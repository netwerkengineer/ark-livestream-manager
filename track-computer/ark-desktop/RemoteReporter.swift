// Afstandsbediening via de server: de stand van de speler gaat een paar keer per seconde naar de server, zodat het Podium
// (tablet, telefoon) hem ziet. Dit gebeurt hier in het programma en niet in de webpagina: een venster dat op de achtergrond
// staat of bedekt is, wordt door macOS afgeknepen en zou dan als "niet verbonden" te boek staan terwijl de muziek gewoon speelt.
// De commando's van het Podium komen wel via de pagina binnen (die voert ze uit met de bestaande code); zie remoteLink.ts.

import Foundation

final class RemoteReporter {
    unowned let app: AppDelegate
    let queue = DispatchQueue(label: "ark.remote", qos: .utility)
    var timer: DispatchSourceTimer?
    var inflight = false
    var failures = 0
    var nextTry = Date.distantPast
    var cookie = "", cookieAt = Date.distantPast
    var lastPlaying = false
    var pokeNow = false                // na een commando meteen de nieuwe stand melden (binnen de limiet)
    var reported = false              // de server kent deze app pas na de eerste melding
    var listening = false
    var listenFails = 0
    var session: URLSession?

    init(app: AppDelegate) { self.app = app }

    /// Het id van deze app (bewaard bij de eigen instellingen van de pagina, zodat pagina en programma hetzelfde id gebruiken)
    static func playerId() -> String {
        if let id = LocalStore.values["ark-player-id"], !id.isEmpty { return id }
        let id = UUID().uuidString
        LocalStore.values["ark-player-id"] = id; LocalStore.save()
        return id
    }

    func refresh() {
        stop()
        guard ShellSettings.remote, !ShellSettings.offline, !ShellSettings.server.isEmpty, !LocalRemote.testMode else { return }
        failures = 0; nextTry = .distantPast; reported = false; listenFails = 0
        if !listening { listening = true; queue.asyncAfter(deadline: .now() + 1) { [weak self] in self?.listen() } }
        let t = DispatchSource.makeTimerSource(queue: queue)
        t.schedule(deadline: .now() + 1, repeating: .milliseconds(250))
        t.setEventHandler { [weak self] in self?.tick() }
        t.resume(); timer = t
    }
    func stop() { timer?.cancel(); timer = nil; session?.invalidateAndCancel(); session = nil }

    private func tick() {
        guard !inflight, Date() >= nextTry else { return }
        // De proxy voor de server staat maximaal 2 verzoeken per seconde per route toe (meer = 429, en te veel 429's = het adres wordt
        // geblokkeerd). Daar blijven we ruim onder: tijdens het spelen elke 0,8 s, anders elke 2 s, en na een commando zo snel mogelijk maar
        // nooit binnen 0,7 s na de vorige melding.
        let since = Date().timeIntervalSince(lastSent)
        if since < 0.7 { return }
        if !pokeNow && since < (lastPlaying ? 0.8 : 2.0) { return }
        pokeNow = false
        inflight = true
        let base = ShellSettings.server.trimmingCharacters(in: CharacterSet(charactersIn: "/ "))
        guard let url = URL(string: base + "/api/desktop-link/state") else { inflight = false; return }
        if Date().timeIntervalSince(cookieAt) > 30 { cookie = app.fetcher.cookieHeader(for: url); cookieAt = Date() }
        let state = app.engine.handle("GET", "/state", [:]).1
        let library = app.engine.handle("GET", "/library", [:]).1
        lastPlaying = state.contains("\"state\":\"playing\"")
        let player = (try? String(data: JSONSerialization.data(withJSONObject: ["id": RemoteReporter.playerId(), "name": ShellSettings.deviceName]), encoding: .utf8)) ?? "{}"
        var req = URLRequest(url: url, timeoutInterval: 5)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(cookie, forHTTPHeaderField: "Cookie")
        req.setValue("Version/17.0 Safari/605.1.15 ArkTracksDesktop", forHTTPHeaderField: "User-Agent")
        req.httpBody = "{\"player\":\(player),\"engine\":\(state),\"library\":\(library)}".data(using: .utf8)
        lastSent = Date()
        URLSession.shared.dataTask(with: req) { [weak self] _, resp, err in
            guard let self = self else { return }
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            if err == nil && code == 200 { self.failures = 0; self.reported = true }
            else {
                self.failures += 1
                self.cookieAt = .distantPast                                      // na inloggen in het venster is de cookie anders
                // Een afgewezen verzoek (niet ingelogd, geen toegang) telt bij de proxy voor de server als "bad behavior": een paar
                // per minuut en het adres van deze Mac wordt geblokkeerd. Dus na een afwijzing lang wachten, en steeds langer.
                let rejected = code != 0 && code != 200
                // 429 = even te snel geweest: kort wachten; andere afwijzingen (niet ingelogd, geen toegang): lang
                self.nextTry = Date().addingTimeInterval(code == 429 ? 8 : rejected ? min(600, 30 * pow(2, Double(min(self.failures, 5) - 1))) : min(30, Double(self.failures) * 2))
            }
            self.inflight = false
        }.resume()
    }
    var lastSent = Date.distantPast
}


