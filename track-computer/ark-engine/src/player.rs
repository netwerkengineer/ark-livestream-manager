//! Player: alles rond de mixer wat REAPER + de bridge samen deden - nummers en setlist, overgangen tussen nummers,
//! FreeShow-cues (REST) met voorlooptijd, timing opnemen en de bewaarde instellingen (player.swift).

use crate::cues::{build_timeline, CueTable, Recording, SlideTime};
use crate::mixer::Mixer;
use crate::song::{load_song, Song};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Instant;

pub fn log(s: &str) {
    use std::io::Write;
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap();
    let secs = now.as_secs() % 86400;
    let line = format!("{:02}:{:02}:{:02}.{:03} {}\n", secs / 3600, secs / 60 % 60, secs % 60, now.subsec_millis(), s);
    eprint!("{line}");
    let path = log_path();
    if let Some(dir) = Path::new(&path).parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if std::fs::metadata(&path).map(|m| m.len() > 1_000_000).unwrap_or(false) {
        let _ = std::fs::rename(&path, format!("{path}.1"));
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = f.write_all(line.as_bytes());
    }
}

pub fn home() -> String {
    std::env::var("HOME").unwrap_or_else(|_| ".".into())
}
fn log_path() -> String {
    std::env::var("ARK_LOG").unwrap_or_else(|_| {
        let base = std::env::var("XDG_STATE_HOME").unwrap_or_else(|_| format!("{}/.local/state", home()));
        format!("{base}/ArkTracks/ArkTracks.log")
    })
}
pub fn config_dir() -> String {
    let base = std::env::var("XDG_CONFIG_HOME").unwrap_or_else(|_| format!("{}/.config", home()));
    format!("{base}/ArkTracks")
}

pub struct LibSong {
    pub name: String,
    pub path: String,
    pub folder: String,
}

#[derive(Clone)]
pub struct Config {
    pub output_mode: String,
    pub jump_mode: String,
    pub lead_beats: f64,
    pub fs_host: String,
    pub fs_port: i64,
    pub last_host: String,
    pub last_port: i64,
    pub device: String,
    pub songs_root: String,
    pub pads_root: String,
    pub path: String,
}

impl Config {
    pub fn new() -> Config {
        Config {
            output_mode: "stereo".into(),
            jump_mode: "end".into(),
            lead_beats: 2.0,
            fs_host: String::new(),
            fs_port: 5506,
            last_host: String::new(),
            last_port: 5506,
            device: String::new(),
            songs_root: String::new(),
            pads_root: String::new(),
            path: std::env::var("ARK_PLAYER_CONFIG").unwrap_or_else(|_| format!("{}/player.json", config_dir())),
        }
    }
    pub fn load(&mut self) {
        let Ok(d) = std::fs::read(&self.path) else { return };
        let Ok(j) = serde_json::from_slice::<Value>(&d) else { return };
        let s = |k: &str, cur: &str| j[k].as_str().map(String::from).unwrap_or_else(|| cur.to_string());
        self.output_mode = s("output_mode", &self.output_mode);
        self.jump_mode = s("jump_mode", &self.jump_mode);
        self.lead_beats = j["lead_beats"].as_f64().unwrap_or(self.lead_beats);
        self.fs_host = s("freeshow_host", &self.fs_host);
        self.fs_port = j["freeshow_port"].as_i64().unwrap_or(self.fs_port);
        self.last_host = s("freeshow_last_host", &self.last_host);
        self.last_port = j["freeshow_last_port"].as_i64().unwrap_or(self.last_port);
        self.device = s("device", &self.device);
        self.songs_root = s("songs_root", &self.songs_root);
        self.pads_root = s("pads_root", &self.pads_root);
    }
    pub fn save(&self) {
        let j = json!({"output_mode": self.output_mode, "jump_mode": self.jump_mode, "lead_beats": self.lead_beats, "freeshow_host": self.fs_host,
            "freeshow_port": self.fs_port, "freeshow_last_host": self.last_host, "freeshow_last_port": self.last_port, "device": self.device,
            "songs_root": self.songs_root, "pads_root": self.pads_root});
        if let Some(d) = Path::new(&self.path).parent() {
            let _ = std::fs::create_dir_all(d);
        }
        let tmp = format!("{}.tmp", self.path);
        if std::fs::write(&tmp, serde_json::to_vec_pretty(&j).unwrap()).is_ok() {
            let _ = std::fs::rename(&tmp, &self.path);
        }
    }
}

