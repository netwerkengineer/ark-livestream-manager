//! Een kopie van het Tracks-scherm van de webapp, zodat de app ook zonder verbinding met de server werkt (OfflineMirror.swift).
//!
//! Bij een gewone start (met server) haalt de app op de achtergrond de pagina /desktop en de bestanden van deze versie van de
//! webapp (/_next/static/...) binnen. Zonder server toont de app die kopie via het adres arkoffline://app/ en beantwoordt de
//! pagina zelf de verzoeken aan de server (zie desktopEngine.ts).

use crate::player::{config_dir, log};
use serde_json::Value;
use std::path::{Path, PathBuf};

pub const SCHEME: &str = "arkoffline";
pub const URL: &str = "arkoffline://app/desktop";
const AGENT: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15 ArkTracksDesktop";

pub fn dir() -> PathBuf {
    match std::env::var("ARK_MIRROR_DIR") {
        Ok(d) if !d.is_empty() => PathBuf::from(d), // voor de proeven
        _ => PathBuf::from(config_dir()).join("offline"),
    }
}

pub fn available() -> bool {
    dir().join("desktop.html").exists()
}

fn get(server: &str, path: &str, key: &str) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let url = format!("{server}{path}");
    let mut req = ureq::AgentBuilder::new().timeout_connect(std::time::Duration::from_secs(15)).timeout_read(std::time::Duration::from_secs(60)).build().get(&url).set("User-Agent", AGENT);
    if !key.is_empty() {
        req = req.set("Cookie", &format!("ark_desktop={key}"));
    }
    let resp = match req.call() {
        Ok(r) => r,
        Err(ureq::Error::Status(c, _)) => return Err(format!("{path}: server antwoordde {c}")),
        Err(e) => return Err(format!("{path}: {e}")),
    };
    let mut buf = Vec::new();
    resp.into_reader().read_to_end(&mut buf).map_err(|e| format!("{path}: {e}"))?;
    Ok(buf)
}

static SYNCING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Haalt de kopie binnen en vervangt daarna de oude in één keer. Bestanden die er al zijn worden hergebruikt (de namen bevatten een vingerafdruk).
pub fn sync(server: &str, key: &str) -> Result<(), String> {
    if SYNCING.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return Ok(());
    }
    let r = run(server, key);
    SYNCING.store(false, std::sync::atomic::Ordering::SeqCst);
    r
}

fn run(raw_server: &str, key: &str) -> Result<(), String> {
    let server = raw_server.trim().trim_matches('/').to_string();
    let cur = dir();
    let fresh = cur.parent().unwrap_or(Path::new(".")).join("offline.new");
    let _ = std::fs::remove_dir_all(&fresh);
    std::fs::create_dir_all(&fresh).map_err(|e| e.to_string())?;
    let result = (|| -> Result<(), String> {
        let html = get(&server, "/desktop", key)?;
        let text = String::from_utf8_lossy(&html).to_string();
        if !text.contains("/_next/") {
            return Err("de pagina /desktop is niet zoals verwacht".into());
        }
        let podium = get(&server, "/tracks", key).ok(); // het Podium en de mixer, voor de lokale bediening (zonder server)
        let mixer = get(&server, "/tracks/mixer", key).ok();
        let list: Value = serde_json::from_slice(&get(&server, "/api/tracks/desktop/bundle", key)?).map_err(|e| e.to_string())?;
        let files: Vec<String> = list["files"].as_array().into_iter().flatten().filter_map(|f| f.as_str().map(String::from)).collect();
        if files.is_empty() {
            return Err("de server gaf geen lijst met bestanden".into());
        }
        let failed = std::sync::atomic::AtomicUsize::new(0);
        let next = std::sync::atomic::AtomicUsize::new(0);
        std::thread::scope(|sc| {
            for _ in 0..8 {
                sc.spawn(|| loop {
                    let i = next.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    let Some(f) = files.get(i) else { break };
                    let rel = f.trim_start_matches('/');
                    if rel.contains("..") {
                        failed.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                        continue;
                    }
                    let target = fresh.join(rel);
                    if let Some(p) = target.parent() {
                        let _ = std::fs::create_dir_all(p);
                    }
                    let old = cur.join(rel);
                    if old.exists() && std::fs::copy(&old, &target).is_ok() {
                        continue;
                    }
                    let ok = get(&server, f, key).map(|d| std::fs::write(&target, d).is_ok()).unwrap_or(false);
                    if !ok {
                        failed.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    }
                });
            }
        });
        let nf = failed.load(std::sync::atomic::Ordering::SeqCst);
        if nf > 0 {
            return Err(format!("{nf} bestanden konden niet worden opgehaald"));
        }
        std::fs::write(fresh.join("desktop.html"), &html).map_err(|e| e.to_string())?;
        if let Some(p) = podium.filter(|p| String::from_utf8_lossy(p).contains("/_next/")) {
            let _ = std::fs::write(fresh.join("tracks.html"), p);
        }
        if let Some(m) = mixer.filter(|m| String::from_utf8_lossy(m).contains("/_next/")) {
            let _ = std::fs::write(fresh.join("mixer.html"), m);
        }
        let _ = std::fs::remove_dir_all(&cur);
        std::fs::rename(&fresh, &cur).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = std::fs::remove_dir_all(&fresh);
    }
    match &result {
        Ok(()) => log("Kopie voor gebruik zonder server is bijgewerkt"),
        Err(e) => log(&format!("Kopie voor gebruik zonder server niet bijgewerkt: {e}")),
    }
    result
}

pub fn content_type(ext: &str) -> &'static str {
    match ext {
        "js" => "text/javascript",
        "css" => "text/css",
        "html" => "text/html; charset=utf-8",
        "json" => "application/json",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "png" => "image/png",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        _ => "application/octet-stream",
    }
}

/// Levert de kopie aan de webview (alleen bestanden lezen). Geeft (status, type, inhoud).
pub fn serve(path: &str, query: &str, rsc: bool) -> (u16, &'static str, Vec<u8>) {
    let is_rsc = rsc || query.contains("_rsc");
    let d = dir();
    let file = if !is_rsc && (path.is_empty() || path == "/" || path == "/desktop") {
        Some(d.join("desktop.html"))
    } else if !is_rsc && path == "/tracks" {
        Some(d.join("tracks.html"))
    } else if !is_rsc && path == "/tracks/mixer" {
        Some(d.join("mixer.html"))
    } else if path.starts_with("/_next/static/") && !path.contains("..") {
        Some(d.join(path.trim_start_matches('/')))
    } else {
        None
    };
    if let Some(f) = file {
        if let Ok(data) = std::fs::read(&f) {
            let ext = f.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
            return (200, content_type(&ext), data);
        }
    }
    (404, "text/plain", Vec::new())
}
