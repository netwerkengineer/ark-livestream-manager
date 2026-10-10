//! Padspeler in de speler: ambient pads per toonsoort, los van de nummers (ze lopen door bij stoppen, starten en nummerwissels).
//! Zelfde bestanden en uitgangen als ArkPads op de track-computer (pads.swift):
//!   <padsmap>/<set>/<laag>/<toon>.wav   (bv. Fundamental/Deep/Eb.wav)
//!   uitgangsmodus multi -> uitgang 8 (PADS-bus van de X32), 3ch -> uitgang 2+3, 2ch -> uitgang 2, stereo -> 1+2
//! De pad wordt volledig in het geheugen geladen (op de achtergrond) en daarna met een crossfade ingewisseld.

use crate::decode::decode_file;
use crate::player::home;
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

pub struct PadVoice {
    l: Vec<f32>,
    r: Vec<f32>,
    pos: usize,
    gain: f32,
    target: f32,
    step: f32, // gain-verandering per frame
    dying: bool,
    id: u64,
}

struct Inner {
    voices: Vec<PadVoice>,
    current: Option<u64>,
    volume: f32,
    /// uitgefadede pads: de besturing ruimt ze op (geen geheugen vrijgeven in de audio-callback)
    graveyard: Vec<PadVoice>,
}

#[derive(Default, Clone)]
pub struct PadMeta {
    pub set: String,
    pub layer: String,
    pub key: String,
    pub error: String,
    pub loading: bool,
    pub last_cmd: String,
    pub root: String, // pads-map (leeg = ~/Tracks/Pads)
    pub library: BTreeMap<String, Vec<String>>,
}

struct Shared {
    inner: Mutex<Inner>,
    meta: Mutex<PadMeta>,
    generation: AtomicU64,
    next_id: AtomicU64,
}

#[derive(Clone)]
pub struct PadPlayer {
    shared: Arc<Shared>,
}

impl Default for PadPlayer {
    fn default() -> Self {
        PadPlayer {
            shared: Arc::new(Shared {
                inner: Mutex::new(Inner { voices: Vec::new(), current: None, volume: 0.8, graveyard: Vec::with_capacity(8) }),
                meta: Mutex::new(PadMeta::default()),
                generation: AtomicU64::new(0),
                next_id: AtomicU64::new(1),
            }),
        }
    }
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl PadPlayer {
    pub fn dir(&self) -> String {
        let r = lock(&self.shared.meta).root.clone();
        if r.is_empty() { format!("{}/Tracks/Pads", home()) } else { r }
    }
    pub fn set_root(&self, root: &str) {
        lock(&self.shared.meta).root = root.to_string();
        self.scan();
    }
    pub fn meta(&self) -> PadMeta {
        lock(&self.shared.meta).clone()
    }
    pub fn set_last_cmd(&self, c: &str) {
        lock(&self.shared.meta).last_cmd = c.to_string();
    }
    pub fn playing(&self) -> bool {
        lock(&self.shared.inner).current.is_some()
    }
    pub fn volume(&self) -> f32 {
        lock(&self.shared.inner).volume
    }
    pub fn set_volume(&self, v: f32) {
        lock(&self.shared.inner).volume = v.max(0.0).min(1.0);
    }
    pub fn voice_count(&self) -> usize {
        lock(&self.shared.inner).voices.len()
    }

    // ---- bibliotheek
    pub fn scan(&self) {
        let dir = self.dir();
        let mut sets: BTreeMap<String, Vec<String>> = BTreeMap::new();
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for s in rd.filter_map(|e| e.ok()) {
                let sname = s.file_name().to_string_lossy().to_string();
                if sname.starts_with('.') || sname.starts_with('_') || !s.path().is_dir() {
                    continue;
                }
                let mut layers: Vec<String> = Vec::new();
                if let Ok(ld) = std::fs::read_dir(s.path()) {
                    for l in ld.filter_map(|e| e.ok()) {
                        let lname = l.file_name().to_string_lossy().to_string();
                        if lname.starts_with('.') || !l.path().is_dir() {
                            continue;
                        }
                        let has_wav = std::fs::read_dir(l.path()).map(|d| d.filter_map(|e| e.ok()).any(|e| e.file_name().to_string_lossy().to_lowercase().ends_with(".wav"))).unwrap_or(false);
                        if has_wav {
                            layers.push(lname);
                        }
                    }
                }
                if !layers.is_empty() {
                    layers.sort();
                    sets.insert(sname, layers);
                }
            }
        }
        lock(&self.shared.meta).library = sets;
    }

    // ---- bestand -> geheugen (48 kHz, stereo)
    fn decode(path: &str, sr: u32) -> Result<(Vec<f32>, Vec<f32>), String> {
        let d = decode_file(Path::new(path), 0)?;
        let ch = if d.rate != sr { crate::resample::to_rate(d.ch, d.rate, sr)? } else { d.ch };
        if ch[0].is_empty() {
            return Err("leeg bestand".into());
        }
        let mut it = ch.into_iter();
        let l = it.next().unwrap();
        let r = it.next().unwrap_or_else(|| l.clone());
        Ok((l, r))
    }

