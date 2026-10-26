//! Stems, bus-indeling en het laden van een nummer (ark-player.json of song.json), zoals `core.swift`.

use crate::decode::decode_file;
use crate::tempo::TempoMap;
use serde_json::Value;
use std::path::Path;

pub const SR: f64 = 48000.0;

/// Eenvoudige shell-glob (alleen `*` en `?`), genoeg voor de busnamen
pub fn fnmatch(pat: &str, s: &str) -> bool {
    let p: Vec<char> = pat.chars().collect();
    let t: Vec<char> = s.chars().collect();
    fn rec(p: &[char], t: &[char]) -> bool {
        match p.first() {
            None => t.is_empty(),
            Some('*') => (0..=t.len()).any(|i| rec(&p[1..], &t[i..])),
            Some('?') => !t.is_empty() && rec(&p[1..], &t[1..]),
            Some(c) => t.first() == Some(c) && rec(&p[1..], &t[1..]),
        }
    }
    rec(&p, &t)
}

pub const DEFAULT_BUSSES: &[(&str, usize, &[&str])] = &[
    ("CLICK", 1, &["click*", "metronome*"]),
    ("GUIDE", 2, &["guide*", "cues*"]),
    ("DRUMS / PERC", 3, &["drum*", "perc*", "loop*"]),
    ("BASS", 4, &["bass*", "synth bass*", "sub*"]),
    ("KEYS", 5, &["keys*", "piano*", "organ*", "synth*", "rhodes*"]),
    ("GITAREN", 6, &["eg*", "ag*", "gtr*", "guitar*"]),
    ("BGV / KOOR", 7, &["choir*", "bgv*", "vox*", "vocal*", "voc*", "soprano*", "alto*", "tenor*", "bari*", "gang*"]),
    ("PADS / STRINGS / FX", 8, &["pad*", "string*", "fx*", "synth fx*", "brass*"]),
];
pub const PRIORITY_BUSSES: &[(&str, usize)] = &[("synth fx*", 8), ("synth bass*", 4), ("vox fx*", 7)];
pub const LIVE_STEMS: &[&str] = &["drums*", "bass", "keys", "piano 1*", "eg 1*"];

pub fn bus_for(stem: &str) -> (usize, &'static str) {
    let s = stem.to_lowercase();
    let s = s.trim();
    for (pat, out) in PRIORITY_BUSSES {
        if fnmatch(pat, s) {
            if let Some(b) = DEFAULT_BUSSES.iter().find(|b| b.1 == *out) {
                return (b.1, b.0);
            }
        }
    }
    for b in DEFAULT_BUSSES {
        if b.2.iter().any(|p| fnmatch(p, s)) {
            return (b.1, b.0);
        }
    }
    (8, "PADS / STRINGS / FX")
}

pub fn is_live(name: &str) -> bool {
    let s = name.to_lowercase();
    LIVE_STEMS.iter().any(|p| fnmatch(p, &s))
}

pub struct Stem {
    pub name: String,
    pub frames: usize,
    pub ch: Vec<Vec<f32>>,
    pub bus: usize,
    pub bus_name: &'static str,
    pub monitor: bool,
    pub is_guide: bool,
    pub live: bool,
    pub gain: f32,
    pub mute: bool,
    pub solo: bool,
    pub peak: f32,
    pub out_a: usize,
    pub out_b: Option<usize>,
    pub mono: bool,
    pub trim: f32,
}

impl Stem {
    pub fn new(name: &str, ch: Vec<Vec<f32>>) -> Stem {
        let (bus, bus_name) = bus_for(name);
        let up = name.to_uppercase();
        let up = up.trim();
        Stem {
            name: name.to_string(),
            frames: ch[0].len(),
            ch,
            bus,
            bus_name,
            monitor: up.starts_with("CLICK") || up.starts_with("GUIDE") || bus_name == "CLICK" || bus_name == "GUIDE",
            is_guide: up.starts_with("GUIDE"),
            live: false,
            gain: 1.0,
            mute: false,
            solo: false,
            peak: 0.0,
            out_a: 0,
            out_b: None,
            mono: false,
            trim: 1.0,
        }
    }
}

