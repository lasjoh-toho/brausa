//! Notices when brausa's interface stops responding (a view stuck in a long
//! computation) and restarts it.
//!
//! The interface reports every two seconds (`alive`) with what it shows (opaque
//! to the core). When the window is in front and nothing came for 10 seconds,
//! brausa restarts. A marker file keeps the last report, so the next start (also
//! after the app was killed) opens without the stuck folder and offers to go on
//! with a narrower view.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

/// No report for this long while the window is in front: the interface hangs.
const STUCK: Duration = Duration::from_secs(10);

pub struct Watchdog {
    marker: PathBuf,
    state: Mutex<State>,
}

struct State {
    last: Option<Instant>,
    view: String,
    stuck: bool,
    /// The marker file is written (removed again once the interface responds).
    marked: bool,
}

impl Watchdog {
    pub fn new(app_dir: &Path) -> Watchdog {
        Watchdog { marker: app_dir.join("stuck.txt"), state: Mutex::new(State { last: None, view: String::new(), stuck: false, marked: false }) }
    }

    /// The interface is responsive and shows `view`.
    pub fn alive(&self, view: String) {
        let Ok(mut s) = self.state.lock() else { return };
        s.last = Some(Instant::now());
        s.view = view;
        if s.marked {
            // It recovered by itself.
            s.stuck = false;
            s.marked = false;
            let _ = fs::remove_file(&self.marker);
        }
    }

    /// The view that hung last time, once (the marker is removed).
    pub fn take_stuck(&self) -> Option<String> {
        let view = fs::read_to_string(&self.marker).ok()?;
        let _ = fs::remove_file(&self.marker);
        Some(view)
    }

    /// Watches in a thread of its own.
    pub fn start(app: AppHandle) {
        std::thread::spawn(move || {
            let mut tick = Instant::now();
            loop {
                std::thread::sleep(Duration::from_secs(1));
                let dog = app.state::<Watchdog>();
                let slept = tick.elapsed() > Duration::from_secs(5);
                tick = Instant::now();
                let front = app
                    .get_window("main")
                    .is_some_and(|w| w.is_focused().unwrap_or(false) && !w.is_minimized().unwrap_or(false));
                let view = {
                    let Ok(mut s) = dog.state.lock() else { continue };
                    // After sleep, or while in the background (timers are slowed), nothing to judge.
                    if slept || !front {
                        if s.last.is_some() {
                            s.last = Some(Instant::now());
                        }
                        continue;
                    }
                    match s.last {
                        Some(t) if !s.stuck && t.elapsed() > STUCK => {
                            s.stuck = true;
                            s.marked = true;
                            s.view.clone()
                        }
                        _ => continue,
                    }
                };
                // The interface cannot be freed from outside: restart, and let the next
                // start know where it got stuck (it then opens without that folder).
                let _ = fs::write(&dog.marker, &view);
                app.restart();
            }
        });
    }
}
