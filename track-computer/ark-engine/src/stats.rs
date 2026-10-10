//! Metingen van de audio-callback: haperingen opsporen zonder iets te horen.

use std::sync::atomic::{AtomicU64, Ordering::Relaxed};
use std::time::Instant;

pub struct Stats {
    start: Instant,
    pub callbacks: AtomicU64,
    pub lock_miss: AtomicU64,   // de callback kon de mixer niet krijgen en bleef even stil
    pub lock_wait_max_us: AtomicU64,
    pub cb_max_us: AtomicU64,   // langste rekentijd van een callback
    pub gap_max_us: AtomicU64,  // langste tijd tussen twee callbacks
    pub frames_last: AtomicU64,
    pub late: AtomicU64,        // callbacks die later kwamen dan 2x hun eigen lengte
    last_us: AtomicU64,
}

impl Stats {
    pub fn new() -> Stats {
        Stats { start: Instant::now(), callbacks: 0.into(), lock_miss: 0.into(), lock_wait_max_us: 0.into(), cb_max_us: 0.into(), gap_max_us: 0.into(), frames_last: 0.into(), late: 0.into(), last_us: 0.into() }
    }
    pub fn now_us(&self) -> u64 {
        self.start.elapsed().as_micros() as u64
    }
    /// bij het begin van elke callback
    pub fn begin(&self, frames: usize) -> u64 {
        let now = self.now_us();
        let last = self.last_us.swap(now, Relaxed);
        let n = self.callbacks.fetch_add(1, Relaxed);
        self.frames_last.store(frames as u64, Relaxed);
        if n > 0 {
            let gap = now - last;
            self.gap_max_us.fetch_max(gap, Relaxed);
            if gap as f64 > 2.0 * frames as f64 / 48000.0 * 1e6 {
                self.late.fetch_add(1, Relaxed);
            }
        }
        now
    }
    pub fn end(&self, began: u64) {
        self.cb_max_us.fetch_max(self.now_us() - began, Relaxed);
    }
    /// leest en wist de maxima
    pub fn take(&self) -> (u64, u64, u64, u64, u64, u64) {
        (self.callbacks.load(Relaxed), self.lock_miss.swap(0, Relaxed), self.late.swap(0, Relaxed), self.cb_max_us.swap(0, Relaxed), self.gap_max_us.swap(0, Relaxed), self.lock_wait_max_us.swap(0, Relaxed))
    }
}