#[derive(Clone, Debug)]
pub struct Section {
    pub id: i64,
    pub name: String,
    pub start: f64,
    pub end: f64,
}

#[derive(Default)]
pub struct Song {
    pub title: String,
    pub folder: String,
    pub stems: Vec<Stem>,
    pub sections: Vec<Section>,
    pub tempo: TempoMap,
    pub has_original_click: bool,
    pub rpp: Option<String>,
    /// Golfvorm van het hele nummer: piek per 1/PEAK_RATE seconde (0-255, na compressie), zonder click en guide
    pub peaks: Vec<u8>,
    /// Idem, effectieve waarde (het "volume" van de mix)
    pub rms: Vec<u8>,
    /// Referentie: de originele opname (een eigen bestand Reference.<mp3|m4a|wav|flac|aiff> in de songmap) om mee te vergelijken; wordt pas geladen als je hem aanzet
    pub ref_path: Option<String>,
    pub reference: Option<Stem>,
    /// frames: waar 0:00 van het nummer in de referentie ligt (positief = de referentie begint eerder)
    pub ref_offset: i64,
}

/// Aantal golfvormblokjes per seconde (10 = elk blokje 100 ms)
pub const PEAK_RATE: f64 = 10.0;

pub const REFERENCE_EXTS: [&str; 8] = ["wav", "mp3", "m4a", "aac", "flac", "aif", "aiff", "caf"];

impl Song {
    /// Zoekt Reference.* in de songmap en leest de verschuiving uit ark-reference.json
    pub fn find_reference(&mut self) {
        self.ref_path = None;
        if self.folder.is_empty() {
            return;
        }
        if let Ok(rd) = std::fs::read_dir(&self.folder) {
            for e in rd.flatten() {
                let n = e.file_name().to_string_lossy().to_string();
                let l = n.to_lowercase();
                if l.starts_with("reference.") && REFERENCE_EXTS.contains(&l.rsplit('.').next().unwrap_or("")) {
                    self.ref_path = Some(format!("{}/{}", self.folder, n));
                    break;
                }
            }
        }
        if let Ok(d) = std::fs::read(Path::new(&self.folder).join("ark-reference.json")) {
            if let Ok(j) = serde_json::from_slice::<Value>(&d) {
                if let Some(o) = j["offset"].as_f64() {
                    self.ref_offset = (o * 48000.0).round() as i64;
                }
            }
        }
    }
    pub fn save_reference_offset(&self) {
        if self.folder.is_empty() {
            return;
        }
        let j = serde_json::json!({"offset": self.ref_offset as f64 / 48000.0});
        let _ = std::fs::write(Path::new(&self.folder).join("ark-reference.json"), j.to_string());
    }
    pub fn total(&self) -> usize {
        self.stems.iter().map(|s| s.frames).max().unwrap_or(0)
    }

