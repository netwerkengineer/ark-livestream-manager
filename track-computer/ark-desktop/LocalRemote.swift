// Lokale bediening zonder server: de app levert zelf het Podium (de kopie uit OfflineMirror) aan tablets en telefoons op het
// netwerk en bedient de speler rechtstreeks. Bedoeld voor als de server of de NAS uitvalt tijdens een dienst.
//
// - Staat standaard uit (menu: Bediening op afstand…); poort en aan/uit in dat venster, niets vast in de code.
// - Een apparaat koppelt eenmalig: de Mac vraagt "toestaan?" en geeft dan een eigen sleutel (alleen de hash wordt bewaard,
//   in de Keychain). Elk apparaat is afzonderlijk in te trekken.
// - Alleen een vaste lijst opdrachten van de speler is bereikbaar; geen instellingen, geen opnemen, geen bestanden.
// - De verbinding is gewoon http (geen versleuteling): alleen op een netwerk dat je vertrouwt.

import Foundation
import Network
import CryptoKit
import Cocoa
import CoreImage
import SystemConfiguration

struct LanDevice: Codable {
    var id: String
    var name: String
    var hash: String
    var created: Date
    var lastSeen: Date
}

enum LanDevices {
    static var memory: [LanDevice]?                  // alleen voor de proef: niets naar de Keychain
    static var list: [LanDevice] {
        get {
            if let m = memory { return m }
            guard let d = Keychain.get("lan-devices").data(using: .utf8), !d.isEmpty else { return [] }
            let dec = JSONDecoder(); dec.dateDecodingStrategy = .iso8601
            return (try? dec.decode([LanDevice].self, from: d)) ?? []
        }
        set {
            if memory != nil { memory = newValue; return }
            let enc = JSONEncoder(); enc.dateEncodingStrategy = .iso8601
            Keychain.set("lan-devices", (try? String(data: enc.encode(newValue), encoding: .utf8)) ?? "")
        }
    }
    static func hash(_ token: String) -> String { SHA256.hash(data: Data(token.utf8)).map { String(format: "%02x", $0) }.joined() }
}

final class LocalRemote {
    unowned let app: AppDelegate
    let q = DispatchQueue(label: "ark.lan")
    var listener: NWListener?
    var pairing = false
    var attempts: [String: [Date]] = [:]
    var logHits: [String: [Date]] = [:]
    var testAutoAllow = false                       // alleen voor de proef (--lan-test): zonder venster toestaan
    var lastSave = Date.distantPast
    var devices: [LanDevice] = []
    var onboarding: NWListener?                     // gewone http-poort (poort+1): alleen om het certificaat te installeren, verder niets
    var lastError: String?
    var tlsOn = false
    var ipTimer: DispatchSourceTimer?
    var ipsSeen: [String] = []
    var startedAt = Date()
    let store = DispatchQueue(label: "ark.lan.store")       // alles met de Keychain: nooit op de wachtrij van de server (een vraag van macOS zou dan alle verzoeken laten wachten)
    var devicesLoaded = false                       // de Keychain pas aanspreken als er een apparaat komt, niet bij het opstarten
    static let testMode = CommandLine.arguments.contains { $0.hasSuffix("-test") }     // proeven zonder venster raken de echte instellingen niet aan

    init(app: AppDelegate) { self.app = app }

    // engine-opdrachten die vanaf het netwerk mogen (geen instellingen, opnemen of bestanden)
    static let allowed: Set<String> = ["/state", "/library", "/play", "/pause", "/stop", "/seek", "/mute", "/solo", "/gain", "/group", "/unmute",
                                       "/master", "/jump", "/loop", "/mode", "/load", "/song", "/songcancel", "/setlist", "/pad"]

    func refresh() {
        stop()
        guard ShellSettings.lan, !LocalRemote.testMode else { return }
        start(port: ShellSettings.lanPort, tls: ShellSettings.lanTLS)
    }
    /// De naam waarmee andere apparaten deze Mac op het netwerk vinden (Bonjour: "Naam-van-de-Mac.local"). Dat is niet altijd de hostnaam van het proces.
    static func hostLocalName() -> String {
        if let n = SCDynamicStoreCopyLocalHostName(nil) as String?, !n.isEmpty { return n.lowercased() + ".local" }
        let h = ProcessInfo.processInfo.hostName.lowercased(); return h.hasSuffix(".local") ? h : h + ".local"
    }
    /// Alle namen voor het certificaat: de Bonjour-naam en de hostnaam van het proces
    static func hostLocalNames() -> [String] {
        let a = hostLocalName(), b = ProcessInfo.processInfo.hostName.lowercased()
        return b.hasSuffix(".local") && b != a ? [a, b] : [a]
    }

