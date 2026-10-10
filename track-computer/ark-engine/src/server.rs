//! De opdrachten van de pagina (zelfde paden en antwoorden als server.swift): /state, /jump, /load, ...
//! `handle` is los van het transport: de app roept het aan via de brug `window.arkEngine`, en later via de lokale bediening.

use crate::mixer::Mixer;
use crate::player::{folder_of, log, Player};
use crate::song::{Song, DEFAULT_BUSSES};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;

pub struct Query {
    pub qs: HashMap<String, String>,
    pub items: Vec<(String, String)>,
}

impl Query {
    pub fn new(items: Vec<(String, String)>) -> Query {
        let mut qs = HashMap::new();
        for (k, v) in &items {
            qs.insert(k.clone(), v.clone());
        }
        Query { qs, items }
    }
    pub fn s(&self, k: &str) -> Option<&str> {
        self.qs.get(k).map(|s| s.as_str())
    }
    pub fn f(&self, k: &str) -> Option<f64> {
        self.s(k)?.trim().parse().ok()
    }
    pub fn i(&self, k: &str) -> Option<i64> {
        self.s(k)?.trim().parse().ok()
    }
}

fn db(g: f32) -> f64 {
    if g <= 0.000001 { -150.0 } else { 20.0 * (g as f64).log10() }
}

fn ok() -> (u16, String) {
    (200, json!({"ok": true}).to_string())
}
fn bad(msg: &str) -> (u16, String) {
    (400, json!({"error": msg}).to_string())
}

/// Wat de pagina over de speler wil weten (/state)
pub fn state(p: &Arc<Player>) -> Value {
    let st = p.lock();
    let m = p.mx();
    let s = &m.song;
    let dur = s.total() as f64 / m.sr;
    let state = if m.playing { "playing" } else if m.pos > 0 && m.pos < s.total() { "paused" } else { "stopped" };
    let cur = m.section_index(m.pos);
    let tm = &s.tempo;
    let pad = m.pads.meta();
    let fs_host = Player::fs_host(&st);
    let mut loaded: Vec<String> = st.cache.keys().cloned().collect();
    loaded.sort();
    let mut d = json!({
        "title": s.title, "path": st.active_path, "state": state, "position": m.pos_sec(),
        "position_beats": tm.bar_beat(tm.qn_sec(m.pos_sec())), "duration": dur,
        "loading": !st.loading.is_empty(), "error": st.error.clone().unwrap_or_default(),
        "device": st.device_name, "outputs": if st.hw_channels > 0 { st.hw_channels } else { m.out_ch },
        "output_mode": m.requested, "output_applied": m.applied,
        "master_db": db(m.master), "master_mute": m.master_muted, "jump_mode": m.jump_mode, "lead_beats": st.cfg.lead_beats,
        "freeshow": if fs_host.is_empty() { String::new() } else { format!("{}:{}", fs_host, Player::fs_port(&st)) },
        "freeshow_override": !st.cfg.fs_host.is_empty(),
        "has_cues": st.table.is_some(), "slide": st.sent.unwrap_or(0), "last_cmd": st.last_cmd,
        "setlist": st.setlist, "loaded": loaded,
        "sections": s.sections.iter().enumerate().map(|(i, x)| json!({"id": i, "region": x.id, "name": x.name, "start": x.start, "end": x.end,
            "start_qn": tm.qn_sec(x.start), "end_qn": tm.qn_sec(x.end)})).collect::<Vec<_>>(),
        "stems": s.stems.iter().map(|x| json!({"name": x.name, "bus": x.bus, "bus_name": x.bus_name, "mute": x.mute, "solo": x.solo, "live": x.live,
            "monitor": x.monitor, "gain_db": db(x.gain), "gain": x.gain as f64, "meter_db": db(x.peak)})).collect::<Vec<_>>(),
        "busses": DEFAULT_BUSSES.iter().map(|b| json!({"bus": b.1, "name": b.0, "mute": m.group_mute[b.1], "solo": m.group_solo[b.1], "gain": m.group_gain[b.1] as f64})).collect::<Vec<_>>(),
        "render": {"blocks": m.blocks, "avg_us": if m.blocks > 0 { m.sum_micros / m.blocks as f64 } else { 0.0 }, "max_us": m.max_micros},
        "pads": {"playing": m.pads.playing(), "loading": pad.loading, "set": pad.set, "layer": pad.layer, "key": pad.key, "volume": m.pads.volume() as f64,
            "output": m.applied, "device": st.device_name, "sets": pad.library, "lastCmd": pad.last_cmd},
    });
    let o = d.as_object_mut().unwrap();
    if !pad.error.is_empty() {
        o.insert("pads_error".into(), json!(pad.error));
    }
    if let Some(c) = cur {
        o.insert("section".into(), json!(c));
    }
    if m.pend_section >= 0 {
        o.insert("pending".into(), json!(m.pend_section));
        o.insert("pending_at".into(), json!(m.pend_at as f64 / m.sr));
    }
    if m.loop_sec >= 0 {
        o.insert("loop".into(), json!(m.loop_sec));
    }
    if let Some(n) = Player::next_song(&st) {
        o.insert("next_song".into(), json!(n));
    }
    if let (Some(t), true) = (&st.switch_target, m.pend_song_at >= 0) {
        o.insert("pending_song".into(), json!(t.0));
        o.insert("pending_song_at".into(), json!(m.pend_song_at as f64 / m.sr));
    }
    if let Some(r) = &st.rec {
        o.insert("recording".into(), json!(true));
        o.insert("rec_slide".into(), json!(r.idx));
        o.insert("rec_slides".into(), json!(r.region.map(|x| p.region_notes(&st, &m, x).len()).unwrap_or(0)));
    }
    d
}

