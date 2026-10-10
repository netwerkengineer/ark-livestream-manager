//! Lokale bediening zonder server: de app levert zelf het Podium (de kopie uit `offline`) aan tablets en telefoons op het
//! netwerk en bedient de speler rechtstreeks (LocalRemote.swift). Bedoeld voor als de server of de NAS uitvalt tijdens een dienst.
//!
//! - Staat standaard uit; poort en aan/uit in het instellingenscherm, niets vast in de code.
//! - Een apparaat koppelt eenmalig: de computer vraagt "toestaan?" en geeft dan een eigen sleutel (alleen de hash wordt bewaard).
//!   Elk apparaat is afzonderlijk in te trekken.
//! - Alleen een vaste lijst opdrachten van de speler is bereikbaar; geen instellingen, geen opnemen, geen bestanden.
//! - De verbinding is versleuteld (https) met een eigen certificaat (zie `lanca`), of gewoon http op een netwerk dat je vertrouwt.

use crate::lanca::{uuid_like, Ca};
use crate::offline;
use crate::player::{config_dir, log, Player};
use crate::server::{handle, Query};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use std::io::{Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// engine-opdrachten die vanaf het netwerk mogen (geen instellingen, opnemen of bestanden)
pub const ALLOWED: &[&str] = &[
    "/state", "/library", "/play", "/pause", "/stop", "/seek", "/mute", "/solo", "/gain", "/group", "/unmute", "/master", "/jump", "/loop", "/mode",
    "/load", "/song", "/songcancel", "/setlist", "/pad",
];

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

// ------------------------------------------------------------- eigen instellingen van de pagina ("ark-…") op deze computer
#[derive(Default)]
pub struct Kv {
    path: Option<PathBuf>,
    values: Mutex<BTreeMap<String, String>>,
}

impl Kv {
    pub fn new(path: Option<PathBuf>) -> Kv {
        let values = path.as_ref().and_then(|p| std::fs::read(p).ok()).and_then(|d| serde_json::from_slice::<BTreeMap<String, String>>(&d).ok()).unwrap_or_default();
        Kv { path, values: Mutex::new(values) }
    }
    pub fn values(&self) -> BTreeMap<String, String> {
        self.values.lock().unwrap().clone()
    }
    pub fn set(&self, k: &str, v: Option<&str>) {
        if !k.starts_with("ark-") && k != "__init" {
            return;
        }
        {
            let mut g = self.values.lock().unwrap();
            match v {
                Some(v) => g.insert(k.to_string(), v.to_string()),
                None => g.remove(k),
            };
        }
        self.save();
    }
    fn save(&self) {
        let Some(p) = &self.path else { return };
        let data = serde_json::to_vec(&*self.values.lock().unwrap()).unwrap_or_default();
        if let Some(d) = p.parent() {
            let _ = std::fs::create_dir_all(d);
        }
        let tmp = PathBuf::from(format!("{}.tmp", p.display()));
        if std::fs::write(&tmp, data).is_ok() {
            let _ = std::fs::rename(&tmp, p);
        }
    }
}

// ------------------------------------------------------------- gekoppelde apparaten
#[derive(Clone)]
pub struct Device {
    pub id: String,
    pub name: String,
    pub hash: String,
    pub created: u64,
    pub last_seen: u64,
}

fn hash_token(t: &str) -> String {
    Sha256::digest(t.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

struct Devices {
    path: Option<PathBuf>, // None: alleen in het geheugen (proeven)
    list: Vec<Device>,
    last_save: Instant,
}

impl Devices {
    fn load(path: Option<PathBuf>) -> Devices {
        let list = path
            .as_ref()
            .and_then(|p| std::fs::read(p).ok())
            .and_then(|d| serde_json::from_slice::<Vec<Value>>(&d).ok())
            .map(|v| {
                v.iter()
                    .filter_map(|j| {
                        Some(Device { id: j["id"].as_str()?.into(), name: j["name"].as_str()?.into(), hash: j["hash"].as_str()?.into(), created: j["created"].as_u64().unwrap_or(0), last_seen: j["lastSeen"].as_u64().unwrap_or(0) })
                    })
                    .collect()
            })
            .unwrap_or_default();
        Devices { path, list, last_save: Instant::now() }
    }
    fn persist(&mut self) {
        self.last_save = Instant::now();
        let Some(p) = &self.path else { return };
        use std::os::unix::fs::PermissionsExt;
        let j: Vec<Value> = self.list.iter().map(|d| json!({"id": d.id, "name": d.name, "hash": d.hash, "created": d.created, "lastSeen": d.last_seen})).collect();
        if let Some(d) = p.parent() {
            let _ = std::fs::create_dir_all(d);
        }
        let tmp = PathBuf::from(format!("{}.tmp", p.display()));
        if std::fs::write(&tmp, serde_json::to_vec(&j).unwrap()).is_ok() {
            let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
            let _ = std::fs::rename(&tmp, p);
        }
    }
}

// ------------------------------------------------------------- de server
pub struct LanConfig {
    pub name: String, // naam van deze computer, voor de pagina's en het certificaat
}

pub struct Lan {
    player: Arc<Player>,
    kv: Arc<Kv>,
    ca: Ca,
    devices: Mutex<Devices>,
    /// vraagt de gebruiker om toestemming (blokkeert tot er antwoord is of de tijd om is)
    confirm: Arc<dyn Fn(&str, &str) -> bool + Send + Sync>,
    auto_allow: bool, // alleen voor de proeven
    run: Mutex<Option<Arc<AtomicBool>>>, // stopvlag van de draaiende server
    pairing: AtomicBool,
    attempts: Mutex<HashMap<String, Vec<Instant>>>,
    log_hits: Mutex<HashMap<String, Vec<Instant>>>,
    pub last_error: Mutex<Option<String>>,
    status: Mutex<Status>,
}

#[derive(Default, Clone)]
struct Status {
    port: u16,
    tls: bool,
    ips: Vec<String>,
    running: bool,
    name: String,
}

pub fn host_local_name() -> String {
    let h = gethostname::gethostname().to_string_lossy().to_lowercase();
    let h = h.trim_end_matches(".local").to_string();
    format!("{h}.local")
}

pub fn local_ips() -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(list) = if_addrs::get_if_addrs() {
        for i in list {
            let n = i.name.to_lowercase();
            if i.is_loopback() || !(n.starts_with("en") || n.starts_with("eth") || n.starts_with("wl")) {
                continue;
            }
            if let if_addrs::IfAddr::V4(a) = i.addr {
                let ip = a.ip.to_string();
                if !ip.starts_with("169.254.") {
                    out.push(ip);
                }
            }
        }
    }
    out.sort();
    out
}

impl Lan {
    /// `test`: alles in het geheugen en koppelen vanzelf toestaan; raakt de echte instellingen niet aan
    pub fn new(player: Arc<Player>, kv: Arc<Kv>, confirm: Arc<dyn Fn(&str, &str) -> bool + Send + Sync>, test: bool) -> Arc<Lan> {
        let dir = PathBuf::from(config_dir()).join("lan");
        Arc::new(Lan {
            player,
            kv,
            ca: Ca::new(if test { None } else { Some(dir.clone()) }),
            devices: Mutex::new(Devices::load(if test { None } else { Some(dir.join("devices.json")) })),
            confirm,
            auto_allow: test,
            run: Mutex::new(None),
            pairing: AtomicBool::new(false),
            attempts: Mutex::new(HashMap::new()),
            log_hits: Mutex::new(HashMap::new()),
            last_error: Mutex::new(None),
            status: Mutex::new(Status::default()),
        })
    }

    pub fn stop(&self) {
        if let Some(f) = self.run.lock().unwrap().take() {
            f.store(true, Ordering::SeqCst);
        }
        self.status.lock().unwrap().running = false;
    }

    pub fn start(self: &Arc<Self>, port: u16, tls: bool, name: &str) {
        self.stop();
        *self.last_error.lock().unwrap() = None;
        let ips = local_ips();
        let stop = Arc::new(AtomicBool::new(false));
        *self.run.lock().unwrap() = Some(stop.clone());
        {
            let mut s = self.status.lock().unwrap();
            *s = Status { port, tls, ips: ips.clone(), running: false, name: name.to_string() };
        }
        // https: eigen certificaat voor deze namen en adressen
        let tls_cfg = if tls {
            match self.ca.leaf(&[host_local_name()], &ips, name).and_then(|(cert, key)| make_tls(cert, key)) {
                Ok(c) => Some(Arc::new(c)),
                Err(e) => {
                    *self.last_error.lock().unwrap() = Some(e.clone());
                    log(&format!("Lokale bediening starten mislukt: {e}"));
                    return;
                }
            }
        } else {
            None
        };
        let main = match TcpListener::bind(("0.0.0.0", port)) {
            Ok(l) => l,
            Err(e) => {
                *self.last_error.lock().unwrap() = Some(format!("poort {port} niet beschikbaar: {e}"));
                log(&format!("Lokale bediening: poort {port} niet beschikbaar: {e}"));
                return;
            }
        };
        let onboarding = if tls { TcpListener::bind(("0.0.0.0", port + 1)).ok() } else { None };
        self.status.lock().unwrap().running = true;
        log(&format!("Lokale bediening aan op poort {port}{}", if tls { " (https)" } else { "" }));
        let me = self.clone();
        let st = stop.clone();
        std::thread::Builder::new().name("ark-lan".into()).spawn(move || me.accept_loop(main, tls_cfg, false, st)).ok();
        if let Some(ob) = onboarding {
            let me = self.clone();
            let st = stop.clone();
            std::thread::Builder::new().name("ark-lan-onboarding".into()).spawn(move || me.accept_loop(ob, None, true, st)).ok();
        }
        // wisselt het adres van deze computer (andere wifi, nieuw DHCP-adres), dan past het certificaat niet meer: opnieuw maken
        if tls {
            let me = self.clone();
            let (name, started) = (name.to_string(), Instant::now());
            std::thread::Builder::new()
                .name("ark-lan-ipwatch".into())
                .spawn(move || loop {
                    for _ in 0..60 {
                        if stop.load(Ordering::SeqCst) {
                            return;
                        }
                        std::thread::sleep(Duration::from_secs(1));
                    }
                    // ook na ruim 10 maanden aan één stuk: het certificaat is 397 dagen geldig
                    if local_ips() != ips || started.elapsed() > Duration::from_secs(300 * 86400) {
                        log("Certificaat opnieuw maken (adres gewijzigd of bijna verlopen)");
                        me.start(port, true, &name);
                        return;
                    }
                })
                .ok();
        }
    }

    fn accept_loop(self: Arc<Self>, l: TcpListener, tls: Option<Arc<rustls::ServerConfig>>, onboarding: bool, stop: Arc<AtomicBool>) {
        l.set_nonblocking(true).ok();
        while !stop.load(Ordering::SeqCst) {
            match l.accept() {
                Ok((s, addr)) => {
                    let me = self.clone();
                    let tls = tls.clone();
                    std::thread::spawn(move || {
                        s.set_nonblocking(false).ok();
                        s.set_read_timeout(Some(Duration::from_secs(30))).ok();
                        s.set_write_timeout(Some(Duration::from_secs(30))).ok();
                        let ip = addr.ip().to_string();
                        match tls {
                            Some(cfg) => match rustls::ServerConnection::new(cfg) {
                                Ok(conn) => {
                                    let mut st = rustls::StreamOwned::new(conn, s);
                                    me.serve(&mut st, &ip, onboarding);
                                    st.conn.send_close_notify();
                                    let _ = st.flush();
                                    let _ = st.sock.shutdown(Shutdown::Write);
                                    drain(&mut st.sock);
                                }
                                Err(_) => {}
                            },
                            None => {
                                let mut s2 = s;
                                me.serve(&mut s2, &ip, onboarding);
                                let _ = s2.flush();
                                let _ = s2.shutdown(Shutdown::Write);
                                drain(&mut s2);
                            }
                        }
                    });
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(100)),
                Err(_) => std::thread::sleep(Duration::from_millis(500)),
            }
        }
    }

    // ---- een verzoek inlezen en beantwoorden
    fn serve<S: Read + Write>(&self, s: &mut S, ip: &str, onboarding: bool) {
        let mut buf: Vec<u8> = Vec::new();
        let mut tmp = [0u8; 8192];
        let header_end;
        loop {
            if let Some(p) = find(&buf, b"\r\n\r\n") {
                header_end = p;
                break;
            }
            match s.read(&mut tmp) {
                Ok(0) | Err(_) => return,
                Ok(n) => buf.extend_from_slice(&tmp[..n]),
            }
            if buf.len() > 1_000_000 {
                return;
            }
        }
        let head = String::from_utf8_lossy(&buf[..header_end]).to_string();
        let mut lines = head.split("\r\n");
        let first: Vec<&str> = lines.next().unwrap_or("").split(' ').collect();
        if first.len() < 2 {
            return;
        }
        let (method, target) = (first[0].to_string(), first[1].to_string());
        let mut headers: HashMap<String, String> = HashMap::new();
        for l in lines {
            if let Some((k, v)) = l.split_once(':') {
                headers.insert(k.to_lowercase(), v.trim().to_string());
            }
        }
        let need: usize = headers.get("content-length").and_then(|v| v.parse().ok()).unwrap_or(0);
        let mut body = buf[header_end + 4..].to_vec();
        while body.len() < need {
            match s.read(&mut tmp) {
                Ok(0) | Err(_) => return,
                Ok(n) => body.extend_from_slice(&tmp[..n]),
            }
            if body.len() > 1_000_000 {
                return;
            }
        }
        body.truncate(need);
        let req = Req { method, target, headers, body, ip: ip.to_string() };
        let resp = if onboarding { self.onboarding_route(&req) } else { self.route(&req) };
        let _ = s.write_all(&resp.to_bytes());
    }

    // ---- routes
    fn route(&self, r: &Req) -> Resp {
        let (path, query) = split_target(&r.target);
        if r.method == "GET" && (path == "/" || path == "/podium") {
            return Resp::redirect("/tracks");
        }
        if r.method == "GET" && path == "/mixer" {
            return Resp::redirect("/tracks/mixer");
        }
        if r.method == "GET" && path == "/tracks" {
            return self.page("tracks.html");
        }
        if r.method == "GET" && path == "/tracks/mixer" {
            return self.page("mixer.html"); // alleen de faders
        }
        if r.method == "GET" && path == "/desktop" {
            return self.page("desktop.html"); // het volledige Tracks-scherm met de mixer
        }
        if r.method == "GET" && path.starts_with("/_next/static/") {
            return self.file(&path);
        }
        if r.method == "POST" && path == "/_log" {
            // meldingen van de pagina (fouten), voor het logbestand; kort en met een limiet
            let ok = {
                let mut g = self.log_hits.lock().unwrap();
                let v = g.entry(r.ip.clone()).or_default();
                v.retain(|t| t.elapsed() < Duration::from_secs(60));
                v.push(Instant::now());
                v.len() <= 30
            };
            if ok {
                if let Some(m) = serde_json::from_slice::<Value>(&r.body).ok().and_then(|o| o["m"].as_str().map(String::from)) {
                    let clean: String = m.chars().filter(|c| *c != '\n' && *c != '\r').take(400).collect();
                    log(&format!("Pagina op {}: {clean}", r.ip));
                }
            }
            return Resp::json(200, json!({"ok": true}));
        }
        if r.method == "POST" && path == "/_pair" {
            log(&format!("Lokale bediening: koppelverzoek van {}", r.ip));
            return self.pair(r);
        }
        if r.method == "GET" && path == "/api/auth/session" {
            return Resp::json(200, json!({})); // de pagina vraagt om een inlogsessie: die is er hier niet
        }
        // alles hieronder alleen met een sleutel van een gekoppeld apparaat
        if !self.authorize(r) {
            log(&format!("Lokale bediening: {} {} zonder geldige sleutel van {}", r.method, path, r.ip));
            return Resp::json(401, json!({"error": "Niet gekoppeld"}));
        }
        if path == "/_kv" {
            if r.method == "GET" {
                return Resp::json(200, serde_json::to_value(self.kv.values()).unwrap());
            }
            if r.method == "POST" {
                if let Ok(o) = serde_json::from_slice::<Value>(&r.body) {
                    if let Some(k) = o["key"].as_str().filter(|k| k.starts_with("ark-")) {
                        self.kv.set(k, o["value"].as_str());
                        return Resp::json(200, json!({"ok": true}));
                    }
                }
            }
            return Resp::json(400, json!({"error": "ongeldig"}));
        }
        if let Some(p) = path.strip_prefix("/_engine") {
            return self.engine(p, &query);
        }
        Resp::json(404, json!({"error": "onbekend"}))
    }

    fn engine(&self, path: &str, query: &str) -> Resp {
        if !ALLOWED.contains(&path) {
            return Resp::json(403, json!({"error": "Niet toegestaan"}));
        }
        let items = parse_query(query);
        // alleen nummers uit de eigen bibliotheek
        if ["/load", "/song", "/setlist"].contains(&path) {
            let known: Vec<String> = self.player.lock().library.iter().map(|s| s.path.clone()).collect();
            let mut asked: Vec<String> = Vec::new();
            for (k, v) in &items {
                match k.as_str() {
                    "path" | "p" => asked.push(v.clone()),
                    "paths" => asked.extend(v.split('|').map(String::from)),
                    _ => {}
                }
            }
            if asked.iter().any(|a| !known.contains(&a.replace('+', " "))) {
                return Resp::json(403, json!({"error": "Onbekend nummer"}));
            }
        }
        let (code, body) = handle(&self.player, path, &Query::new(items));
        Resp { status: code, ctype: "application/json".into(), body: body.into_bytes(), cache: false, extra: vec![] }
    }

    // ---- het Podium zelf (de kopie van de webapp) en zijn bestanden
    fn page(&self, name: &str) -> Resp {
        let f = offline::dir().join(name);
        let Ok(mut html) = std::fs::read_to_string(&f) else {
            return Resp { status: 404, ctype: "text/plain; charset=utf-8".into(), body: "Het Podium staat nog niet in de kopie van deze app. Open de app één keer met de server (de app bewaart dan zelf een kopie).".as_bytes().to_vec(), cache: false, extra: vec![] };
        };
        log(&format!("Lokale bediening: pagina {name} uitgeleverd ({} bytes)", html.len()));
        let shim = format!("<script>{}</script>", shim(&self.status.lock().unwrap().name));
        match html.find("<head>") {
            Some(i) => html.insert_str(i + 6, &shim),
            None => html = format!("{shim}{html}"),
        }
        Resp { status: 200, ctype: "text/html; charset=utf-8".into(), body: html.into_bytes(), cache: false, extra: vec![] }
    }

    fn file(&self, path: &str) -> Resp {
        let decoded = percent_decode(path);
        if decoded.contains("..") {
            return Resp::json(404, json!({"error": "niet gevonden"}));
        }
        let f = offline::dir().join(decoded.trim_start_matches('/'));
        match std::fs::read(&f) {
            Ok(d) => {
                let ext = f.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
                Resp { status: 200, ctype: offline::content_type(&ext).into(), body: d, cache: true, extra: vec![] }
            }
            Err(_) => {
                log(&format!("Lokale bediening: GET {decoded} NIET GEVONDEN in de kopie"));
                Resp::json(404, json!({"error": "niet gevonden"}))
            }
        }
    }

    // ---- apparaten
    fn authorize(&self, r: &Req) -> bool {
        let Some(h) = r.headers.get("authorization").filter(|h| h.starts_with("Bearer ")) else { return false };
        let hash = hash_token(&h[7..]);
        let mut d = self.devices.lock().unwrap();
        let Some(i) = d.list.iter().position(|x| x.hash == hash) else { return false };
        d.list[i].last_seen = now_secs();
        if d.last_save.elapsed() > Duration::from_secs(60) {
            d.persist();
        }
        true
    }

    fn pair(&self, r: &Req) -> Resp {
        {
            let mut g = self.attempts.lock().unwrap();
            let v = g.entry(r.ip.clone()).or_default();
            v.retain(|t| t.elapsed() < Duration::from_secs(60));
            v.push(Instant::now());
            if v.len() > 4 || self.pairing.load(Ordering::SeqCst) {
                return Resp::json(429, json!({"error": "Er wacht al een verzoek of er zijn er te veel; probeer het zo opnieuw"}));
            }
        }
        let o: Value = serde_json::from_slice(&r.body).unwrap_or(json!({}));
        let name: String = o["name"].as_str().unwrap_or("apparaat").chars().filter(|c| *c != '\n' && *c != '\r' && *c != '<' && *c != '>').take(40).collect();
        self.pairing.store(true, Ordering::SeqCst);
        let allowed = if self.auto_allow {
            true
        } else {
            log(&format!("Lokale bediening: wacht op toestemming voor \"{name}\""));
            (self.confirm)(&name, &r.ip)
        };
        self.pairing.store(false, Ordering::SeqCst);
        if !allowed {
            log(&format!("Lokale bediening: koppelverzoek van \"{name}\" geweigerd of verlopen"));
            return Resp::json(403, json!({"error": "Geweigerd"}));
        }
        let mut b = [0u8; 32];
        getrandom::getrandom(&mut b).ok();
        let token: String = b.iter().map(|x| format!("{x:02x}")).collect();
        let mut d = self.devices.lock().unwrap();
        d.list.push(Device { id: uuid_like(), name: name.clone(), hash: hash_token(&token), created: now_secs(), last_seen: now_secs() });
        d.persist();
        log(&format!("Lokale bediening: \"{name}\" toegestaan en gekoppeld ({} apparaten)", d.list.len()));
        Resp::json(200, json!({"token": token}))
    }

    pub fn devices(&self) -> Vec<Device> {
        self.devices.lock().unwrap().list.clone()
    }
    pub fn revoke(&self, id: &str) {
        let mut d = self.devices.lock().unwrap();
        d.list.retain(|x| x.id != id);
        d.persist();
    }
    /// Nieuwe CA maken: alle apparaten moeten het nieuwe certificaat opnieuw installeren en opnieuw koppelen
    pub fn renew_ca(&self) {
        self.ca.reset();
        let mut d = self.devices.lock().unwrap();
        d.list.clear();
        d.persist();
    }

    // ---- installatiepagina op de gewone poort (poort+1): het certificaat en de uitleg, verder niets
    fn onboarding_route(&self, r: &Req) -> Resp {
        if r.method != "GET" {
            return Resp::json(405, json!({"error": "niet toegestaan"}));
        }
        let (path, _) = split_target(&r.target);
        let st = self.status.lock().unwrap().clone();
        let host = r.headers.get("host").map(|h| h.split(':').next().unwrap_or("").to_string()).filter(|h| !h.is_empty()).unwrap_or_else(host_local_name);
        match path.as_str() {
            "/ca.mobileconfig" => match self.ca.mobileconfig(&st.name) {
                Some(d) => Resp::attachment(d, "application/x-apple-aspen-config", "ark-tracks-lokale-bediening.mobileconfig"),
                None => Resp::json(404, json!({"error": "geen certificaat"})),
            },
            "/ca.crt" => match self.ca.der() {
                Some(d) => Resp::attachment(d, "application/x-x509-ca-cert", "ark-tracks-lokale-ca.crt"),
                None => Resp::json(404, json!({"error": "geen certificaat"})),
            },
            _ => Resp { status: 200, ctype: "text/html; charset=utf-8".into(), body: landing(&host, st.port, &st.name, &self.ca.fingerprint()).into_bytes(), cache: false, extra: vec![] },
        }
    }

    /// Alles voor het instellingenscherm
    pub fn info(&self) -> Value {
        let st = self.status.lock().unwrap().clone();
        let host = host_local_name();
        let ip = st.ips.first().cloned();
        let scheme = if st.tls { "https" } else { "http" };
        let podium_url = format!("{scheme}://{}:{}/tracks", ip.clone().unwrap_or_else(|| host.clone()), st.port);
        let podium_name = format!("{scheme}://{host}:{}/tracks", st.port);
        let install_url = format!("http://{}:{}/", ip.unwrap_or_else(|| host.clone()), st.port + 1);
        let qr = |t: &str| -> String {
            qrcode::QrCode::new(t.as_bytes()).map(|c| c.render::<qrcode::render::svg::Color>().min_dimensions(130, 130).quiet_zone(true).build()).unwrap_or_default()
        };
        json!({
            "running": st.running, "tls": st.tls, "port": st.port, "ips": st.ips, "host": host,
            "error": self.last_error.lock().unwrap().clone(),
            "podiumUrl": podium_url, "podiumName": podium_name, "installUrl": install_url,
            "qrPodium": qr(&podium_url), "qrInstall": if st.tls { qr(&install_url) } else { String::new() },
            "fingerprint": self.ca.fingerprint(),
            "devices": self.devices().iter().map(|d| json!({"id": d.id, "name": d.name, "lastSeen": d.last_seen})).collect::<Vec<_>>(),
        })
    }
}

// ------------------------------------------------------------- http-hulpjes
struct Req {
    method: String,
    target: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
    ip: String,
}

struct Resp {
    status: u16,
    ctype: String,
    body: Vec<u8>,
    cache: bool,
    extra: Vec<(String, String)>,
}

impl Resp {
    fn json(status: u16, v: Value) -> Resp {
        Resp { status, ctype: "application/json".into(), body: v.to_string().into_bytes(), cache: false, extra: vec![] }
    }
    fn redirect(to: &str) -> Resp {
        Resp { status: 302, ctype: "text/plain".into(), body: vec![], cache: false, extra: vec![("Location".into(), to.into())] }
    }
    fn attachment(d: Vec<u8>, ctype: &str, name: &str) -> Resp {
        Resp { status: 200, ctype: ctype.into(), body: d, cache: false, extra: vec![("Content-Disposition".into(), format!("attachment; filename=\"{name}\""))] }
    }
    fn to_bytes(&self) -> Vec<u8> {
        let name = match self.status {
            200 => "OK",
            202 => "Accepted",
            302 => "Found",
            400 => "Bad Request",
            401 => "Unauthorized",
            403 => "Forbidden",
            404 => "Not Found",
            405 => "Method Not Allowed",
            429 => "Too Many Requests",
            _ => "OK",
        };
        let mut head = format!(
            "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nCache-Control: {}\r\nConnection: close\r\nX-Content-Type-Options: nosniff\r\n",
            self.status, name, self.ctype, self.body.len(), if self.cache { "max-age=3600" } else { "no-store" }
        );
        for (k, v) in &self.extra {
            head.push_str(&format!("{k}: {v}\r\n"));
        }
        head.push_str("\r\n");
        let mut out = head.into_bytes();
        out.extend_from_slice(&self.body);
        out
    }
}

fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

/// De ontvanger sluit de verbinding zodra hij alles heeft (verwerkt is niet hetzelfde als aangekomen); wij wachten daar even op.
fn drain(s: &mut TcpStream) {
    s.set_read_timeout(Some(Duration::from_secs(15))).ok();
    let mut b = [0u8; 256];
    let t = Instant::now();
    while t.elapsed() < Duration::from_secs(15) {
        match s.read(&mut b) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
    }
}

fn split_target(t: &str) -> (String, String) {
    match t.split_once('?') {
        Some((p, q)) => (percent_decode(p), q.to_string()),
        None => (percent_decode(t), String::new()),
    }
}

pub fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn parse_query(q: &str) -> Vec<(String, String)> {
    q.split('&')
        .filter(|p| !p.is_empty())
        .map(|p| {
            let (k, v) = p.split_once('=').unwrap_or((p, ""));
            (percent_decode(&k.replace('+', " ")), percent_decode(&v.replace('+', " ")))
        })
        .collect()
}

fn make_tls(cert: Vec<u8>, key: Vec<u8>) -> Result<rustls::ServerConfig, String> {
    use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    rustls::ServerConfig::builder_with_provider(provider)
        .with_protocol_versions(&[&rustls::version::TLS12, &rustls::version::TLS13])
        .map_err(|e| e.to_string())?
        .with_no_client_auth()
        .with_single_cert(vec![CertificateDer::from(cert)], PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(key)))
        .map_err(|e| e.to_string())
}

// ------------------------------------------------------------- de pagina's
include!("lan_pages.rs");
