// Nummers van de server op deze computer zetten: de zip ophalen (hervatbaar), uitpakken, het speelbestand van de server ernaast
// zetten, de eigen click maken en de cuetabel overnemen. Daarna ziet de speler het nummer vanzelf in de nummermap.

import Foundation
import AVFoundation
import WebKit

struct FetchJob {
    var id: String
    var folder: String
    var title: String
    var rpp: String
    var state = "wachtrij"          // wachtrij | ophalen | uitpakken | click | klaar | fout
    var progress = 0.0
    var message = ""
}

final class SongFetcher {
    unowned let app: AppDelegate
    let queue = DispatchQueue(label: "ark.fetch")
    let lock = NSLock()
    var jobs: [String: FetchJob] = [:]
    var order: [String] = []

    init(app: AppDelegate) { self.app = app }

    // ---- aanroepen vanuit de pagina
    func start(_ p: [String: Any]) {
        guard let id = p["id"] as? String, let folder = p["folder"] as? String, !folder.isEmpty else { return }
        lock.lock()
        if let j = jobs[id], ["wachtrij", "ophalen", "uitpakken", "click"].contains(j.state) { lock.unlock(); return }
        jobs[id] = FetchJob(id: id, folder: folder, title: p["title"] as? String ?? folder, rpp: p["rpp"] as? String ?? "")
        order.append(id)
        lock.unlock()
        queue.async { [self] in run(id) }
    }

    func status() -> [[String: Any]] {
        lock.lock(); defer { lock.unlock() }
        return order.compactMap { jobs[$0] }.map { ["id": $0.id, "title": $0.title, "state": $0.state, "progress": $0.progress, "message": $0.message] }
    }

    /// Nummer van deze computer halen: naar de Prullenbak (niet definitief verwijderen)
    func remove(folder: String) -> Bool {
        let root = app.player.songsRoot
        let path = (root as NSString).appendingPathComponent(folder)
        guard path.hasPrefix(root), FileManager.default.fileExists(atPath: path) else { return false }
        var ok = false
        let sem = DispatchSemaphore(value: 0)
        DispatchQueue.main.async {
            NSWorkspace.shared.recycle([URL(fileURLWithPath: path)]) { _, e in ok = e == nil; sem.signal() }
        }
        sem.wait()
        app.player.scanLibrary()
        return ok
    }

    // ---- een nummer ophalen
    func update(_ id: String, _ f: (inout FetchJob) -> Void) { lock.lock(); if var j = jobs[id] { f(&j); jobs[id] = j }; lock.unlock() }

    private func run(_ id: String) {
        lock.lock(); let current = jobs[id]; lock.unlock()
        guard let job = current else { return }
        do {
            let base = ShellSettings.server.trimmingCharacters(in: CharacterSet(charactersIn: "/ "))
            let root = app.player.songsRoot
            let dest = (root as NSString).appendingPathComponent(job.folder)
            let incoming = (root as NSString).appendingPathComponent(".ophalen")
            try FileManager.default.createDirectory(atPath: incoming, withIntermediateDirectories: true)
            let zip = (incoming as NSString).appendingPathComponent("\(id).zip")

            // 1. beschrijving
            update(id) { $0.state = "ophalen"; $0.message = "beschrijving" }
            guard let desc = try getJSON(base + "/api/tracks/desktop/\(id)/descriptor") as? [String: Any] else { throw fail("Beschrijving ontbreekt") }

            // 2. zip (hervat als er al een deel is)
            try download(base + "/api/tracks/desktop/\(id)/zip", to: zip) { [self] done, total in
                update(id) { $0.progress = total > 0 ? Double(done) / Double(total) : 0; $0.message = "\(done / 1_000_000) MB" }
            }

            // 3. uitpakken
            update(id) { $0.state = "uitpakken"; $0.progress = 1; $0.message = "" }
            try FileManager.default.createDirectory(atPath: dest, withIntermediateDirectories: true)
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
            p.arguments = ["-x", "-k", zip, dest]
            try p.run(); p.waitUntilExit()
            guard p.terminationStatus == 0 else { throw fail("Uitpakken mislukt") }
            try? FileManager.default.removeItem(atPath: zip)          // onze eigen tijdelijke zip

            // 4. speelbestand + eigen click
            update(id) { $0.state = "click" }
            let sub = desc["root"] as? String ?? ""
            let songDir = sub.isEmpty ? dest : (dest as NSString).appendingPathComponent(sub)
            var d = desc
            let clicks = try makeClicks(dir: songDir, desc: desc)
            d["stems"] = ((desc["stems"] as? [[String: Any]]) ?? []) + clicks
            d["title"] = job.title
            if (d["rpp"] as? String ?? "").isEmpty { d["rpp"] = job.rpp }
            let data = try JSONSerialization.data(withJSONObject: d, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: URL(fileURLWithPath: (songDir as NSString).appendingPathComponent("ark-player.json")), options: .atomic)

            // 5. cuetabel van de server (de tekstkoppeling)
            if let c = try? getJSON(base + "/api/tracks/desktop/\(id)/cues") as? [String: Any], let cues = c["cues"] as? String, !cues.isEmpty {
                let rpp = (d["rpp"] as? String) ?? job.rpp
                try? app.player.saveCues(path: (songDir as NSString).appendingPathComponent(rpp), data: cues)
            }
            app.player.scanLibrary()
            update(id) { $0.state = "klaar"; $0.progress = 1; $0.message = "" }
        } catch {
            update(id) { $0.state = "fout"; $0.message = error.localizedDescription }
        }
    }