    func start(port p: Int, tls: Bool) {
        lastError = nil; tlsOn = tls; startedAt = Date()
        devicesLoaded = false
        loadDevices()
        guard let port = NWEndpoint.Port(rawValue: UInt16(clamping: p)) else { return }
        do {
            var params = NWParameters.tcp
            if tls {
                // eigen certificaat (zie LocalCA): versleuteld, geen waarschuwing zodra het apparaat de CA vertrouwt
                let ips = LanWindow.localIPs()
                ipsSeen = ips
                let id = try LocalCA.identity(hosts: LocalRemote.hostLocalNames(), ips: ips, name: ShellSettings.deviceName)
                let opts = NWProtocolTLS.Options()
                sec_protocol_options_set_local_identity(opts.securityProtocolOptions, sec_identity_create(id)!)
                sec_protocol_options_set_min_tls_protocol_version(opts.securityProtocolOptions, .TLSv12)
                params = NWParameters(tls: opts, tcp: NWProtocolTCP.Options())
                startOnboarding(port: p + 1)
                startIPWatch()
            }
            let l = try NWListener(using: params, on: port)
            l.newConnectionHandler = { [weak self] c in self?.accept(c) }
            l.stateUpdateHandler = { st in
                if case .failed(let e) = st { log("Lokale bediening: poort \(port) niet beschikbaar: \(e)") }
                if case .ready = st { log("Lokale bediening aan op poort \(port)") }
                if case .waiting(let e) = st { log("Lokale bediening wacht: \(e) (staat de firewall of \"Lokaal netwerk\" in de weg?)") }
            }
            l.start(queue: q)
            listener = l
        } catch { lastError = error.localizedDescription; log("Lokale bediening starten mislukt: \(error.localizedDescription)") }
    }
    func stop() { listener?.cancel(); listener = nil; onboarding?.cancel(); onboarding = nil; ipTimer?.cancel(); ipTimer = nil }

    /// Wisselt het adres van de Mac (andere wifi, nieuw DHCP-adres), dan past het certificaat niet meer: opnieuw maken
    private func startIPWatch() {
        ipTimer?.cancel()
        let t = DispatchSource.makeTimerSource(queue: q)
        t.schedule(deadline: .now() + 60, repeating: 60)
        t.setEventHandler { [weak self] in
            guard let self = self, self.tlsOn else { return }
            let now = LanWindow.localIPs()
            // ook na ruim 10 maanden aan één stuk: het certificaat is 397 dagen geldig
            if now != self.ipsSeen || Date().timeIntervalSince(self.startedAt) > 300 * 86400 { log("Certificaat opnieuw maken (adres gewijzigd of bijna verlopen)"); DispatchQueue.main.async { self.refresh() } }
        }
        t.resume(); ipTimer = t
    }

    /// De gewone http-poort: alleen de installatiepagina en het certificaat (openbaar), nooit de bediening zelf
    private func startOnboarding(port p: Int) {
        guard let port = NWEndpoint.Port(rawValue: UInt16(clamping: p)), let l = try? NWListener(using: .tcp, on: port) else { return }
        l.newConnectionHandler = { [weak self] c in self?.accept(c, onboarding: true) }
        l.start(queue: q)
        onboarding = l
    }

    // ---- een verzoek inlezen
    private struct Request { var method = "", target = "", headers: [String: String] = [:], body = Data(), ip = "", onboarding = false }

    private func accept(_ c: NWConnection, onboarding: Bool = false) {
        c.start(queue: q)
        var ip = ""
        if case .hostPort(let host, _) = c.endpoint { ip = "\(host)".components(separatedBy: "%").first ?? "" }
        q.asyncAfter(deadline: .now() + 120) { c.cancel() }                // niets blijft eeuwig open
        read(c, Data(), ip, onboarding)
    }

