//! Language of messages the core shows to the user (errors, sync reports).
//! The frontend sets it at start and whenever the language changes; until
//! then the environment (LANG) decides.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

static EN: AtomicBool = AtomicBool::new(false);
static INIT: OnceLock<()> = OnceLock::new();

fn init() {
    INIT.get_or_init(|| {
        let lang = ["LC_ALL", "LC_MESSAGES", "LANG"].iter().find_map(|k| std::env::var(k).ok().filter(|v| !v.is_empty())).unwrap_or_default();
        EN.store(!lang.to_lowercase().starts_with("de"), Ordering::Relaxed);
    });
}

pub fn set(lang: &str) {
    init();
    EN.store(lang != "de", Ordering::Relaxed);
}

pub fn en() -> bool {
    init();
    EN.load(Ordering::Relaxed)
}

/// `tr!("Deutsch", "English")`; both arms may be `format!(…)` as well.
#[macro_export]
macro_rules! tr {
    ($de:expr, $en:expr) => {
        if $crate::i18n::en() {
            $en
        } else {
            $de
        }
    };
}