// ---- commando's van het Podium: de verbinding met de server (SSE) en het uitvoeren, allemaal hier en niet in de webpagina
final class CommandListener: NSObject, URLSessionDataDelegate {
    var onEvent: ((String, String) -> Void)?
    var onDone: ((Int, Bool) -> Void)?
    var buffer = ""
    var status = 0, opened = false

    func urlSession(_ s: URLSession, dataTask: URLSessionDataTask, didReceive r: URLResponse, completionHandler ch: @escaping (URLSession.ResponseDisposition) -> Void) {
        status = (r as? HTTPURLResponse)?.statusCode ?? 0
        opened = status == 200
        ch(opened ? .allow : .cancel)
    }
    func urlSession(_ s: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        buffer += String(decoding: data, as: UTF8.self)
        while let r = buffer.range(of: "\n\n") {
            let block = String(buffer[..<r.lowerBound]); buffer.removeSubrange(..<r.upperBound)
            var name = "message", payload = ""
            for line in block.split(separator: "\n", omittingEmptySubsequences: true) {
                if line.hasPrefix("event:") { name = line.dropFirst(6).trimmingCharacters(in: .whitespaces) }
                else if line.hasPrefix("data:") { payload += line.dropFirst(5).trimmingCharacters(in: .whitespaces) }
            }
            if !payload.isEmpty || name != "message" { onEvent?(name, payload) }
        }
    }
    func urlSession(_ s: URLSession, task: URLSessionTask, didCompleteWithError e: Error?) { onDone?(status, opened) }
}

extension RemoteReporter {
    func listen() {
        guard ShellSettings.remote, !ShellSettings.offline, !ShellSettings.server.isEmpty else { listening = false; return }
        func again(_ seconds: Double) { queue.asyncAfter(deadline: .now() + seconds) { [weak self] in self?.listen() } }
        guard reported else { again(1); return }
        let base = ShellSettings.server.trimmingCharacters(in: CharacterSet(charactersIn: "/ "))
        let id = RemoteReporter.playerId()
        guard let url = URL(string: base + "/api/desktop-link/commands?kinds=reaper&player=" + (id.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? id)) else { again(30); return }
        var req = URLRequest(url: url, timeoutInterval: 3600)
        req.setValue(cookie, forHTTPHeaderField: "Cookie")
        req.setValue("Version/17.0 Safari/605.1.15 ArkTracksDesktop", forHTTPHeaderField: "User-Agent")
        req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        let l = CommandListener()
        l.onEvent = { [weak self] name, data in if name == "cmd" { self?.handle(data) } }
        l.onDone = { [weak self] status, opened in
            guard let self = self else { return }
            // een geweigerde verbinding telt bij de proxy voor de server als "bad behavior": dan lang wachten, steeds langer
            self.listenFails = opened ? 0 : self.listenFails + 1
            if !opened { self.cookieAt = .distantPast }
            let rejected = status != 0 && status != 200
            again(self.listenFails == 0 ? 1.5 : (rejected ? min(600, 30 * pow(2, Double(min(self.listenFails, 5) - 1))) : min(30, Double(self.listenFails) * 2)))
        }
        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest = 3600; cfg.timeoutIntervalForResource = 24 * 3600
        let sess = URLSession(configuration: cfg, delegate: l, delegateQueue: nil)
        session = sess
        sess.dataTask(with: req).resume()
    }

    private func handle(_ data: String) {
        guard let d = data.data(using: .utf8), let c = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
              let id = c["id"] as? String, c["kind"] as? String == "reaper", let body = c["body"] as? [String: Any] else { return }
        DispatchQueue.main.async { [self] in            // de speler wordt vanaf de hoofdthread bediend, zoals ook vanuit de pagina
            let (ok, err) = execute(body)
            pokeNow = true
            ack(id, ok, err)
        }
    }

