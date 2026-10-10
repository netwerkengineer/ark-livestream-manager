//! Nummers van de server op deze computer zetten: de zip ophalen (hervatbaar), uitpakken, het speelbestand van de server
//! ernaast zetten, de eigen click maken en de cuetabel overnemen. Daarna ziet de speler het nummer vanzelf in de nummermap.
//! Ook: een zip zonder server importeren (SongFetcher.swift + SongImporter.swift).

use crate::importer;
use crate::player::{log, Player};
use crate::tempo::TempoMap;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

const AGENT: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15 ArkTracksDesktop";

#[derive(Clone, Default)]
pub struct Job {
    pub id: String,
    pub folder: String,
    pub title: String,
    pub rpp: String,
    pub state: String, // wachtrij | ophalen | uitpakken | click | klaar | fout
    pub progress: f64,
    pub message: String,
}

type Res<T> = Result<T, String>;

pub struct Fetcher {
    player: Arc<Player>,
    jobs: Mutex<(HashMap<String, Job>, Vec<String>)>,
    /// (serveradres, sleutel) uit de instellingen van de schil
    server: Arc<dyn Fn() -> (String, String) + Send + Sync>,
    /// cookies (de inlog) van het venster voor dit adres
    cookies: Arc<dyn Fn(&str) -> String + Send + Sync>,
}

impl Fetcher {
    pub fn new(player: Arc<Player>, server: Arc<dyn Fn() -> (String, String) + Send + Sync>, cookies: Arc<dyn Fn(&str) -> String + Send + Sync>) -> Arc<Fetcher> {
        Arc::new(Fetcher { player, jobs: Mutex::new((HashMap::new(), Vec::new())), server, cookies })
    }

    fn update(&self, id: &str, f: impl FnOnce(&mut Job)) {
        if let Some(j) = self.jobs.lock().unwrap().0.get_mut(id) {
            f(j);
        }
    }

    pub fn status(&self) -> Value {
        let g = self.jobs.lock().unwrap();
        let list: Vec<Value> = g.1.iter().filter_map(|id| g.0.get(id)).map(|j| json!({"id": j.id, "title": j.title, "state": j.state, "progress": j.progress, "message": j.message})).collect();
        json!({ "jobs": list })
    }

    /// Een nummer van de server ophalen (aanroep vanuit de pagina)
    pub fn start(self: &Arc<Self>, p: &Value) {
        let (Some(id), Some(folder)) = (p["id"].as_str(), p["folder"].as_str().filter(|f| !f.is_empty())) else { return };
        // alleen een eenvoudige mapnaam: geen pad
        if folder.contains('/') || folder.contains("..") {
            return;
        }
        {
            let mut g = self.jobs.lock().unwrap();
            if let Some(j) = g.0.get(id) {
                if ["wachtrij", "ophalen", "uitpakken", "click"].contains(&j.state.as_str()) {
                    return;
                }
            }
            g.0.insert(id.into(), Job { id: id.into(), folder: folder.into(), title: p["title"].as_str().unwrap_or(folder).into(), rpp: p["rpp"].as_str().unwrap_or("").into(), state: "wachtrij".into(), ..Default::default() });
            g.1.retain(|x| x != id);
            g.1.push(id.into());
        }
        let (me, id) = (self.clone(), id.to_string());
        std::thread::spawn(move || {
            if let Err(e) = me.run(&id) {
                log(&format!("Ophalen mislukt ({id}): {e}"));
                me.update(&id, |j| {
                    j.state = "fout".into();
                    j.message = e;
                });
            }
        });
    }

    /// Nummer van deze computer halen: naar de prullenbak (niet definitief verwijderen)
    pub fn remove(&self, folder: &str) -> bool {
        let root = self.player.lock().songs_root.clone();
        if folder.is_empty() || folder.contains("..") {
            return false;
        }
        let path = Path::new(&root).join(folder);
        if !path.starts_with(&root) || !path.exists() {
            return false;
        }
        let ok = trash::delete(&path).is_ok();
        self.player.scan_library();
        ok
    }