    /// Golfvorm voor de weergave op het podium: alle stems behalve click en guide, in stappen van 1 s opgeteld (geen kopie van het hele
    /// nummer in het geheugen), genormaliseerd op de hoogste piek en met x^0,6 samengedrukt zodat een rustig begin zichtbaar blijft naast een hard refrein.
    pub fn compute_peaks(&mut self) {
        let bucket = ((SR / PEAK_RATE) as usize).max(1);
        let total = self.total();
        if total == 0 {
            return;
        }
        let n = (total + bucket - 1) / bucket;
        let (mut pk, mut sq) = (vec![0.0f32; n], vec![0.0f32; n]);
        let stems: Vec<&Stem> = self.stems.iter().filter(|s| !s.monitor).collect();
        let chunk = bucket * 10; // een veelvoud van het blokje: elk stuk begint op een blokgrens
        let mut mix = vec![0.0f32; chunk];
        let mut start = 0usize;
        while start < total {
            let len = chunk.min(total - start);
            for v in mix[..len].iter_mut() {
                *v = 0.0;
            }
            for s in &stems {
                if start >= s.frames {
                    continue;
                }
                let l = len.min(s.frames - start);
                if s.ch.len() > 1 {
                    let (a, b) = (&s.ch[0][start..start + l], &s.ch[1][start..start + l]);
                    for i in 0..l {
                        mix[i] += (a[i] + b[i]) * 0.5;
                    }
                } else {
                    let a = &s.ch[0][start..start + l];
                    for i in 0..l {
                        mix[i] += a[i];
                    }
                }
            }
            let (mut b, mut i) = (start / bucket, 0usize);
            while i < len {
                let e = (i + bucket).min(len);
                let (mut m, mut ss) = (0.0f32, 0.0f32);
                for k in i..e {
                    let v = mix[k];
                    let a = v.abs();
                    if a > m {
                        m = a;
                    }
                    ss += v * v;
                }
                pk[b] = m;
                sq[b] = (ss / (e - i) as f32).sqrt();
                b += 1;
                i = e;
            }
            start += len;
        }
        let top = pk.iter().cloned().fold(0.0f32, f32::max).max(1e-6);
        let scale = |v: f32| -> u8 { ((v / top).powf(0.6) * 255.0).clamp(0.0, 255.0) as u8 };
        self.peaks = pk.iter().map(|&v| scale(v)).collect();
        self.rms = sq.iter().map(|&v| scale(v)).collect();
    }
}

fn num(v: &Value) -> Option<f64> {
    v.as_f64()
}

pub fn load_stem(path: &Path, name: &str, offset: usize) -> Result<Stem, String> {
    let d = decode_file(path, 0)?;
    let mut ch = if d.rate != 48000 { crate::resample::to_rate(d.ch, d.rate, 48000).map_err(|e| format!("{name}: {e}"))? } else { d.ch };
    if offset > 0 {
        // een stem die later begint: stilte ervoor (op 48 kHz)
        for c in ch.iter_mut() {
            let mut v = vec![0.0f32; offset];
            v.extend_from_slice(c);
            *c = v;
        }
    }
    Ok(Stem::new(name, ch))
}

/// Beschikbaar en totaal werkgeheugen in bytes (waar het systeem dat laat zien)
pub fn mem_available() -> Option<u64> {
    crate::platform::memory().0
}
pub fn mem_total() -> Option<u64> {
    crate::platform::memory().1
}

/// Stems laden met een beperkt aantal tegelijk: elke stem heeft tijdens het decoderen en omrekenen even het dubbele nodig,
/// en alle stems tegelijk (26) vult het werkgeheugen van een gewone laptop.
fn load_parallel(items: Vec<(std::path::PathBuf, String, usize, bool)>) -> Result<Vec<Stem>, String> {
    // is er genoeg geheugen voor het hele nummer? (48 kHz, Float32, kanalen zoals in het bestand) Zo niet: een melding, geen crash.
    if let Some(avail) = mem_available() {
        let (mut need, mut biggest_src): (u64, u64) = (0, 0);
        for (p, _, off, _) in &items {
            let (secs, ch, rate) = crate::decode::stem_info(p).unwrap_or((0.0, 2, 48000));
            need += ((secs + *off as f64 / SR) * SR) as u64 * ch as u64 * 4;
            // tijdens het laden staat een stem even twee keer in het geheugen (gedecodeerd en omgerekend)
            biggest_src = biggest_src.max((secs * rate as f64) as u64 * ch as u64 * 4 + (secs * SR) as u64 * ch as u64 * 4);
        }
        let headroom: u64 = 3 * biggest_src + 300_000_000;
        if need + headroom > avail {
            return Err(format!(
                "Te weinig geheugen om dit nummer te laden: nodig ongeveer {} MB, beschikbaar {} MB. Sluit andere programma's of kies een kleiner nummer.",
                (need + headroom) / 1_000_000,
                avail / 1_000_000
            ));
        }
    }
    let workers = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(2).clamp(1, 3);
    let next = std::sync::atomic::AtomicUsize::new(0);
    let results: std::sync::Mutex<Vec<Option<Result<Stem, String>>>> = std::sync::Mutex::new((0..items.len()).map(|_| None).collect());
    std::thread::scope(|sc| {
        for _ in 0..workers {
            sc.spawn(|| loop {
                let i = next.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                if i >= items.len() {
                    break;
                }
                let (p, n, off, mute) = &items[i];
                let r = load_stem(p, n, *off).map(|mut s| {
                    s.mute = *mute;
                    s
                });
                results.lock().unwrap()[i] = Some(r);
            });
        }
    });
    let mut out = Vec::new();
    for r in results.into_inner().unwrap() {
        out.push(r.ok_or("laden mislukt")??);
    }
    Ok(out)
}