    func fail(_ m: String) -> NSError { NSError(domain: "ark", code: 1, userInfo: [NSLocalizedDescriptionKey: m]) }

    // ---- netwerk (met de inlog van het venster)
    private func cookieHeader(for url: URL) -> String {
        var header = ""
        let sem = DispatchSemaphore(value: 0)
        DispatchQueue.main.async {
            self.app.web.configuration.websiteDataStore.httpCookieStore.getAllCookies { cookies in
                let host = url.host ?? ""
                let mine = cookies.filter { c in let d = c.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")); return host == d || host.hasSuffix("." + d) }
                header = HTTPCookie.requestHeaderFields(with: mine)["Cookie"] ?? ""
                sem.signal()
            }
        }
        sem.wait()
        return header
    }

    private func request(_ s: String) throws -> URLRequest {
        guard let url = URL(string: s) else { throw fail("Ongeldig adres") }
        var r = URLRequest(url: url, timeoutInterval: 60)
        r.setValue(cookieHeader(for: url), forHTTPHeaderField: "Cookie")
        r.setValue("Version/17.0 Safari/605.1.15 ArkTracksDesktop", forHTTPHeaderField: "User-Agent")
        return r
    }

    private func getJSON(_ url: String) throws -> Any {
        let req = try request(url)
        var result: Result<Data, Error> = .failure(fail("Geen antwoord"))
        let sem = DispatchSemaphore(value: 0)
        URLSession.shared.dataTask(with: req) { data, resp, err in
            if let e = err { result = .failure(e) }
            else if let h = resp as? HTTPURLResponse, h.statusCode != 200 {
                let msg = (try? JSONSerialization.jsonObject(with: data ?? Data()) as? [String: Any])?["error"] as? String
                result = .failure(NSError(domain: "ark", code: h.statusCode, userInfo: [NSLocalizedDescriptionKey: msg ?? "Server antwoordde \(h.statusCode)"]))
            } else { result = .success(data ?? Data()) }
            sem.signal()
        }.resume()
        sem.wait()
        return try JSONSerialization.jsonObject(with: try result.get())
    }

    /// Grote download die hervat: een deel dat er al is, wordt aangevuld
    private func download(_ url: String, to path: String, progress: @escaping (Int64, Int64) -> Void) throws {
        let part = path + ".deel"
        let fm = FileManager.default
        let have = (try? fm.attributesOfItem(atPath: part)[.size] as? Int64) ?? 0
        var req = try request(url)
        req.timeoutInterval = 300
        if have > 0 { req.setValue("bytes=\(have)-", forHTTPHeaderField: "Range") }
        if !fm.fileExists(atPath: part) { fm.createFile(atPath: part, contents: nil) }
        let handle = try FileHandle(forWritingTo: URL(fileURLWithPath: part))
        defer { try? handle.close() }
        let dl = StreamDownload(handle: handle, offset: have, progress: progress)
        let session = URLSession(configuration: .default, delegate: dl, delegateQueue: nil)
        session.dataTask(with: req).resume()
        dl.semaphore.wait()
        session.finishTasksAndInvalidate()
        if let e = dl.error { throw e }
        if fm.fileExists(atPath: path) { try fm.removeItem(atPath: path) }
        try fm.moveItem(atPath: part, toPath: path)
    }

    // ---- eigen click (MultiTracks-geluid) in 1/4, 1/8 en 1/16
    func makeClicks(dir: String, desc: [String: Any]) throws -> [[String: Any]] {
        let tempo = (desc["tempo_qn"] as? [[Any]] ?? []).compactMap { r -> (qn: Double, bpm: Double)? in
            guard r.count == 2, let q = (r[0] as? NSNumber)?.doubleValue, let b = (r[1] as? NSNumber)?.doubleValue else { return nil }; return (q, b) }
        let sigs = (desc["timesig"] as? [[Any]] ?? []).compactMap { r -> (qn: Double, num: Double, den: Double)? in
            guard r.count == 3, let q = (r[0] as? NSNumber)?.doubleValue, let n = (r[1] as? NSNumber)?.doubleValue, let d = (r[2] as? NSNumber)?.doubleValue else { return nil }; return (q, n, d) }
        guard !tempo.isEmpty else { return [] }
        let tm = TempoMap(tempoQN: tempo, sigs: sigs)
        // lengte: de langste stem
        var duration = 0.0
        for s in (desc["stems"] as? [[String: Any]] ?? []) {
            guard let f = s["file"] as? String, let af = try? AVAudioFile(forReading: URL(fileURLWithPath: (dir as NSString).appendingPathComponent(f))) else { continue }
            duration = max(duration, ((s["offset"] as? NSNumber)?.doubleValue ?? 0) + Double(af.length) / af.processingFormat.sampleRate)
        }
        guard duration > 0 else { return [] }
        let sr = 48000
        func decode(_ b64: String) -> [Int16] {
            let d = Data(base64Encoded: b64) ?? Data()
            return stride(from: 0, to: d.count - 1, by: 2).map { Int16(bitPattern: UInt16(d[$0]) | UInt16(d[$0 + 1]) << 8) }
        }
        let strong = decode(clickBankStrong), weak = decode(clickBankWeak)
        let scale: ([Int16], Double) -> [Int16] = { a, f in a.map { Int16(Double($0) * f) } }
        let sounds: [[Int16]] = [strong, scale(strong, 0.85), weak, scale(weak, 0.6)]     // accent, kwart, achtste, zestiende
        let n = Int((duration + 1) * Double(sr))
        var layers = [[Int16]](repeating: [Int16](repeating: 0, count: n), count: 3)
        let endQ = tm.qn(sec: duration)
        var barStarts = Set<Int>()
        var q = 0.0
        while q <= endQ + 0.001 {
            barStarts.insert(Int((q * 4).rounded()))
            let sig = tm.sigs.last(where: { $0.qn <= q + 1e-6 }) ?? tm.sigs[0]
            q += sig.qpb
        }
        var k = 0
        while Double(k) / 4 <= endQ {
            let layer: Int, sound: Int
            if k % 4 == 0 { layer = 0; sound = barStarts.contains(k) ? 0 : 1 } else if k % 2 == 0 { layer = 1; sound = 2 } else { layer = 2; sound = 3 }
            let start = Int((tm.sec(qn: Double(k) / 4) * Double(sr)).rounded())
            for (i, v) in sounds[sound].enumerated() where start + i < n { layers[layer][start + i] = Int16(clamping: Int(layers[layer][start + i]) + Int(v)) }
            k += 1
        }
        let origClick = desc["orig_click"] as? Bool ?? false
        let names = [("Click 1/4", "Ark Click 1-4.wav"), ("Click 1/8", "Ark Click 1-8.wav"), ("Click 1/16", "Ark Click 1-16.wav")]
        var out: [[String: Any]] = []
        for (i, nm) in names.enumerated() {
            let file = (dir as NSString).appendingPathComponent(nm.1)
            try wavData(layers[i], rate: sr).write(to: URL(fileURLWithPath: file), options: .atomic)
            out.append(["file": nm.1, "name": nm.0, "offset": 0.0, "mute": !(origClick && i == 0)])      // zonder echte click blijft de eigen click uit
        }
        return out
    }

    private func wavData(_ s: [Int16], rate: Int) -> Data {
        var d = Data()
        func u32(_ v: Int) { var x = UInt32(v).littleEndian; d.append(Data(bytes: &x, count: 4)) }
        func u16(_ v: Int) { var x = UInt16(v).littleEndian; d.append(Data(bytes: &x, count: 2)) }
        d.append("RIFF".data(using: .ascii)!); u32(36 + s.count * 2); d.append("WAVEfmt ".data(using: .ascii)!)
        u32(16); u16(1); u16(1); u32(rate); u32(rate * 2); u16(2); u16(16)
        d.append("data".data(using: .ascii)!); u32(s.count * 2)
        s.withUnsafeBufferPointer { d.append(Data(buffer: $0)) }
        return d
    }
}

/// Schrijft binnenkomende data in een bestand en meldt de voortgang
final class StreamDownload: NSObject, URLSessionDataDelegate {
    let handle: FileHandle
    var written: Int64
    var total: Int64 = 0
    let progress: (Int64, Int64) -> Void
    let semaphore = DispatchSemaphore(value: 0)
    var error: Error?