    // ---- netwerk (met de inlog van het venster)
    fn request(&self, url: &str) -> ureq::Request {
        let (_, key) = (self.server)();
        let mut cookie = (self.cookies)(url);
        if !key.is_empty() && !cookie.contains("ark_desktop=") {
            if !cookie.is_empty() {
                cookie.push_str("; ");
            }
            cookie.push_str(&format!("ark_desktop={key}"));
        }
        let agent = ureq::AgentBuilder::new().timeout_connect(std::time::Duration::from_secs(20)).timeout_read(std::time::Duration::from_secs(120)).build();
        agent.get(url).set("Cookie", &cookie).set("User-Agent", AGENT)
    }

    fn get_json(&self, url: &str) -> Res<Value> {
        match self.request(url).call() {
            Ok(r) => r.into_json::<Value>().map_err(|e| e.to_string()),
            Err(ureq::Error::Status(code, r)) => {
                let msg = r.into_json::<Value>().ok().and_then(|j| j["error"].as_str().map(String::from));
                Err(msg.unwrap_or_else(|| format!("Server antwoordde {code}")))
            }
            Err(e) => Err(e.to_string()),
        }
    }

    /// Grote download die hervat: een deel dat er al is, wordt aangevuld
    fn download(&self, url: &str, to: &Path, progress: &dyn Fn(u64, u64)) -> Res<()> {
        let part = PathBuf::from(format!("{}.deel", to.display()));
        let have = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
        let mut req = self.request(url);
        if have > 0 {
            req = req.set("Range", &format!("bytes={have}-"));
        }
        let resp = match req.call() {
            Ok(r) => r,
            Err(ureq::Error::Status(416, _)) => {
                // al compleet
                std::fs::rename(&part, to).map_err(|e| e.to_string())?;
                return Ok(());
            }
            Err(ureq::Error::Status(code, _)) => return Err(format!("Server antwoordde {code}")),
            Err(e) => return Err(e.to_string()),
        };
        let len: u64 = resp.header("Content-Length").and_then(|v| v.parse().ok()).unwrap_or(0);
        let resumed = resp.status() == 206;
        let mut f = std::fs::OpenOptions::new().create(true).write(true).append(resumed).truncate(!resumed).open(&part).map_err(|e| e.to_string())?;
        let mut written = if resumed { have } else { 0 };
        let total = written + len;
        let mut reader = resp.into_reader();
        let mut buf = vec![0u8; 256 * 1024];
        loop {
            let n = reader.read(&mut buf).map_err(|e| format!("verbinding verbroken: {e}"))?;
            if n == 0 {
                break;
            }
            f.write_all(&buf[..n]).map_err(|e| e.to_string())?;
            written += n as u64;
            progress(written, total);
        }
        f.flush().ok();
        drop(f);
        if total > 0 && written < total {
            return Err("download is niet compleet; probeer het opnieuw (het gaat verder waar het bleef)".into());
        }
        std::fs::rename(&part, to).map_err(|e| e.to_string())
    }

