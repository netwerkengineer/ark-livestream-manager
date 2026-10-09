// Ark Tracks Desktop - een eigen venster voor Tracks en Oefenen van de webapp, met de eigen speler (ark-player) erin.
//
// - Toont de pagina /desktop van de webapp (Tracks + Oefenen).
// - Speelt de tracks zelf af (ark-player zit in dit programma) op het gekozen audioapparaat, bijvoorbeeld de X-USB van de X32.
// - Geen vaste adressen in de code: server, audioapparaat, nummermap en FreeShow-adres staan in Instellingen (⌘,).
//
// De webpagina praat met de speler via window.arkEngine (zie injectedScript). Bouwen: ./build-app.sh

import Cocoa
import WebKit
import AVFoundation
import CoreAudio
import Security

let appName = "Ark Tracks"

/// De sleutel van de beheerder staat in de Keychain, niet in een gewoon bestand
enum Keychain {
    static let service = "nl.arkchurch.tracks-desktop"
    static func get(_ account: String) -> String {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account,
                                kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return "" }
        return String(data: d, encoding: .utf8) ?? ""
    }
    static func set(_ account: String, _ value: String) {
        let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        SecItemDelete(base as CFDictionary)
        if value.isEmpty { return }
        var add = base; add[kSecValueData as String] = Data(value.utf8)
        SecItemAdd(add as CFDictionary, nil)
    }
}

