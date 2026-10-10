// Gegenereerd uit LocalRemote.swift en daarna aangepast voor Linux: de pagina's voor tablet en telefoon.

fn esc_html(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;")
}

/// De pagina die een tablet of telefoon als eerste ziet: certificaat installeren (per type apparaat uitgelegd) en dan het Podium openen
pub fn landing(host: &str, port: u16, name: &str, fingerprint: &str) -> String {
    let https = format!("https://{host}:{port}/tracks");
    LANDING.replace("__HTTPS__", &https).replace("__NAME__", &esc_html(name)).replace("__FP__", &esc_html(fingerprint))
}

/// Het script dat bovenaan de pagina komt: de speler van deze computer via http(s), koppelen, en de eigen instellingen van de pagina
pub fn shim(host_name: &str) -> String {
    let name = serde_json::to_string(host_name).unwrap_or_else(|_| "\"computer\"".into());
    SHIM.replace("__HOST__", &name)
}

const LANDING: &str = r##"<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ark Tracks – lokale bediening</title>
<style>
body{margin:0;background:#0b1222;color:#e2e8f0;font:16px/1.5 -apple-system,Segoe UI,sans-serif;padding:20px;max-width:640px;margin:0 auto}
h1{font-size:1.4rem;margin:.2em 0}h2{font-size:1.05rem;margin:1.4em 0 .3em;color:#7dd3fc}
.card{background:#111c33;border:1px solid #1e2d4d;border-radius:14px;padding:14px 16px;margin:12px 0}
a.btn{display:block;text-align:center;background:#3b82f6;color:#fff;text-decoration:none;font-weight:700;border-radius:12px;padding:14px;margin:10px 0}
a.btn.alt{background:#1e293b;border:1px solid #334155}
ol{padding-left:1.2em;margin:.4em 0}li{margin:.35em 0}small,.fp{color:#94a3b8;font-size:.8rem;word-break:break-all}
.tip{background:#1b2a1f;border-color:#2c4a34}
</style></head><body>
<h1>Ark Tracks – lokale bediening</h1>
<p>Deze pagina staat op <b>__NAME__</b>. Om het Podium en de mixer versleuteld te gebruiken, installeer je <b>eenmalig</b> het certificaat van deze computer op je apparaat. Daarna geef je het apparaat toestemming op de Mac zelf.</p>

<h2>Stap 1 – Certificaat installeren</h2>
<div class="card" id="ios"><b>iPhone en iPad</b>
  <a class="btn" href="/ca.mobileconfig">Download het certificaat</a>
  <ol>
    <li>Tik op <b>Download het certificaat</b> en kies <b>Toestaan</b> (“Dit website probeert een configuratieprofiel te downloaden”).</li>
    <li>Open <b>Instellingen</b>. Bovenaan staat <b>Profiel gedownload</b>. Tik daarop, dan op <b>Installeer</b> (rechtsboven), voer je toegangscode in en tik nogmaals op <b>Installeer</b>. “Niet ondertekend” is normaal.</li>
    <li><b>Belangrijk, daarna nog:</b> ga naar <b>Instellingen › Algemeen › Info › Certificaatvertrouwen</b> en zet de schakelaar bij <b>Ark Tracks Lokale CA</b> aan. Bevestig met <b>Ga door</b>.</li>
  </ol></div>
<div class="card" id="android"><b>Android</b>
  <a class="btn alt" href="/ca.crt">Download het certificaat</a>
  <ol>
    <li>Download het bestand en open <b>Instellingen › Beveiliging en privacy › Meer beveiliging › Versleuteling en inloggegevens › Een certificaat installeren › CA-certificaat</b> (de naam verschilt per telefoon; zoek op “certificaat”).</li>
    <li>Kies <b>Toch installeren</b> en selecteer het gedownloade bestand.</li>
  </ol></div>
<div class="card" id="mac"><b>Mac</b>
  <a class="btn alt" href="/ca.crt">Download het certificaat</a>
  <ol>
    <li>Dubbelklik op het bestand: <b>Sleutelhangertoegang</b> opent. Kies bij <b>Sleutelhanger</b> “inloggen” en voeg toe.</li>
    <li>Zoek “Ark Tracks Lokale CA”, dubbelklik, open <b>Vertrouwen</b> en kies bij <b>Bij gebruik van dit certificaat</b>: <b>Altijd vertrouwen</b>.</li>
  </ol></div>
<div class="card" id="win"><b>Windows</b>
  <a class="btn alt" href="/ca.crt">Download het certificaat</a>
  <ol>
    <li>Dubbelklik op het bestand › <b>Certificaat installeren</b> › <b>Huidige gebruiker</b> › <b>Alle certificaten in het volgende archief plaatsen</b> › <b>Vertrouwde basiscertificeringsinstanties</b>.</li>
    <li>Firefox heeft een eigen certificaatlijst: gebruik Edge of Chrome, of importeer het daar ook.</li>
  </ol></div>

<div class="card" id="linux"><b>Linux</b>
  <a class="btn alt" href="/ca.crt">Download het certificaat</a>
  <ol>
    <li>Chrome, Edge en Chromium: <b>Instellingen › Privacy en beveiliging › Beveiliging › Certificaten beheren › Autoriteiten › Importeren</b> en kies het bestand; vink <b>Vertrouwen voor het identificeren van websites</b> aan.</li>
    <li>Firefox: <b>Instellingen › Privacy en beveiliging › Certificaten weergeven › Autoriteiten › Importeren</b> en vink het vertrouwen voor websites aan.</li>
  </ol></div>

<h2>Stap 2 – Het Podium openen</h2>
<a class="btn" href="__HTTPS__">Open het Podium</a>
<div class="card">Het eerste apparaat dat het Podium opent, vraagt om een naam. Op de <b>computer</b> verschijnt dan de vraag om het apparaat <b>toe te staan</b>. Doe dat alleen als je het zelf aanvraagt.</div>
<div class="card tip"><b>Op het beginscherm zetten (iPad/iPhone)</b><br>Open het Podium in Safari › deelknop › <b>Zet op beginscherm</b>. Dan opent het volledig scherm.</div>

<h2>Controle</h2>
<p><small>Wil je zeker weten dat dit het certificaat van deze computer is? De vingerafdruk (SHA-256) is:</small></p>
<p class="fp">__FP__</p>
<p><small>Je vindt hem op de computer onder Bediening op afstand. Op iPhone/iPad: Instellingen › Algemeen › Info › Certificaatvertrouwen › tik op het certificaat.</small></p>
<script>
const ua = navigator.userAgent;
const mine = /iPhone|iPad|Macintosh.*Mobile/.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua)) ? "ios" : /Android/.test(ua) ? "android" : /Windows/.test(ua) ? "win" : /Linux/.test(ua) ? "linux" : /Macintosh/.test(ua) ? "mac" : "";
for (const id of ["ios", "android", "mac", "win", "linux"]) { const el = document.getElementById(id); if (mine && id !== mine) el.style.opacity = ".55"; }
</script>
</body></html>
"##;

const SHIM: &str = r##"(() => {
  const HOST = __HOST__;
  const TK = "lan-token";
  const get = (k) => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } };
  const auth = () => ({ Authorization: "Bearer " + get(TK) });
  let pairing = false;
  function pair(reason) {
    if (pairing) return; pairing = true;
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:fixed;inset:0;z-index:99999;background:#0b1222;color:#e2e8f0;display:flex;align-items:center;justify-content:center;text-align:center;font-family:-apple-system,sans-serif;padding:24px";
    wrap.innerHTML = '<div style="max-width:420px"><h2 id="lanhost">Koppelen</h2><p style="opacity:.8">Geef dit apparaat een naam. Op de computer verschijnt een vraag om toe te staan.</p><input id="lanname" style="font-size:18px;padding:10px;width:100%;box-sizing:border-box;border-radius:8px;border:1px solid #475569;background:#111827;color:#fff"><p><button id="lango" style="font-size:18px;padding:10px 24px;border-radius:8px;border:0;background:#3b82f6;color:#fff">Koppelen</button></p><p id="lanmsg" style="opacity:.8"></p></div>';
    const mount = () => { document.body.appendChild(wrap); wrap.querySelector("#lanhost").textContent = "Koppelen met " + HOST;
      const ua = navigator.userAgent; wrap.querySelector("#lanname").value = /iPad/.test(ua) ? "iPad" : /iPhone/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : "Apparaat";
      wrap.querySelector("#lango").onclick = async () => {
        const msg = wrap.querySelector("#lanmsg"); msg.textContent = "Wacht op toestemming op de computer…";
        try {
          const r = await fetch("/_pair", { method: "POST", body: JSON.stringify({ name: wrap.querySelector("#lanname").value }) });
          const j = await r.json();
          if (r.ok && j.token) { localStorage.setItem(TK, j.token); location.reload(); } else msg.textContent = j.error || "Niet gelukt";
        } catch (e) { msg.textContent = "Geen verbinding met de computer"; }
      };
    };
    if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);
  }
  let unpaired = false;      // not coupled: do not keep asking (the page polls the player several times a second)
  async function call(path, params) {
    if (unpaired) throw new Error("Niet gekoppeld");
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) {
      if (Array.isArray(v)) v.forEach(x => qs.append(k, x));
      else if (v !== undefined && v !== null) qs.append(k, typeof v === "boolean" ? (v ? "1" : "0") : String(v));
    }
    const r = await fetch("/_engine" + path + (qs.toString() ? "?" + qs : ""), { headers: auth() });
    if (r.status === 401) { unpaired = true; pair(); throw new Error("Niet gekoppeld"); }
    return r.json();
  }
  // meldingen en een controle na 8 seconden: komt de pagina niet op, dan staat er in het logbestand van de computer waarom
  const tell = (m) => { try { fetch("/_log", { method: "POST", body: JSON.stringify({ m: String(m).slice(0, 380) }), keepalive: true }).catch(() => {}); } catch (e) {} };
  let told = 0;
  const once = (m) => { if (told++ < 8) tell(m); };
  window.addEventListener("error", e => once("fout: " + e.message + " @" + String(e.filename || "").split("/").pop() + ":" + e.lineno));
  window.addEventListener("unhandledrejection", e => once("belofte afgewezen: " + (e.reason && e.reason.message || e.reason)));
  const ce = console.error; console.error = function () { once("console.error: " + [].slice.call(arguments).map(String).join(" ")); ce.apply(console, arguments); };
  tell("start " + navigator.userAgent.slice(0, 120) + " | gekoppeld: " + !!get(TK) + " | veilig: " + window.isSecureContext + " | " + document.readyState);
  document.addEventListener("DOMContentLoaded", () => tell("DOMContentLoaded"));
  window.addEventListener("load", () => tell("load"));
  // een controle na 2 seconden: antwoordt de pagina zelf op /api/settings (dat handelt de app af) en de speler van de computer?
  setTimeout(() => {
    const t0 = Date.now();
    fetch("/api/settings", { cache: "no-store" }).then(r => r.json()).then(j => tell("controle /api/settings: " + JSON.stringify(j).slice(0, 100) + " (" + (Date.now() - t0) + " ms)"), e => tell("controle /api/settings MISLUKT: " + e));
    const t1 = Date.now();
    window.arkEngine.call("/state").then(j => tell("controle speler: " + (j && j.state) + " (" + (Date.now() - t1) + " ms)"), e => tell("controle speler MISLUKT: " + e));
  }, 2000);
  setTimeout(() => {
    const t = (document.body && document.body.innerText || "").replace(/\s+/g, " ").slice(0, 160);
    tell("na 8 s: " + t + " | sectie-tegels: " + document.querySelectorAll(".trk-section").length);
    try {
      const scripts = [].slice.call(document.scripts).map(x => x.src).filter(Boolean);
      const seen = performance.getEntriesByType("resource").map(e => e.name);
      const missing = scripts.filter(u => !seen.includes(u)).map(u => u.split("/").pop());
      const slow = performance.getEntriesByType("resource").filter(e => e.duration > 1500).map(e => e.name.split("/").pop() + " " + Math.round(e.duration) + "ms");
      tell("scripts: " + scripts.length + ", geladen: " + (scripts.length - missing.length) + ", ontbreken: " + missing.join(",") + " | traag: " + slow.join(",") + " | next_f: " + (self.__next_f ? self.__next_f.length : "geen") + " | turbopack: " + (self.TURBOPACK ? (self.TURBOPACK.length === undefined ? "object" : self.TURBOPACK.length) : "geen") + " | root: " + !!document.querySelector("[data-reactroot], body > div") + " | " + document.readyState);
    } catch (e) { tell("controle mislukt: " + e); }
    if (!document.querySelector(".trk-transport") && !document.querySelector("#lango")) {
      const b = document.createElement("div");
      b.style.cssText = "position:fixed;left:12px;right:12px;bottom:12px;z-index:99998;background:#7c2d12;color:#fff;border-radius:12px;padding:12px 14px;font:14px -apple-system,sans-serif";
      b.innerHTML = 'Het laden duurt lang. <button id="lanagain" style="margin-left:8px;padding:6px 10px;border-radius:8px;border:0">Opnieuw koppelen</button>';
      (document.body || document.documentElement).appendChild(b);
      b.querySelector("#lanagain").onclick = () => { try { localStorage.removeItem(TK); } catch (e) {} location.reload(); };
    }
  }, 8000);
  window.arkEngine = { available: true, call };
  window.arkDesktop = { version: "lan", offline: true, server: "", remote: { enabled: false, name: "" }, lan: true,
    openSettings() {}, openExternal(u) { window.open(u); }, chooseFolder: async () => ({ path: "" }), fetchSong() {}, fetchStatus: async () => ({ jobs: [] }),
    removeSong: async () => ({ ok: false }), importZip() {} };
  // de eigen instellingen van de pagina ("ark-…": eigen setlist e.d.) staan op de computer
  try {
    const x = new XMLHttpRequest(); x.open("GET", "/_kv", false); x.setRequestHeader("Authorization", auth().Authorization); x.send();
    if (x.status === 401) pair();
    else if (x.status === 200) {
      const kv = JSON.parse(x.responseText);
      const set = Storage.prototype.setItem, remove = Storage.prototype.removeItem;
      for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith("ark-") && !(k in kv)) remove.call(localStorage, k); }
      for (const k in kv) if (k.startsWith("ark-")) set.call(localStorage, k, kv[k]);
      const push = (k, v) => fetch("/_kv", { method: "POST", headers: auth(), body: JSON.stringify({ key: k, value: v }), keepalive: true }).catch(() => {});
      Storage.prototype.setItem = function (k, v) { set.call(this, k, v); if (this === localStorage && String(k).startsWith("ark-")) push(String(k), String(v)); };
      Storage.prototype.removeItem = function (k) { remove.call(this, k); if (this === localStorage && String(k).startsWith("ark-")) push(String(k), null); };
    }
  } catch (e) {}
})();
"##;