    private func read(_ c: NWConnection, _ buf: Data, _ ip: String, _ onboarding: Bool = false) {
        c.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, done, err in
            guard let self = self else { return }
            var b = buf; if let d = data { b.append(d) }
            if b.count > 1_000_000 || err != nil { c.cancel(); return }
            if let end = b.range(of: Data("\r\n\r\n".utf8)) {
                let head = String(decoding: b[..<end.lowerBound], as: UTF8.self)
                var lines = head.components(separatedBy: "\r\n")
                let first = lines.removeFirst().split(separator: " ")
                guard first.count >= 2 else { c.cancel(); return }
                var req = Request(); req.method = String(first[0]); req.target = String(first[1]); req.ip = ip; req.onboarding = onboarding
                for l in lines { if let i = l.firstIndex(of: ":") { req.headers[l[..<i].lowercased()] = l[l.index(after: i)...].trimmingCharacters(in: .whitespaces) } }
                let need = Int(req.headers["content-length"] ?? "0") ?? 0
                let have = b.count - end.upperBound
                if have >= need { req.body = b[end.upperBound..<(end.upperBound + need)]; self.route(c, req); return }
            }
            if done { c.cancel() } else { self.read(c, b, ip, onboarding) }
        }
    }

    // ---- antwoorden
    private func send(_ c: NWConnection, _ status: Int, _ type: String, _ body: Data, cache: Bool = false, note: String? = nil) {
        let names = [200: "OK", 202: "Accepted", 302: "Found", 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 408: "Request Timeout", 429: "Too Many Requests"]
        let head = "HTTP/1.1 \(status) \(names[status] ?? "OK")\r\nContent-Type: \(type)\r\nContent-Length: \(body.count)\r\nCache-Control: \(cache ? "max-age=3600" : "no-store")\r\nConnection: close\r\nX-Content-Type-Options: nosniff\r\n\r\n"
        var d = Data(head.utf8); d.append(body)
        let started = Date()
        finish(c, d) { err in
            if let note = note { log("Lokale bediening: \(note) \(status) \(body.count) bytes in \(Int(Date().timeIntervalSince(started) * 1000)) ms\(err.map { " FOUT \($0)" } ?? "")") }
            else if let e = err { log("Lokale bediening: versturen mislukt: \(e)") }
        }
    }

    /// Verstuurt het antwoord als laatste bericht en sluit de verbinding NIET zelf: dat doet de ontvanger zodra hij alles heeft.
    /// (Meteen sluiten na "verwerkt" kan een groot bestand op een echte verbinding afkappen: verwerkt is niet hetzelfde als aangekomen.)
    private func finish(_ c: NWConnection, _ data: Data, _ done: ((NWError?) -> Void)? = nil) {
        c.send(content: data, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { err in done?(err) })
        c.receive(minimumIncompleteLength: 1, maximumLength: 1) { _, _, _, _ in c.cancel() }
        q.asyncAfter(deadline: .now() + 60) { c.cancel() }                         // noodstop voor een ontvanger die nooit sluit
    }
    private func json(_ c: NWConnection, _ status: Int, _ obj: Any) {
        send(c, status, "application/json", (try? JSONSerialization.data(withJSONObject: obj)) ?? Data("{}".utf8))
    }

    // ---- routes
    private func route(_ c: NWConnection, _ r: Request) {
        guard let comps = URLComponents(string: r.target) else { c.cancel(); return }
        let path = comps.path
        if r.onboarding { return onboardingRoute(c, r, path) }
        if r.method == "GET" && (path == "/" || path == "/podium") { return redirect(c, "/tracks") }
        if r.method == "GET" && path == "/mixer" { return redirect(c, "/tracks/mixer") }
        if r.method == "GET" && path == "/tracks" { return page(c, "tracks.html") }
        if r.method == "GET" && path == "/tracks/mixer" { return page(c, "mixer.html") }       // alleen de faders
        if r.method == "GET" && path == "/desktop" { return page(c, "desktop.html") }       // het volledige Tracks-scherm met de mixer
        if r.method == "GET" && path.hasPrefix("/_next/static/") { return file(c, path) }
        if r.method == "POST" && path == "/_log" {            // meldingen van de pagina (fouten), voor het logbestand van de Mac; kort en met een limiet
            let now = Date(); logHits[r.ip] = (logHits[r.ip] ?? []).filter { now.timeIntervalSince($0) < 60 } + [now]
            if (logHits[r.ip] ?? []).count <= 30, let o = (try? JSONSerialization.jsonObject(with: r.body)) as? [String: Any], let m = o["m"] as? String {
                log("Pagina op \(r.ip): \(String(m.filter { !$0.isNewline }.prefix(400)))")
            }
            return json(c, 200, ["ok": true])
        }
        if r.method == "POST" && path == "/_pair" { log("Lokale bediening: koppelverzoek van \(r.ip)"); return pair(c, r) }
        if r.method == "GET" && path == "/api/auth/session" { return json(c, 200, [String: String]()) }      // de pagina vraagt om een inlogsessie: die is er hier niet
        // alles hieronder alleen met een sleutel van een gekoppeld apparaat
        guard let dev = authorize(r) else { log("Lokale bediening: \(r.method) \(path) zonder geldige sleutel (\(devicesLoaded ? "apparaat onbekend" : "lijst met apparaten nog niet geladen")) van \(r.ip)"); return json(c, 401, ["error": "Niet gekoppeld"]) }
        _ = dev
        if path == "/_kv" {
            if r.method == "GET" { return json(c, 200, LocalStore.values) }
            if r.method == "POST", let o = (try? JSONSerialization.jsonObject(with: r.body)) as? [String: Any], let k = o["key"] as? String, k.hasPrefix("ark-") {
                let v = o["value"] as? String
                DispatchQueue.main.async { [self] in app.kvChanged { if let v = v { LocalStore.values[k] = v } else { LocalStore.values.removeValue(forKey: k) } } }
                return json(c, 200, ["ok": true])
            }
            return json(c, 400, ["error": "ongeldig"])
        }
        if path.hasPrefix("/_engine/") { return engine(c, String(path.dropFirst("/_engine".count)), comps) }
        json(c, 404, ["error": "onbekend"])
    }

    private func redirect(_ c: NWConnection, _ to: String) {
        let head = "HTTP/1.1 302 Found\r\nLocation: \(to)\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        finish(c, Data(head.utf8))
    }

    private func engine(_ c: NWConnection, _ path: String, _ comps: URLComponents) {
        guard LocalRemote.allowed.contains(path) else { return json(c, 403, ["error": "Niet toegestaan"]) }
        var qs: [String: String] = [:]
        for i in comps.queryItems ?? [] { qs[i.name] = (i.value ?? "").replacingOccurrences(of: "+", with: " ") }
        let items = comps.queryItems ?? []
        var res: (Int, String) = (500, "{}")
        DispatchQueue.main.sync { [self] in
            // alleen nummers uit de eigen bibliotheek
            if ["/load", "/song", "/setlist"].contains(path) {
                let known = Set(app.player.library.map { $0.path })
                var asked: [String] = []
                if let p = qs["path"] { asked.append(p) }
                asked += items.filter { $0.name == "p" }.compactMap { $0.value }
                if let j = qs["paths"] { asked += j.components(separatedBy: "|") }
                if asked.contains(where: { !known.contains($0.replacingOccurrences(of: "+", with: " ")) }) { res = (403, "{\"error\":\"Onbekend nummer\"}"); return }
            }
            res = app.engine.handle("GET", path, qs, items)
        }
        send(c, res.0, "application/json", Data(res.1.utf8))
    }

    // ---- het Podium zelf (de kopie van de webapp) en zijn bestanden
    private func page(_ c: NWConnection, _ name: String) {
        let f = OfflineMirror.dir.appendingPathComponent(name)
        guard let d = try? Data(contentsOf: f), var html = String(data: d, encoding: .utf8) else {
            return send(c, 404, "text/plain; charset=utf-8", Data("Het Podium staat nog niet in de kopie van deze app. Open de app één keer met de server (Weergave > Kopie voor gebruik zonder server bijwerken).".utf8))
        }
        log("Lokale bediening: pagina \(name) uitgeleverd (\(html.utf8.count) bytes)")
        let shim = "<script>" + LocalRemote.shim(hostName: ShellSettings.deviceName) + "</script>"
        if let r = html.range(of: "<head>") { html.insert(contentsOf: shim, at: r.upperBound) } else { html = shim + html }
        send(c, 200, "text/html; charset=utf-8", Data(html.utf8))
    }

    private func file(_ c: NWConnection, _ path: String) {
        let decoded = path.removingPercentEncoding ?? path
        guard !decoded.contains(".."), let d = try? Data(contentsOf: OfflineMirror.dir.appendingPathComponent(decoded)) else { log("Lokale bediening: GET \(decoded) NIET GEVONDEN in de kopie"); return json(c, 404, ["error": "niet gevonden"]) }
        let ext = (decoded as NSString).pathExtension.lowercased()
        send(c, 200, OfflineScheme.types[ext] ?? "application/octet-stream", d, cache: true, note: "GET \(decoded)")
    }

    // ---- apparaten
    private func authorize(_ r: Request) -> LanDevice? {
        guard devicesLoaded else { return nil }                  // nog niet geladen (de Keychain vraagt misschien iets): geen toegang in plaats van wachten
        guard let h = r.headers["authorization"], h.hasPrefix("Bearer ") else { return nil }
        let hash = LanDevices.hash(String(h.dropFirst(7)))
        guard let i = devices.firstIndex(where: { $0.hash == hash }) else { return nil }
        devices[i].lastSeen = Date()
        if Date().timeIntervalSince(lastSave) > 60 { lastSave = Date(); persist() }
        return devices[i]
    }

    private func pair(_ c: NWConnection, _ r: Request) {
        let now = Date()
        attempts[r.ip] = (attempts[r.ip] ?? []).filter { now.timeIntervalSince($0) < 60 } + [now]
        if (attempts[r.ip] ?? []).count > 4 || pairing { return json(c, 429, ["error": "Er wacht al een verzoek of er zijn er te veel; probeer het zo opnieuw"]) }
        let o = (try? JSONSerialization.jsonObject(with: r.body)) as? [String: Any]
        let name = String(((o?["name"] as? String) ?? "apparaat").filter { !$0.isNewline && $0 != "<" && $0 != ">" }.prefix(40))
        pairing = true
        var answered = false
        func finish(_ allowed: Bool) {
            q.async { [self] in
                guard !answered else { return }
                answered = true; pairing = false
                if allowed {
                    var bytes = [UInt8](repeating: 0, count: 32); _ = SecRandomCopyBytes(kSecRandomDefault, 32, &bytes)
                    let token = bytes.map { String(format: "%02x", $0) }.joined()
                    devices.append(LanDevice(id: UUID().uuidString, name: name, hash: LanDevices.hash(token), created: Date(), lastSeen: Date()))
                    log("Lokale bediening: \"\(name)\" toegestaan en gekoppeld (\(devices.count) apparaten)")
                    persist()
                    json(c, 200, ["token": token])
                } else { log("Lokale bediening: koppelverzoek van \"\(name)\" geweigerd of verlopen"); json(c, 403, ["error": "Geweigerd"]) }
            }
        }
        if testAutoAllow { finish(true); return }
        log("Lokale bediening: wacht op toestemming op de Mac voor \"\(name)\"")
        DispatchQueue.main.async { [self] in
            let a = NSAlert()
            a.messageText = "\u{201C}\(name)\u{201D} wil de bediening koppelen"
            a.informativeText = "Adres: \(r.ip)\nAlleen toestaan als jij dit zelf aanvraagt. Dit apparaat kan daarna spelen, springen en de mix en pads bedienen. Je kunt het later weer intrekken (Bediening op afstand…)."
            a.addButton(withTitle: "Toestaan"); a.addButton(withTitle: "Weigeren")
            NSApp.activate(ignoringOtherApps: true)
            q.asyncAfter(deadline: .now() + 90) { if !answered { DispatchQueue.main.async { if let w = self.app.window.attachedSheet { self.app.window.endSheet(w, returnCode: .abort) } }; finish(false) } }
            if app.window.isVisible { a.beginSheetModal(for: app.window) { finish($0 == .alertFirstButtonReturn) } }
            else { finish(a.runModal() == .alertFirstButtonReturn) }
        }
    }

    // de lijst wordt alleen op de eigen wachtrij aangepast (daar komen ook de verzoeken binnen)
    /// De lijst uit de Keychain halen (op de eigen wachtrij) en samenvoegen met wat er intussen bij is gekomen
    func loadDevices() {
        store.async { [self] in
            let list = LanDevices.list
            q.async { [self] in
                let extra = devices.filter { d in !list.contains(where: { $0.id == d.id }) }
                devices = list + extra; devicesLoaded = true
            }
        }
    }
    /// De lijst bewaren (de Keychain-vraag wacht op de eigen wachtrij, niet op de server)
    private func persist() { let snapshot = devices; store.async { LanDevices.list = snapshot; log("Lokale bediening: apparatenlijst bewaard in de Keychain") } }
    func remove(_ id: String) { q.async { [self] in devices.removeAll { $0.id == id }; persist() } }
    func removeAll() { q.async { [self] in devices = []; devicesLoaded = true; persist() } }
    func reloadDevices() { loadDevices() }

    // ---- installatiepagina op de gewone poort (poort+1): het certificaat en de uitleg, verder niets
    private func onboardingRoute(_ c: NWConnection, _ r: Request, _ path: String) {
        guard r.method == "GET" else { return json(c, 405, ["error": "niet toegestaan"]) }
        let host = (r.headers["host"] ?? LocalRemote.hostLocalName()).components(separatedBy: ":").first ?? LocalRemote.hostLocalName()
        switch path {
        case "/ca.mobileconfig":
            guard let d = LocalCA.mobileconfig(name: ShellSettings.deviceName) else { return json(c, 404, ["error": "geen certificaat"]) }
            sendFile(c, d, "application/x-apple-aspen-config", "ark-tracks-lokale-bediening.mobileconfig")
        case "/ca.crt":
            guard let d = LocalCA.caDER else { return json(c, 404, ["error": "geen certificaat"]) }
            sendFile(c, d, "application/x-x509-ca-cert", "ark-tracks-lokale-ca.crt")
        default:
            let html = LocalRemote.landing(host: host, port: ShellSettings.lanPort, name: ShellSettings.deviceName, fingerprint: LocalCA.fingerprint)
            send(c, 200, "text/html; charset=utf-8", Data(html.utf8))
        }
    }

    private func sendFile(_ c: NWConnection, _ data: Data, _ type: String, _ name: String) {
        let head = "HTTP/1.1 200 OK\r\nContent-Type: \(type)\r\nContent-Disposition: attachment; filename=\"\(name)\"\r\nContent-Length: \(data.count)\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
        var d = Data(head.utf8); d.append(data)
        finish(c, d)
    }

    /// De pagina die een tablet of telefoon als eerste ziet: certificaat installeren (per type apparaat uitgelegd) en dan het Podium openen
    static func landing(host: String, port: Int, name: String, fingerprint: String) -> String {
        let https = "https://\(host):\(port)/tracks"
        let esc = { (s: String) in s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;") }
        return """
        <!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
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
        <p>Deze pagina staat op <b>\(esc(name))</b>. Om het Podium en de mixer versleuteld te gebruiken, installeer je <b>eenmalig</b> het certificaat van deze Mac op je apparaat. Daarna geef je het apparaat toestemming op de Mac zelf.</p>

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

        <h2>Stap 2 – Het Podium openen</h2>
        <a class="btn" href="\(https)">Open het Podium</a>
        <div class="card">Het eerste apparaat dat het Podium opent, vraagt om een naam. Op de <b>Mac</b> verschijnt dan de vraag om het apparaat <b>toe te staan</b>. Doe dat alleen als je het zelf aanvraagt.</div>
        <div class="card tip"><b>Op het beginscherm zetten (iPad/iPhone)</b><br>Open het Podium in Safari › deelknop › <b>Zet op beginscherm</b>. Dan opent het volledig scherm.</div>

        <h2>Controle</h2>
        <p><small>Wil je zeker weten dat dit het certificaat van deze Mac is? De vingerafdruk (SHA-256) is:</small></p>
        <p class="fp">\(esc(fingerprint))</p>
        <p><small>Je vindt hem op de Mac onder Bediening op afstand. Op iPhone/iPad: Instellingen › Algemeen › Info › Certificaatvertrouwen › tik op het certificaat.</small></p>
        <script>
        const ua = navigator.userAgent;
        const mine = /iPhone|iPad|Macintosh.*Mobile/.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua)) ? "ios" : /Android/.test(ua) ? "android" : /Windows/.test(ua) ? "win" : /Macintosh/.test(ua) ? "mac" : "";
        for (const id of ["ios", "android", "mac", "win"]) { const el = document.getElementById(id); if (mine && id !== mine) el.style.opacity = ".55"; }
        </script>
        </body></html>
        """
    }

    // ---- het script dat bovenaan de pagina komt: de speler van deze Mac via http, koppelen, en de eigen instellingen van de pagina
    static func shim(hostName: String) -> String {
        let name = (try? String(data: JSONSerialization.data(withJSONObject: [hostName]), encoding: .utf8)).flatMap { String($0.dropFirst().dropLast()) } ?? "\"Mac\""
        return """
        (() => {
          const HOST = \(name);
          const TK = "lan-token";
          const get = (k) => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } };
          const auth = () => ({ Authorization: "Bearer " + get(TK) });
          let pairing = false;
          function pair(reason) {
            if (pairing) return; pairing = true;
            const wrap = document.createElement("div");
            wrap.style.cssText = "position:fixed;inset:0;z-index:99999;background:#0b1222;color:#e2e8f0;display:flex;align-items:center;justify-content:center;text-align:center;font-family:-apple-system,sans-serif;padding:24px";
            wrap.innerHTML = '<div style="max-width:420px"><h2 id="lanhost">Koppelen</h2><p style="opacity:.8">Geef dit apparaat een naam. Op de Mac verschijnt een vraag om toe te staan.</p><input id="lanname" style="font-size:18px;padding:10px;width:100%;box-sizing:border-box;border-radius:8px;border:1px solid #475569;background:#111827;color:#fff"><p><button id="lango" style="font-size:18px;padding:10px 24px;border-radius:8px;border:0;background:#3b82f6;color:#fff">Koppelen</button></p><p id="lanmsg" style="opacity:.8"></p></div>';
            const mount = () => { document.body.appendChild(wrap); wrap.querySelector("#lanhost").textContent = "Koppelen met " + HOST;
              const ua = navigator.userAgent; wrap.querySelector("#lanname").value = /iPad/.test(ua) ? "iPad" : /iPhone/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : "Apparaat";
              wrap.querySelector("#lango").onclick = async () => {
                const msg = wrap.querySelector("#lanmsg"); msg.textContent = "Wacht op toestemming op de Mac…";
                try {
                  const r = await fetch("/_pair", { method: "POST", body: JSON.stringify({ name: wrap.querySelector("#lanname").value }) });
                  const j = await r.json();
                  if (r.ok && j.token) { localStorage.setItem(TK, j.token); location.reload(); } else msg.textContent = j.error || "Niet gelukt";
                } catch (e) { msg.textContent = "Geen verbinding met de Mac"; }
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
          // meldingen en een controle na 8 seconden: komt de pagina niet op, dan staat er in het logbestand van de Mac waarom
          const tell = (m) => { try { fetch("/_log", { method: "POST", body: JSON.stringify({ m: String(m).slice(0, 380) }), keepalive: true }).catch(() => {}); } catch (e) {} };
          let told = 0;
          const once = (m) => { if (told++ < 8) tell(m); };
          window.addEventListener("error", e => once("fout: " + e.message + " @" + String(e.filename || "").split("/").pop() + ":" + e.lineno));
          window.addEventListener("unhandledrejection", e => once("belofte afgewezen: " + (e.reason && e.reason.message || e.reason)));
          const ce = console.error; console.error = function () { once("console.error: " + [].slice.call(arguments).map(String).join(" ")); ce.apply(console, arguments); };
          tell("start " + navigator.userAgent.slice(0, 120) + " | gekoppeld: " + !!get(TK) + " | veilig: " + window.isSecureContext + " | " + document.readyState);
          document.addEventListener("DOMContentLoaded", () => tell("DOMContentLoaded"));
          window.addEventListener("load", () => tell("load"));
          // een controle na 2 seconden: antwoordt de pagina zelf op /api/settings (dat handelt de app af) en de speler van de Mac?
          setTimeout(() => {
            const t0 = Date.now();
            fetch("/api/settings", { cache: "no-store" }).then(r => r.json()).then(j => tell("controle /api/settings: " + JSON.stringify(j).slice(0, 100) + " (" + (Date.now() - t0) + " ms)"), e => tell("controle /api/settings MISLUKT: " + e));
            const t1 = Date.now();
            window.arkEngine.call("/state").then(j => tell("controle speler: " + (j && j.state) + " (" + (Date.now() - t1) + " ms)"), e => tell("controle speler MISLUKT: " + e));
          }, 2000);
          setTimeout(() => {
            const t = (document.body && document.body.innerText || "").replace(/\\s+/g, " ").slice(0, 160);
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
          // de eigen instellingen van de pagina ("ark-…": eigen setlist e.d.) staan op de Mac
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
        """
    }
}

