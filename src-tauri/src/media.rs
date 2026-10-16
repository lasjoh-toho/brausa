//! Image thumbnails (disk cache) and photo metadata (EXIF GPS + capture date).

use crate::meta::Geo;
use image::{DynamicImage, ImageDecoder, ImageReader};
use serde::Serialize;
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::{self, BufReader};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// Raster formats we can decode. SVG/AVIF/HEIC are not decoded here; the UI
/// shows SVGs directly and falls back to an icon for the rest.
pub const THUMB_EXT: &[&str] = &["jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff"];

fn ext_of(p: &Path) -> String {
    p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
}

/// Cache key: path + size + mtime + requested edge length. Changing the file invalidates the thumb.
fn cache_key(p: &Path, max: u32) -> io::Result<String> {
    let md = fs::metadata(p)?;
    let mtime = md.modified()?.duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let mut h = DefaultHasher::new();
    (p, md.len(), mtime, max).hash(&mut h);
    Ok(format!("{:016x}", h.finish()))
}

fn decode_oriented(p: &Path) -> Result<DynamicImage, String> {
    let mut dec = ImageReader::open(p)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?
        .into_decoder()
        .map_err(|e| e.to_string())?;
    // Phones store portrait photos sideways plus an orientation flag.
    let orientation = dec.orientation().ok();
    let mut img = DynamicImage::from_decoder(dec).map_err(|e| e.to_string())?;
    if let Some(o) = orientation {
        img.apply_orientation(o);
    }
    Ok(img)
}

/// Returns the path of a cached thumbnail (longest edge ≤ `max`), creating it if needed.
pub fn thumbnail(p: &Path, max: u32, cache_dir: &Path) -> Result<PathBuf, String> {
    if !THUMB_EXT.contains(&ext_of(p).as_str()) {
        return Err("Format ohne Vorschau".into());
    }
    let key = cache_key(p, max).map_err(|e| e.to_string())?;
    for ext in ["jpg", "png"] {
        let c = cache_dir.join(format!("{key}.{ext}"));
        if c.exists() {
            return Ok(c);
        }
    }
    let img = decode_oriented(p)?;
    let t = if img.width() > max || img.height() > max { img.thumbnail(max, max) } else { img };
    fs::create_dir_all(cache_dir).map_err(|e| e.to_string())?;
    // Keep transparency for PNG/GIF/WebP sources; everything else is a compact JPEG.
    let out = if t.color().has_alpha() {
        let out = cache_dir.join(format!("{key}.png"));
        t.save_with_format(&out, image::ImageFormat::Png).map_err(|e| e.to_string())?;
        out
    } else {
        let out = cache_dir.join(format!("{key}.jpg"));
        let f = fs::File::create(&out).map_err(|e| e.to_string())?;
        let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(io::BufWriter::new(f), 82);
        enc.encode_image(&t.to_rgb8()).map_err(|e| e.to_string())?;
        out
    };
    Ok(out)
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct MediaInfo {
    pub path: String,
    pub geo: Option<Geo>,
    /// Capture time (ms since epoch) from EXIF DateTimeOriginal, interpreted as UTC.
    pub taken: Option<f64>,
}

fn rational_deg(v: &exif::Value) -> Option<f64> {
    match v {
        exif::Value::Rational(r) if r.len() >= 3 => Some(r[0].to_f64() + r[1].to_f64() / 60.0 + r[2].to_f64() / 3600.0),
        _ => None,
    }
}

pub fn media_info(p: &Path) -> MediaInfo {
    let mut info = MediaInfo { path: p.to_string_lossy().to_string(), geo: None, taken: None };
    let Ok(f) = fs::File::open(p) else { return info };
    let Ok(ex) = exif::Reader::new().read_from_container(&mut BufReader::new(f)) else { return info };

    let field = |t| ex.get_field(t, exif::In::PRIMARY);
    let refchar = |t| field(t).map(|f| f.display_value().to_string()).unwrap_or_default();
    if let (Some(lat), Some(lon)) = (
        field(exif::Tag::GPSLatitude).and_then(|f| rational_deg(&f.value)),
        field(exif::Tag::GPSLongitude).and_then(|f| rational_deg(&f.value)),
    ) {
        let lat = if refchar(exif::Tag::GPSLatitudeRef).starts_with('S') { -lat } else { lat };
        let lon = if refchar(exif::Tag::GPSLongitudeRef).starts_with('W') { -lon } else { lon };
        if lat.is_finite() && lon.is_finite() && (lat != 0.0 || lon != 0.0) {
            info.geo = Some(Geo { lat, lon });
        }
    }
    if let Some(f) = field(exif::Tag::DateTimeOriginal).or_else(|| field(exif::Tag::DateTime)) {
        if let exif::Value::Ascii(ref v) = f.value {
            if let Some(s) = v.first().and_then(|b| std::str::from_utf8(b).ok()) {
                if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(s.trim(), "%Y:%m:%d %H:%M:%S") {
                    info.taken = Some(dt.and_utc().timestamp_millis() as f64);
                }
            }
        }
    }
    info
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thumbnails_are_cached_and_bounded() {
        let t = tempfile::tempdir().unwrap();
        let src = t.path().join("a.png");
        DynamicImage::new_rgb8(1200, 600).save(&src).unwrap();
        let cache = t.path().join("cache");
        let out = thumbnail(&src, 300, &cache).unwrap();
        let img = image::open(&out).unwrap();
        assert_eq!((img.width(), img.height()), (300, 150));
        // Second call hits the cache.
        assert_eq!(thumbnail(&src, 300, &cache).unwrap(), out);
        assert!(thumbnail(&t.path().join("x.svg"), 300, &cache).is_err());
    }

    #[test]
    fn reads_gps_date_and_orientation() {
        let f = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/gps.jpg");
        let i = media_info(&f);
        let g = i.geo.expect("GPS");
        assert!((g.lat - 41.9028).abs() < 1e-3 && (g.lon - 12.4964).abs() < 1e-3);
        // 2024-05-17 14:30:00 (treated as UTC)
        assert_eq!(i.taken, Some(1_715_956_200_000.0));
        // Orientation 6 = rotate 90°: the 64×48 landscape thumbnail becomes portrait.
        let t = tempfile::tempdir().unwrap();
        let thumb = image::open(thumbnail(&f, 64, t.path()).unwrap()).unwrap();
        assert_eq!((thumb.width(), thumb.height()), (48, 64));
    }

    #[test]
    fn media_info_without_exif_is_empty() {
        let t = tempfile::tempdir().unwrap();
        let src = t.path().join("a.png");
        DynamicImage::new_rgb8(4, 4).save(&src).unwrap();
        let i = media_info(&src);
        assert_eq!((i.geo, i.taken), (None, None));
    }
}