pub type Res<T> = Result<T, String>;

pub struct State {
    pub cfg: Config,
    pub songs_root: String,
    pub max_cache_bytes: usize,
    pub library: Vec<LibSong>,
    /// nummers die in het geheugen staan maar niet actief zijn (het actieve nummer zit in de mixer)
    pub cache: HashMap<String, Song>,
    pub loading: HashSet<String>,
    pub setlist: Vec<String>,
    pub active_path: String,
    pub active_folder: String,
    pub want_active: Option<(String, String, bool)>,
    pub switch_target: Option<(String, String)>,
    pub error: Option<String>,
    pub last_cmd: String,
    pub table: Option<CueTable>,
    pub timeline: Vec<SlideTime>,
    pub sent: Option<i64>,
    pub was_playing: bool,
    pub cue_when_stopped: bool,
    pub rec: Option<Recording>,
    pub last_taps: Value,
    pub seen_switch: u32,
    pub last_scan: Instant,
    pub fs_runtime_host: String,
    pub fs_runtime_port: i64,
    pub device_name: String,
    pub hw_channels: usize,
    /// bij het opnemen van de uitgang: na het wisselen van apparaat opnieuw starten (door de app ingevuld)
    pub restart_audio: Option<Arc<dyn Fn(&str) -> Result<(), String> + Send + Sync>>,
    pub list_devices: Option<Arc<dyn Fn() -> Vec<(String, usize)> + Send + Sync>>,
    pub on_freeshow: Option<Arc<dyn Fn(&str, &str) + Send + Sync>>,
}

pub struct Player {
    pub mixer: Arc<Mutex<Mixer>>,
    pub stats: Arc<crate::stats::Stats>,
    pub st: Mutex<State>,
}

pub fn folder_of(path: &str) -> String {
    let f = if path.to_lowercase().ends_with(".rpp") { Path::new(path).parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default() } else { path.to_string() };
    // standardizingPath: dubbele en afsluitende schuine strepen weg
    let mut out = String::new();
    for part in f.split('/').filter(|p| !p.is_empty() && *p != ".") {
        out.push('/');
        out.push_str(part);
    }
    if out.is_empty() { "/".into() } else { out }
}

