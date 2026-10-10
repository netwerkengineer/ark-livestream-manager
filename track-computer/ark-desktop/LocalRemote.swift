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
    var testAutoAllow = false                       // alleen voor de proef (--lan-test): zonder venster toestaan
    var lastSave = Date.distantPast
    var devices: [LanDevice] = []
    var devicesLoaded = false                       // de Keychain pas aanspreken als er een apparaat komt, niet bij het opstarten
    static let testMode = CommandLine.arguments.contains { $0.hasSuffix("-test") }     // proeven zonder venster raken de echte instellingen niet aan

    init(app: AppDelegate) { self.app = app }

    // engine-opdrachten die vanaf het netwerk mogen (geen instellingen, opnemen of bestanden)
    static let allowed: Set<String> = ["/state", "/library", "/play", "/pause", "/stop", "/seek", "/mute", "/solo", "/gain", "/group", "/unmute",
                                       "/master", "/jump", "/loop", "/mode", "/load", "/song", "/songcancel", "/setlist", "/pad"]

    func refresh() {
        stop()
        guard ShellSettings.lan, !LocalRemote.testMode else { return }
        start(port: ShellSettings.lanPort)
    }
    func start(port p: Int) {
        devicesLoaded = false
        guard let port = NWEndpoint.Port(rawValue: UInt16(clamping: p)) else { return }
        do {
            let l = try NWListener(using: .tcp, on: port)
            l.newConnectionHandler = { [weak self] c in self?.accept(c) }
            l.stateUpdateHandler = { st in
                if case .failed(let e) = st { log("Lokale bediening: poort \(port) niet beschikbaar: \(e)") }
                if case .ready = st { log("Lokale bediening aan op poort \(port)") }
                if case .waiting(let e) = st { log("Lokale bediening wacht: \(e) (staat de firewall of \"Lokaal netwerk\" in de weg?)") }
            }
            l.start(queue: q)
            listener = l
        } catch { log("Lokale bediening starten mislukt: \(error.localizedDescription)") }
    }
    func stop() { listener?.cancel(); listener = nil }

    // ---- een verzoek inlezen
    private struct Request { var method = "", target = "", headers: [String: String] = [:], body = Data(), ip = "" }

    private func accept(_ c: NWConnection) {
        c.start(queue: q)
        var ip = ""
        if case .hostPort(let host, _) = c.endpoint { ip = "\(host)".components(separatedBy: "%").first ?? "" }
        q.asyncAfter(deadline: .now() + 120) { c.cancel() }                // niets blijft eeuwig open
        read(c, Data(), ip)
    }

    private func read(_ c: NWConnection, _ buf: Data, _ ip: String) {
        c.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, done, err in
            guard let self = self else { return }
            var b = buf; if let d = data { b.append(d) }
            if b.count > 1_000_000 || err != nil { c.cancel(); return }
            if let end = b.range(of: Data("\r\n\r\n".utf8)) {
                let head = String(decoding: b[..<end.lowerBound], as: UTF8.self)
                var lines = head.components(separatedBy: "\r\n")
                let first = lines.removeFirst().split(separator: " ")
                guard first.count >= 2 else { c.cancel(); return }
                var req = Request(); req.method = String(first[0]); req.target = String(first[1]); req.ip = ip
                for l in lines { if let i = l.firstIndex(of: ":") { req.headers[l[..<i].lowercased()] = l[l.index(after: i)...].trimmingCharacters(in: .whitespaces) } }
                let need = Int(req.headers["content-length"] ?? "0") ?? 0
                let have = b.count - end.upperBound
                if have >= need { req.body = b[end.upperBound..<(end.upperBound + need)]; self.route(c, req); return }
            }
            if done { c.cancel() } else { self.read(c, b, ip) }
        }
    }

    // ---- antwoorden
    private func send(_ c: NWConnection, _ status: Int, _ type: String, _ body: Data, cache: Bool = false) {
        let names = [200: "OK", 202: "Accepted", 302: "Found", 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 408: "Request Timeout", 429: "Too Many Requests"]
        let head = "HTTP/1.1 \(status) \(names[status] ?? "OK")\r\nContent-Type: \(type)\r\nContent-Length: \(body.count)\r\nCache-Control: \(cache ? "max-age=3600" : "no-store")\r\nConnection: close\r\nX-Content-Type-Options: nosniff\r\n\r\n"
        var d = Data(head.utf8); d.append(body)
        c.send(content: d, completion: .contentProcessed { _ in c.cancel() })
    }
    private func json(_ c: NWConnection, _ status: Int, _ obj: Any) {
        send(c, status, "application/json", (try? JSONSerialization.data(withJSONObject: obj)) ?? Data("{}".utf8))
    }

    // ---- routes
    private func route(_ c: NWConnection, _ r: Request) {
        guard let comps = URLComponents(string: r.target) else { c.cancel(); return }
        let path = comps.path
        if r.method == "GET" && (path == "/" || path == "/podium") { return redirect(c, "/tracks") }
        if r.method == "GET" && path == "/mixer" { return redirect(c, "/desktop") }
        if r.method == "GET" && path == "/tracks" { return page(c, "tracks.html") }
        if r.method == "GET" && path == "/desktop" { return page(c, "desktop.html") }       // het volledige Tracks-scherm met de mixer
        if r.method == "GET" && path.hasPrefix("/_next/static/") { return file(c, path) }
        if r.method == "POST" && path == "/_pair" { return pair(c, r) }
        if r.method == "GET" && path == "/api/auth/session" { return json(c, 200, [String: String]()) }      // de pagina vraagt om een inlogsessie: die is er hier niet
        // alles hieronder alleen met een sleutel van een gekoppeld apparaat
        guard let dev = authorize(r) else { return json(c, 401, ["error": "Niet gekoppeld"]) }
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
        c.send(content: Data(head.utf8), completion: .contentProcessed { _ in c.cancel() })
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
        let shim = "<script>" + LocalRemote.shim(hostName: ShellSettings.deviceName) + "</script>"
        if let r = html.range(of: "<head>") { html.insert(contentsOf: shim, at: r.upperBound) } else { html = shim + html }
        send(c, 200, "text/html; charset=utf-8", Data(html.utf8))
    }

    private func file(_ c: NWConnection, _ path: String) {
        let decoded = path.removingPercentEncoding ?? path
        guard !decoded.contains(".."), let d = try? Data(contentsOf: OfflineMirror.dir.appendingPathComponent(decoded)) else { return json(c, 404, ["error": "niet gevonden"]) }
        let ext = (decoded as NSString).pathExtension.lowercased()
        send(c, 200, OfflineScheme.types[ext] ?? "application/octet-stream", d, cache: true)
    }

    // ---- apparaten
    private func authorize(_ r: Request) -> LanDevice? {
        if !devicesLoaded { devices = LanDevices.list; devicesLoaded = true }
        guard let h = r.headers["authorization"], h.hasPrefix("Bearer ") else { return nil }
        let hash = LanDevices.hash(String(h.dropFirst(7)))
        guard let i = devices.firstIndex(where: { $0.hash == hash }) else { return nil }
        devices[i].lastSeen = Date()
        if Date().timeIntervalSince(lastSave) > 60 { lastSave = Date(); LanDevices.list = devices }
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
                    if !devicesLoaded { devices = LanDevices.list; devicesLoaded = true }
                    devices.append(LanDevice(id: UUID().uuidString, name: name, hash: LanDevices.hash(token), created: Date(), lastSeen: Date()))
                    LanDevices.list = devices
                    json(c, 200, ["token": token])
                } else { json(c, 403, ["error": "Geweigerd"]) }
            }
        }
        if testAutoAllow { finish(true); return }
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
    func remove(_ id: String) { q.async { [self] in if !devicesLoaded { devices = LanDevices.list; devicesLoaded = true }; devices.removeAll { $0.id == id }; LanDevices.list = devices } }
    func removeAll() { q.async { [self] in devices = []; devicesLoaded = true; LanDevices.list = [] } }
    func reloadDevices() { q.async { [self] in devices = LanDevices.list; devicesLoaded = true } }

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
          async function call(path, params) {
            const qs = new URLSearchParams();
            for (const [k, v] of Object.entries(params || {})) {
              if (Array.isArray(v)) v.forEach(x => qs.append(k, x));
              else if (v !== undefined && v !== null) qs.append(k, typeof v === "boolean" ? (v ? "1" : "0") : String(v));
            }
            const r = await fetch("/_engine" + path + (qs.toString() ? "?" + qs : ""), { headers: auth() });
            if (r.status === 401) { pair(); throw new Error("Niet gekoppeld"); }
            return r.json();
          }
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
        on.state = ShellSettings.lan ? .on : .off
        stack.addArrangedSubview(on)
        let portRow = NSStackView(); portRow.orientation = .horizontal; portRow.spacing = 8
        let port = NSTextField(string: String(ShellSettings.lanPort)); port.frame.size.width = 70; port.tag = 7
        portRow.addArrangedSubview(NSTextField(labelWithString: "Poort"))
        portRow.addArrangedSubview(port)
        let apply = NSButton(title: "Pas toe", target: self, action: #selector(applyPort(_:)))
        portRow.addArrangedSubview(apply)
        stack.addArrangedSubview(portRow)
        if ShellSettings.lan {
            let host = (ProcessInfo.processInfo.hostName.hasSuffix(".local") ? ProcessInfo.processInfo.hostName : ProcessInfo.processInfo.hostName + ".local")
            var urls = ["http://\(host):\(ShellSettings.lanPort)/tracks"]
            urls += LanWindow.localIPs().map { "http://\($0):\(ShellSettings.lanPort)/tracks" }
            stack.addArrangedSubview(label("Open op de tablet of telefoon (op hetzelfde netwerk) een van deze adressen. Het eerste apparaat dat je opent vraagt toestemming op deze Mac.", secondary: true))
            for u in urls { stack.addArrangedSubview(label(u, selectable: true)) }
            if let img = LanWindow.qr(urls.last ?? urls[0]) {
                let iv = NSImageView(image: img); iv.imageScaling = .scaleProportionallyUpOrDown
                iv.widthAnchor.constraint(equalToConstant: 160).isActive = true; iv.heightAnchor.constraint(equalToConstant: 160).isActive = true
                stack.addArrangedSubview(iv)
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
        stack.addArrangedSubview(label("Let op: deze verbinding is niet versleuteld (http). Gebruik hem alleen op een netwerk dat je vertrouwt; zolang gasten op hetzelfde netwerk zitten kunnen zij het verkeer in principe meelezen. Een gekoppeld apparaat kan spelen, springen en de mix en pads bedienen; instellingen en opnemen zijn niet bereikbaar.", secondary: true))
        w?.setContentSize(NSSize(width: 520, height: max(300, stack.fittingSize.height)))
    }

    @objc func toggle(_ s: NSButton) { ShellSettings.lan = s.state == .on; app.remote.refresh(); rebuild() }
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
}
