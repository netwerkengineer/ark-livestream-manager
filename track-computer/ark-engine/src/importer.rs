//! Een nummer zonder server op deze computer zetten: een MultiTracks-zip (met .als) of een eigen opname (zip met song.json
//! en de stems). Dezelfde uitkomst als de beschrijving die de server maakt (mt2reaper.py --describe): het speelbestand
//! ark-player.json, de eigen click en de stems in de nummermap (SongImporter.swift).

use crate::song::{bus_for, is_live};
use crate::tempo::TempoMap;
use serde_json::{json, Value};

type Res<T> = Result<T, String>;
fn fail<T>(m: impl Into<String>) -> Res<T> {
    Err(m.into())
}

pub const AUDIO_EXT: &[&str] = &["wav", "m4a", "aif", "aiff", "mp3", "flac", "caf"];

#[derive(Default, Debug)]
pub struct Meta {
    pub tempo: Vec<(f64, f64)>,           // (kwartnoot, bpm)
    pub timesig: Vec<(f64, i64, i64)>,    // (kwartnoot, teller, noemer)
    pub markers: Vec<(f64, String)>,      // (kwartnoot, naam)
    pub tracks: Vec<(String, Option<String>, f64)>, // (naam, bestand, start in kwartnoten)
    pub title: Option<String>,
}

fn base_name(p: &str) -> &str {
    p.rsplit('/').next().unwrap_or(p)
}

// ---- Ableton (.als)
fn time_sig(v: i64) -> (i64, i64) {
    (v % 99 + 1, 1 << (v / 99)) // Ableton: (teller-1) + 99*log2(noemer)
}

fn collapse<T: Clone>(ev: Vec<(f64, T)>) -> Vec<(f64, T)> {
    let mut out: Vec<(f64, T)> = Vec::new();
    for (t, v) in ev {
        // het laatste event op een tijdstip is de nieuwe waarde
        if let Some(e) = out.iter_mut().find(|e| e.0 == t) {
            e.1 = v;
        } else {
            out.push((t, v));
        }
    }
    out.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
    out
}

fn child<'a, 'b>(n: roxmltree::Node<'a, 'b>, name: &str) -> Option<roxmltree::Node<'a, 'b>> {
    n.children().find(|c| c.is_element() && c.tag_name().name() == name)
}
fn path<'a, 'b>(n: roxmltree::Node<'a, 'b>, parts: &[&str]) -> Option<roxmltree::Node<'a, 'b>> {
    let mut cur = n;
    for p in parts {
        cur = child(cur, p)?;
    }
    Some(cur)
}