    fn run(self: &Arc<Self>, id: &str) -> Res<()> {
        let job = self.jobs.lock().unwrap().0.get(id).cloned().ok_or("opdracht onbekend")?;
        let (base, _) = (self.server)();
        let base = base.trim().trim_matches('/').to_string();
        if base.is_empty() {
            return Err("Geen server ingesteld".into());
        }
        let root = self.player.lock().songs_root.clone();
        let dest = Path::new(&root).join(&job.folder);
        let incoming = Path::new(&root).join(".ophalen");
        std::fs::create_dir_all(&incoming).map_err(|e| e.to_string())?;
        let zip = incoming.join(format!("{id}.zip"));

        // 1. beschrijving
        self.update(id, |j| {
            j.state = "ophalen".into();
            j.message = "beschrijving".into();
        });
        let desc = self.get_json(&format!("{base}/api/tracks/desktop/{id}/descriptor"))?;
        if !desc.is_object() {
            return Err("Beschrijving ontbreekt".into());
        }
        // 2. zip (hervat als er al een deel is)
        let me = self.clone();
        let idc = id.to_string();
        self.download(&format!("{base}/api/tracks/desktop/{id}/zip"), &zip, &move |done, total| {
            me.update(&idc, |j| {
                j.progress = if total > 0 { done as f64 / total as f64 } else { 0.0 };
                j.message = format!("{} MB", done / 1_000_000);
            });
        })?;
        // 3. uitpakken
        self.update(id, |j| {
            j.state = "uitpakken".into();
            j.progress = 1.0;
            j.message = String::new();
        });
        std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
        unzip(&zip, &dest)?;
        let _ = std::fs::remove_file(&zip); // onze eigen tijdelijke zip
        // 4. speelbestand + eigen click
        self.update(id, |j| j.state = "click".into());
        let sub = desc["root"].as_str().unwrap_or("");
        let song_dir = if sub.is_empty() { dest.clone() } else { dest.join(sub) };
        let mut d = desc.clone();
        let clicks = make_clicks(&song_dir, &desc)?;
        let mut stems = desc["stems"].as_array().cloned().unwrap_or_default();
        stems.extend(clicks);
        d["stems"] = Value::Array(stems);
        d["title"] = json!(job.title);
        if d["rpp"].as_str().unwrap_or("").is_empty() {
            d["rpp"] = json!(job.rpp);
        }
        write_atomic(&song_dir.join("ark-player.json"), &serde_json::to_vec_pretty(&d).unwrap())?;
        // 5. cuetabel van de server (de tekstkoppeling)
        if let Ok(c) = self.get_json(&format!("{base}/api/tracks/desktop/{id}/cues")) {
            if let Some(cues) = c["cues"].as_str().filter(|c| !c.is_empty()) {
                let rpp = d["rpp"].as_str().unwrap_or(&job.rpp).to_string();
                let _ = self.player.save_cues(&song_dir.join(rpp).to_string_lossy(), cues);
            }
        }
        self.player.scan_library();
        self.update(id, |j| {
            j.state = "klaar".into();
            j.progress = 1.0;
        });
        Ok(())
    }