    // ---- bediening (niet vanuit de audiothread)
    pub fn play(&self, set: &str, layer: &str, key: &str, fade: f64, sr: f64) {
        let path = format!("{}/{}/{}/{}.wav", self.dir(), set, layer, key);
        // geen paden buiten de padsmap
        if [set, layer, key].iter().any(|p| p.contains('/') || p.contains("..") || p.is_empty()) || !Path::new(&path).exists() {
            lock(&self.shared.meta).error = format!("Pad niet gevonden: {set}/{layer}/{key}");
            return;
        }
        let generation = self.shared.generation.fetch_add(1, Ordering::SeqCst) + 1;
        {
            let mut m = lock(&self.shared.meta);
            m.error.clear();
            m.loading = true;
            m.set = set.into();
            m.layer = layer.into();
            m.key = key.into();
        }
        let sh = self.shared.clone();
        std::thread::spawn(move || match PadPlayer::decode(&path, sr as u32) {
            Ok((l, r)) => {
                let n = (fade.max(0.05) * sr) as f32;
                let id = sh.next_id.fetch_add(1, Ordering::SeqCst);
                let v = PadVoice { l, r, pos: 0, gain: 0.0, target: 1.0, step: 1.0 / n, dying: false, id };
                let mut inner = lock(&sh.inner);
                if generation == sh.generation.load(Ordering::SeqCst) {
                    // een nieuwere keuze wint
                    if let Some(cur) = inner.current {
                        if let Some(old) = inner.voices.iter_mut().find(|x| x.id == cur) {
                            old.target = 0.0;
                            old.step = -old.gain.max(0.0001) / n;
                            old.dying = true;
                        }
                    }
                    inner.voices.push(v);
                    inner.current = Some(id);
                }
                drop(inner);
                lock(&sh.meta).loading = false;
            }
            Err(e) => {
                let mut m = lock(&sh.meta);
                m.error = format!("Pad laden mislukt: {e}");
                m.loading = false;
            }
        });
    }

    pub fn stop(&self, fade: f64, sr: f64) {
        self.shared.generation.fetch_add(1, Ordering::SeqCst);
        {
            let mut m = lock(&self.shared.meta);
            m.key.clear();
            m.loading = false;
        }
        let mut inner = lock(&self.shared.inner);
        let Some(cur) = inner.current.take() else { return };
        if let Some(c) = inner.voices.iter_mut().find(|x| x.id == cur) {
            c.target = 0.0;
            c.step = -c.gain.max(0.0001) / (fade.max(0.05) * sr) as f32;
            c.dying = true;
        }
    }

    /// Door de besturing aangeroepen: uitgefadede pads vrijgeven
    pub fn cleanup(&self) {
        let dead: Vec<PadVoice> = match self.shared.inner.try_lock() {
            Ok(mut g) => g.graveyard.drain(..).collect(),
            Err(_) => return,
        };
        drop(dead);
    }

    // ---- audiothread: mengt de pads bij de uitgangen van de mixer (zonder te wachten: is de lock bezet dan slaat dit blok de pads over)
    pub fn mix(&self, frames: usize, out: &mut [Vec<f32>], mode: &str) {
        let Ok(mut g) = self.shared.inner.try_lock() else { return };
        if g.voices.is_empty() {
            return;
        }
        let n_out = out.len();
        // doeluitgangen: (links, rechts of None voor mono)
        let (a, mut b): (usize, Option<usize>) = match mode {
            "multi" => (7.min(n_out - 1), None),
            "3ch" => (1.min(n_out - 1), Some(2.min(n_out - 1))),
            "2ch" => (1.min(n_out - 1), None),
            _ => (0, if n_out > 1 { Some(1) } else { None }),
        };
        if b == Some(a) {
            b = None;
        }
        let vol = g.volume;
        for v in g.voices.iter_mut() {
            let n = v.l.len();
            for i in 0..frames {
                v.gain += v.step;
                if (v.step > 0.0 && v.gain >= v.target) || (v.step < 0.0 && v.gain <= v.target) {
                    v.gain = v.target;
                    v.step = 0.0;
                }
                let gain = v.gain * vol;
                let p = v.pos;
                if let Some(b) = b {
                    out[a][i] += v.l[p] * gain;
                    out[b][i] += v.r[p] * gain;
                } else {
                    out[a][i] += (v.l[p] + v.r[p]) * 0.5 * gain;
                }
                v.pos = if p + 1 >= n { 0 } else { p + 1 };
            }
        }
        let mut i = 0;
        while i < g.voices.len() {
            if g.voices[i].dying && g.voices[i].gain <= 0.0 {
                let v = g.voices.remove(i);
                if g.graveyard.len() < 8 {
                    g.graveyard.push(v);
                } else {
                    std::mem::forget(v);
                }
            } else {
                i += 1;
            }
        }
    }
}