pub fn read_als(raw: &[u8]) -> Res<Meta> {
    let mut data = raw.to_vec();
    if data.len() > 2 && data[0] == 0x1f && data[1] == 0x8b {
        use std::io::Read;
        let mut out = Vec::new();
        flate2::read::GzDecoder::new(&raw[..]).read_to_end(&mut out).map_err(|e| format!("gunzip mislukte: {e}"))?;
        data = out;
    }
    let text = String::from_utf8(data).map_err(|_| "het .als-bestand is geen geldige tekst".to_string())?;
    let doc = roxmltree::Document::parse_with_options(&text, roxmltree::ParsingOptions { allow_dtd: true, ..Default::default() }).map_err(|e| format!("het .als-bestand is niet te lezen: {e}"))?;
    let mut m = Meta::default();
    let find = |name: &str| doc.descendants().find(|n| n.is_element() && n.tag_name().name() == name);
    if let Some(t) = find("Tempo") {
        let mut ev: Vec<(f64, f64)> = Vec::new();
        if let Some(events) = path(t, &["ArrangerAutomation", "Events"]) {
            for e in events.children().filter(|c| c.is_element() && c.tag_name().name() == "FloatEvent") {
                if let (Some(tm), Some(v)) = (e.attribute("Time").and_then(|x| x.parse::<f64>().ok()), e.attribute("Value").and_then(|x| x.parse::<f64>().ok())) {
                    ev.push((tm.max(0.0), v));
                }
            }
        }
        if ev.is_empty() {
            if let Some(v) = path(t, &["Manual"]).and_then(|n| n.attribute("Value")).and_then(|x| x.parse::<f64>().ok()) {
                ev = vec![(0.0, v)];
            }
        }
        m.tempo = collapse(ev);
    }
    if let Some(t) = find("TimeSignature") {
        let mut ev: Vec<(f64, (i64, i64))> = Vec::new();
        if let Some(events) = path(t, &["ArrangerAutomation", "Events"]) {
            for e in events.children().filter(|c| c.is_element() && c.tag_name().name() == "EnumEvent") {
                if let (Some(tm), Some(v)) = (e.attribute("Time").and_then(|x| x.parse::<f64>().ok()), e.attribute("Value").and_then(|x| x.parse::<i64>().ok())) {
                    ev.push((tm.max(0.0), time_sig(v)));
                }
            }
        }
        m.timesig = collapse(ev).into_iter().map(|(q, (n, d))| (q, n, d)).collect();
    }
    if m.tempo.is_empty() {
        m.tempo = vec![(0.0, 120.0)];
    }
    if m.timesig.is_empty() {
        m.timesig = vec![(0.0, 4, 4)];
    }
    if let Some(live) = find("LiveSet") {
        if let Some(locs) = path(live, &["Locators", "Locators"]) {
            for l in locs.children().filter(|c| c.is_element() && c.tag_name().name() == "Locator") {
                if let Some(t) = child(l, "Time").and_then(|n| n.attribute("Value")).and_then(|x| x.parse::<f64>().ok()) {
                    let name = child(l, "Name").and_then(|n| n.attribute("Value")).unwrap_or("").trim().to_string();
                    m.markers.push((t, name));
                }
            }
        }
        if let Some(tracks) = child(live, "Tracks") {
            for tr in tracks.children().filter(|c| c.is_element() && c.tag_name().name() == "AudioTrack") {
                let name = path(tr, &["Name", "EffectiveName"]).and_then(|n| n.attribute("Value")).unwrap_or("").to_string();
                for clip in tr.descendants().filter(|c| c.is_element() && c.tag_name().name() == "AudioClip") {
                    let file = clip
                        .descendants()
                        .find(|c| c.is_element() && c.tag_name().name() == "SampleRef")
                        .and_then(|s| s.descendants().find(|c| c.is_element() && c.tag_name().name() == "FileRef"))
                        .and_then(|f| child(f, "Name"))
                        .and_then(|n| n.attribute("Value"))
                        .map(String::from);
                    let start = clip.attribute("Time").and_then(|x| x.parse::<f64>().ok()).unwrap_or(0.0);
                    m.tracks.push((name.clone(), file, start));
                }
            }
        }
    }
    m.markers.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
    Ok(m)
}