    // ---- een zip zonder server importeren
    pub fn import_zip(self: &Arc<Self>, zip_path: &str) {
        let id = format!("lokaal-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis());
        let name = Path::new(zip_path).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        {
            let mut g = self.jobs.lock().unwrap();
            g.0.insert(id.clone(), Job { id: id.clone(), title: name, state: "uitpakken".into(), ..Default::default() });
            g.1.push(id.clone());
        }
        let (me, zp) = (self.clone(), zip_path.to_string());
        std::thread::spawn(move || {
            if let Err(e) = me.import_run(&id, &zp) {
                log(&format!("Importeren mislukt ({zp}): {e}"));
                me.update(&id, |j| {
                    j.state = "fout".into();
                    j.message = e;
                });
            }
        });
    }

    fn import_run(self: &Arc<Self>, id: &str, zip_path: &str) -> Res<()> {
        let file = std::fs::File::open(zip_path).map_err(|e| format!("{zip_path}: {e}"))?;
        let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("geen geldige zip: {e}"))?;
        // 1. wat zit er in de zip (alleen het beschrijvende bestand wordt uitgepakt)
        let mut names: Vec<String> = Vec::new();
        for i in 0..archive.len() {
            let f = archive.by_index(i).map_err(|e| e.to_string())?;
            let n = f.name().to_string();
            if !n.ends_with('/') && !n.contains("__MACOSX") && !n.rsplit('/').next().unwrap_or("").starts_with("._") {
                names.push(n);
            }
        }
        let meta_name = names.iter().find(|n| n.rsplit('/').next().unwrap_or("").to_lowercase() == "song.json").or_else(|| names.iter().find(|n| n.to_lowercase().ends_with(".als"))).cloned();
        let Some(meta_path) = meta_name else { return Err("Geen .als-bestand of song.json in de zip".into()) };
        let mut meta_data = Vec::new();
        archive.by_name(&meta_path).map_err(|e| e.to_string())?.read_to_end(&mut meta_data).map_err(|e| e.to_string())?;
        let meta = if meta_path.to_lowercase().ends_with(".json") { importer::read_song_json(&meta_data, &names)? } else { importer::read_als(&meta_data)? };
        let root = match meta_path.rfind('/') {
            Some(i) => meta_path[..i].to_string(),
            None => String::new(),
        };
        let zip_title = Path::new(zip_path).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        let (mut desc, missing, safe) = importer::describe(&meta, &names, &root, &zip_title)?;
        let title = desc["title"].as_str().unwrap_or("").to_string();
        let rpp = desc["rpp"].as_str().unwrap_or("").to_string();

        // 3. uitpakken in een tijdelijke map en op zijn plaats zetten (bestaat het nummer al, dan niets overschrijven)
        let songs = self.player.lock().songs_root.clone();
        let dest = Path::new(&songs).join(&safe);
        if safe.is_empty() || safe.contains("..") {
            return Err("ongeldige naam van het nummer".into());
        }
        if dest.exists() {
            return Err(format!("\"{safe}\" staat al op deze computer. Haal het eerst weg (prullenbak) als je het opnieuw wilt importeren."));
        }
        let incoming = Path::new(&songs).join(".ophalen").join(id);
        std::fs::create_dir_all(&incoming).map_err(|e| e.to_string())?;
        let result = (|| -> Res<()> {
            self.update(id, |j| {
                j.state = "uitpakken".into();
                j.title = title.clone();
                j.folder = safe.clone();
                j.rpp = rpp.clone();
            });
            unzip(Path::new(zip_path), &incoming)?;
            let src = if root.is_empty() { incoming.clone() } else { incoming.join(&root) };
            std::fs::rename(&src, &dest).map_err(|e| format!("op zijn plaats zetten mislukt: {e}"))?;
            // 4. eigen click en speelbestand
            self.update(id, |j| j.state = "click".into());
            let clicks = make_clicks(&dest, &desc)?;
            let mut stems = desc["stems"].as_array().cloned().unwrap_or_default();
            stems.extend(clicks);
            desc["stems"] = Value::Array(stems);
            write_atomic(&dest.join("ark-player.json"), &serde_json::to_vec_pretty(&desc).unwrap())
        })();
        let _ = std::fs::remove_dir_all(&incoming); // onze eigen tijdelijke map
        result?;
        self.player.scan_library();
        self.update(id, |j| {
            j.state = "klaar".into();
            j.progress = 1.0;
            j.message = if missing.is_empty() { String::new() } else { format!("{} stems ontbraken in de zip", missing.len()) };
        });
        Ok(())
    }
}