    init(handle: FileHandle, offset: Int64, progress: @escaping (Int64, Int64) -> Void) {
        self.handle = handle; self.written = offset; self.progress = progress
        super.init()
        try? handle.seekToEnd()
    }

    func urlSession(_ s: URLSession, dataTask t: URLSessionDataTask, didReceive r: URLResponse, completionHandler ch: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let h = r as? HTTPURLResponse else { ch(.cancel); return }
        if h.statusCode == 416 { total = written; ch(.cancel); return }              // al compleet
        guard [200, 206].contains(h.statusCode) else {
            error = NSError(domain: "ark", code: h.statusCode, userInfo: [NSLocalizedDescriptionKey: "Server antwoordde \(h.statusCode)"]); ch(.cancel); return
        }
        if h.statusCode == 200 { written = 0; try? handle.truncate(atOffset: 0) }       // de server hervat niet: opnieuw beginnen
        total = written + h.expectedContentLength
        ch(.allow)
    }
    func urlSession(_ s: URLSession, dataTask t: URLSessionDataTask, didReceive data: Data) {
        try? handle.write(contentsOf: data)
        written += Int64(data.count)
        progress(written, total)
    }
    func urlSession(_ s: URLSession, task: URLSessionTask, didCompleteWithError e: Error?) {
        if let e = e as NSError?, e.code != NSURLErrorCancelled { error = e }
        semaphore.signal()
    }
}