/// Secties en tempo van een nummer lezen zonder de audio te laden (alleen de lengte uit de bestandskoppen)
fn outline(folder: &str) -> Option<(String, Vec<crate::song::Section>, crate::tempo::TempoMap)> {
    let data = std::fs::read(format!("{folder}/ark-player.json")).ok()?;
    let j: Value = serde_json::from_slice(&data).ok()?;
    let song = crate::song::outline_from_json(folder, &j);
    Some(song)
}

pub fn handle(p: &Arc<Player>, path: &str, q: &Query) -> (u16, String) {
    let t0 = std::time::Instant::now();
    let r = handle_inner(p, path, q);
    let ms = t0.elapsed().as_secs_f64() * 1000.0;
    if ms > 15.0 || path == "/jump" || path == "/song" || path == "/load" {
        log(&format!("Opdracht {path} {} duurde {ms:.1} ms", q.items.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("&")));
    }
    r
}

fn handle_inner(p: &Arc<Player>, path: &str, q: &Query) -> (u16, String) {
    p.lock().last_cmd = path.to_string();
    let mx = || p.mx();
    match path {
        "/state" => (200, state(p).to_string()),
        "/play" => {
            let mut m = mx();
            if m.pos >= m.song.total() {
                m.pos = 0;
            }
            m.playing = true;
            ok()
        }
        "/pause" => {
            mx().playing = false;
            ok()
        }
        "/stop" => {
            {
                let mut m = mx();
                m.playing = false;
                m.pos = 0;
                m.stop_loop();
                m.cancel_pending();
            }
            p.cancel_song();
            ok()
        }
        "/seek" => {
            let Some(t) = q.f("t") else { return bad("t ontbreekt") };
            let mut m = mx();
            let max = m.song.total();
            m.pos = ((t * m.sr) as i64).max(0).min(max as i64) as usize;
            ok()
        }
        "/mute" => {
            let on = q.s("on").unwrap_or("1") != "0";
            let stem = q.s("stem").map(|s| s.to_lowercase());
            for s in mx().song.stems.iter_mut() {
                if stem.as_ref().map_or(true, |n| s.name.to_lowercase() == *n) {
                    s.mute = on;
                }
            }
            ok()
        }
        "/gain" => {
            let Some(d) = q.f("db") else { return bad("db ontbreekt") };
            let stem = q.s("stem").unwrap_or("").to_lowercase();
            for s in mx().song.stems.iter_mut().filter(|s| s.name.to_lowercase() == stem) {
                s.gain = 10f64.powf(d / 20.0) as f32;
            }
            ok()
        }
        "/solo" => {
            let on = q.s("on").unwrap_or("1") != "0";
            let stem = q.s("stem").unwrap_or("").to_lowercase();
            for s in mx().song.stems.iter_mut().filter(|s| s.name.to_lowercase() == stem) {
                s.solo = on;
            }
            ok()
        }
        "/group" => {
            let b = match q.i("bus") {
                Some(b) if (1..=8).contains(&b) => b as usize,
                _ => return bad("bus = 1-8"),
            };
            let mut m = mx();
            if let Some(v) = q.s("mute") {
                m.group_mute[b] = v != "0";
            }
            if let Some(v) = q.s("solo") {
                m.group_solo[b] = v != "0";
            }
            if let Some(g) = q.f("gain") {
                m.group_gain[b] = g.max(0.0).min(4.0) as f32;
            }
            ok()
        }
        "/unmute" => {
            let mut m = mx();
            for s in m.song.stems.iter_mut() {
                s.mute = false;
                s.solo = false;
            }
            for b in 0..m.group_mute.len() {
                m.group_mute[b] = false;
                m.group_solo[b] = false;
            }
            ok()
        }
        "/master" => {
            let mut m = mx();
            if let Some(v) = q.s("mute") {
                m.master_muted = v != "0";
            }
            if let Some(d) = q.f("db") {
                m.master = 10f64.powf(d.max(-90.0).min(6.0) / 20.0) as f32;
            } else if q.s("mute").is_none() {
                return bad("db of mute ontbreekt");
            }
            ok()
        }
        "/jump" => {
            let Some(id) = q.i("id") else { return bad("id ontbreekt") };
            if id < 0 {
                return bad("sectie niet gevonden");
            }
            match p.jump(id as usize, q.s("mode")) {
                Ok(()) => ok(),
                Err(e) => bad(&e),
            }
        }
        "/loop" => {
            let mut m = mx();
            if q.s("on").unwrap_or("1") == "0" {
                m.stop_loop();
                return ok();
            }
            match m.start_loop() {
                Ok(()) => ok(),
                Err(e) => bad(&e),
            }
        }
        "/cancel" => {
            mx().cancel_pending();
            ok()
        }
        "/mode" => match q.s("m") {
            Some(m) if ["end", "bar", "now"].contains(&m) => {
                p.set_jump_mode(m);
                ok()
            }
            _ => bad("m = end|bar|now"),
        },
        "/output" => match q.s("mode") {
            Some(m) if ["auto", "multi", "2ch", "3ch", "stereo"].contains(&m) => {
                p.set_output_mode(m);
                let applied = mx().applied.clone();
                log(&format!("Uitgangsmodus {m} -> {applied}"));
                (200, json!({"ok": true, "applied": applied}).to_string())
            }
            _ => bad("mode = auto|multi|2ch|3ch|stereo"),
        },
        // --- nummers en setlist
        "/load" | "/song" => {
            let Some(target) = q.s("path") else { return bad("path ontbreekt") };
            let mode = if path == "/load" { None } else { q.s("mode") };
            match p.select_song(target, mode) {
                Ok(()) => (202, json!({"ok": true}).to_string()),
                Err(e) => bad(&e),
            }
        }
        "/songcancel" => {
            p.cancel_song();
            ok()
        }
        "/setlist" => {
            let mut paths: Vec<String> = q.items.iter().filter(|(k, _)| k == "p").map(|(_, v)| v.replace('+', " ")).collect();
            if let Some(j) = q.s("paths") {
                paths.extend(j.split('|').map(String::from));
            }
            let n = paths.len();
            p.set_setlist(paths);
            (202, json!({"ok": true, "count": n}).to_string())
        }
        "/scan" => {
            p.scan_library();
            ok()
        }
        "/sections" => {
            let Some(target) = q.s("path") else { return bad("path ontbreekt") };
            let Some((title, secs, tm)) = outline(&folder_of(target)) else { return bad("Geen speelbestand (ark-player.json of song.json) bij dit nummer") };
            let lead = p.lock().cfg.lead_beats;
            (200, json!({"title": title, "lead": lead, "sections": secs.iter().map(|s| json!({"id": s.id, "name": s.name, "start": s.start, "finish": s.end,
                "startQn": tm.qn_sec(s.start), "finishQn": tm.qn_sec(s.end)})).collect::<Vec<_>>()}).to_string())
        }
        "/pad" => {
            let (pads, sr) = {
                let m = mx();
                (m.pads.clone(), m.sr)
            };
            pads.set_last_cmd(&q.s("id").map(String::from).unwrap_or_else(|| std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis().to_string()).unwrap_or_default()));
            let fade = q.f("fade").unwrap_or(4.0);
            match q.s("op").unwrap_or("") {
                "play" => {
                    let (set, layer, key) = (q.s("set").unwrap_or(""), q.s("layer").unwrap_or(""), q.s("key").unwrap_or(""));
                    if set.is_empty() || layer.is_empty() || key.is_empty() {
                        return bad("set, laag en toon ontbreken");
                    }
                    pads.play(set, layer, key, fade, sr);
                }
                "stop" => pads.stop(fade, sr),
                "volume" => pads.set_volume(q.f("volume").unwrap_or(pads.volume() as f64) as f32),
                "rescan" => pads.scan(),
                _ => return bad("Onbekende pad-actie"),
            }
            ok()
        }
        "/configure" => {
            let mut device_changed = false;
            if let Some(d) = q.s("device") {
                if d != p.lock().cfg.device {
                    device_changed = true;
                }
                p.set_device(d);
            }
            if let Some(m) = q.s("output_mode") {
                if ["auto", "multi", "3ch", "2ch", "stereo"].contains(&m) {
                    p.set_output_mode(m);
                }
            }
            if let Some(r) = q.s("songs_root") {
                p.set_songs_root(r);
            }
            if let Some(r) = q.s("pads_root") {
                {
                    let mut st = p.lock();
                    st.cfg.pads_root = r.to_string();
                    st.cfg.save();
                }
                let pads = mx().pads.clone();
                pads.set_root(r);
            }
            if let Some(h) = q.s("freeshow_host") {
                p.set_freeshow(h, q.i("freeshow_port"));
            }
            if device_changed {
                let (restart, dev) = {
                    let st = p.lock();
                    (st.restart_audio.clone(), st.cfg.device.clone())
                };
                if let Some(r) = restart {
                    if let Err(e) = r(&dev) {
                        return bad(&format!("Audio starten mislukt: {e}"));
                    }
                }
            }
            ok()
        }
        "/devices" => {
            let st = p.lock();
            let list = st.list_devices.as_ref().map(|f| f()).unwrap_or_default();
            (200, json!({"devices": list.iter().filter(|d| d.1 > 0).map(|d| json!({"name": d.0, "outputs": d.1})).collect::<Vec<_>>(), "current": st.device_name}).to_string())
        }
        "/settings" => {
            let st = p.lock();
            (200, json!({"device": st.cfg.device, "songs_root": st.songs_root, "pads_root": st.cfg.pads_root, "freeshow_host": st.cfg.fs_host,
                "freeshow_port": st.cfg.fs_port, "output_mode": st.cfg.output_mode, "lead_beats": st.cfg.lead_beats}).to_string())
        }
        "/library" => {
            let st = p.lock();
            let active = p.mx().song.folder.clone();
            (200, json!({"songs": st.library.iter().map(|s| json!({"name": s.name, "path": s.path,
                "loaded": st.cache.contains_key(&folder_of(&s.path)) || active == folder_of(&s.path)})).collect::<Vec<_>>()}).to_string())
        }
        // --- cues
        "/cues" => {
            let Some(target) = q.s("path") else { return bad("path ontbreekt") };
            match p.save_cues(target, q.s("data").unwrap_or("")) {
                Ok(()) => ok(),
                Err(e) => bad(&e),
            }
        }
        "/lead" => {
            let Some(b) = q.f("beats") else { return bad("beats ontbreekt") };
            match p.set_lead(b) {
                Ok(()) => ok(),
                Err(e) => bad(&e),
            }
        }
        "/freeshow" => {
            if q.s("runtime") == Some("1") {
                p.set_freeshow_runtime(q.s("host").unwrap_or(""), q.i("port"));
            } else {
                p.set_freeshow(q.s("host").unwrap_or(""), q.i("port"));
            }
            ok()
        }
        "/record" => match p.record(q.s("action").unwrap_or("cancel")) {
            Ok(()) => ok(),
            Err(e) => bad(&e),
        },
        "/tap" => match p.tap(q.f("pos")) {
            Ok(()) => ok(),
            Err(e) => bad(&e),
        },
        "/taps" => (200, p.lock().last_taps.to_string()),
        "/notes" => {
            let st = p.lock();
            (200, json!({"path": st.active_path, "notes": st.timeline.iter().map(|n| json!({"t": n.t, "n": n.n})).collect::<Vec<_>>()}).to_string())
        }
        _ => (404, json!({"error": "onbekend"}).to_string()),
    }
}

#[allow(dead_code)]
fn _unused(_: &Mixer, _: &Song) {}