pub fn load_song(folder: &str) -> Result<Song, String> {
    let base = Path::new(folder);
    if let Ok(data) = std::fs::read(base.join("ark-player.json")) {
        let j: Value = serde_json::from_slice(&data).map_err(|e| e.to_string())?;
        return load_player_file(folder, &j);
    }
    Err("alleen ark-player.json wordt ondersteund (song.json volgt)".into())
}

pub fn load_player_file(folder: &str, j: &Value) -> Result<Song, String> {
    let base = Path::new(folder);
    let mut song = Song { folder: folder.to_string(), ..Default::default() };
    song.title = j["title"].as_str().map(String::from).unwrap_or_else(|| base.file_name().unwrap().to_string_lossy().into());
    let mut items = Vec::new();
    for s in j["stems"].as_array().into_iter().flatten() {
        let Some(f) = s["file"].as_str() else { continue };
        let name = s["name"].as_str().map(String::from).unwrap_or_else(|| Path::new(f).file_stem().unwrap().to_string_lossy().into());
        let offset = (num(&s["offset"]).unwrap_or(0.0) * SR) as usize; // Swift: Int(x), naar nul afgekapt
        items.push((base.join(f), name, offset, s["mute"].as_bool().unwrap_or(false)));
    }
    song.stems = load_parallel(items)?;
    if song.stems.is_empty() {
        return Err(format!("Geen stems gevonden in {folder}"));
    }
    for st in &mut song.stems {
        st.live = is_live(&st.name);
    }
    let tempo: Vec<(f64, f64)> = j["tempo_qn"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|r| {
            let r = r.as_array()?;
            (r.len() == 2).then(|| Some((num(&r[0])?, num(&r[1])?)))?
        })
        .collect();
    let sigs: Vec<(f64, f64, f64)> = j["timesig"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|r| {
            let r = r.as_array()?;
            (r.len() == 3).then(|| Some((num(&r[0])?, num(&r[1])?, num(&r[2])?)))?
        })
        .collect();
    song.tempo = if tempo.is_empty() { TempoMap::default() } else { TempoMap::from_qn(tempo, sigs) };
    let mut secs: Vec<Section> = Vec::new();
    for (k, s) in j["sections"].as_array().into_iter().flatten().enumerate() {
        if let (Some(n), Some(t)) = (s["name"].as_str(), num(&s["sec"])) {
            secs.push(Section { id: s["id"].as_i64().unwrap_or(k as i64 + 1), name: n.to_string(), start: t, end: 0.0 });
        }
    }
    secs.sort_by(|a, b| a.start.partial_cmp(&b.start).unwrap());
    let total = song.total() as f64 / SR;
    for i in 0..secs.len() {
        secs[i].end = if i + 1 < secs.len() { secs[i + 1].start } else { total };
    }
    song.rpp = j["rpp"].as_str().map(String::from);
    song.sections = secs;
    song.has_original_click = song.stems.iter().any(|s| s.name.to_lowercase().starts_with("click") && !s.name.starts_with("Click 1/"));
    song.compute_peaks();
    song.find_reference();
    Ok(song)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn glob() {
        assert!(fnmatch("drum*", "drums bus"));
        assert!(!fnmatch("bass", "bass 2"));
        assert!(fnmatch("a?c", "abc"));
    }
    #[test]
    fn peaks_of_two_stems() {
        // 2 s stilte, daarna 1 s sinus; click telt niet mee
        let n = 3 * 48000;
        let tone: Vec<f32> = (0..n).map(|i| if i < 96000 { 0.0 } else { 0.5 * (i as f32 * 0.05).sin() }).collect();
        let mut song = Song::default();
        song.stems.push(Stem::new("Keys", vec![tone.clone(), tone.clone()]));
        song.stems.push(Stem::new("Click", vec![vec![1.0; n]]));
        song.compute_peaks();
        assert_eq!(song.peaks.len(), 30);
        assert_eq!(song.rms.len(), 30);
        assert_eq!(song.peaks[0], 0);
        assert_eq!(song.peaks[19], 0);
        assert_eq!(song.peaks[25], 255); // de hoogste piek is 255
        assert!(song.rms[25] > 100 && song.rms[25] < song.peaks[25]);
    }
    #[test]
    fn buses() {
        assert_eq!(bus_for("Synth Bass").0, 4);
        assert_eq!(bus_for("Synth FX 2").0, 8);
        assert_eq!(bus_for("Click").0, 1);
        assert_eq!(bus_for("Guide").0, 2);
        assert_eq!(bus_for("EG 1").0, 6);
        assert_eq!(bus_for("onbekend").0, 8);
    }
}