// ---- eigen opname (song.json)
fn num(v: &Value, what: &str) -> Res<f64> {
    if let Some(n) = v.as_f64() {
        return Ok(n);
    }
    if let Some(s) = v.as_str().and_then(|s| s.trim().parse::<f64>().ok()) {
        return Ok(s);
    }
    fail(format!("song.json: {what} moet een getal zijn"))
}
fn sig(v: &Value) -> Res<(i64, i64)> {
    let Some(s) = v.as_str() else { return fail("song.json: maatsoort moet tekst zijn als \"4/4\"") };
    let p: Vec<Option<i64>> = s.split('/').map(|x| x.trim().parse().ok()).collect();
    if p.len() == 2 {
        if let (Some(n), Some(d)) = (p[0], p[1]) {
            if [1, 2, 4, 8, 16, 32].contains(&d) {
                return Ok((n, d));
            }
        }
    }
    fail("song.json: maatsoort moet zijn als \"4/4\" of \"6/8\"")
}
fn clean(s: &str) -> String {
    let t: String = s.chars().map(|c| if "-\\/:*?\"<>|".contains(c) { ' ' } else { c }).collect();
    t.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn read_song_json(raw: &[u8], audio_names: &[String]) -> Res<Meta> {
    let j: Value = serde_json::from_slice(raw).map_err(|_| "song.json: verwacht een object met title, bpm en sections".to_string())?;
    if !j.is_object() {
        return fail("song.json: verwacht een object met title, bpm en sections");
    }
    let title = j["title"].as_str().unwrap_or("").trim().to_string();
    if title.is_empty() {
        return fail("song.json: \"title\" ontbreekt");
    }
    // maatsoort per maat
    let mut sigs_in: Vec<(i64, (i64, i64))> = Vec::new();
    if j["timesig"].is_string() {
        sigs_in.push((1, sig(&j["timesig"])?));
    } else if let Some(l) = j["timesig"].as_array() {
        for e in l {
            sigs_in.push((num(&e[0], "maat in timesig")? as i64, sig(&e[1])?));
        }
    } else {
        sigs_in.push((1, (4, 4)));
    }
    sigs_in.sort_by_key(|s| s.0);
    if sigs_in.first().map(|s| s.0) != Some(1) {
        return fail("song.json: timesig moet bij maat 1 beginnen");
    }
    let bar_to_qn = |bar: f64, beat: f64| -> f64 {
        let whole = bar as i64;
        let (mut qn, mut b, mut idx) = (0.0, 1i64, 0usize);
        while b < whole {
            while idx + 1 < sigs_in.len() && sigs_in[idx + 1].0 <= b {
                idx += 1;
            }
            qn += sigs_in[idx].1 .0 as f64 * 4.0 / sigs_in[idx].1 .1 as f64;
            b += 1;
        }
        while idx + 1 < sigs_in.len() && sigs_in[idx + 1].0 <= whole {
            idx += 1;
        }
        let cur = sigs_in[idx].1;
        qn + (bar - whole as f64) * cur.0 as f64 * 4.0 / cur.1 as f64 + (beat - 1.0) * 4.0 / cur.1 as f64
    };
    let mut m = Meta::default();
    m.timesig = sigs_in.iter().map(|s| (bar_to_qn(s.0 as f64, 1.0), s.1 .0, s.1 .1)).collect();
    let mut tempo_in: Vec<(i64, f64)> = Vec::new();
    if let Some(l) = j["tempo"].as_array() {
        for e in l {
            tempo_in.push((num(&e[0], "maat in tempo")? as i64, num(&e[1], "tempo")?));
        }
    } else if !j["bpm"].is_null() {
        tempo_in.push((1, num(&j["bpm"], "bpm")?));
    } else {
        return fail("song.json: \"bpm\" (of \"tempo\": [[maat, bpm], ...]) ontbreekt");
    }
    tempo_in.sort_by_key(|t| t.0);
    if tempo_in.first().map(|t| t.0) != Some(1) {
        return fail("song.json: tempo moet bij maat 1 beginnen");
    }
    if tempo_in.iter().any(|t| t.1 < 20.0 || t.1 > 400.0) {
        return fail("song.json: tempo buiten 20-400 bpm");
    }
    m.tempo = tempo_in.iter().map(|t| (bar_to_qn(t.0 as f64, 1.0), t.1)).collect();
    let tm = TempoMap::from_qn(m.tempo.clone(), m.timesig.iter().map(|s| (s.0, s.1 as f64, s.2 as f64)).collect());
    for entry in j["sections"].as_array().into_iter().flatten() {
        let (mut name, mut bar, mut beat, mut sec) = (String::new(), Value::Null, json!(1), Value::Null);
        if let Some(d) = entry.as_object() {
            name = d.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
            bar = d.get("bar").cloned().unwrap_or(Value::Null);
            beat = d.get("beat").cloned().unwrap_or(json!(1));
            sec = d.get("sec").cloned().unwrap_or(Value::Null);
        } else if let Some(a) = entry.as_array() {
            name = a.first().and_then(|v| v.as_str()).unwrap_or("").to_string();
            bar = a.get(1).cloned().unwrap_or(Value::Null);
            beat = a.get(2).cloned().unwrap_or(json!(1));
        }
        let name = name.trim().to_string();
        if name.is_empty() {
            return fail("song.json: sectie zonder naam");
        }
        if !sec.is_null() {
            m.markers.push((tm.qn_sec(num(&sec, &format!("sec van {name}"))?), name));
        } else if !bar.is_null() {
            let b = num(&bar, &format!("maat van {name}"))?;
            if b < 1.0 {
                return fail(format!("song.json: maat van \"{name}\" moet vanaf 1 tellen"));
            }
            m.markers.push((bar_to_qn(b, num(&beat, &format!("tel van {name}"))?), name));
        } else {
            return fail(format!("song.json: sectie \"{name}\" heeft een \"bar\" (maat) of \"sec\" (seconden) nodig"));
        }
    }
    m.markers.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
    if m.markers.is_empty() {
        return fail("song.json: \"sections\" ontbreekt; zonder secties kan er niet gesprongen worden");
    }
    // stems: opgegeven, anders alle audiobestanden uit de zip
    if let Some(listed) = j["stems"].as_array().filter(|l| !l.is_empty()) {
        for s in listed {
            let d = if let Some(f) = s.as_str() { json!({ "file": f }) } else { s.clone() };
            let Some(f) = d["file"].as_str().filter(|f| !f.is_empty()) else { return fail("song.json: stem zonder \"file\"") };
            let base = base_name(f);
            if base.starts_with("._") {
                continue;
            }
            let start = if !d["start"].is_null() && num(&d["start"], "start").unwrap_or(0.0) != 0.0 { tm.qn_sec(num(&d["start"], "start")?) } else { 0.0 };
            let nm = d["name"].as_str().map(String::from).unwrap_or_else(|| std::path::Path::new(base).file_stem().unwrap().to_string_lossy().into());
            m.tracks.push((nm, Some(base.to_string()), start));
        }
    } else {
        let mut found: std::collections::BTreeMap<String, String> = Default::default();
        for n in audio_names {
            let f = base_name(n);
            let ext = std::path::Path::new(f).extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
            if f.starts_with("._") || f.starts_with("Ark Click") || !AUDIO_EXT.contains(&ext.as_str()) {
                continue;
            }
            let base = std::path::Path::new(f).file_stem().unwrap().to_string_lossy().to_string();
            if !found.contains_key(&base) || f.to_lowercase().ends_with(".wav") {
                found.insert(base, f.to_string());
            }
        }
        let mut keys: Vec<&String> = found.keys().collect();
        keys.sort_by_key(|k| k.to_lowercase());
        for base in keys {
            m.tracks.push((base.clone(), Some(found[base].clone()), 0.0));
        }
    }
    if m.tracks.is_empty() {
        return fail("song.json: geen audiobestanden (stems) in de zip");
    }
    // naam in MultiTracks-stijl ("Titel-Album-Toonsoort-120.00bpm"): daar halen de app en de padspeler titel, toonsoort en tempo uit
    let key = j["key"].as_str().unwrap_or("").trim().to_string();
    let album = j["album"].as_str().filter(|a| !a.is_empty()).unwrap_or("Eigen opname");
    let mut name = format!("{}-{}", clean(&title), clean(album));
    let kb: Vec<char> = key.chars().collect();
    let valid_key = !kb.is_empty() && ('A'..='G').contains(&kb[0]) && {
        let rest = &kb[1..];
        let rest = if !rest.is_empty() && (rest[0] == '#' || rest[0] == 'b') { &rest[1..] } else { rest };
        rest.is_empty() || (rest.len() == 1 && rest[0] == 'm')
    };
    if valid_key {
        name.push_str(&format!("-{key}-{:.2}bpm", tempo_in[0].1));
    } else if !key.is_empty() {
        return fail(format!("song.json: key \"{key}\" is geen toonsoort (bijv. C, Bb, F#m)"));
    }
    m.title = Some(name);
    Ok(m)
}

/// Het speelbestand (ark-player.json) uit de metagegevens en de namen in de zip. `root` is de map in de zip waar het nummer staat.
/// Geeft (beschrijving, ontbrekende stems) terug.
pub fn describe(meta: &Meta, names: &[String], root: &str, zip_title: &str) -> Res<(Value, Vec<String>, String)> {
    let tm = TempoMap::from_qn(meta.tempo.clone(), meta.timesig.iter().map(|s| (s.0, s.1 as f64, s.2 as f64)).collect());
    let mut by_base: std::collections::HashMap<&str, &String> = Default::default();
    for n in names {
        by_base.entry(base_name(n)).or_insert(n);
    }
    let click_bus = bus_for("click").0;
    let (mut stems, mut missing, mut orig_click) = (Vec::new(), Vec::new(), false);
    for t in &meta.tracks {
        let Some(file) = t.1.as_ref().filter(|f| !f.is_empty()) else { continue };
        let wav = format!("{}.wav", std::path::Path::new(file).with_extension("").to_string_lossy());
        let Some(found) = by_base.get(file.as_str()).or_else(|| by_base.get(wav.as_str())) else {
            missing.push(file.clone());
            continue;
        };
        let is_click = t.0.to_lowercase().starts_with("click") && bus_for(&t.0).0 == click_bus;
        orig_click = orig_click || is_click;
        let rel = if root.is_empty() { found.to_string() } else { found[root.len() + 1..].to_string() };
        stems.push(json!({"file": rel, "name": t.0, "offset": (tm.sec_qn(t.2) * 1e6).round() / 1e6, "mute": is_click || is_live(&t.0)}));
    }
    if stems.is_empty() {
        return fail("Geen van de stems uit de beschrijving zit in de zip");
    }
    let markers: Vec<&(f64, String)> = meta.markers.iter().filter(|m| !m.1.is_empty()).collect();
    let title = meta.title.clone().unwrap_or_else(|| if root.is_empty() { zip_title.to_string() } else { base_name(root).to_string() });
    let safe: String = title.chars().map(|c| if "\\/:*?\"<>|".contains(c) { ' ' } else { c }).collect::<String>().trim().to_string();
    let rpp = format!("{safe}.RPP");
    let desc = json!({
        "format": 2, "title": title, "rpp": rpp, "root": "", "orig_click": orig_click, "stems": stems,
        "sections": markers.iter().enumerate().map(|(i, m)| json!({"id": i + 1, "name": m.1, "sec": (tm.sec_qn(m.0) * 1e6).round() / 1e6})).collect::<Vec<_>>(),
        "tempo_qn": meta.tempo.iter().map(|t| json!([t.0, t.1])).collect::<Vec<_>>(),
        "timesig": meta.timesig.iter().map(|t| json!([t.0, t.1, t.2])).collect::<Vec<_>>(),
    });
    Ok((desc, missing, safe))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn song_json_basic() {
        let j = br#"{"title":"Test","key":"Bb","bpm":120,"timesig":"4/4","sections":[["Intro",1],["Vers",5]],"stems":["Drums.wav","Bass.wav"]}"#;
        let m = read_song_json(j, &[]).unwrap();
        assert_eq!(m.title.as_deref(), Some("Test-Eigen opname-Bb-120.00bpm"));
        assert_eq!(m.markers.len(), 2);
        assert!((m.markers[1].0 - 16.0).abs() < 1e-9);
        assert_eq!(m.tracks.len(), 2);
    }
    #[test]
    fn als_signature() {
        assert_eq!(time_sig(3), (4, 1));
        assert_eq!(time_sig(201), (4, 4));
    }
    #[test]
    fn json_errors() {
        assert!(read_song_json(br#"{"bpm":100}"#, &[]).is_err());
        assert!(read_song_json(br#"{"title":"x","bpm":10,"sections":[["a",1]]}"#, &[]).is_err());
    }
}