    private func ack(_ id: String, _ ok: Bool, _ error: String) {
        let base = ShellSettings.server.trimmingCharacters(in: CharacterSet(charactersIn: "/ "))
        guard let url = URL(string: base + "/api/desktop-link/ack") else { return }
        var req = URLRequest(url: url, timeoutInterval: 5)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(cookie, forHTTPHeaderField: "Cookie")
        req.setValue("Version/17.0 Safari/605.1.15 ArkTracksDesktop", forHTTPHeaderField: "User-Agent")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["player": RemoteReporter.playerId(), "id": id, "ok": ok, "error": error])
        URLSession.shared.dataTask(with: req).resume()
    }

    /// Voert een commando van het Podium uit: dezelfde vertaling als de pagina (desktopEngine.ts), maar direct op de speler.
    /// Alleen de vaste lijst; een onbekende actie wordt geweigerd.
    func execute(_ b: [String: Any]) -> (Bool, String) {
        let e = app.engine!
        func call(_ path: String, _ qs: [String: String] = [:]) -> (Bool, String) {
            let r = e.handle("GET", path, qs)
            if (200...299).contains(r.0) { return (true, "") }
            let msg = ((try? JSONSerialization.jsonObject(with: Data(r.1.utf8))) as? [String: Any])?["error"] as? String
            return (false, msg ?? "Mislukt")
        }
        func num(_ k: String) -> Double? {
            if let n = b[k] as? NSNumber { return CFGetTypeID(n) == CFBooleanGetTypeID() ? nil : n.doubleValue }
            if let s = b[k] as? String { return Double(s) }
            return nil
        }
        func on(_ k: String) -> String {                     // een schakelaar: ontbreekt hij, dan "aan"
            guard let v = b[k], !(v is NSNull) else { return "1" }
            if let n = v as? NSNumber { return n.doubleValue != 0 ? "1" : "0" }
            return "1"
        }
        func db(_ v: Double, floor: Double) -> String { v <= 0 ? String(floor) : String(20 * log10(v)) }
        guard let action = b["action"] as? String else { return (false, "Onbekende actie") }
        switch action {
        case "play", "pause", "stop": return call("/" + action)
        case "start": return call("/seek", ["t": "0"])
        case "seek":
            guard let t = num("pos"), t.isFinite else { return (false, "Ongeldige positie") }
            return call("/seek", ["t": String(t)])
        case "unmuteAll": return call("/unmute")
        case "songCancel": return call("/songcancel")
        case "mode":
            guard let m = b["mode"] as? String, ["end", "bar", "now"].contains(m) else { return (false, "Ongeldige modus") }
            return call("/mode", ["m": m])
        case "loop":
            return call("/loop", ["on": (b["value"] as? NSNumber)?.boolValue == true ? "1" : "0"])
        case "jump":
            guard let region = num("region") else { return (false, "Sectie niet gevonden") }
            let secs = app.engine.state()["sections"] as? [[String: Any]] ?? []
            guard let s = secs.first(where: { ($0["region"] as? Int) == Int(region) }), let idx = s["id"] as? Int else { return (false, "Sectie niet gevonden") }
            var qs = ["id": String(idx)]
            if let m = b["mode"] as? String, ["end", "bar", "now"].contains(m) { qs["mode"] = m }
            return call("/jump", qs)
        case "song":
            guard let p = b["path"] as? String, !p.isEmpty else { return (false, "Onbekende song") }
            if let m = b["mode"] as? String, ["end", "bar", "now"].contains(m) { return call("/song", ["path": p, "mode": m]) }
            return call("/load", ["path": p])
        case "master":
            var qs: [String: String] = [:]
            if let v = num("value"), v.isFinite { qs["db"] = db(v, floor: -90) }
            if b["mute"] != nil { qs["mute"] = on("mute") }
            return call("/master", qs)
        case "volume", "mute", "solo":
            guard let track = num("track"), track >= 1, track <= 1024 else { return (false, "Ongeldig tracknummer") }
            // tracknummers zoals de pagina ze telt: per bus eerst de bus zelf, dan zijn stems
            let st = app.engine.state()
            let busses = st["busses"] as? [[String: Any]] ?? [], stems = st["stems"] as? [[String: Any]] ?? []
            var k = 1
            var found: (isBus: Bool, bus: Int, name: String)?
            outer: for bus in busses {
                let n = bus["bus"] as? Int ?? 0
                if k == Int(track) { found = (true, n, ""); break outer }
                k += 1
                for s in stems where (s["bus"] as? Int) == n {
                    if k == Int(track) { found = (false, n, s["name"] as? String ?? ""); break outer }
                    k += 1
                }
            }
            guard let f = found else { return (false, "Ongeldig tracknummer") }
            if action == "volume" {
                guard let v = num("value"), v.isFinite, v >= 0, v <= 4 else { return (false, "Ongeldig volume") }
                return f.isBus ? call("/group", ["bus": String(f.bus), "gain": String(v)]) : call("/gain", ["stem": f.name, "db": db(v, floor: -150)])
            }
            let flag = on("value")
            return f.isBus ? call("/group", ["bus": String(f.bus), action: flag]) : call(action == "mute" ? "/mute" : "/solo", ["stem": f.name, "on": flag])
        case "pad":
            guard let v = b["value"] as? [String: Any], let op = v["op"] as? String, ["play", "stop", "volume"].contains(op) else { return (false, "Onbekende pad-actie") }
            var qs = ["op": op]
            for key in ["set", "layer", "key"] { if let s = v[key] as? String { qs[key] = s } }
            for key in ["fade", "volume"] { if let n = v[key] as? NSNumber { qs[key] = String(n.doubleValue) } }
            return call("/pad", qs)
        default: return (false, "Deze actie kan niet vanaf afstand")
        }
    }
}
