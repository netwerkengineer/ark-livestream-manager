//! Ark Tracks voor Linux (en straks Windows): een venster met de Tracks-pagina van de webapp en de speler erachter.
//! De pagina praat met de speler via `window.arkEngine.call(pad, params)` (zelfde brug als de Mac-app).

use ark_engine::fetch::Fetcher;
use ark_engine::lan::{Kv, Lan};
use ark_engine::mixer::Mixer;
use ark_engine::offline;
use ark_engine::output::{self, Output};
use ark_engine::player::{config_dir, log, Player};
use ark_engine::server::{handle, Query};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use tao::dpi::LogicalSize;
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy};
use tao::window::{Fullscreen, WindowBuilder};
use wry::{http::Response, WebContext, WebViewBuilder};

#[cfg(target_os = "linux")]
use tao::platform::unix::WindowExtUnix;
#[cfg(target_os = "linux")]
use wry::WebViewBuilderExtUnix;

const USER_AGENT: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15 ArkTracksDesktop";

enum Ev {
    Eval(String),
    Cookies(String, std::sync::mpsc::Sender<String>),
    Pick(i64, &'static str), // (antwoord-id, "zip" | "folder")
    Navigate(String),
    RestartAudio(String),
    Fullscreen,
    Zoom(f64),
}

// ------------------------------------------------------------- instellingen van de schil (server en sleutel)
#[derive(Clone, Default)]
struct Shell {
    server: String,
    key: String,
    offline: bool, // zonder server werken (kopie van de pagina)
    lan: bool,     // lokale bediening voor tablet en telefoon
    lan_tls: bool,
    lan_port: u16,
    name: String, // naam van deze computer voor de lokale bediening
}

fn shell_path() -> String {
    format!("{}/shell.json", config_dir())
}
impl Shell {
    fn load() -> Shell {
        let j: Value = std::fs::read(shell_path()).ok().and_then(|d| serde_json::from_slice(&d).ok()).unwrap_or(json!({}));
        let file_key = j["key"].as_str().unwrap_or("").to_string();
        let vault_key = ark_engine::vault::get("desktop-key");
        // de sleutel staat in de sleutelbos van het systeem; een sleutel uit een oud bestand wordt daarheen overgezet
        let key = vault_key.clone().unwrap_or_else(|| file_key.clone());
        let s = Shell {
            server: j["server"].as_str().unwrap_or("").to_string(),
            key,
            offline: j["offline"].as_bool().unwrap_or(false),
            lan: j["lan"].as_bool().unwrap_or(false),
            lan_tls: j["lan_tls"].as_bool().unwrap_or(true),
            lan_port: j["lan_port"].as_u64().filter(|p| (1024..=65535).contains(p)).unwrap_or(8765) as u16,
            name: j["name"].as_str().filter(|n| !n.is_empty()).map(String::from).unwrap_or_else(|| gethostname::gethostname().to_string_lossy().to_string()),
        };
        if !file_key.is_empty() {
            // het bestand bevat nog een sleutel: opnieuw bewaren (zet hem in de sleutelbos en schrijft het bestand zonder sleutel)
            if vault_key.is_none() && ark_engine::vault::available() {
                log("Sleutel van de app overgezet naar de sleutelbos van het systeem");
            }
            s.save();
        }
        s
    }
    fn save(&self) {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::create_dir_all(config_dir());
        let path = shell_path();
        let tmp = format!("{path}.tmp");
        // een lege sleutel wissen we nooit uit de sleutelbos: hij kan ook leeg zijn omdat de sleutelbos even niet te lezen was
        let in_vault = if self.key.is_empty() { ark_engine::vault::available() } else { ark_engine::vault::set("desktop-key", &self.key) };
        let mut j = json!({"server": self.server, "offline": self.offline, "lan": self.lan, "lan_tls": self.lan_tls, "lan_port": self.lan_port, "name": self.name});
        if !in_vault {
            j["key"] = json!(self.key); // geen sleutelbos: in het bestand (alleen leesbaar voor deze gebruiker)
        }
        if std::fs::write(&tmp, j.to_string()).is_ok() {
            let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
            let _ = std::fs::rename(&tmp, &path);
        }
    }
    fn base(&self) -> String {
        self.server.trim().trim_matches('/').to_string()
    }
    fn host(&self) -> String {
        self.base().split("://").nth(1).unwrap_or("").split('/').next().unwrap_or("").split(':').next().unwrap_or("").to_string()
    }
    fn origin(&self) -> String {
        let b = self.base();
        match b.split_once("://") {
            Some((s, rest)) => format!("{s}://{}", rest.split('/').next().unwrap_or("")),
            None => String::new(),
        }
    }
}

// ------------------------------------------------------------- audio
struct Audio {
    out: Option<Output>,
}

fn want_channels(mode: &str) -> Option<usize> {
    match mode {
        "stereo" | "2ch" => Some(2),
        "3ch" => Some(3),
        "multi" => Some(8),
        _ => None,
    }
}

fn start_audio(player: &Arc<Player>, mixer: &Arc<Mutex<Mixer>>, audio: &mut Audio, device: &str) -> Result<(), String> {
    audio.out = None; // het oude apparaat eerst loslaten
    let mode = mixer.lock().unwrap().requested.clone();
    let dev = if device.is_empty() { None } else { Some(device) };
    let out = match output::start(mixer.clone(), dev, want_channels(&mode), player.stats.clone()) {
        Ok(o) => o,
        Err(_) => output::start(mixer.clone(), dev, None, player.stats.clone())?,
    };
    let applied = mixer.lock().unwrap().applied.clone();
    log(&format!("Audio: {}, {} uitgangen, 48000 Hz, uitgangsmodus {} -> {}", out.device_name, out.channels, mode, applied));
    {
        let mut st = player.lock();
        st.device_name = out.device_name.clone();
        st.hw_channels = out.channels;
    }
    audio.out = Some(out);
    Ok(())
}

// ------------------------------------------------------------- de pagina's van de schil
const LAN_HTML: &str = r##"<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>Bediening op afstand</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:dark}body{margin:0;background:#0b1222;color:#e2e8f0;font:15px system-ui,sans-serif;display:flex;justify-content:center}
main{width:min(680px,92vw);padding:28px 0 60px}h1{font-size:22px;margin:0 0 6px}p.s{color:#94a3b8;margin:0 0 18px}
label.c{display:flex;gap:10px;align-items:center;font-weight:600;margin:14px 0}input[type=checkbox]{width:18px;height:18px}
input[type=number]{width:90px;padding:8px 10px;border-radius:8px;border:1px solid #334155;background:#111b31;color:inherit;font:inherit}
button{padding:9px 16px;border:0;border-radius:8px;background:#2563eb;color:#fff;font:inherit;font-weight:600;cursor:pointer}button.g{background:#1e293b}button.r{background:#7f1d1d}
.card{background:#111c33;border:1px solid #1e2d4d;border-radius:12px;padding:12px 16px;margin:14px 0}
.qrs{display:flex;gap:28px;flex-wrap:wrap;margin:10px 0}.qr{text-align:center}.qr svg{width:150px;height:150px;background:#fff;border-radius:8px}
code{color:#7dd3fc;word-break:break-all}small,.fp{color:#94a3b8;font-size:13px;word-break:break-all}.err{color:#fca5a5}
.dev{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #1e2d4d}
</style></head><body><main>
<h1>Bediening op afstand</h1><p class="s">Bedien Ark Tracks vanaf een tablet of telefoon, zonder dat de server of de NAS nodig is.</p>
<label class="c"><input type="checkbox" id="on"> Lokale bediening toestaan (werkt ook zonder server)</label>
<div id="rest">
<label class="c"><input type="checkbox" id="tls"> Versleuteld (https) met een eigen certificaat — aanbevolen</label>
<div class="card" id="net"></div>
</div>
<div class="card">Poort <input type="number" id="port" min="1024" max="65535"> <button class="g" id="apply">Pas toe</button> <small id="portmsg"></small></div>
<h2 style="font-size:16px">Gekoppelde apparaten (<span id="n">0</span>)</h2><div class="card" id="devs"></div>
<p class="s" id="note"></p>
<p><button class="g" id="back">Terug</button></p>
</main><script>
const $=id=>document.getElementById(id);
const call=(a,p)=>window.arkShell(Object.assign({action:a},p||{}));
const esc=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;");
let S=null;
function render(s){
 S=s; $("on").checked=s.enabled; $("tls").checked=s.tlsWanted; $("port").value=s.portWanted;
 $("rest").style.display=s.enabled?"":"none";
 let h="";
 if(s.error) h+='<p class="err">Starten mislukt: '+esc(s.error)+'</p>';
 if(s.enabled){
  if(s.tls){
   h+='<p><small>Op elk apparaat, eenmalig: eerst het certificaat installeren (stap 1), daarna het Podium openen (stap 2). Op de pagina van stap 1 staat per type apparaat precies wat je doet.</small></p>';
   h+='<p>Stap 1: <code>'+esc(s.installUrl)+'</code></p><p>Stap 2: <code>'+esc(s.podiumName)+'</code><br>of <code>'+esc(s.podiumUrl)+'</code></p>';
   h+='<div class="qrs"><div class="qr">'+s.qrInstall+'<br>1 Certificaat</div><div class="qr">'+s.qrPodium+'<br>2 Podium</div></div>';
   if(s.fingerprint) h+='<p class="fp">Vingerafdruk van het certificaat (SHA-256):<br>'+esc(s.fingerprint)+'</p>';
   h+='<p><button class="r" id="renew">Nieuw certificaat maken…</button></p>';
  } else {
   h+='<p><small>Open op de tablet of telefoon (op hetzelfde netwerk) een van deze adressen. Het eerste apparaat dat je opent vraagt toestemming op deze computer.</small></p>';
   h+='<p><code>'+esc(s.podiumName)+'</code><br><code>'+esc(s.podiumUrl)+'</code></p><div class="qrs"><div class="qr">'+s.qrPodium+'<br>Podium</div></div>';
  }
 }
 $("net").innerHTML=h;
 const r=$("renew"); if(r) r.onclick=async()=>{ if(confirm("Nieuw certificaat maken?\n\nAlle apparaten moeten het nieuwe certificaat opnieuw installeren en opnieuw koppelen. Doe dit alleen als je denkt dat het oude niet meer veilig is.")) render(await call("lanRenew")); };
 $("n").textContent=s.devices.length;
 $("devs").innerHTML=s.devices.length?s.devices.map(d=>'<div class="dev"><span>'+esc(d.name)+' · laatst gezien '+(d.lastSeen?new Date(d.lastSeen*1000).toLocaleString("nl-NL"):"nog niet")+'</span><button class="g" data-id="'+esc(d.id)+'">Intrekken</button></div>').join(""):'<small>Nog geen.</small>';
 for(const b of $("devs").querySelectorAll("button")) b.onclick=async()=>render(await call("lanRevoke",{id:b.dataset.id}));
 $("note").textContent=s.tlsWanted?"Het verkeer is versleuteld (https). De sleutel van het certificaat staat alleen op deze computer en het certificaat werkt alleen voor lokale namen (.local en privé-adressen). Een gekoppeld apparaat kan spelen, springen en de mix en pads bedienen; instellingen en opnemen zijn niet bereikbaar.":"Let op: zonder https is de verbinding niet versleuteld. Gebruik hem alleen op een netwerk dat je vertrouwt; zolang gasten op hetzelfde netwerk zitten kunnen zij het verkeer in principe meelezen.";
}
$("on").onchange=async()=>render(await call("lanSet",{enabled:$("on").checked}));
$("tls").onchange=async()=>render(await call("lanSet",{tls:$("tls").checked}));
$("apply").onclick=async()=>{const p=parseInt($("port").value,10); if(!(p>=1024&&p<=65535)){$("portmsg").textContent="Kies een poort tussen 1024 en 65535.";return;} $("portmsg").textContent=""; render(await call("lanSet",{port:p}));};
$("back").onclick=()=>call("openMain");
call("lanGet").then(render);
setInterval(async()=>{ if(document.activeElement && document.activeElement.id==="port") return; render(await call("lanGet")); },5000);
</script></body></html>"##;

const SETTINGS_HTML: &str = r#"<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>Instellingen</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:dark}body{margin:0;background:#0b1222;color:#e2e8f0;font:15px system-ui,sans-serif;display:flex;justify-content:center}
main{width:min(640px,92vw);padding:28px 0 60px}h1{font-size:22px;margin:0 0 6px}p.s{color:#94a3b8;margin:0 0 22px}
label{display:block;margin:16px 0 6px;font-weight:600}input,select{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;border:1px solid #334155;background:#111b31;color:inherit;font:inherit}
small{display:block;color:#94a3b8;margin-top:5px}button{margin-top:26px;padding:11px 22px;border:0;border-radius:8px;background:#2563eb;color:#fff;font:inherit;font-weight:600;cursor:pointer}
button.g{background:#1e293b;margin-left:10px}.msg{margin-top:16px;color:#86efac}.err{color:#fca5a5}
</style></head><body><main>
<h1>Ark Tracks – instellingen</h1><p class="s" id="ver"></p>
<label for="server">Server</label><input id="server" placeholder="https://ops.arkchurch.nl" autocomplete="off">
<small>Het adres van de webapp. Laat leeg om alleen met de eigen nummers te werken (nog niet beschikbaar zonder server).</small>
<label for="key">Sleutel van deze computer</label><input id="key" type="password" autocomplete="off" placeholder="(laat leeg om de bewaarde sleutel te houden)">
<small>Maak de sleutel aan in de webapp onder Instellingen › Desktop-app. <span id="vaultnote">Hij wordt alleen op deze computer bewaard.</span></small>
<label style="display:flex;gap:10px;align-items:center;font-weight:600"><input type="checkbox" id="offline" style="width:auto"> Zonder server werken</label>
<small id="mirror"></small><button class="g" id="upd" style="margin:8px 0 0">Kopie voor gebruik zonder server nu bijwerken</button>
<label for="songs">Map met nummers</label><input id="songs" placeholder="~/Tracks/Songs">
<label for="device">Audio-uitgang</label><select id="device"><option value="">Standaard van het systeem</option></select>
<label for="mode">Uitgangen</label><select id="mode"><option value="stereo">Stereo (2 kanalen)</option><option value="2ch">2 kanalen (muziek rechts, click/guide links)</option><option value="3ch">3 kanalen (click/guide, muziek stereo)</option><option value="multi">8 kanalen (X32, per groep)</option><option value="auto">Automatisch</option></select>
<label for="fs">FreeShow (adres:poort)</label><input id="fs" placeholder="leeg = zoals de server het opgeeft">
<button id="save">Opslaan</button><button class="g" id="cancel">Annuleren</button><button class="g" id="lan">Bediening op afstand…</button><div class="msg" id="msg"></div>
</main><script>
const $=id=>document.getElementById(id);
const call=(a,p)=>window.arkShell(Object.assign({action:a},p||{}));
(async()=>{
 const s=await call("getSettings"); $("ver").textContent="Versie "+s.version+" · logbestand: "+s.log;
 $("server").value=s.server; $("key").placeholder=s.hasKey?"(sleutel is bewaard; laat leeg om hem te houden)":"plak hier de sleutel";
 $("songs").value=s.songs_root; $("mode").value=s.output_mode; $("fs").value=s.freeshow_host?(s.freeshow_host+":"+s.freeshow_port):"";
 for(const d of s.devices){const o=document.createElement("option");o.value=d.name;o.textContent=d.name+" ("+d.outputs+" uitgangen)";$("device").appendChild(o)}
 $("device").value=s.device; $("offline").checked=s.offline; $("vaultnote").textContent=s.vault?"Hij staat in de sleutelbos van deze computer, niet in een bestand.":"Er is geen sleutelbos beschikbaar: de sleutel staat in een bestand dat alleen jij kunt lezen.";
 $("mirror").textContent=s.mirror?"Er is een kopie van de pagina bewaard; zonder server (of bij een storing) werkt de app daarmee.":"Er is nog geen kopie. Verbind één keer met de server: de app bewaart dan zelf een kopie.";
 $("cancel").style.display=s.configured?"":"none";
})();
$("save").onclick=async()=>{
 const fs=$("fs").value.trim().split(":");
 const r=await call("saveSettings",{offline:$("offline").checked,server:$("server").value.trim(),key:$("key").value.trim(),songs_root:$("songs").value.trim(),device:$("device").value,output_mode:$("mode").value,freeshow_host:fs[0]||"",freeshow_port:fs[1]||""});
 $("msg").className="msg"+(r.ok?"":" err"); $("msg").textContent=r.ok?"Opgeslagen.":(r.error||"Mislukt");
};
$("cancel").onclick=()=>call("openMain");
$("lan").onclick=()=>call("openLan");
$("upd").onclick=async()=>{ $("msg").className="msg"; $("msg").textContent="Bezig met bijwerken…"; const r=await call("updateMirror"); $("msg").className="msg"+(r.ok?"":" err"); $("msg").textContent=r.ok?"De kopie is bijgewerkt.":("Bijwerken mislukt: "+(r.error||"")); };
</script></body></html>"#;

fn init_script(shell: &Shell) -> String {
    format!(
        r#"
window.arkDesktop = {{
  version: "{version}-linux", platform: "linux", offline: location.protocol === "arkoffline:",
  remote: {{ enabled: false, name: "" }}, server: {server},
  openSettings: () => window.arkShell({{ action: "openSettings" }}),
  openExternal: (url) => window.arkShell({{ action: "openExternal", url }}),
  chooseFolder: async () => window.arkShell({{ action: "chooseFolder" }}),
  // nummers van de server op deze computer zetten ({{ id, folder, title, rpp }}), de stand opvragen en een nummer weghalen (prullenbak)
  fetchSong: (song) => window.arkShell({{ action: "fetchSong", song }}),
  fetchStatus: async () => window.arkShell({{ action: "fetchStatus" }}),
  importZip: () => window.arkShell({{ action: "importZip" }}),
  removeSong: async (folder) => window.arkShell({{ action: "removeSong", folder }}),
}};
(() => {{
  const pending = {{}}; let n = 0;
  window.__arkRes = (id, text) => {{ const r = pending[id]; if (r) {{ delete pending[id]; r(text); }} }};
  const send = (msg) => new Promise((res) => {{ const id = ++n; pending[id] = res; msg.id = id; window.ipc.postMessage(JSON.stringify(msg)); }});
  window.arkShell = async (msg) => JSON.parse(await send(msg));
  window.arkEngine = {{ available: true, call: async (path, params) => JSON.parse(await send({{ t: "engine", path, params: params || {{}} }})) }};
  // keuzemenu's (select) tekent het systeem zelf: donker, passend bij de pagina (anders wit met witte tekst)
  const svg = "<svg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'><path d='M1 1l5 5 5-5' fill='none' stroke='#94a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/></svg>";
  const arrow = 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
  const css = "select{{-webkit-appearance:none;appearance:none;color-scheme:dark;background-color:#111b31 !important;background-image:" + arrow + " !important;background-repeat:no-repeat !important;background-position:right 12px center !important;background-size:12px 8px !important;color:#e2e8f0 !important;border:1px solid #334155;border-radius:8px;padding-right:34px !important}}select:focus{{border-color:#3b82f6;outline:none}}select option,select optgroup{{background-color:#111b31;color:#e2e8f0}}select:disabled{{opacity:.6}}";
  const addCss = () => {{ if (document.getElementById("ark-shell-css")) return; const st = document.createElement("style"); st.id = "ark-shell-css"; st.textContent = css; (document.head || document.documentElement).appendChild(st); }};
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addCss); else addCss();
  // eigen instellingen van de pagina ("ark-…", zoals de eigen setlist) worden ook in de app bewaard, zodat ze er zijn in de kopie
  // zonder server en op de tablet. De online pagina houdt zijn eigen opslag en stuurt wijzigingen door; de kopie zonder server haalt ze bij het openen op.
  (() => {{ try {{
    if (location.protocol === "ark:") return;
    const post = (m) => window.ipc.postMessage(JSON.stringify(Object.assign({{ id: 0 }}, m)));
    const set = Storage.prototype.setItem, remove = Storage.prototype.removeItem;
    if (location.protocol === "arkoffline:") {{
      let kv = null;
      try {{ const x = new XMLHttpRequest(); x.open("GET", "/_kv", false); x.send(); if (x.status === 200) kv = JSON.parse(x.responseText); }} catch (e) {{}}
      if (kv) {{
        for (let i = localStorage.length - 1; i >= 0; i--) {{ const k = localStorage.key(i); if (k && k.startsWith("ark-") && !(k in kv)) remove.call(localStorage, k); }}
        for (const k in kv) if (k.startsWith("ark-")) set.call(localStorage, k, kv[k]);
      }}
    }} else {{
      for (let i = 0; i < localStorage.length; i++) {{ const k = localStorage.key(i); if (k && k.startsWith("ark-")) post({{ action: "kvSet", key: k, value: localStorage.getItem(k) }}); }}
    }}
    Storage.prototype.setItem = function (k, v) {{ set.call(this, k, v); if (this === localStorage && String(k).startsWith("ark-")) post({{ action: "kvSet", key: String(k), value: String(v) }}); }};
    Storage.prototype.removeItem = function (k) {{ remove.call(this, k); if (this === localStorage && String(k).startsWith("ark-")) post({{ action: "kvRemove", key: String(k) }}); }};
  }} catch (e) {{}} }})();
  window.addEventListener("keydown", (e) => {{
    if (e.key === "F5" || (e.ctrlKey && e.key.toLowerCase() === "r")) {{ e.preventDefault(); if (location.protocol === "arkoffline:") window.arkShell({{ action: "openMain" }}); else location.reload(); }}
    else if (e.ctrlKey && e.key === ",") {{ e.preventDefault(); window.arkShell({{ action: "openSettings" }}); }}
    else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "l") {{ e.preventDefault(); window.arkShell({{ action: "openLan" }}); }}
    else if (e.key === "F11") {{ e.preventDefault(); window.arkShell({{ action: "fullscreen" }}); }}
    else if (e.ctrlKey && (e.key === "+" || e.key === "=")) {{ e.preventDefault(); window.arkShell({{ action: "zoom", d: 0.1 }}); }}
    else if (e.ctrlKey && e.key === "-") {{ e.preventDefault(); window.arkShell({{ action: "zoom", d: -0.1 }}); }}
    else if (e.ctrlKey && e.key === "0") {{ e.preventDefault(); window.arkShell({{ action: "zoom", d: 0 }}); }}
    else if (e.altKey && e.key === "ArrowLeft") {{ history.back(); }}
  }}, true);
}})();
"#,
        server = serde_json::to_string(&shell.base()).unwrap(),
        version = env!("CARGO_PKG_VERSION")
    )
}

fn params_to_items(params: &Value) -> Vec<(String, String)> {
    let mut items = Vec::new();
    if let Some(o) = params.as_object() {
        for (k, v) in o {
            let one = |x: &Value| match x {
                Value::Bool(b) => (if *b { "1" } else { "0" }).to_string(),
                Value::String(s) => s.clone(),
                Value::Null => String::new(),
                other => other.to_string(),
            };
            match v {
                Value::Array(list) => {
                    for x in list {
                        items.push((k.clone(), one(x)));
                    }
                }
                x => items.push((k.clone(), one(x))),
            }
        }
    }
    items
}

fn open_external(url: &str) {
    if url.starts_with("https://") || url.starts_with("http://") {
        let _ = std::process::Command::new("xdg-open").arg(url).spawn();
    }
}


// ------------------------------------------------------------- vragen en bestandskiezers
// Op Linux via `zenity` (een apart programma): de vragen van de ingebouwde besturing van het venster (rfd/gtk) lopen vast in de hoofdlus.
#[cfg(target_os = "linux")]
mod dialogs {
    use std::process::Command;
    pub fn confirm(title: &str, text: &str, secs: u32) -> bool {
        Command::new("zenity")
            .args(["--question", "--title", title, "--text", text, "--ok-label=Toestaan", "--cancel-label=Weigeren", "--width=440", &format!("--timeout={secs}")])
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
    pub fn pick_files(title: &str, filter: &str) -> Vec<String> {
        let out = Command::new("zenity").args(["--file-selection", "--multiple", "--separator=|", "--title", title, "--file-filter", filter]).output();
        match out {
            Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).trim().split('|').filter(|p| !p.is_empty()).map(String::from).collect(),
            _ => vec![],
        }
    }
    pub fn pick_folder(title: &str) -> String {
        match Command::new("zenity").args(["--file-selection", "--directory", "--title", title]).output() {
            Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).trim().to_string(),
            _ => String::new(),
        }
    }
}
#[cfg(not(target_os = "linux"))]
mod dialogs {
    pub fn confirm(title: &str, text: &str, _secs: u32) -> bool {
        matches!(rfd::MessageDialog::new().set_title(title).set_description(text).set_buttons(rfd::MessageButtons::YesNo).show(), rfd::MessageDialogResult::Yes)
    }
    pub fn pick_files(title: &str, _filter: &str) -> Vec<String> {
        rfd::FileDialog::new().set_title(title).add_filter("Zip", &["zip"]).pick_files().unwrap_or_default().iter().map(|p| p.to_string_lossy().to_string()).collect()
    }
    pub fn pick_folder(title: &str) -> String {
        rfd::FileDialog::new().set_title(title).pick_folder().map(|p| p.to_string_lossy().to_string()).unwrap_or_default()
    }
}

fn apply_lan(s: &Shell, lan: &Arc<Lan>) {
    if s.lan {
        lan.start(s.lan_port, s.lan_tls, &s.name);
    } else {
        lan.stop();
    }
}

fn lan_state(s: &Shell, lan: &Arc<Lan>) -> String {
    let mut j = lan.info();
    j["enabled"] = json!(s.lan);
    j["tlsWanted"] = json!(s.lan_tls);
    j["portWanted"] = json!(s.lan_port);
    j["name"] = json!(s.name);
    j.to_string()
}

fn main() {
    if std::env::var_os("ARK_PRINT_INIT").is_some() {
        // alleen voor het controleren van het script (node --check): niets starten
        println!("{}", init_script(&Shell::default()));
        return;
    }
    // donker thema voor de lijsten die het systeem zelf tekent (keuzemenu's); de pagina is donker en de tekst daarin is licht
    if std::env::var_os("GTK_THEME").is_none() {
        std::env::set_var("GTK_THEME", "Adwaita:dark");
    }
    let mixer = Arc::new(Mutex::new(Mixer::default()));
    let player = Player::new(mixer.clone());
    player.start_ticker();
    let shell = Arc::new(Mutex::new(Shell::load()));

    let event_loop = EventLoopBuilder::<Ev>::with_user_event().build();
    let proxy: EventLoopProxy<Ev> = event_loop.create_proxy();
    let fetcher = {
        let sh = shell.clone();
        let px = proxy.clone();
        Fetcher::new(
            player.clone(),
            Arc::new(move || {
                let s = sh.lock().unwrap();
                (s.base(), s.key.clone())
            }),
            Arc::new(move |url: &str| {
                // de cookies (de inlog) staan in het venster; die vraag je op de hoofddraad
                let (tx, rx) = std::sync::mpsc::channel();
                if px.send_event(Ev::Cookies(url.to_string(), tx)).is_err() {
                    return String::new();
                }
                rx.recv_timeout(std::time::Duration::from_secs(10)).unwrap_or_default()
            }),
        )
    };

    // koppeling met het audioapparaat (de stream blijft op deze draad)
    let mut audio = Audio { out: None };
    {
        let p = player.clone();
        let px = proxy.clone();
        p.lock().restart_audio = Some(Arc::new(move |dev: &str| {
            let _ = px.send_event(Ev::RestartAudio(dev.to_string()));
            Ok(())
        }));
        p.lock().list_devices = Some(Arc::new(output::list_devices));
    }
    let dev = player.lock().cfg.device.clone();
    if let Err(e) = start_audio(&player, &mixer, &mut audio, &dev) {
        log(&format!("Audio starten mislukt: {e}"));
    }

    let window = WindowBuilder::new().with_title("Ark Tracks").with_inner_size(LogicalSize::new(1280.0, 860.0)).build(&event_loop).expect("venster");

    let data_dir = std::path::PathBuf::from(config_dir()).join("webdata");
    let _ = std::fs::create_dir_all(&data_dir);
    let mut context = WebContext::new(Some(data_dir));

    let kv = Arc::new(Kv::new(Some(std::path::PathBuf::from(config_dir()).join("kv.json"))));
    let lan = {
        Lan::new(
            player.clone(),
            kv.clone(),
            Arc::new(move |name: &str, ip: &str| {
                dialogs::confirm(
                    "Bediening koppelen",
                    &format!("\u{201C}{name}\u{201D} wil de bediening koppelen.\n\nAdres: {ip}\nAlleen toestaan als jij dit zelf aanvraagt. Dit apparaat kan daarna spelen, springen en de mix en pads bedienen. Je kunt het later weer intrekken (Bediening op afstand).\n\nHet verzoek verloopt na 90 seconden."),
                    90,
                )
            }),
            false,
        )
    };
    apply_lan(&shell.lock().unwrap(), &lan);
    let (p_ipc, sh_ipc, px_ipc, f_ipc) = (player.clone(), shell.clone(), proxy.clone(), fetcher.clone());
    let (lan_ipc, kv_ipc, kv_proto) = (lan.clone(), kv.clone(), kv.clone());
    let px_new = proxy.clone();
    let px_nav = proxy.clone();
    let sh_nav = shell.clone();
    let init = init_script(&shell.lock().unwrap());
    let builder = WebViewBuilder::new_with_web_context(&mut context)
        .with_user_agent(USER_AGENT) // de server herkent de app hieraan (zonder dit bestaat /desktop niet)
        .with_initialization_script(init)
        .with_html("<body style='background:#0b1222'></body>")
        .with_custom_protocol("ark".into(), move |_id, req| {
            let path = req.uri().path();
            if path == "/settings" {
                Response::builder().header("Content-Type", "text/html; charset=utf-8").body(SETTINGS_HTML.as_bytes().to_vec().into()).unwrap()
            } else if path == "/lan" {
                Response::builder().header("Content-Type", "text/html; charset=utf-8").body(LAN_HTML.as_bytes().to_vec().into()).unwrap()
            } else {
                Response::builder().status(404).body(Vec::new().into()).unwrap()
            }
        })
        // inloggen (SSO) gebeurt in dit venster zelf: de terugkeer moet bij dezelfde cookies uitkomen.
        // Alleen pagina's van de eigen server en van de app krijgen toegang tot de speler (zie het ipc-bericht hieronder).
        .with_custom_protocol(offline::SCHEME.into(), move |_id, req| {
            if req.uri().path() == "/_kv" {
                // eigen instellingen van de pagina voor de kopie zonder server (zelfde adres als de pagina zelf)
                return Response::builder().header("Content-Type", "application/json").header("Cache-Control", "no-store").body(serde_json::to_vec(&kv_proto.values()).unwrap_or_default().into()).unwrap();
            }
            let rsc = req.headers().get("RSC").is_some();
            let (status, ctype, data) = offline::serve(req.uri().path(), req.uri().query().unwrap_or(""), rsc);
            Response::builder().status(status).header("Content-Type", ctype).header("Cache-Control", "no-store").body(data.into()).unwrap()
        })
        .with_navigation_handler(move |url| {
            if !(url.starts_with("https://") || url.starts_with("http://") || url.starts_with("ark://") || url.starts_with("arkoffline://") || url.starts_with("about:")) {
                return false;
            }
            // de app toont alleen /desktop van de eigen server: na het inloggen landt de server op de startpagina, die sturen we terug
            let origin = sh_nav.lock().unwrap().origin();
            if !origin.is_empty() && url.starts_with(&origin) {
                let rest = &url[origin.len()..];
                let path = rest.split(|c| c == '?' || c == '#').next().unwrap_or("");
                let allowed = path.starts_with("/desktop") || path.starts_with("/api/") || path.starts_with("/_next/");
                if !allowed {
                    log(&format!("Pagina buiten de app doorgestuurd naar /desktop: {path}"));
                    let _ = px_nav.send_event(Ev::Navigate(String::new()));
                    return false;
                }
            }
            true
        })
        .with_new_window_req_handler(move |url, _| {
            // een nieuw venster (bijvoorbeeld een inlogpopup) laden we in dit venster
            if url.starts_with("https://") || url.starts_with("http://") {
                let _ = px_new.send_event(Ev::Navigate(url));
            }
            wry::NewWindowResponse::Deny
        })
        .with_ipc_handler(move |req| {
            let page = req.uri().to_string();
            let Ok(msg) = serde_json::from_str::<Value>(req.body()) else { return };
            let id = msg["id"].as_i64().unwrap_or(0);
            let (p, sh, px, fe) = (p_ipc.clone(), sh_ipc.clone(), px_ipc.clone(), f_ipc.clone());
            let (lan_l, kv_i) = (lan_ipc.clone(), kv_ipc.clone());
            let origin = sh.lock().unwrap().origin();
            let trusted_page = page.starts_with("ark://") || page.starts_with("arkoffline://") || (!origin.is_empty() && page.starts_with(&origin));
            if !trusted_page {
                log(&format!("Bericht van een onbekende pagina genegeerd: {page}"));
                return;
            }
            let from_settings = page.starts_with("ark://");
            let reply = move |v: String| {
                let _ = px.send_event(Ev::Eval(format!("window.__arkRes({id},{})", serde_json::to_string(&v).unwrap())));
            };
            std::thread::spawn(move || {
                if msg["t"] == "engine" {
                    let path = msg["path"].as_str().unwrap_or("");
                    let q = Query::new(params_to_items(&msg["params"]));
                    let (_, body) = handle(&p, path, &q);
                    reply(body);
                    return;
                }
                match msg["action"].as_str().unwrap_or("") {
                    "openSettings" => {
                        let _ = px_send(&p, Ev::Navigate("ark://app/settings".into()));
                        reply("{}".into());
                    }
                    "openLan" if from_settings => {
                        let _ = px_send(&p, Ev::Navigate("ark://app/lan".into()));
                        reply("{}".into());
                    }
                    "lanGet" if from_settings => reply(lan_state(&sh.lock().unwrap(), &lan_l)),
                    "lanSet" if from_settings => {
                        {
                            let mut s = sh.lock().unwrap();
                            if let Some(b) = msg["enabled"].as_bool() {
                                s.lan = b;
                            }
                            if let Some(b) = msg["tls"].as_bool() {
                                s.lan_tls = b;
                            }
                            if let Some(pn) = msg["port"].as_u64().filter(|p| (1024..=65535).contains(p)) {
                                s.lan_port = pn as u16;
                            }
                            s.save();
                            apply_lan(&s, &lan_l);
                        }
                        reply(lan_state(&sh.lock().unwrap(), &lan_l));
                    }
                    "lanRevoke" if from_settings => {
                        lan_l.revoke(msg["id"].as_str().unwrap_or(""));
                        reply(lan_state(&sh.lock().unwrap(), &lan_l));
                    }
                    "lanRenew" if from_settings => {
                        lan_l.renew_ca();
                        {
                            let s = sh.lock().unwrap();
                            apply_lan(&s, &lan_l);
                        }
                        reply(lan_state(&sh.lock().unwrap(), &lan_l));
                    }
                    "kvSet" => {
                        kv_i.set(msg["key"].as_str().unwrap_or(""), msg["value"].as_str());
                        reply("{}".into());
                    }
                    "kvRemove" => {
                        kv_i.set(msg["key"].as_str().unwrap_or(""), None);
                        reply("{}".into());
                    }
                    "kvInfo" => {
                        log(&format!("Instellingen van de pagina: {}", msg["text"].as_str().unwrap_or("")));
                        reply("{}".into());
                    }
                    "openMain" => {
                        let _ = px_send(&p, Ev::Navigate(String::new()));
                        reply("{}".into());
                    }
                    "openExternal" => {
                        open_external(msg["url"].as_str().unwrap_or(""));
                        reply("{}".into());
                    }
                    "fullscreen" => {
                        let _ = px_send(&p, Ev::Fullscreen);
                        reply("{}".into());
                    }
                    "zoom" => {
                        let _ = px_send(&p, Ev::Zoom(msg["d"].as_f64().unwrap_or(0.0)));
                        reply("{}".into());
                    }
                    "fetchSong" => {
                        fe.start(&msg["song"]);
                        reply("{}".into());
                    }
                    "fetchStatus" => reply(fe.status().to_string()),
                    "removeSong" => {
                        let ok = fe.remove(msg["folder"].as_str().unwrap_or(""));
                        reply(json!({"ok": ok}).to_string());
                    }
                    "importZip" => {
                        let _ = px_send(&p, Ev::Pick(id, "zip"));
                    }
                    "chooseFolder" => {
                        let _ = px_send(&p, Ev::Pick(id, "folder"));
                    }
                    "updateMirror" if from_settings => {
                        let s = sh.lock().unwrap().clone();
                        let r = offline::sync(&s.base(), &s.key);
                        reply(match r {
                            Ok(()) => json!({"ok": true}).to_string(),
                            Err(e) => json!({"error": e}).to_string(),
                        });
                    }
                    "getSettings" if from_settings => {
                        let s = sh.lock().unwrap().clone();
                        let st = p.lock();
                        let devices = st.list_devices.as_ref().map(|f| f()).unwrap_or_default();
                        reply(
                            json!({"version": env!("CARGO_PKG_VERSION"), "log": std::env::var("ARK_LOG").unwrap_or_else(|_| format!("{}/.local/state/ArkTracks/ArkTracks.log", std::env::var("HOME").unwrap_or_default())),
                                "server": s.base(), "hasKey": !s.key.is_empty(), "vault": ark_engine::vault::available(), "configured": !s.base().is_empty() && !s.key.is_empty() || s.offline, "offline": s.offline, "mirror": offline::available(),
                                "songs_root": st.cfg.songs_root, "device": st.cfg.device, "output_mode": st.cfg.output_mode,
                                "freeshow_host": st.cfg.fs_host, "freeshow_port": st.cfg.fs_port,
                                "devices": devices.iter().filter(|d| d.1 > 0).map(|d| json!({"name": d.0, "outputs": d.1})).collect::<Vec<_>>()})
                            .to_string(),
                        );
                    }
                    "saveSettings" if from_settings => {
                        {
                            let mut s = sh.lock().unwrap();
                            s.server = msg["server"].as_str().unwrap_or("").to_string();
                            s.offline = msg["offline"].as_bool().unwrap_or(false);
                            if let Some(k) = msg["key"].as_str().filter(|k| !k.is_empty()) {
                                s.key = k.to_string();
                            }
                            s.save();
                        }
                        let mut items = vec![
                            ("songs_root".to_string(), msg["songs_root"].as_str().unwrap_or("").to_string()),
                            ("device".to_string(), msg["device"].as_str().unwrap_or("").to_string()),
                            ("output_mode".to_string(), msg["output_mode"].as_str().unwrap_or("stereo").to_string()),
                            ("freeshow_host".to_string(), msg["freeshow_host"].as_str().unwrap_or("").to_string()),
                        ];
                        if let Some(port) = msg["freeshow_port"].as_str().filter(|p| !p.is_empty()) {
                            items.push(("freeshow_port".into(), port.to_string()));
                        }
                        let (_, body) = handle(&p, "/configure", &Query::new(items));
                        let ok = !body.contains("\"error\"");
                        reply(if ok { json!({"ok": true}).to_string() } else { body });
                        if ok {
                            let _ = px_send(&p, Ev::Navigate(String::new()));
                        }
                    }
                    _ => reply(json!({"error": "onbekend"}).to_string()),
                }
            });
        });
    #[cfg(target_os = "linux")]
    let webview = builder.build_gtk(window.default_vbox().unwrap()).expect("webview");
    #[cfg(not(target_os = "linux"))]
    let webview = builder.build(&window).expect("webview");

    // helper: stuur een gebeurtenis naar de hoofdlus (de ipc-draden hebben alleen de speler)
    // (zie px_send hieronder: de proxy zit in een globale)
    PROXY.set(Mutex::new(proxy.clone())).ok();

    let go_main = {
        let shell = shell.clone();
        let proxy = proxy.clone();
        move |wv: &wry::WebView| {
            let s = shell.lock().unwrap().clone();
            if let Ok(u) = std::env::var("ARK_START_URL") {
                // alleen voor proeven: een bepaalde pagina openen
                let _ = wv.load_url(&u);
                return;
            }
            if s.offline {
                // zonder server werken: de bewaarde kopie van de pagina
                if offline::available() {
                    let _ = wv.load_url(offline::URL);
                } else {
                    let _ = wv.load_url("ark://app/settings");
                }
                return;
            }
            if s.base().is_empty() || s.key.is_empty() {
                let _ = wv.load_url("ark://app/settings");
                return;
            }
            // de sleutel gaat als cookie mee naar de server: zonder dat bestaat /desktop daar niet
            let mut c = wry::cookie::Cookie::new("ark_desktop", s.key.clone());
            c.set_domain(s.host());
            c.set_path("/");
            c.set_http_only(true);
            c.set_secure(s.base().starts_with("https://"));
            c.set_expires(wry::cookie::time::OffsetDateTime::now_utc() + wry::cookie::time::Duration::days(365));
            if let Err(e) = wv.set_cookie(&c) {
                log(&format!("Cookie zetten mislukt: {e}"));
            }
            // is de server er? Zo niet en is er een kopie, dan daarmee doorwerken. Is hij er, dan de kopie op de achtergrond bijwerken.
            let url = format!("{}/desktop", s.base());
            let px = proxy.clone();
            std::thread::spawn(move || {
                // Onbereikbaar is alleen: de naam niet te vinden of niet kunnen verbinden. Een trage server (of een wifi die even slaapt) is er wel:
                // dan laden we de gewone pagina in plaats van de kopie.
                let reachable = match ureq::AgentBuilder::new().timeout_connect(std::time::Duration::from_secs(6)).timeout_read(std::time::Duration::from_secs(20)).build().get(&url).set("Cookie", &format!("ark_desktop={}", s.key)).call() {
                    Ok(_) | Err(ureq::Error::Status(_, _)) => true, // elk antwoord van de server telt: hij is er
                    Err(ureq::Error::Transport(t)) => !matches!(t.kind(), ureq::ErrorKind::Dns | ureq::ErrorKind::ConnectionFailed | ureq::ErrorKind::InvalidUrl),
                };
                if reachable {
                    let _ = px.send_event(Ev::Navigate(url.clone()));
                    static ONCE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
                    if !ONCE.swap(true, std::sync::atomic::Ordering::SeqCst) {
                        std::thread::sleep(std::time::Duration::from_secs(8)); // eerst de pagina laten laden
                        let _ = offline::sync(&s.base(), &s.key);
                    }
                } else if offline::available() {
                    log("Server niet bereikbaar: verder met de kopie zonder server");
                    let _ = px.send_event(Ev::Navigate(offline::URL.into()));
                } else {
                    let _ = px.send_event(Ev::Navigate(url));
                }
            });
        }
    };
    go_main(&webview);

    let mut zoom = 1.0f64;
    let (player2, mixer2, fetcher2) = (player.clone(), mixer.clone(), fetcher.clone());
    event_loop.run(move |event, _, flow| {
        *flow = ControlFlow::Wait;
        match event {
            Event::UserEvent(Ev::Eval(js)) => {
                let _ = webview.evaluate_script(&js);
            }
            Event::UserEvent(Ev::Cookies(url, tx)) => {
                let header = webview.cookies_for_url(&url).map(|v| v.iter().map(|c| format!("{}={}", c.name(), c.value())).collect::<Vec<_>>().join("; ")).unwrap_or_default();
                let _ = tx.send(header);
            }
            Event::UserEvent(Ev::Pick(id, kind)) => {
                let (f2, px2) = (fetcher2.clone(), proxy.clone());
                std::thread::spawn(move || {
                    let result = if kind == "zip" {
                        for f in dialogs::pick_files("Kies een MultiTracks-zip of een eigen opname (zip met song.json)", "Zip | *.zip") {
                            f2.import_zip(&f);
                        }
                        "{}".to_string()
                    } else {
                        json!({"path": dialogs::pick_folder("Kies een map")}).to_string()
                    };
                    let _ = px2.send_event(Ev::Eval(format!("window.__arkRes({id},{})", serde_json::to_string(&result).unwrap())));
                });
            }
            Event::UserEvent(Ev::Navigate(url)) => {
                if url.is_empty() {
                    go_main(&webview);
                } else {
                    let _ = webview.load_url(&url);
                }
            }
            Event::UserEvent(Ev::RestartAudio(dev)) => {
                if let Err(e) = start_audio(&player2, &mixer2, &mut audio, &dev) {
                    log(&format!("Audio starten mislukt: {e}"));
                }
            }
            Event::UserEvent(Ev::Fullscreen) => {
                window.set_fullscreen(if window.fullscreen().is_some() { None } else { Some(Fullscreen::Borderless(None)) });
            }
            Event::UserEvent(Ev::Zoom(d)) => {
                zoom = if d == 0.0 { 1.0 } else { (zoom + d).clamp(0.5, 3.0) };
                let _ = webview.zoom(zoom);
            }
            Event::WindowEvent { event: WindowEvent::CloseRequested, .. } => {
                log("Afsluiten");
                *flow = ControlFlow::Exit;
            }
            _ => {}
        }
    });
}

static PROXY: std::sync::OnceLock<Mutex<EventLoopProxy<Ev>>> = std::sync::OnceLock::new();
fn px_send(_p: &Arc<Player>, e: Ev) -> Result<(), ()> {
    PROXY.get().and_then(|p| p.lock().ok().and_then(|p| p.send_event(e).ok())).ok_or(())
}