/// Instellingen van de schil (de rest staat in de config van de speler)
struct ShellSettings {
    static var key: String {
        get { Keychain.get("desktop-key") }
        set { Keychain.set("desktop-key", newValue) }
    }
    static var server: String {
        get { UserDefaults.standard.string(forKey: "server") ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: "server") }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandlerWithReply {
    var window: NSWindow!
    var web: WKWebView!
    var settingsWindow: SettingsWindow?

    // de speler (dezelfde code als ark-player)
    let mixer = Mixer()
    var output: Output!
    var player: Player!
    var engine: Server!

    var audioTest = CommandLine.arguments.contains("--audio-test")

    func applicationDidFinishLaunching(_ n: Notification) {
        output = Output(mixer: mixer)
        player = Player(mixer: mixer, output: output)
        player.start()
        engine = Server(player: player)
        do { try output.start(device: player.cfg.device.isEmpty ? nil : player.cfg.device) } catch { log("Audio starten mislukt: \(error.localizedDescription)") }

        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default()                       // inloggen blijft bewaard
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.applicationNameForUserAgent = "Version/17.0 Safari/605.1.15 ArkTracksDesktop"
        cfg.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "engine")
        cfg.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "shellcall")
        cfg.userContentController.add(WeakHandler(self), name: "shell")
        cfg.userContentController.addUserScript(WKUserScript(source: injectedScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        web = WKWebView(frame: .zero, configuration: cfg)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = true
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 860),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = appName
        window.contentView = web
        window.setFrameAutosaveName("ArkTracksMain")
        if !window.setFrameUsingName("ArkTracksMain") { window.center() }
        window.makeKeyAndOrderFront(nil)
        buildMenu()
        NSApp.activate(ignoringOtherApps: true)
        if audioTest { runAudioTest(); return }
        if ShellSettings.server.isEmpty { showSettings(firstRun: true) } else { load() }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

    // ---- de speler voor de webpagina
    var injectedScript: String { """
    window.arkDesktop = {
      version: "0.3",
      server: \(jsString(ShellSettings.server)),
      openSettings: () => window.webkit.messageHandlers.shell.postMessage({ action: "settings" }),
      openExternal: (url) => window.webkit.messageHandlers.shell.postMessage({ action: "openExternal", url }),
      chooseFolder: async () => JSON.parse(await window.webkit.messageHandlers.shellcall.postMessage({ action: "chooseFolder" })),
      getConnection: async () => JSON.parse(await window.webkit.messageHandlers.shellcall.postMessage({ action: "getConnection" })),
      // wijzigt het adres van de server en/of de sleutel (key weglaten = sleutel laten zoals hij is) en laadt de pagina opnieuw
      setConnection: (server, key) => window.webkit.messageHandlers.shellcall.postMessage({ action: "setConnection", server, key }),
    };
    window.arkEngine = {
      available: true,
      // path: bijvoorbeeld "/state" of "/jump"; params: { id: 3, mode: "bar" } (een lijst geeft herhaalde sleutels); geeft het JSON-antwoord terug
      call: async (path, params) => {
        const r = await window.webkit.messageHandlers.engine.postMessage({ path, params: params || {} });
        return JSON.parse(r);
      },
    };
    """ }

    func jsString(_ s: String) -> String {
        (try? String(data: JSONSerialization.data(withJSONObject: [s]), encoding: .utf8)).flatMap { String($0.dropFirst().dropLast()) } ?? "\"\""
    }

    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        if m.name == "shellcall" {
            if let b = m.body as? [String: Any], b["action"] as? String == "chooseFolder" {
                let panel = NSOpenPanel(); panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.prompt = "Kies"
                let ok = panel.runModal() == .OK
                replyHandler(jsonString(["path": ok ? (panel.url?.path ?? "") : ""]), nil)
            } else if let b = m.body as? [String: Any], b["action"] as? String == "getConnection" {
                replyHandler(jsonString(["server": ShellSettings.server, "hasKey": !ShellSettings.key.isEmpty]), nil)
            } else if let b = m.body as? [String: Any], b["action"] as? String == "setConnection" {
                var v = ((b["server"] as? String) ?? "").trimmingCharacters(in: .whitespaces)
                if !v.isEmpty && !v.hasPrefix("http") { v = "https://" + v }
                if !v.isEmpty { ShellSettings.server = v }
                if let k = b["key"] as? String { ShellSettings.key = k.trimmingCharacters(in: .whitespaces) }
                replyHandler(jsonString(["ok": true]), nil)
                DispatchQueue.main.async { [self] in load() }
            } else { replyHandler(nil, "onbekend") }
            return
        }
        guard let body = m.body as? [String: Any], let path = body["path"] as? String else { replyHandler(nil, "ongeldig verzoek"); return }
        var qs: [String: String] = [:]
        var items: [URLQueryItem] = []
        for (k, v) in (body["params"] as? [String: Any] ?? [:]) {
            if let list = v as? [Any] { for x in list { items.append(URLQueryItem(name: k, value: "\(x)")) } }
            else if let n = v as? NSNumber, CFGetTypeID(n) == CFBooleanGetTypeID() { qs[k] = n.boolValue ? "1" : "0"; items.append(URLQueryItem(name: k, value: qs[k])) }
            else { qs[k] = "\(v)"; items.append(URLQueryItem(name: k, value: qs[k])) }
        }
        let res = engine.handle("GET", path, qs, items)
        replyHandler(res.1, nil)
    }