// ---- het venster "Bediening op afstand…": aan/uit, poort, adres + QR, gekoppelde apparaten
final class LanWindow: NSObject, NSWindowDelegate {
    static var forceOn = false                       // alleen voor de proef met het venster
    unowned let app: AppDelegate
    var w: NSWindow?
    let stack = NSStackView()
    init(app: AppDelegate) { self.app = app }

    static func localIPs() -> [String] {
        var out: [String] = []
        var ifa: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifa) == 0, let first = ifa else { return [] }
        defer { freeifaddrs(ifa) }
        for p in sequence(first: first, next: { $0.pointee.ifa_next }) {
            let i = p.pointee
            guard i.ifa_addr.pointee.sa_family == UInt8(AF_INET), String(cString: i.ifa_name).hasPrefix("en") else { continue }
            var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            if getnameinfo(i.ifa_addr, socklen_t(i.ifa_addr.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 {
                let ip = String(cString: host)
                if !ip.hasPrefix("169.254.") { out.append(ip) }
            }
        }
        return out
    }

    static func qr(_ text: String) -> NSImage? {
        guard let f = CIFilter(name: "CIQRCodeGenerator") else { return nil }
        f.setValue(Data(text.utf8), forKey: "inputMessage"); f.setValue("M", forKey: "inputCorrectionLevel")
        guard let out = f.outputImage?.transformed(by: CGAffineTransform(scaleX: 6, y: 6)) else { return nil }
        let rep = NSCIImageRep(ciImage: out); let img = NSImage(size: rep.size); img.addRepresentation(rep); return img
    }

    func show() {
        if w == nil {
            let win = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 520, height: 600), styleMask: [.titled, .closable], backing: .buffered, defer: false)
            win.title = "Bediening op afstand"; win.delegate = self; win.isReleasedWhenClosed = false
            stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 10
            stack.edgeInsets = NSEdgeInsets(top: 16, left: 20, bottom: 16, right: 20)
            win.contentView = stack
            w = win
        }
        rebuild()
        w?.center(); w?.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
    }

    func label(_ s: String, secondary: Bool = false, selectable: Bool = false) -> NSTextField {
        let l = NSTextField(wrappingLabelWithString: s)
        l.preferredMaxLayoutWidth = 480; l.isSelectable = selectable
        if secondary { l.textColor = .secondaryLabelColor }
        return l
    }

    func rebuild() {
        stack.arrangedSubviews.forEach { stack.removeArrangedSubview($0); $0.removeFromSuperview() }
        let on = NSButton(checkboxWithTitle: "Lokale bediening toestaan (werkt ook zonder server)", target: self, action: #selector(toggle(_:)))
        on.state = (ShellSettings.lan || LanWindow.forceOn) ? .on : .off
        stack.addArrangedSubview(on)
        let portRow = NSStackView(); portRow.orientation = .horizontal; portRow.spacing = 8
        let port = NSTextField(string: String(ShellSettings.lanPort)); port.frame.size.width = 70; port.tag = 7
        portRow.addArrangedSubview(NSTextField(labelWithString: "Poort"))
        portRow.addArrangedSubview(port)
        let apply = NSButton(title: "Pas toe", target: self, action: #selector(applyPort(_:)))
        portRow.addArrangedSubview(apply)
        stack.addArrangedSubview(portRow)
        if ShellSettings.lan || LanWindow.forceOn {
            let tlsBox = NSButton(checkboxWithTitle: "Versleuteld (https) met een eigen certificaat — aanbevolen", target: self, action: #selector(toggleTLS(_:)))
            tlsBox.state = ShellSettings.lanTLS ? .on : .off
            stack.addArrangedSubview(tlsBox)
            if let e = app.remote.lastError { stack.addArrangedSubview(label("Starten mislukt: \(e)").colored(.systemRed)) }
            let host = LocalRemote.hostLocalName()
            let ip = LanWindow.localIPs().first
            let tls = ShellSettings.lanTLS
            let port = ShellSettings.lanPort
            let scheme = tls ? "https" : "http"
            func qrBox(_ title: String, _ url: String) -> NSView {
                let col = NSStackView(); col.orientation = .vertical; col.alignment = .centerX; col.spacing = 4
                col.addArrangedSubview(NSTextField(labelWithString: title).withBold())
                if let img = LanWindow.qr(url) {
                    let iv = NSImageView(image: img); iv.imageScaling = .scaleProportionallyUpOrDown
                    iv.widthAnchor.constraint(equalToConstant: 130).isActive = true; iv.heightAnchor.constraint(equalToConstant: 130).isActive = true
                    col.addArrangedSubview(iv)
                }
                return col
            }
            let podiumURL = "\(scheme)://\(ip ?? host):\(port)/tracks"
            let podiumName = "\(scheme)://\(host):\(port)/tracks"
            if tls {
                let installURL = "http://\(ip ?? host):\(port + 1)/"
                stack.addArrangedSubview(label("Op elk apparaat, eenmalig: eerst het certificaat installeren (stap 1), daarna het Podium openen (stap 2). Op de pagina van stap 1 staat per type apparaat precies wat je doet.", secondary: true))
                stack.addArrangedSubview(label("Stap 1: \(installURL)", selectable: true))
                stack.addArrangedSubview(label("Stap 2: \(podiumName)\nof \(podiumURL)", selectable: true))
                let row = NSStackView(); row.orientation = .horizontal; row.spacing = 24
                row.addArrangedSubview(qrBox("1  Certificaat", installURL))
                row.addArrangedSubview(qrBox("2  Podium", podiumURL))
                stack.addArrangedSubview(row)
                let fp = LocalCA.fingerprint
                if !fp.isEmpty { stack.addArrangedSubview(label("Vingerafdruk van het certificaat (SHA-256):\n\(fp)", secondary: true, selectable: true)) }
                let renew = NSButton(title: "Nieuw certificaat maken…", target: self, action: #selector(renewCA))
                stack.addArrangedSubview(renew)
            } else {
                stack.addArrangedSubview(label("Open op de tablet of telefoon (op hetzelfde netwerk) een van deze adressen. Het eerste apparaat dat je opent vraagt toestemming op deze Mac.", secondary: true))
                for u in [podiumName, podiumURL] { stack.addArrangedSubview(label(u, selectable: true)) }
                stack.addArrangedSubview(qrBox("Podium", podiumURL))
            }
        } else {
            stack.addArrangedSubview(label("Uit. Zet het aan om het Podium en de bediening rechtstreeks vanaf deze Mac te kunnen gebruiken, ook als de server of de NAS uitvalt.", secondary: true))
        }
        let list = LanDevices.list
        stack.addArrangedSubview(label("Gekoppelde apparaten (\(list.count))").withBold())
        let df = DateFormatter(); df.dateStyle = .short; df.timeStyle = .short
        for d in list {
            let row = NSStackView(); row.orientation = .horizontal; row.spacing = 8
            row.addArrangedSubview(NSTextField(labelWithString: "\(d.name) · laatst gezien \(df.string(from: d.lastSeen))"))
            let b = NSButton(title: "Intrekken", target: self, action: #selector(revoke(_:))); b.identifier = NSUserInterfaceItemIdentifier(d.id)
            row.addArrangedSubview(b)
            stack.addArrangedSubview(row)
        }
        if list.isEmpty { stack.addArrangedSubview(label("Nog geen.", secondary: true)) }
        stack.addArrangedSubview(label(ShellSettings.lanTLS
            ? "Het verkeer is versleuteld (https). De sleutel van het certificaat staat alleen in de Keychain van deze Mac en het certificaat werkt alleen voor lokale namen (.local en privé-adressen). Een gekoppeld apparaat kan spelen, springen en de mix en pads bedienen; instellingen en opnemen zijn niet bereikbaar."
            : "Let op: zonder https is de verbinding niet versleuteld. Gebruik hem alleen op een netwerk dat je vertrouwt; zolang gasten op hetzelfde netwerk zitten kunnen zij het verkeer in principe meelezen.", secondary: true))
        w?.setContentSize(NSSize(width: 520, height: max(300, stack.fittingSize.height)))
    }

    @objc func toggle(_ s: NSButton) { ShellSettings.lan = s.state == .on; app.remote.refresh(); rebuild() }
    @objc func toggleTLS(_ s: NSButton) { ShellSettings.lanTLS = s.state == .on; app.remote.refresh(); rebuild() }
    @objc func renewCA() {
        let a = NSAlert()
        a.messageText = "Nieuw certificaat maken?"
        a.informativeText = "Alle apparaten moeten het nieuwe certificaat opnieuw installeren. Doe dit alleen als je denkt dat het oude niet meer veilig is (bijvoorbeeld als de Mac is overgedragen)."
        a.addButton(withTitle: "Nieuw certificaat"); a.addButton(withTitle: "Annuleer")
        guard a.runModal() == .alertFirstButtonReturn else { return }
        LocalCA.reset(); app.remote.removeAll(); app.remote.refresh(); rebuild()
    }
    @objc func applyPort(_ s: NSButton) {
        if let f = (s.superview as? NSStackView)?.arrangedSubviews.first(where: { ($0 as? NSTextField)?.tag == 7 }) as? NSTextField, let p = Int(f.stringValue), (1024...65535).contains(p) {
            ShellSettings.lanPort = p; app.remote.refresh()
        } else { NSSound.beep() }
        rebuild()
    }
    @objc func revoke(_ s: NSButton) { if let id = s.identifier?.rawValue { app.remote.remove(id) }; rebuild() }
    func windowDidBecomeKey(_ n: Notification) { app.remote.reloadDevices() }
}

private extension NSTextField {
    func withBold() -> NSTextField { font = NSFont.boldSystemFont(ofSize: NSFont.systemFontSize); return self }
    func colored(_ c: NSColor) -> NSTextField { textColor = c; return self }
}