fn locked<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl Player {
    pub fn new(mixer: Arc<Mutex<Mixer>>) -> Arc<Player> {
        let mut cfg = Config::new();
        cfg.load();
        let songs_root = if cfg.songs_root.is_empty() { format!("{}/Tracks/Songs", home()) } else { cfg.songs_root.clone() };
        {
            let mut m = locked(&mixer);
            m.requested = cfg.output_mode.clone();
            m.jump_mode = cfg.jump_mode.clone();
            m.pads.set_root(&cfg.pads_root);
        }
        let st = State {
            fs_runtime_host: cfg.last_host.clone(),
            fs_runtime_port: cfg.last_port,
            cfg,
            songs_root,
            max_cache_bytes: crate::song::mem_total().map(|t| (t / 2).min(6_000_000_000) as usize).unwrap_or(6_000_000_000),
            library: vec![],
            cache: HashMap::new(),
            loading: HashSet::new(),
            setlist: vec![],
            active_path: String::new(),
            active_folder: String::new(),
            want_active: None,
            switch_target: None,
            error: None,
            last_cmd: String::new(),
            table: None,
            timeline: vec![],
            sent: None,
            was_playing: false,
            cue_when_stopped: false,
            rec: None,
            last_taps: json!({}),
            seen_switch: 0,
            last_scan: Instant::now(),
            device_name: String::new(),
            hw_channels: 2,
            restart_audio: None,
            list_devices: None,
            on_freeshow: None,
        };
        let p = Arc::new(Player { mixer, stats: Arc::new(crate::stats::Stats::new()), st: Mutex::new(st) });
        p.scan_library();
        p
    }

    /// De achtergronddraad: elke 40 ms de cues bijwerken
    pub fn start_ticker(self: &Arc<Self>) {
        let p = self.clone();
        std::thread::Builder::new()
            .name("ark-cues".into())
            .spawn(move || {
                let mut n = 0u32;
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(40));
                    p.tick();
                    n += 1;
                    if n % 50 == 0 {
                        let (cb, miss, late, cb_max, gap_max, wait_max) = p.stats.take();
                        if miss > 0 || late > 0 || cb_max > 4000 || wait_max > 500 {
                            log(&format!("Audio-meting: {cb} callbacks, {miss} keer stil (mixer bezet), {late} te laat, rekentijd max {cb_max} us, wachttijd max {wait_max} us, langste tussenpoos {gap_max} us"));
                        }
                    }
                }
            })
            .unwrap();
    }

    pub fn lock(&self) -> MutexGuard<'_, State> {
        locked(&self.st)
    }
    pub fn mx(&self) -> MutexGuard<'_, Mixer> {
        locked(&self.mixer)
    }

    // ------------------------------------------------------------- instellingen
    pub fn set_lead(&self, beats: f64) -> Res<()> {
        if !(0.0..=4.0).contains(&beats) {
            return Err("Ongeldige voorlooptijd".into());
        }
        let mut st = self.lock();
        st.cfg.lead_beats = beats;
        st.cfg.save();
        self.rebuild_timeline(&mut st);
        Ok(())
    }
    pub fn fs_host(st: &State) -> String {
        if st.cfg.fs_host.is_empty() { st.fs_runtime_host.clone() } else { st.cfg.fs_host.clone() }
    }
    pub fn fs_port(st: &State) -> i64 {
        if st.cfg.fs_host.is_empty() { st.fs_runtime_port } else { st.cfg.fs_port }
    }
    pub fn set_freeshow_runtime(&self, host: &str, port: Option<i64>) {
        let mut st = self.lock();
        st.fs_runtime_host = host.to_string();
        if let Some(p) = port {
            st.fs_runtime_port = p;
        }
        st.sent = None;
        if !host.is_empty() && (host != st.cfg.last_host || st.fs_runtime_port != st.cfg.last_port) {
            st.cfg.last_host = host.to_string();
            st.cfg.last_port = st.fs_runtime_port;
            st.cfg.save();
        }
    }
    pub fn set_freeshow(&self, host: &str, port: Option<i64>) {
        let mut st = self.lock();
        st.cfg.fs_host = host.to_string();
        if let Some(p) = port {
            st.cfg.fs_port = p;
        }
        st.cfg.save();
        st.sent = None;
    }
    pub fn set_songs_root(self: &Arc<Self>, path: &str) {
        {
            let mut st = self.lock();
            st.songs_root = if path.is_empty() { format!("{}/Tracks/Songs", home()) } else { path.to_string() };
            st.cfg.songs_root = path.to_string();
            st.cfg.save();
        }
        self.scan_library();
    }
    pub fn set_device(&self, name: &str) {
        let mut st = self.lock();
        st.cfg.device = name.to_string();
        st.cfg.save();
    }
    pub fn set_output_mode(&self, m: &str) {
        let mut st = self.lock();
        {
            let mut mx = self.mx();
            mx.requested = m.to_string();
            mx.apply_routing();
        }
        st.cfg.output_mode = m.to_string();
        st.cfg.save();
    }
    pub fn set_jump_mode(&self, m: &str) {
        let mut st = self.lock();
        self.mx().jump_mode = m.to_string();
        st.cfg.jump_mode = m.to_string();
        st.cfg.save();
    }

    // ------------------------------------------------------------- bibliotheek en nummers
    pub fn scan_library(&self) {
        let root = self.lock().songs_root.clone();
        let mut found: Vec<LibSong> = Vec::new();
        fn walk(dir: &str, depth: usize, found: &mut Vec<LibSong>) {
            if depth > 3 {
                return;
            }
            let Ok(rd) = std::fs::read_dir(dir) else { return };
            let mut items: Vec<String> = rd.filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().to_string()).collect();
            items.sort();
            if items.iter().any(|i| i == "ark-player.json") {
                if let Ok(d) = std::fs::read(format!("{dir}/ark-player.json")) {
                    if let Ok(j) = serde_json::from_slice::<Value>(&d) {
                        let rpp = j["rpp"].as_str();
                        found.push(LibSong {
                            name: j["title"].as_str().map(String::from).unwrap_or_else(|| Path::new(dir).file_name().unwrap().to_string_lossy().into()),
                            path: rpp.map(|r| format!("{dir}/{r}")).unwrap_or_else(|| dir.to_string()),
                            folder: dir.to_string(),
                        });
                        return;
                    }
                }
            }
            for i in items.iter().filter(|i| !i.starts_with('.')) {
                let p = format!("{dir}/{i}");
                if Path::new(&p).is_dir() {
                    walk(&p, depth + 1, found);
                }
            }
        }
        walk(&root, 0, &mut found);
        found.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        let n = found.len();
        self.lock().library = found;
        static LAST: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(usize::MAX);
        if LAST.swap(n, std::sync::atomic::Ordering::Relaxed) != n {
            log(&format!("Bibliotheek: {n} nummers met ark-player.json in {root}"));
        }
    }

    /// Nummer in het geheugen zetten (op de achtergrond). `done` draait nadat het klaar is.
    pub fn ensure_loaded(self: &Arc<Self>, path: &str, done: Option<Box<dyn FnOnce() + Send>>) {
        let f = folder_of(path);
        {
            let mut st = self.lock();
            if st.cache.contains_key(&f) || st.active_folder == f && !st.active_folder.is_empty() && self.mx().song.folder == f {
                drop(st);
                if let Some(d) = done {
                    d();
                }
                return;
            }
            if st.loading.contains(&f) {
                return;
            }
            st.loading.insert(f.clone());
        }
        let p = self.clone();
        let path = path.to_string();
        std::thread::spawn(move || {
            let t0 = Instant::now();
            let mut result = load_song(&f);
            // te weinig geheugen: als er niets speelt, eerst het huidige nummer (en wat klaarstaat) vrijgeven en nog een keer proberen
            for stage in 0..2 {
                match &result {
                    Err(e) if e.starts_with("Te weinig geheugen") && p.release_memory(stage, &f) => {
                        log(&format!("Geheugen vrijgegeven voor {} (stap {})", f, stage + 1));
                        result = load_song(&f);
                    }
                    _ => break,
                }
            }
            match result {
                Ok(s) => {
                    let mut st = p.lock();
                    log(&format!("Geladen: {}, {} stems, {} MB in {:.1} s", s.title, s.stems.len(), s.mem_bytes() / 1_000_000, t0.elapsed().as_secs_f64()));
                    st.cache.insert(f.clone(), s);
                    st.loading.remove(&f);
                    if let Some((wp, wf, cue)) = st.want_active.clone() {
                        if wf == f {
                            st.want_active = None;
                            p.activate(&mut st, &wp, &wf, cue);
                        }
                    }
                }
                Err(e) => {
                    let mut st = p.lock();
                    st.loading.remove(&f);
                    st.error = Some(e.clone());
                    st.want_active = None;
                    log(&format!("Laden mislukt ({path}): {e}"));
                }
            }
            if let Some(d) = done {
                d();
            }
        });
    }

    /// Geheugen vrijmaken voor een nummer dat anders niet past. Stap 0: het actieve nummer loslaten (alleen als er niets speelt).
    /// Stap 1: ook de nummers die voor de setlist klaarstaan. Geeft terug of er iets is vrijgegeven.
    fn release_memory(&self, stage: usize, loading: &str) -> bool {
        let mut st = self.lock();
        // alleen voor een nummer dat de gebruiker zelf koos; het klaarzetten van de setlist op de achtergrond mag niets weggooien
        if !st.want_active.as_ref().map(|w| w.1 == loading).unwrap_or(false) {
            return false;
        }
        let freed: Vec<Song> = {
            let mut m = self.mx();
            if m.playing || m.pend_song.is_some() {
                return false;
            }
            let mut v = Vec::new();
            if stage == 0 {
                if m.song.stems.is_empty() || m.song.folder == loading {
                    return false;
                }
                v.push(std::mem::replace(&mut m.song, Song::default()));
                m.pos = 0;
                m.stop_loop();
                m.cancel_pending();
            } else {
                if st.cache.is_empty() {
                    return false;
                }
                let keys: Vec<String> = st.cache.keys().filter(|k| k.as_str() != loading).cloned().collect();
                if keys.is_empty() {
                    return false;
                }
                for k in keys {
                    if let Some(sg) = st.cache.remove(&k) {
                        v.push(sg);
                    }
                }
            }
            v
        };
        if stage == 0 {
            st.active_path.clear();
            st.active_folder.clear();
            st.table = None;
            st.timeline = vec![];
            st.sent = None;
        }
        drop(st);
        drop(freed); // het geheugen gaat terug naar het systeem (buiten de sloten)
        true
    }

    /// Dit nummer actief maken: stoppen, naar het begin, cues voor dit nummer.
    fn activate(&self, st: &mut State, path: &str, folder: &str, cue_now: bool) {
        let old;
        if st.active_folder == folder && self.mx().song.folder == folder {
            // hetzelfde nummer opnieuw: terug naar het begin
            let mut m = self.mx();
            m.playing = false;
            m.stop_loop();
            m.cancel_pending();
            m.pend_song_at = -1;
            m.pos = 0;
            old = None;
        } else {
            let Some(mut s) = st.cache.remove(folder) else { return };
            let mut m = self.mx();
            m.playing = false;
            m.stop_loop();
            m.cancel_pending();
            m.pend_song_at = -1;
            if let Some(p) = m.pend_song.take() {
                st.cache.insert(p.folder.clone(), p);
            }
            m.apply_routing_to(&mut s);
            m.pos = 0;
            old = Some(std::mem::replace(&mut m.song, s));
        }
        if let Some(o) = old {
            self.keep_or_drop(st, o);
        }
        self.use_song(st, path, folder, cue_now);
        st.error = None;
    }

    fn keep_or_drop(&self, st: &mut State, old: Song) {
        if old.stems.is_empty() {
            return;
        }
        let keep = st.setlist.iter().any(|p| folder_of(p) == old.folder);
        if keep {
            st.cache.insert(old.folder.clone(), old);
        }
    }

    fn use_song(&self, st: &mut State, path: &str, folder: &str, cue_now: bool) {
        st.active_path = path.to_string();
        st.active_folder = folder.to_string();
        self.load_cues(st);
        st.sent = None;
        st.cue_when_stopped = cue_now;
        st.rec = None;
        if let Some(id) = st.table.as_ref().and_then(|t| t.show_id.clone()) {
            self.freeshow_call(st, "id_select_show", &format!("{{\"id\":\"{id}\"}}"));
        }
    }

    /// Ander nummer kiezen. Speelt er iets en is er een modus (end | bar | now), dan op dat muzikale moment overgaan.
    pub fn select_song(self: &Arc<Self>, path: &str, mode: Option<&str>) -> Res<()> {
        let mut st = self.lock();
        let f = folder_of(path);
        {
            let mut m = self.mx();
            m.pend_song_at = -1;
            if let Some(p) = m.pend_song.take() {
                st.cache.insert(p.folder.clone(), p);
            }
        }
        st.switch_target = None;
        let playing = self.mx().playing;
        if let (true, Some(md)) = (playing, mode) {
            if ["end", "bar", "now"].contains(&md) && f != st.active_folder {
                let Some(mut n) = st.cache.remove(&f) else { return Err("Dit nummer staat nog niet klaar (zet de setlist klaar)".into()) };
                let mut m = self.mx();
                let pos = m.pos_sec();
                let tm = m.song.tempo.clone();
                let at = match md {
                    "end" => {
                        let a = m.section_index(m.pos).map(|i| m.song.sections[i].end).unwrap_or(pos + 0.3);
                        m.stop_loop();
                        a
                    }
                    "bar" => tm.next_bar(pos + 0.001),
                    _ => pos + 0.35,
                };
                let beat = tm.sec_qn(tm.qn_sec(at)) - tm.sec_qn(tm.qn_sec(at) - 1.0);
                let fade = beat.min(if md == "now" { 0.3 } else { 0.6 });
                let from = pos.max(at - fade);
                m.apply_routing_to(&mut n);
                st.switch_target = Some((path.to_string(), f));
                m.song_fade = m.frame(at - from);
                m.pend_song = Some(n);
                m.pend_song_at = m.frame(at);
                return Ok(());
            }
        }
        st.want_active = None;
        let active_here = st.active_folder == f && self.mx().song.folder == f;
        if st.cache.contains_key(&f) || active_here {
            self.activate(&mut st, path, &f, true);
        } else {
            st.want_active = Some((path.to_string(), f.clone(), true));
            drop(st);
            self.ensure_loaded(path, None);
        }
        Ok(())
    }

    pub fn cancel_song(&self) {
        let mut st = self.lock();
        let mut m = self.mx();
        m.pend_song_at = -1;
        if let Some(p) = m.pend_song.take() {
            st.cache.insert(p.folder.clone(), p);
        }
        st.switch_target = None;
    }

    pub fn set_setlist(self: &Arc<Self>, paths: Vec<String>) {
        let list: Vec<String> = paths.into_iter().filter(|p| !p.is_empty()).collect();
        self.lock().setlist = list.clone();
        let p = self.clone();
        std::thread::spawn(move || {
            for path in &list {
                let (used, have) = {
                    let st = p.lock();
                    let f = folder_of(path);
                    (st.cache.values().map(|s| s.mem_bytes()).sum::<usize>(), st.cache.contains_key(&f) || p.mx().song.folder == f)
                };
                if have {
                    continue;
                }
                if used > p.lock().max_cache_bytes {
                    log("Setlist: geheugenlimiet bereikt, rest wordt later geladen");
                    break;
                }
                let (tx, rx) = std::sync::mpsc::channel();
                p.ensure_loaded(path, Some(Box::new(move || {
                    let _ = tx.send(());
                })));
                let _ = rx.recv_timeout(std::time::Duration::from_secs(300));
            }
            let mut st = p.lock();
            let mut keep: HashSet<String> = list.iter().map(|x| folder_of(x)).collect();
            keep.insert(st.active_folder.clone());
            st.cache.retain(|k, _| keep.contains(k));
        });
    }

    pub fn next_song(st: &State) -> Option<String> {
        let i = st.setlist.iter().position(|p| folder_of(p) == st.active_folder)?;
        st.setlist.get(i + 1).cloned()
    }

    // ------------------------------------------------------------- cues
    pub fn cues_path(s: &Song) -> Option<String> {
        let rpp = s.rpp.clone().or_else(|| {
            let mut v: Vec<String> = std::fs::read_dir(&s.folder).ok()?.filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().to_string()).filter(|n| n.to_lowercase().ends_with(".rpp")).collect();
            v.sort();
            v.into_iter().next()
        });
        rpp.map(|r| format!("{}/{}.cues", s.folder, r))
    }

    fn load_cues(&self, st: &mut State) {
        st.table = None;
        st.timeline = vec![];
        let p = Self::cues_path(&self.mx().song);
        if let Some(p) = p {
            st.table = CueTable::read(&p);
        }
        self.rebuild_timeline(st);
    }

    fn rebuild_timeline(&self, st: &mut State) {
        st.timeline = match &st.table {
            Some(t) => build_timeline(&self.mx().song, t, st.cfg.lead_beats),
            None => vec![],
        };
    }

    /// Cuetabel van de app opslaan: "show:ID@LAYOUT;regionId:dia,dia;..." (leeg = cues uit voor dit nummer)
    pub fn save_cues(&self, path: &str, data: &str) -> Res<()> {
        let mut st = self.lock();
        let f = folder_of(path);
        if !path.to_lowercase().ends_with(".rpp") || !Path::new(&f).exists() {
            return Err("Map van het nummer niet gevonden".into());
        }
        let file = format!("{path}.cues");
        if data.is_empty() {
            let _ = std::fs::remove_file(&file);
        } else {
            let mut out = String::from("ark-cues 4\n");
            for e in data.split(';').filter(|e| !e.is_empty()) {
                if let Some(body) = e.strip_prefix("show:") {
                    let mut it = body.splitn(2, '@');
                    let id = it.next().unwrap_or("");
                    let lay = it.next().unwrap_or("");
                    out.push_str(&format!("show {id} {lay}\n"));
                } else if let Some((id, rest)) = e.split_once(':') {
                    if id.parse::<i64>().is_ok() {
                        out.push_str(&format!("{id} {}\n", rest.replace(',', " ")));
                    }
                }
            }
            std::fs::write(&file, out).map_err(|e| e.to_string())?;
        }
        if f == st.active_folder {
            self.load_cues(&mut st);
            st.sent = None;
        }
        Ok(())
    }

    pub fn freeshow_call(&self, st: &State, action: &str, data: &str) {
        if let Some(h) = &st.on_freeshow {
            h(action, data);
        }
        let host = Self::fs_host(st);
        if host.is_empty() {
            return;
        }
        let port = Self::fs_port(st);
        let url = format!("http://{host}:{port}/");
        let (action, data) = (action.to_string(), data.to_string());
        std::thread::spawn(move || {
            // op de achtergrond: niet wachten
            let _ = ureq::get(&url).query("action", &action).query("data", &data).timeout(std::time::Duration::from_secs(2)).call();
        });
    }

    fn send_slide(&self, st: &State, n: i64) {
        let Some(t) = &st.table else { return };
        let Some(id) = &t.show_id else { return };
        let layout = t.layout_id.as_ref().map(|l| format!("\"layoutId\":\"{l}\",")).unwrap_or_default();
        self.freeshow_call(st, "index_select_slide", &format!("{{\"showId\":\"{id}\",{layout}\"index\":{n}}}"));
    }

    // --- hulpfuncties op de tijdlijn
    fn section_index_at(m: &Mixer, t: f64) -> Option<usize> {
        m.song.sections.iter().rposition(|s| s.start <= t + 0.0005)
    }
    pub fn lead_seconds(m: &Mixer, lead: f64, pos: f64) -> f64 {
        let tm = &m.song.tempo;
        pos - tm.sec_qn(tm.qn_sec(pos) - lead)
    }
    fn slide_at_time(st: &State, pos: f64) -> Option<i64> {
        let mut pick = None;
        for e in &st.timeline {
            if e.t <= pos + 0.001 {
                pick = Some(e.n);
            } else {
                break;
            }
        }
        pick
    }
    /// Indices in de tijdlijn van de dia's van een sectie: vanaf `lead` voor het begin tot het einde
    pub fn region_notes(&self, st: &State, m: &Mixer, idx: usize) -> Vec<usize> {
        if idx >= m.song.sections.len() {
            return vec![];
        }
        let r = &m.song.sections[idx];
        let from = r.start - Self::lead_seconds(m, st.cfg.lead_beats, r.start) - 0.05;
        (0..st.timeline.len()).filter(|&i| st.timeline[i].t >= from && st.timeline[i].t < r.end).collect()
    }
    pub fn first_slide_of(&self, st: &State, m: &Mixer, idx: usize) -> Option<i64> {
        if let Some(i) = self.region_notes(st, m, idx).first() {
            return Some(st.timeline[*i].n);
        }
        let sec = &m.song.sections[idx];
        st.table.as_ref()?.regions.get(&sec.id)?.first().map(|s| s.n)
    }
    fn recorded_slide(&self, st: &mut State, m: &Mixer, idx: Option<usize>) -> Option<i64> {
        let idx = idx?;
        let notes = self.region_notes(st, m, idx);
        if notes.is_empty() {
            return None;
        }
        if let Some(r) = &mut st.rec {
            if r.region != Some(idx) {
                r.region = Some(idx);
                r.idx = 1;
            }
        }
        let k = st.rec.as_ref().map(|r| r.idx).unwrap_or(1);
        Some(st.timeline[notes[k.min(notes.len()) - 1]].n)
    }

    fn slide_at(&self, st: &mut State, m: &Mixer, pos: f64, playing: bool) -> Option<i64> {
        if !playing {
            return Self::slide_at_time(st, pos);
        }
        let tm = &m.song.tempo;
        let cur = Self::section_index_at(m, pos);
        let look = tm.sec_qn(tm.qn_sec(pos) + st.cfg.lead_beats);
        let mut target: Option<usize> = None;
        if m.pend_section >= 0 && m.pend_at >= 0 && look >= m.pend_at as f64 / m.sr {
            target = Some(m.pend_section as usize);
        } else if let Some(c) = cur {
            if m.loop_sec == c as i64 && look >= m.song.sections[c].end {
                target = Some(c);
            }
        }
        if st.rec.is_some() {
            let t = target.or_else(|| Self::section_index_at(m, look));
            return self.recorded_slide(st, m, t);
        }
        if let Some(t) = target {
            return self.first_slide_of(st, m, t);
        }
        Self::slide_at_time(st, pos)
    }

    /// Elke 40 ms: nummerwissel opmerken, dia bepalen en naar FreeShow sturen (updateCues in de bridge)
    pub fn tick(self: &Arc<Self>) {
        let mut st = self.lock();
        // nummers die de mixer net heeft losgelaten opruimen
        let retired: Vec<Song> = {
            let mut m = self.mx();
            m.retired.drain(..).collect()
        };
        for r in retired {
            self.keep_or_drop(&mut st, r);
        }
        let pads = self.mx().pads.clone();
        pads.cleanup(); // uitgefadede pads vrijgeven
        let (playing, switched, pos_sec, at_end, total) = {
            let m = self.mx();
            (m.playing, m.switched, m.pos_sec(), m.pos >= m.song.total() && m.song.total() > 0, m.song.total())
        };
        if !playing && st.last_scan.elapsed().as_secs() > 10 {
            st.last_scan = Instant::now();
            let p = self.clone();
            std::thread::spawn(move || p.scan_library());
        }
        if switched != st.seen_switch {
            st.seen_switch = switched;
            if let Some((p, f)) = st.switch_target.take() {
                self.use_song(&mut st, &p, &f, false);
            }
        }
        let _ = total;
        if playing != st.was_playing {
            st.was_playing = playing;
            if playing {
                st.sent = None;
            } else if at_end {
                if let Some(n) = Self::next_song(&st) {
                    // einde van het nummer: het volgende uit de setlist klaarzetten (gestopt, bij zijn begin)
                    let f = folder_of(&n);
                    if st.cache.contains_key(&f) {
                        self.activate(&mut st, &n, &f, true);
                    } else {
                        st.want_active = Some((n.clone(), f, true));
                        drop(st);
                        self.ensure_loaded(&n, None);
                        return;
                    }
                }
            }
        }
        if st.table.is_none() || (!playing && !st.cue_when_stopped) {
            return;
        }
        let m = locked(&self.mixer);
        let slide = self.slide_at(&mut st, &m, pos_sec, playing);
        drop(m);
        if let Some(s) = slide {
            if Some(s) != st.sent && s >= 1 {
                self.send_slide(&st, s);
                st.sent = Some(s);
            }
        }
        if !playing && slide.is_some() {
            st.cue_when_stopped = false;
        }
    }

    // ------------------------------------------------------------- bediening met cues
    pub fn jump(&self, idx: usize, mode: Option<&str>) -> Res<()> {
        let mut st = self.lock();
        let mut m = self.mx();
        let was = m.playing;
        let r = m.jump(idx, mode);
        if r.is_ok() && !was {
            st.cue_when_stopped = true;
        }
        r
    }

    pub fn record(&self, action: &str) -> Res<()> {
        let mut st = self.lock();
        match action {
            "start" => {
                st.rec = Some(Recording { idx: 1, ..Default::default() });
                st.sent = None;
            }
            "save" => {
                let Some(r) = st.rec.clone() else { return Err("Er wordt geen timing opgenomen".into()) };
                let m = self.mx();
                let mut sections = serde_json::Map::new();
                for (idx, taps) in &r.taps {
                    if *idx < m.song.sections.len() {
                        let mut v: Vec<(&usize, &f64)> = taps.iter().collect();
                        v.sort_by_key(|x| *x.0);
                        sections.insert(m.song.sections[*idx].name.clone(), Value::Array(v.into_iter().map(|(k, q)| json!([k, q])).collect()));
                    }
                }
                let rpp = Self::cues_path(&m.song).map(|c| c[..c.len() - 5].to_string()).unwrap_or_default();
                drop(m);
                st.last_taps = json!({"path": rpp, "sections": sections});
                st.rec = None;
                st.sent = None;
            }
            _ => {
                st.rec = None;
                st.sent = None;
            }
        }
        Ok(())
    }

    /// Tik tijdens het opnemen: volgende dia van de sectie, moment vastleggen
    pub fn tap(&self, pos: Option<f64>) -> Res<()> {
        let mut st = self.lock();
        if st.rec.is_none() {
            return Err("Er wordt geen timing opgenomen".into());
        }
        let m = self.mx();
        let p = pos.unwrap_or_else(|| m.pos_sec());
        let rec = st.rec.as_ref().unwrap();
        let Some(id) = rec.region.or_else(|| Self::section_index_at(&m, p)) else { return Ok(()) };
        let notes = self.region_notes(&st, &m, id);
        let ridx = st.rec.as_ref().unwrap().idx;
        if notes.is_empty() || ridx >= notes.len() {
            return Ok(());
        }
        let tm = m.song.tempo.clone();
        let r = &m.song.sections[id];
        let qs = tm.qn_sec(r.start);
        let len = tm.qn_sec(r.end) - qs;
        let mut q = ((tm.qn_sec(p) - qs) * 4.0 + 0.5).floor() / 4.0;
        let prev_q = st.rec.as_ref().unwrap().taps.get(&id).and_then(|t| t.get(&ridx)).copied();
        q = q.max(prev_q.unwrap_or(0.0) + 0.5).max(0.25);
        q = q.min(len - 0.5);
        let rec = st.rec.as_mut().unwrap();
        rec.region = Some(id);
        rec.idx += 1;
        let new_idx = rec.idx;
        rec.taps.entry(id).or_default().insert(new_idx, q);
        drop(m);
        let tl = notes[new_idx - 1];
        st.timeline[tl].t = tm.sec_qn(qs + q); // het moment van deze dia in de tijdlijn
        st.timeline.sort_by(|a, b| a.t.partial_cmp(&b.t).unwrap());
        Ok(())
    }
}

impl Song {
    pub fn mem_bytes(&self) -> usize {
        self.stems.iter().map(|s| s.frames * s.ch.len() * 4).sum()
    }
}