    final class WeakHandler: NSObject, WKScriptMessageHandler {
        weak var d: AppDelegate?
        init(_ d: AppDelegate) { self.d = d }
        func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
            guard let b = m.body as? [String: Any] else { return }
            if b["action"] as? String == "settings" { d?.showSettings(firstRun: false) }
            if b["action"] as? String == "openExternal", let u = (b["url"] as? String).flatMap(URL.init(string:)), u.scheme == "https" || u.scheme == "http" { NSWorkspace.shared.open(u) }
        }
    }

    // ---- laden
    func load() {
        let base = ShellSettings.server.trimmingCharacters(in: CharacterSet(charactersIn: "/ "))
        guard let url = URL(string: base + "/desktop") else { showSettings(firstRun: true); return }
        installKeyCookie(for: url) { [self] in web.load(URLRequest(url: url)) }
    }

    /// De sleutel gaat als cookie mee naar de server (alleen deze app zet hem): zonder dat bestaat /desktop daar niet
    func installKeyCookie(for url: URL, then done: @escaping () -> Void) {
        let store = web.configuration.websiteDataStore.httpCookieStore
        guard let host = url.host else { done(); return }
        store.getAllCookies { cookies in
            let old = cookies.filter { $0.name == "ark_desktop" && $0.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")) == host }
            let remaining = DispatchGroup()
            for c in old { remaining.enter(); store.delete(c) { remaining.leave() } }
            remaining.notify(queue: .main) {
                let key = ShellSettings.key
                guard !key.isEmpty else { done(); return }
                var props: [HTTPCookiePropertyKey: Any] = [.name: "ark_desktop", .value: key, .domain: host, .path: "/", .expires: Date(timeIntervalSinceNow: 365 * 86400)]
                if url.scheme == "https" { props[.secure] = "TRUE" }
                props[HTTPCookiePropertyKey("HttpOnly")] = "TRUE"
                if let c = HTTPCookie(properties: props) { store.setCookie(c) { done() } } else { done() }
            }
        }
    }

    /// Het kleine verbindingsvenster (adres en sleutel van de server)
    func showSettings(firstRun: Bool) {
        if settingsWindow == nil {
            settingsWindow = SettingsWindow(app: self)
        }
        settingsWindow?.show(firstRun: firstRun)
    }

    /// Instellingen toegepast: speler en venster bijwerken
    func settingsChanged(serverChanged: Bool) {
        player.cfg.save()
        do { try output.start(device: player.cfg.device.isEmpty ? nil : player.cfg.device) } catch { log("Audio starten mislukt: \(error.localizedDescription)") }
        if serverChanged || web.url == nil { load() }
    }

    // ---- menu
    func buildMenu() {
        let main = NSMenu()
        func item(_ title: String, _ action: Selector?, _ key: String = "", target: AnyObject? = nil) -> NSMenuItem {
            let i = NSMenuItem(title: title, action: action, keyEquivalent: key); i.target = target; return i
        }
        let appMenu = NSMenu()
        appMenu.addItem(item("Over \(appName)", #selector(NSApplication.orderFrontStandardAboutPanel(_:))))
        appMenu.addItem(.separator())
        appMenu.addItem(item("Instellingen…", #selector(openSettings), ",", target: self))
        appMenu.addItem(.separator())
        appMenu.addItem(item("Verberg \(appName)", #selector(NSApplication.hide(_:)), "h"))
        appMenu.addItem(item("Stop \(appName)", #selector(NSApplication.terminate(_:)), "q"))
        let appItem = NSMenuItem(); appItem.submenu = appMenu; main.addItem(appItem)

        let edit = NSMenu(title: "Wijzig")
        edit.addItem(item("Maak ongedaan", Selector(("undo:")), "z"))
        edit.addItem(item("Herhaal", Selector(("redo:")), "Z"))
        edit.addItem(.separator())
        edit.addItem(item("Knip", #selector(NSText.cut(_:)), "x"))
        edit.addItem(item("Kopieer", #selector(NSText.copy(_:)), "c"))
        edit.addItem(item("Plak", #selector(NSText.paste(_:)), "v"))
        edit.addItem(item("Selecteer alles", #selector(NSText.selectAll(_:)), "a"))
        let editItem = NSMenuItem(); editItem.submenu = edit; main.addItem(editItem)

        let view = NSMenu(title: "Weergave")
        view.addItem(item("Ververs", #selector(reload), "r", target: self))
        view.addItem(item("Terug", #selector(goBack), "[", target: self))
        view.addItem(item("Open in browser", #selector(openInBrowser), "", target: self))
        view.addItem(.separator())
        view.addItem(item("Groter", #selector(zoomIn), "+", target: self))
        view.addItem(item("Kleiner", #selector(zoomOut), "-", target: self))
        view.addItem(item("Normale grootte", #selector(zoomReset), "0", target: self))
        let viewItem = NSMenuItem(); viewItem.submenu = view; main.addItem(viewItem)

        let win = NSMenu(title: "Venster")
        win.addItem(item("Minimaliseer", #selector(NSWindow.performMiniaturize(_:)), "m"))
        win.addItem(item("Zoom", #selector(NSWindow.performZoom(_:))))
        let winItem = NSMenuItem(); winItem.submenu = win; main.addItem(winItem)
        NSApp.mainMenu = main
        NSApp.windowsMenu = win
    }

    /// Instellingen: de tab in de app als de pagina geladen is; anders (geen server of niet bereikbaar) het kleine verbindingsvenster
    @objc func openSettings() {
        if web.url?.path.hasPrefix("/desktop") == true {
            web.evaluateJavaScript("window.dispatchEvent(new Event('ark-open-settings'))", completionHandler: nil)
        } else { showSettings(firstRun: false) }
    }
    @objc func reload() { web.reload() }
    @objc func goBack() { if web.canGoBack { web.goBack() } }
    @objc func openInBrowser() { if let u = web.url { NSWorkspace.shared.open(u) } }
    @objc func zoomIn() { web.pageZoom = min(2.5, web.pageZoom + 0.1) }
    @objc func zoomOut() { web.pageZoom = max(0.5, web.pageZoom - 0.1) }
    @objc func zoomReset() { web.pageZoom = 1.0 }

    // ---- navigatie: alles blijft in dit venster (ook het inloggen bij de SSO-server)
    func webView(_ w: WKWebView, createWebViewWith c: WKWebViewConfiguration, for a: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if a.targetFrame == nil { w.load(a.request) }
        return nil
    }
    // na het inloggen stuurt de server naar de beginpagina (het dashboard): van onze eigen server gaan we dan door naar /desktop
    func webView(_ w: WKWebView, decidePolicyFor a: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = a.request.url, a.targetFrame?.isMainFrame ?? true, let base = URL(string: ShellSettings.server),
           url.host == base.host, url.port == base.port, url.path == "" || url.path == "/" {
            decisionHandler(.cancel)
            load()
            return
        }
        decisionHandler(.allow)
    }
    func webView(_ w: WKWebView, decidePolicyFor r: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if r.isForMainFrame, let http = r.response as? HTTPURLResponse, [403, 404].contains(http.statusCode), http.url?.path.hasPrefix("/desktop") == true {
            decisionHandler(.cancel)
            let html = "<body style='font-family:-apple-system;background:#0b1222;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center'><div><h2>De server accepteert deze app niet</h2><p>De sleutel ontbreekt of klopt niet, of de server is niet de goede.<br>Vraag de beheerder om de sleutel (webapp > Instellingen > Tracks) en vul die in bij Ark Tracks > Instellingen… (⌘,).<br>Server: \(ShellSettings.server)</p></div></body>"
            web.loadHTMLString(html, baseURL: nil)
            return
        }
        decisionHandler(.allow)
    }
    func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) { showError(e) }
    func webView(_ w: WKWebView, didFail n: WKNavigation!, withError e: Error) { showError(e) }
    func showError(_ e: Error) {
        // -999 = een navigatie werd vervangen door een volgende (een redirect, ook naar het inloggen): geen fout
        if (e as NSError).code == NSURLErrorCancelled { return }
        let html = "<body style='font-family:-apple-system;background:#0b1222;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center'><div><h2>Kan de server niet bereiken</h2><p>\(e.localizedDescription)</p><p>Adres: \(ShellSettings.server)<br>Pas het aan bij Ark Tracks > Instellingen… (⌘,) of ververs met ⌘R.</p></div></body>"
        web.loadHTMLString(html, baseURL: nil)
    }
    func webView(_ w: WKWebView, runOpenPanelWith p: WKOpenPanelParameters, initiatedByFrame f: WKFrameInfo, completionHandler ch: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel(); panel.allowsMultipleSelection = p.allowsMultipleSelection
        ch(panel.runModal() == .OK ? panel.urls : nil)
    }

    /// Meet of de klok van een AudioContext gelijk loopt met de echte tijd (ArkTracks --audio-test)
    func runAudioTest() {
        let js = """
        async function t(opts) {
          const c = new AudioContext(opts); await c.resume();
          const o = c.createOscillator(), g = c.createGain(); g.gain.value = 0.0005; o.connect(g); g.connect(c.destination); o.start();
          const t0 = c.currentTime, p0 = performance.now();
          await new Promise(r => setTimeout(r, 3000));
          const dt = c.currentTime - t0, dp = (performance.now() - p0) / 1000;
          const out = { sampleRate: c.sampleRate, ratio: Math.round(dt / dp * 1000) / 1000 };
          o.stop(); await c.close(); return out;
        }
        return JSON.stringify([await t({})]);
        """
        web.loadHTMLString("<html><body>audio-test</body></html>", baseURL: URL(string: "https://localhost"))
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [self] in
            web.callAsyncJavaScript(js, arguments: [:], in: nil, in: .page) { res in
                if case .success(let v) = res { print("AUDIOTEST \(v)") } else { print("AUDIOTEST FOUT") }
                fflush(stdout); exit(0)
            }
        }
    }
}

// ------------------------------------------------------------- verbinding (adres en sleutel van de server)
// De rest van de instellingen (audioapparaat, uitgangen, nummermap, FreeShow) staan in de tab Instellingen van de app zelf;
// dit kleine venster is er alleen voor als de pagina nog niet kan laden (eerste keer, of de server is niet bereikbaar).
final class SettingsWindow: NSObject {
    let w: NSWindow
    unowned let app: AppDelegate
    let server = NSTextField(), key = NSSecureTextField()

    init(app: AppDelegate) {
        self.app = app
        w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 560, height: 220), styleWindow: [.titled, .closable])
        super.init()
        w.title = "Verbinding met de server"
        let v = NSView(frame: w.contentRect(forFrameRect: w.frame))
        func label(_ s: String, _ y: CGFloat) { let l = NSTextField(labelWithString: s); l.frame = NSRect(x: 20, y: y, width: 150, height: 22); l.alignment = .right; v.addSubview(l) }
        func place(_ c: NSView, _ y: CGFloat) { c.frame = NSRect(x: 180, y: y, width: 340, height: 24); v.addSubview(c) }
        label("Server van de webapp", 170); place(server, 168); server.placeholderString = "bijvoorbeeld https://naam.van.jouw.server"
        label("Sleutel van de beheerder", 130); place(key, 128); key.placeholderString = "uit de webapp: Instellingen > Tracks (leeg als er geen is)"
        let hint = NSTextField(wrappingLabelWithString: "Er staat geen adres vast in de app. Alle andere instellingen (audioapparaat, uitgangen, nummermap en FreeShow) vind je in de app zelf, in de tab Instellingen.")
        hint.frame = NSRect(x: 20, y: 56, width: 520, height: 56); hint.textColor = .secondaryLabelColor; v.addSubview(hint)
        let save = NSButton(title: "Bewaar", target: self, action: #selector(saveAction)); save.keyEquivalent = "\r"; save.frame = NSRect(x: 440, y: 16, width: 100, height: 32); v.addSubview(save)
        let cancel = NSButton(title: "Annuleer", target: self, action: #selector(cancelAction)); cancel.frame = NSRect(x: 330, y: 16, width: 100, height: 32); v.addSubview(cancel)
        w.contentView = v
    }

    func show(firstRun: Bool) {
        server.stringValue = ShellSettings.server
        key.stringValue = ShellSettings.key
        w.center(); w.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
    }
    @objc func cancelAction() { w.orderOut(nil) }
    @objc func saveAction() {
        var s = server.stringValue.trimmingCharacters(in: .whitespaces)
        if s.isEmpty { NSSound.beep(); return }
        if !s.hasPrefix("http") { s = "https://" + s }
        ShellSettings.server = s
        ShellSettings.key = key.stringValue.trimmingCharacters(in: .whitespaces)
        w.orderOut(nil)
        app.load()
    }
}

extension NSWindow {
    convenience init(contentRect: NSRect, styleWindow mask: NSWindow.StyleMask) { self.init(contentRect: contentRect, styleMask: mask, backing: .buffered, defer: false) }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
