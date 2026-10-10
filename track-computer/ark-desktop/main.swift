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
import UniformTypeIdentifiers

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
    /// zonder server werken: de app toont de bewaarde kopie van het scherm en doet alles lokaal
    static var offline: Bool {
        get { UserDefaults.standard.bool(forKey: "offline") }
        set { UserDefaults.standard.set(newValue, forKey: "offline") }
    }
    /// afstandsbediening via de server toestaan (standaard uit) en hoe deze Mac op het Podium heet
    static var remote: Bool {
        get { UserDefaults.standard.bool(forKey: "remote") }
        set { UserDefaults.standard.set(newValue, forKey: "remote") }
    }
    static var deviceName: String {
        get { UserDefaults.standard.string(forKey: "deviceName") ?? Host.current().localizedName ?? "Ark Tracks" }
        set { UserDefaults.standard.set(newValue.isEmpty ? Host.current().localizedName ?? "Ark Tracks" : newValue, forKey: "deviceName") }
    }
    /// lokale bediening (zonder server): aan/uit en poort
    static var lan: Bool {
        get { UserDefaults.standard.bool(forKey: "lan") }
        set { UserDefaults.standard.set(newValue, forKey: "lan") }
    }
    static var lanPort: Int {
        get { let p = UserDefaults.standard.integer(forKey: "lanPort"); return p == 0 ? 8765 : p }
        set { UserDefaults.standard.set(newValue, forKey: "lanPort") }
    }
    static var server: String {
        get { UserDefaults.standard.string(forKey: "server") ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: "server") }
    }
}

/// Bewaart de eigen instellingen van de pagina (de sleutels "ark-…": eigen setlist e.d.) buiten de webview, zodat ze hetzelfde zijn
/// met en zonder server (de webview geeft elk adres zijn eigen localStorage).
enum LocalStore {
    static var url: URL {
        let d = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("ArkTracks", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d.appendingPathComponent("page-settings.json")
    }
    static var values: [String: String] = {
        guard let d = try? Data(contentsOf: url), let j = try? JSONSerialization.jsonObject(with: d) as? [String: String] else { return [:] }
        return j
    }()
    static func save() { if let d = try? JSONSerialization.data(withJSONObject: values, options: [.prettyPrinted, .sortedKeys]) { try? d.write(to: url, options: .atomic) } }
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
    var fetcher: SongFetcher!
    var reporter: RemoteReporter!
    var remote: LocalRemote!
    var lanWindow: LanWindow?
    var activity: NSObjectProtocol?

    var audioTest = CommandLine.arguments.contains("--audio-test")

    func applicationDidFinishLaunching(_ n: Notification) {
        // macOS mag de app niet in slaap sussen: audio en afstandsbediening moeten op tijd blijven reageren
        activity = ProcessInfo.processInfo.beginActivity(options: [.userInitiated, .latencyCritical], reason: "Audio afspelen en afstandsbediening")
        _ = RemoteReporter.playerId()                     // het id van deze app staat vast voordat de pagina laadt
        output = Output(mixer: mixer)
        player = Player(mixer: mixer, output: output)
        player.start()
        engine = Server(player: player)
        fetcher = SongFetcher(app: self)
        reporter = RemoteReporter(app: self)
        remote = LocalRemote(app: self)
        do { try output.start(device: player.cfg.device.isEmpty ? nil : player.cfg.device) } catch { log("Audio starten mislukt: \(error.localizedDescription)") }

        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default()                       // inloggen blijft bewaard
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.applicationNameForUserAgent = "Version/17.0 Safari/605.1.15 ArkTracksDesktop"
        cfg.setURLSchemeHandler(OfflineScheme(), forURLScheme: OfflineMirror.scheme)
        cfg.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "engine")
        cfg.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "shellcall")
        cfg.userContentController.add(WeakHandler(self), name: "shell")
        web = WKWebView(frame: .zero, configuration: cfg)
        installScript()
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
        reporter.refresh()
        remote.refresh()
        if audioTest { runAudioTest(); return }
        // proef zonder venster: ArkTracks --lan-test <poort>  (lokale bediening aan, koppelen wordt vanzelf toegestaan, niets naar de Keychain)
        if let i = CommandLine.arguments.firstIndex(of: "--lan-test"), i + 1 < CommandLine.arguments.count, let port = Int(CommandLine.arguments[i + 1]) {
            LanDevices.memory = []; remote.testAutoAllow = true; remote.start(port: port)
            DispatchQueue.global().asyncAfter(deadline: .now() + 60) { exit(0) }
            return
        }
        // proef zonder venster: ArkTracks --remote-test  (laadt het eerste nummer in de nummermap en voert Podium-commando's uit)
        if CommandLine.arguments.contains("--remote-test") { DispatchQueue.global().async { [self] in remoteTest() }; return }
        // proef zonder venster: ArkTracks --import-test <zip>  (zet het nummer in de nummermap en meldt de uitkomst)
        if let i = CommandLine.arguments.firstIndex(of: "--import-test"), i + 1 < CommandLine.arguments.count {
            fetcher.importZip(path: CommandLine.arguments[i + 1])
            DispatchQueue.global().async { [self] in
                for _ in 0..<600 {
                    Thread.sleep(forTimeInterval: 0.5)
                    if let j = fetcher.status().first, ["klaar", "fout"].contains(j["state"] as? String ?? "") { print("IMPORT \(j)"); fflush(stdout); exit(j["state"] as? String == "klaar" ? 0 : 1) }
                }
                print("IMPORT time-out"); exit(1)
            }
            return
        }
        if ShellSettings.server.isEmpty && !ShellSettings.offline { showSettings(firstRun: true) } else { load() }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

