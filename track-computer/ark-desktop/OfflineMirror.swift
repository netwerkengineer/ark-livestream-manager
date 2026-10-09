// Een kopie van het Tracks-scherm van de webapp, zodat de app ook zonder verbinding met de server werkt.
//
// Bij een gewone start (met server) haalt de app op de achtergrond de pagina /desktop en de bestanden van deze
// versie van de webapp (/_next/static/...) binnen. Zonder server toont de app die kopie via het adres
// arkoffline://app/ en beantwoordt de pagina zelf de verzoeken aan de server (zie desktopEngine.ts).

import Foundation
import WebKit

enum OfflineMirror {
    static let scheme = "arkoffline"
    static var url: URL { URL(string: "\(scheme)://app/desktop")! }

    static var dir: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("ArkTracks/offline", isDirectory: true)
    }
    static var available: Bool { FileManager.default.fileExists(atPath: dir.appendingPathComponent("desktop.html").path) }
    static var syncing = false

    /// Haalt de kopie binnen en vervangt daarna de oude in één keer. Bestanden die er al zijn worden hergebruikt (de namen bevatten een vingerafdruk).
    static func sync(server: String, key: String, done: @escaping (String?) -> Void) {
        if syncing { done(nil); return }
        syncing = true
        Task.detached {
            let result = await run(server: server, key: key)
            await MainActor.run { syncing = false; done(result) }
        }
    }

    private static func request(_ server: String, _ path: String, key: String) -> URLRequest? {
        guard let enc = path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed), let u = URL(string: server + enc) else { return nil }
        var r = URLRequest(url: u, timeoutInterval: 60)
        r.httpShouldHandleCookies = false
        r.setValue("Mozilla/5.0 Version/17.0 Safari/605.1.15 ArkTracksDesktop", forHTTPHeaderField: "User-Agent")
        if !key.isEmpty { r.setValue("ark_desktop=\(key)", forHTTPHeaderField: "Cookie") }
        return r
    }

    private static func get(_ server: String, _ path: String, key: String) async throws -> Data {
        guard let r = request(server, path, key: key) else { throw URLError(.badURL) }
        let (data, resp) = try await URLSession.shared.data(for: r)
        guard (resp as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
        return data
    }

    private static func run(server rawServer: String, key: String) async -> String? {
        let server = rawServer.trimmingCharacters(in: CharacterSet(charactersIn: "/ "))
        let fm = FileManager.default
        let fresh = dir.deletingLastPathComponent().appendingPathComponent("offline.new", isDirectory: true)
        do {
            try? fm.removeItem(at: fresh)
            try fm.createDirectory(at: fresh, withIntermediateDirectories: true)
            let html = try await get(server, "/desktop", key: key)
            guard let text = String(data: html, encoding: .utf8), text.contains("/_next/") else { return "de pagina /desktop is niet zoals verwacht" }
            let list = try JSONSerialization.jsonObject(with: try await get(server, "/api/tracks/desktop/bundle", key: key)) as? [String: Any]
            let files = (list?["files"] as? [String]) ?? []
            guard !files.isEmpty else { return "de server gaf geen lijst met bestanden" }

            var failed = 0
            var index = 0
            while index < files.count {
                let batch = files[index..<min(files.count, index + 8)]
                index += 8
                await withTaskGroup(of: Bool.self) { group in
                    for f in batch {
                        group.addTask {
                            let target = fresh.appendingPathComponent(f)
                            let old = dir.appendingPathComponent(f)
                            try? FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
                            if FileManager.default.fileExists(atPath: old.path), (try? FileManager.default.copyItem(at: old, to: target)) != nil { return true }
                            guard let data = try? await get(server, f, key: key) else { return false }
                            return (try? data.write(to: target)) != nil
                        }
                    }
                    for await ok in group where !ok { failed += 1 }
                }
            }
            if failed > 0 { try? fm.removeItem(at: fresh); return "\(failed) bestanden konden niet worden opgehaald" }
            try html.write(to: fresh.appendingPathComponent("desktop.html"))
            try? fm.removeItem(at: dir)
            try fm.moveItem(at: fresh, to: dir)
            return nil
        } catch {
            try? fm.removeItem(at: fresh)
            return error.localizedDescription
        }
    }
}

/// Levert de kopie aan de webview (alleen bestanden lezen; alles wat de pagina verder nodig heeft beantwoordt de pagina zelf)
final class OfflineScheme: NSObject, WKURLSchemeHandler {
    static let types = ["js": "text/javascript", "css": "text/css", "html": "text/html; charset=utf-8", "json": "application/json", "woff2": "font/woff2",
                        "woff": "font/woff", "ttf": "font/ttf", "png": "image/png", "svg": "image/svg+xml", "ico": "image/x-icon", "jpg": "image/jpeg", "webp": "image/webp"]

    func webView(_ w: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { task.didFailWithError(URLError(.badURL)); return }
        let path = url.path.removingPercentEncoding ?? url.path
        var file: URL?
        let isRSC = task.request.value(forHTTPHeaderField: "RSC") != nil || (url.query ?? "").contains("_rsc")
        if !isRSC && (path == "" || path == "/" || path == "/desktop") { file = OfflineMirror.dir.appendingPathComponent("desktop.html") }
        else if path.hasPrefix("/_next/static/") && !path.contains("..") { file = OfflineMirror.dir.appendingPathComponent(path) }
        var status = 404
        var data = Data()
        var type = "text/plain"
        if let f = file, let d = try? Data(contentsOf: f) {
            status = 200; data = d; type = OfflineScheme.types[f.pathExtension.lowercased()] ?? "application/octet-stream"
        }
        let resp = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1",
                                   headerFields: ["Content-Type": type, "Content-Length": String(data.count), "Cache-Control": "no-store"])!
        task.didReceive(resp)
        task.didReceive(data)
        task.didFinish()
    }
    func webView(_ w: WKWebView, stop task: WKURLSchemeTask) {}
}