/// Titel, secties en tempo uit ark-player.json zonder de audio te laden. De lengte volgt uit de stems (bestandskoppen).
pub fn outline_from_json(folder: &str, j: &Value) -> (String, Vec<Section>, TempoMap) {
    let base = Path::new(folder);
    let mut total = 0.0f64;
    for s in j["stems"].as_array().into_iter().flatten() {
        let Some(f) = s["file"].as_str() else { continue };
        let off = num(&s["offset"]).unwrap_or(0.0);
        if let Some(d) = crate::decode::duration_secs(&base.join(f)) {
            total = total.max(off + d);
        }
    }
    let tempo: Vec<(f64, f64)> = j["tempo_qn"].as_array().into_iter().flatten().filter_map(|r| {
        let r = r.as_array()?;
        (r.len() == 2).then(|| Some((num(&r[0])?, num(&r[1])?)))?
    }).collect();
    let sigs: Vec<(f64, f64, f64)> = j["timesig"].as_array().into_iter().flatten().filter_map(|r| {
        let r = r.as_array()?;
        (r.len() == 3).then(|| Some((num(&r[0])?, num(&r[1])?, num(&r[2])?)))?
    }).collect();
    let mut secs: Vec<Section> = Vec::new();
    for (k, s) in j["sections"].as_array().into_iter().flatten().enumerate() {
        if let (Some(n), Some(t)) = (s["name"].as_str(), num(&s["sec"])) {
            secs.push(Section { id: s["id"].as_i64().unwrap_or(k as i64 + 1), name: n.to_string(), start: t, end: 0.0 });
        }
    }
    secs.sort_by(|a, b| a.start.partial_cmp(&b.start).unwrap());
    for i in 0..secs.len() {
        secs[i].end = if i + 1 < secs.len() { secs[i + 1].start } else { total };
    }
    let title = j["title"].as_str().map(String::from).unwrap_or_else(|| base.file_name().unwrap().to_string_lossy().into());
    (title, secs, if tempo.is_empty() { TempoMap::default() } else { TempoMap::from_qn(tempo, sigs) })
}