    /// Het script wordt opnieuw geplaatst als de bewaarde instellingen veranderen, zodat elke pagina de actuele waarden krijgt
    func installScript() {
        let ucc = web.configuration.userContentController
        ucc.removeAllUserScripts()
        ucc.addUserScript(WKUserScript(source: injectedScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }

    // ---- de speler voor de webpagina
    var injectedScript: String { """
    window.arkDesktop = {
      version: "0.4",
      offline: location.protocol === "\(OfflineMirror.scheme):",
      remote: { enabled: \(ShellSettings.remote), name: \(jsString(ShellSettings.deviceName)) },
      server: \(jsString(ShellSettings.server)),
      openSettings: () => window.webkit.messageHandlers.shell.postMessage({ action: "settings" }),
      openExternal: (url) => window.webkit.messageHandlers.shell.postMessage({ action: "openExternal", url }),
      chooseFolder: async () => JSON.parse(await window.webkit.messageHandlers.shellcall.postMessage({ action: "chooseFolder" })),
      // nummers van de server op deze computer zetten ({ id, folder, title, rpp }), de stand opvragen en een nummer weghalen (Prullenbak)
      fetchSong: (song) => window.webkit.messageHandlers.shell.postMessage({ action: "fetchSong", song }),
      fetchStatus: async () => JSON.parse(await window.webkit.messageHandlers.shellcall.postMessage({ action: "fetchStatus" })),
      // een zip (MultiTracks of eigen opname) kiezen en als nummer op deze computer zetten, zonder server
      importZip: () => window.webkit.messageHandlers.shell.postMessage({ action: "importZip" }),
      removeSong: async (folder) => JSON.parse(await window.webkit.messageHandlers.shellcall.postMessage({ action: "removeSong", folder })),
    };
    // eigen instellingen van de pagina ("ark-…") staan in de app, niet in de webview
    (() => { try {
      const kv = \(jsObject(LocalStore.values));
      const post = (m) => window.webkit.messageHandlers.shell.postMessage(m);
      const set = Storage.prototype.setItem, remove = Storage.prototype.removeItem;
      if (kv.__init) {
        for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith("ark-") && !(k in kv)) remove.call(localStorage, k); }
        for (const k in kv) if (k.startsWith("ark-")) set.call(localStorage, k, kv[k]);
      } else {
        for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith("ark-")) post({ action: "kvSet", key: k, value: localStorage.getItem(k) }); }
        post({ action: "kvSet", key: "__init", value: "1" });
      }
      Storage.prototype.setItem = function (k, v) { set.call(this, k, v); if (this === localStorage && String(k).startsWith("ark-")) post({ action: "kvSet", key: String(k), value: String(v) }); };
      Storage.prototype.removeItem = function (k) { remove.call(this, k); if (this === localStorage && String(k).startsWith("ark-")) post({ action: "kvRemove", key: String(k) }); };
    } catch (e) {} })();
    window.arkEngine = {
      available: true,
      // path: bijvoorbeeld "/state" of "/jump"; params: { id: 3, mode: "bar" } (een lijst geeft herhaalde sleutels); geeft het JSON-antwoord terug
      call: async (path, params) => {
        const r = await window.webkit.messageHandlers.engine.postMessage({ path, params: params || {} });
        return JSON.parse(r);
      },
    };
    """ }

    func jsObject(_ d: [String: String]) -> String {
        (try? String(data: JSONSerialization.data(withJSONObject: d), encoding: .utf8)) ?? "{}"
    }
    func jsString(_ s: String) -> String {
        (try? String(data: JSONSerialization.data(withJSONObject: [s]), encoding: .utf8)).flatMap { String($0.dropFirst().dropLast()) } ?? "\"\""
    }

    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        if m.name == "shellcall" {
            if let b = m.body as? [String: Any], b["action"] as? String == "chooseFolder" {
                let panel = NSOpenPanel(); panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.prompt = "Kies"
                let ok = panel.runModal() == .OK
                replyHandler(jsonString(["path": ok ? (panel.url?.path ?? "") : ""]), nil)
            } else if let b = m.body as? [String: Any], b["action"] as? String == "fetchStatus" {
                replyHandler(jsonString(["jobs": fetcher.status()]), nil)
            } else if let b = m.body as? [String: Any], b["action"] as? String == "removeSong", let f = b["folder"] as? String {
                DispatchQueue.global().async { [self] in let ok = fetcher.remove(folder: f); replyHandler(jsonString(["ok": ok]), nil) }
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
            if b["action"] as? String == "kvSet", let k = b["key"] as? String, let v = b["value"] as? String { d?.kvChanged { LocalStore.values[k] = v } }
            if b["action"] as? String == "kvRemove", let k = b["key"] as? String { d?.kvChanged { LocalStore.values.removeValue(forKey: k) } }
            if b["action"] as? String == "importZip" {
                let panel = NSOpenPanel(); panel.canChooseFiles = true; panel.canChooseDirectories = false; panel.allowsMultipleSelection = true
                panel.allowedContentTypes = [.zip]; panel.prompt = "Importeer"; panel.message = "Kies een MultiTracks-zip of een eigen opname (zip met song.json)"
                if panel.runModal() == .OK { for u in panel.urls { d?.fetcher.importZip(path: u.path) } }
            }
            if b["action"] as? String == "fetchSong", let song = b["song"] as? [String: Any] { d?.fetcher.start(song) }
            if b["action"] as? String == "openExternal", let u = (b["url"] as? String).flatMap(URL.init(string:)), u.scheme == "https" || u.scheme == "http" { NSWorkspace.shared.open(u) }
        }
    }

    func kvChanged(_ change: () -> Void) {
        change(); LocalStore.save(); installScript()
    }

    // ---- laden
    func load() {
        if ShellSettings.offline { loadOffline(); return }
        let base = ShellSettings.server.trimmingCharacters(in: CharacterSet(charactersIn: "/ "))
        guard let url = URL(string: base + "/desktop") else { showSettings(firstRun: true); return }
        installKeyCookie(for: url) { [self] in web.load(URLRequest(url: url)) }
    }

    func loadOffline() {
        if OfflineMirror.available { web.load(URLRequest(url: OfflineMirror.url)); return }
        let html = "<body style='font-family:-apple-system;background:#0b1222;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center'><div><h2>Nog geen kopie voor gebruik zonder server</h2><p>Verbind één keer met de server (Instellingen… > haal het vinkje bij \"Zonder server werken\" weg). De app bewaart dan zelf een kopie.</p></div></body>"
        web.loadHTMLString(html, baseURL: nil)
    }

    /// Na een geslaagde start met server: de kopie voor gebruik zonder server bijwerken
    var mirrored = false
    func refreshMirror(force: Bool = false) {
        guard !ShellSettings.offline, force || !mirrored, !ShellSettings.server.isEmpty else { return }
        mirrored = true
        OfflineMirror.sync(server: ShellSettings.server, key: ShellSettings.key) { err in
            log(err == nil ? "Kopie voor gebruik zonder server is bijgewerkt" : "Kopie voor gebruik zonder server niet bijgewerkt: \(err!)")
            if force { let a = NSAlert(); a.messageText = err == nil ? "De kopie voor gebruik zonder server is bijgewerkt." : "Bijwerken mislukt: \(err!)"; a.runModal() }
        }
    }

    func webView(_ w: WKWebView, didFinish n: WKNavigation!) {
        if let u = w.url, u.scheme?.hasPrefix("http") == true, u.path.hasPrefix("/desktop") { refreshMirror() }
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

    func showSettings(firstRun: Bool) {
        if settingsWindow == nil {
            settingsWindow = SettingsWindow(app: self)
        }
        settingsWindow?.show(firstRun: firstRun)
    }

    /// Instellingen toegepast: speler en venster bijwerken
    func settingsChanged(serverChanged: Bool) {
        buildMenu()
        installScript()
        reporter.refresh()
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
        appMenu.addItem(item("Bediening op afstand…", #selector(openLan), "", target: self))
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
        let off = item("Zonder server werken", #selector(toggleOffline), "", target: self); off.state = ShellSettings.offline ? .on : .off
        view.addItem(off)
        view.addItem(item("Kopie voor gebruik zonder server bijwerken", #selector(updateMirror), "", target: self))
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

    @objc func openSettings() { showSettings(firstRun: false) }
    @objc func openLan() { if lanWindow == nil { lanWindow = LanWindow(app: self) }; lanWindow?.show() }
    @objc func reload() {
        if web.url?.scheme == OfflineMirror.scheme && !ShellSettings.offline { load() } else { web.reload() }    // zonder server door omstandigheden: opnieuw proberen te verbinden
    }
    @objc func toggleOffline() {
        ShellSettings.offline.toggle()
        buildMenu()
        load()
    }
    @objc func updateMirror() { refreshMirror(force: true) }
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
        // de server is er niet: met een bewaarde kopie kan de app gewoon doorwerken
        if OfflineMirror.available, web.url?.scheme != OfflineMirror.scheme, [NSURLErrorNotConnectedToInternet, NSURLErrorCannotConnectToHost, NSURLErrorCannotFindHost,
            NSURLErrorTimedOut, NSURLErrorNetworkConnectionLost, NSURLErrorDNSLookupFailed].contains((e as NSError).code) {
            web.load(URLRequest(url: OfflineMirror.url)); return
        }
        let html = "<body style='font-family:-apple-system;background:#0b1222;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center'><div><h2>Kan de server niet bereiken</h2><p>\(e.localizedDescription)</p><p>Adres: \(ShellSettings.server)<br>Pas het aan bij Ark Tracks > Instellingen… (⌘,) of ververs met ⌘R.</p></div></body>"
        web.loadHTMLString(html, baseURL: nil)
    }
    // JavaScript dialogs (confirm/alert) show nothing in a WKWebView unless the app does it
    func webView(_ w: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame f: WKFrameInfo, completionHandler ch: @escaping (Bool) -> Void) {
        let al = NSAlert(); al.messageText = message
        al.addButton(withTitle: "OK"); al.addButton(withTitle: "Annuleer")
        ch(al.runModal() == .alertFirstButtonReturn)
    }
    func webView(_ w: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame f: WKFrameInfo, completionHandler ch: @escaping () -> Void) {
        let al = NSAlert(); al.messageText = message; al.runModal(); ch()
    }

    func webView(_ w: WKWebView, runOpenPanelWith p: WKOpenPanelParameters, initiatedByFrame f: WKFrameInfo, completionHandler ch: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel(); panel.allowsMultipleSelection = p.allowsMultipleSelection
        ch(panel.runModal() == .OK ? panel.urls : nil)
    }

    func remoteTest() {
        var fails = 0
        func check(_ ok: Bool, _ what: String) { print(ok ? "ok   " : "FOUT ", what); if !ok { fails += 1 } }
        func run(_ b: [String: Any]) -> (Bool, String) { var r = (false, ""); DispatchQueue.main.sync { r = reporter.execute(b) }; return r }
        func st() -> [String: Any] { var s: [String: Any] = [:]; DispatchQueue.main.sync { s = engine.state() }; return s }
        Thread.sleep(forTimeInterval: 1)
        guard let song = player.library.first else { print("FOUT geen nummer in de map"); exit(1) }
        let lr = run(["action": "song", "path": song.path]); check(lr.0, "nummer laden (\(lr.1))")
        for _ in 0..<60 { if st()["loading"] as? Bool == false && (st()["sections"] as? [Any])?.isEmpty == false { break }; Thread.sleep(forTimeInterval: 0.5) }
        check(run(["action": "master", "value": 0.001]).0 && (st()["master_db"] as? Double ?? 0) < -50, "master zacht zetten")
        check(run(["action": "play"]).0, "play"); Thread.sleep(forTimeInterval: 0.4)
        check(st()["state"] as? String == "playing", "speelt")
        let secs = st()["sections"] as? [[String: Any]] ?? []
        if let s = secs.last, let region = s["region"] as? Int {
            check(run(["action": "jump", "region": region, "mode": "now"]).0, "springen naar sectie \(region)")
            Thread.sleep(forTimeInterval: 0.4)
            check(st()["section"] as? Int == s["id"] as? Int, "in de gekozen sectie")
        }
        check(!run(["action": "jump", "region": 99]).0, "onbekende sectie geweigerd")
        check(run(["action": "volume", "track": 2, "value": 0.5]).0, "volume van track 2")
        let before = (st()["stems"] as? [[String: Any]]) ?? []
        check(run(["action": "mute", "track": 3, "value": true]).0, "mute track 3")
        let after = (st()["stems"] as? [[String: Any]]) ?? []
        check(zip(before, after).contains { ($0["mute"] as? Bool) != ($1["mute"] as? Bool) } || after.contains { $0["mute"] as? Bool == true }, "een stem staat gedempt")
        check(run(["action": "mute", "track": 1, "value": true]).0 && (st()["busses"] as? [[String: Any]])?.first?["mute"] as? Bool == true, "bus 1 gedempt (track 1)")
        check(run(["action": "mute", "track": 1, "value": false]).0 && (st()["busses"] as? [[String: Any]])?.first?["mute"] as? Bool == false, "bus 1 weer aan")
        check(run(["action": "unmuteAll"]).0, "alles unmuten")
        check(run(["action": "loop", "value": false]).0, "loop uit")
        check(run(["action": "mode", "mode": "bar"]).0 && st()["jump_mode"] as? String == "bar", "sprongmoment: volgende maat")
        check(!run(["action": "mode", "mode": "later"]).0, "ongeldige modus geweigerd")
        check(!run(["action": "volume", "track": 2, "value": 9]).0, "volume 9 geweigerd")
        check(!run(["action": "volume", "track": 999, "value": 1]).0, "onbekend tracknummer geweigerd")
        check(!run(["action": "recordStart"]).0, "opnemen geweigerd")
        check(run(["action": "pad", "value": ["op": "volume", "volume": 0.5]]).0, "padvolume")
        check(!run(["action": "pad", "value": ["op": "format"]]).0, "onbekende pad-actie geweigerd")
        check(run(["action": "pause"]).0 && { Thread.sleep(forTimeInterval: 0.3); return st()["state"] as? String == "paused" }(), "pauze")
        check(run(["action": "start"]).0, "naar het begin")
        check(run(["action": "stop"]).0, "stop")
        print(fails == 0 ? "REMOTETEST GESLAAGD" : "REMOTETEST: \(fails) fouten"); fflush(stdout); exit(fails == 0 ? 0 : 1)
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

// ------------------------------------------------------------- instellingen
final class SettingsWindow: NSObject, NSWindowDelegate {
    let w: NSWindow
    unowned let app: AppDelegate
    let server = NSTextField(), key = NSSecureTextField(), songs = NSTextField(), pads = NSTextField(), fsHost = NSTextField(), fsPort = NSTextField()
    let device = NSPopUpButton(), mode = NSPopUpButton()
    let offline = NSButton(checkboxWithTitle: "Zonder server werken", target: nil, action: nil)
    let remote = NSButton(checkboxWithTitle: "Afstandsbediening toestaan", target: nil, action: nil)
    let deviceName = NSTextField()
    var firstRun = false

    init(app: AppDelegate) {
        self.app = app
        w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 560, height: 540), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        super.init()
        w.title = "Instellingen"
        w.delegate = self
        let v = NSView(frame: w.contentRect(forFrameRect: w.frame))
        func label(_ s: String, _ y: CGFloat) { let l = NSTextField(labelWithString: s); l.frame = NSRect(x: 20, y: y, width: 150, height: 22); l.alignment = .right; v.addSubview(l) }
        func place(_ c: NSView, _ y: CGFloat, _ width: CGFloat = 340) { c.frame = NSRect(x: 180, y: y, width: width, height: 24); v.addSubview(c) }
        label("Server van de webapp", 460); place(server, 458); server.placeholderString = "bijvoorbeeld https://naam.van.jouw.server"
        label("Sleutel van de beheerder", 420); place(key, 418); key.placeholderString = "uit de webapp: Instellingen > Tracks (leeg als er geen is)"
        label("Audioapparaat", 380); place(device, 378)
        label("Uitgangen", 340); place(mode, 338, 260)
        mode.addItems(withTitles: ["Automatisch", "8 kanalen (X32)", "3 kanalen (click+guide, tracks stereo)", "2 kanalen (click+guide, tracks)", "Stereo (test)"])
        label("Map met nummers", 300); place(songs, 298, 250); songs.placeholderString = "standaard ~/Tracks/Songs"
        let choose = NSButton(title: "Kies…", target: self, action: #selector(pickFolder)); choose.frame = NSRect(x: 436, y: 296, width: 84, height: 28); v.addSubview(choose)
        label("Map met pads", 260); place(pads, 258, 250); pads.placeholderString = "standaard ~/Tracks/Pads"
        let choosePads = NSButton(title: "Kies…", target: self, action: #selector(pickPads)); choosePads.frame = NSRect(x: 436, y: 256, width: 84, height: 28); v.addSubview(choosePads)
        label("FreeShow (cues)", 220); place(fsHost, 218, 250); fsHost.placeholderString = "adres, leeg = zoals ingesteld in de webapp"
        fsPort.frame = NSRect(x: 436, y: 218, width: 84, height: 24); fsPort.placeholderString = "poort"; v.addSubview(fsPort)
        let hint = NSTextField(wrappingLabelWithString: "Er staat geen adres vast in de app. Het FreeShow-adres kun je hier opgeven (op deze Mac of een andere computer, poort 5506 voor de REST-listener van FreeShow); laat je het leeg, dan gebruikt de app het adres uit de instellingen van de webapp. Met \"Afstandsbediening toestaan\" kan een tablet of telefoon op het Podium van de webapp deze app bedienen (alleen met een verbinding met de server).")
        hint.frame = NSRect(x: 20, y: 122, width: 520, height: 88); hint.textColor = .secondaryLabelColor; v.addSubview(hint)
        let save = NSButton(title: "Bewaar", target: self, action: #selector(saveAction)); save.keyEquivalent = "\r"; save.frame = NSRect(x: 440, y: 16, width: 100, height: 32); v.addSubview(save)
        let cancel = NSButton(title: "Annuleer", target: self, action: #selector(cancelAction)); cancel.frame = NSRect(x: 330, y: 16, width: 100, height: 32); v.addSubview(cancel)
        offline.frame = NSRect(x: 20, y: 64, width: 250, height: 22); v.addSubview(offline)
        remote.frame = NSRect(x: 260, y: 64, width: 280, height: 22); v.addSubview(remote)
        label("Naam van dit apparaat", 96); place(deviceName, 94, 250); deviceName.placeholderString = "zo zien bedieners deze Mac op het Podium"
        w.contentView = v
    }

    static let modes = ["auto", "multi", "3ch", "2ch", "stereo"]

    func show(firstRun: Bool) {
        self.firstRun = firstRun
        let p = app.player!
        server.stringValue = ShellSettings.server
        offline.state = ShellSettings.offline ? .on : .off
        remote.state = ShellSettings.remote ? .on : .off
        deviceName.stringValue = ShellSettings.deviceName
        key.stringValue = ShellSettings.key
        songs.stringValue = p.cfg.songsRoot
        pads.stringValue = p.cfg.padsRoot
        fsHost.stringValue = p.cfg.fsHost
        fsPort.stringValue = p.cfg.fsHost.isEmpty ? "" : String(p.cfg.fsPort)
        device.removeAllItems(); device.addItem(withTitle: "Standaard van het systeem")
        for d in allDevices() where d.outCh > 0 { device.addItem(withTitle: "\(d.name) (\(d.outCh) uitgangen)") }
        if !p.cfg.device.isEmpty, let i = device.itemTitles.firstIndex(where: { $0.hasPrefix(p.cfg.device + " (") }) { device.selectItem(at: i) }
        mode.selectItem(at: SettingsWindow.modes.firstIndex(of: p.cfg.outputMode) ?? 0)
        w.center(); w.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
    }

    @objc func pickFolder() {
        let panel = NSOpenPanel(); panel.canChooseDirectories = true; panel.canChooseFiles = false
        if panel.runModal() == .OK, let u = panel.url { songs.stringValue = u.path }
    }
    @objc func pickPads() {
        let panel = NSOpenPanel(); panel.canChooseDirectories = true; panel.canChooseFiles = false
        if panel.runModal() == .OK, let u = panel.url { pads.stringValue = u.path }
    }
    @objc func cancelAction() { w.orderOut(nil) }
    func windowWillClose(_ n: Notification) {}

    @objc func saveAction() {
        var s = server.stringValue.trimmingCharacters(in: .whitespaces)
        let wantOffline = offline.state == .on
        if s.isEmpty && !wantOffline { NSSound.beep(); return }
        if !s.isEmpty && !s.hasPrefix("http") { s = "https://" + s }
        let newKey = key.stringValue.trimmingCharacters(in: .whitespaces)
        let remoteChanged = (remote.state == .on) != ShellSettings.remote || deviceName.stringValue.trimmingCharacters(in: .whitespaces) != ShellSettings.deviceName
        let serverChanged = s != ShellSettings.server || newKey != ShellSettings.key || wantOffline != ShellSettings.offline || remoteChanged
        ShellSettings.offline = wantOffline
        ShellSettings.remote = remote.state == .on
        ShellSettings.deviceName = deviceName.stringValue.trimmingCharacters(in: .whitespaces)
        ShellSettings.server = s
        ShellSettings.key = newKey
        let p = app.player!
        let title = device.titleOfSelectedItem ?? ""
        p.cfg.device = device.indexOfSelectedItem == 0 ? "" : (title.range(of: " (", options: .backwards).map { String(title[..<$0.lowerBound]) } ?? title)
        let m = SettingsWindow.modes[max(0, mode.indexOfSelectedItem)]
        p.cfg.outputMode = m; p.mixer.requested = m
        p.cfg.fsHost = fsHost.stringValue.trimmingCharacters(in: .whitespaces)
        p.cfg.fsPort = Int(fsPort.stringValue) ?? 5506
        p.setSongsRoot(songs.stringValue.trimmingCharacters(in: .whitespaces))
        p.setPadsRoot(pads.stringValue.trimmingCharacters(in: .whitespaces))
        w.orderOut(nil)
        app.settingsChanged(serverChanged: serverChanged)
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