fn write_atomic(path: &Path, data: &[u8]) -> Res<()> {
    let tmp = PathBuf::from(format!("{}.tmp", path.display()));
    std::fs::write(&tmp, data).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Alles uit de zip naar `dest` (alleen binnen die map, geen vreemde paden)
pub fn unzip(zip_path: &Path, dest: &Path) -> Res<()> {
    let file = std::fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Uitpakken mislukt: {e}"))?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| format!("Uitpakken mislukt: {e}"))?;
        let Some(rel) = entry.enclosed_name() else { continue };
        let s = rel.to_string_lossy();
        if s.contains("__MACOSX") || rel.file_name().map(|n| n.to_string_lossy().starts_with("._")).unwrap_or(false) {
            continue;
        }
        let out = dest.join(&rel);
        if entry.is_dir() {
            std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(p) = out.parent() {
            std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
        }
        let mut f = std::fs::File::create(&out).map_err(|e| format!("{}: {e}", out.display()))?;
        std::io::copy(&mut entry, &mut f).map_err(|e| format!("Uitpakken mislukt: {e}"))?;
    }
    Ok(())
}

// ---- eigen click (MultiTracks-geluid) in 1/4, 1/8 en 1/16
fn decode_bank(b64: &str) -> Vec<i16> {
    use base64::Engine;
    let d = base64::engine::general_purpose::STANDARD.decode(b64).unwrap_or_default();
    d.chunks_exact(2).map(|c| i16::from_le_bytes([c[0], c[1]])).collect()
}

pub fn make_clicks(dir: &Path, desc: &Value) -> Res<Vec<Value>> {
    let tempo: Vec<(f64, f64)> = desc["tempo_qn"].as_array().into_iter().flatten().filter_map(|r| {
        let r = r.as_array()?;
        (r.len() == 2).then(|| Some((r[0].as_f64()?, r[1].as_f64()?)))?
    }).collect();
    let sigs: Vec<(f64, f64, f64)> = desc["timesig"].as_array().into_iter().flatten().filter_map(|r| {
        let r = r.as_array()?;
        (r.len() == 3).then(|| Some((r[0].as_f64()?, r[1].as_f64()?, r[2].as_f64()?)))?
    }).collect();
    if tempo.is_empty() {
        return Ok(vec![]);
    }
    let tm = TempoMap::from_qn(tempo, sigs);
    // lengte: de langste stem
    let mut duration = 0.0f64;
    for s in desc["stems"].as_array().into_iter().flatten() {
        let Some(f) = s["file"].as_str() else { continue };
        if let Some(d) = crate::decode::duration_secs(&dir.join(f)) {
            duration = duration.max(s["offset"].as_f64().unwrap_or(0.0) + d);
        }
    }
    if duration <= 0.0 {
        return Ok(vec![]);
    }
    let sr = 48000usize;
    let strong = decode_bank(crate::clickbank::STRONG);
    let weak = decode_bank(crate::clickbank::WEAK);
    let scale = |a: &Vec<i16>, f: f64| -> Vec<i16> { a.iter().map(|&v| (v as f64 * f) as i16).collect() };
    let sounds: [Vec<i16>; 4] = [strong.clone(), scale(&strong, 0.85), weak.clone(), scale(&weak, 0.6)]; // accent, kwart, achtste, zestiende
    let n = ((duration + 1.0) * sr as f64) as usize;
    let mut layers = vec![vec![0i16; n]; 3];
    let end_q = tm.qn_sec(duration);
    let mut bar_starts = std::collections::HashSet::new();
    let mut q = 0.0f64;
    while q <= end_q + 0.001 {
        bar_starts.insert((q * 4.0).round() as i64);
        let sig = tm.sigs.iter().rev().find(|s| s.0 <= q + 1e-6).unwrap_or(&tm.sigs[0]);
        q += sig.1;
    }
    let mut k: i64 = 0;
    while k as f64 / 4.0 <= end_q {
        let (layer, sound) = if k % 4 == 0 { (0, if bar_starts.contains(&k) { 0 } else { 1 }) } else if k % 2 == 0 { (1, 2) } else { (2, 3) };
        let start = (tm.sec_qn(k as f64 / 4.0) * sr as f64).round() as usize;
        for (i, &v) in sounds[sound].iter().enumerate() {
            if start + i < n {
                layers[layer][start + i] = (layers[layer][start + i] as i32 + v as i32).clamp(i16::MIN as i32, i16::MAX as i32) as i16;
            }
        }
        k += 1;
    }
    let orig_click = desc["orig_click"].as_bool().unwrap_or(false);
    let names = [("Click 1/4", "Ark Click 1-4.wav"), ("Click 1/8", "Ark Click 1-8.wav"), ("Click 1/16", "Ark Click 1-16.wav")];
    let mut out = Vec::new();
    for (i, nm) in names.iter().enumerate() {
        let path = dir.join(nm.1);
        let tmp = dir.join(format!("{}.tmp", nm.1));
        let spec = hound::WavSpec { channels: 1, sample_rate: sr as u32, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
        let mut w = hound::WavWriter::create(&tmp, spec).map_err(|e| e.to_string())?;
        for &s in &layers[i] {
            w.write_sample(s).map_err(|e| e.to_string())?;
        }
        w.finalize().map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
        out.push(json!({"file": nm.1, "name": nm.0, "offset": 0.0, "mute": !(orig_click && i == 0)})); // zonder echte click blijft de eigen click uit
    }
    Ok(out)
}
