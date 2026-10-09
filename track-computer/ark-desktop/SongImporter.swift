// Een nummer zonder server op deze computer zetten: een MultiTracks-zip (met .als) of een eigen opname (zip met song.json
// en de stems). Dezelfde uitkomst als de beschrijving die de server maakt (mt2reaper.py --describe): het speelbestand
// ark-player.json, de eigen click en de stems in de nummermap. De cues (tekstkoppeling) komen er pas bij met de server.

import Foundation
import AVFoundation

private func fail(_ m: String) -> NSError { NSError(domain: "ark", code: 1, userInfo: [NSLocalizedDescriptionKey: m]) }

private let audioExt = ["wav", "m4a", "aif", "aiff", "mp3", "flac", "caf"]

private struct Meta {
    var tempo: [(qn: Double, bpm: Double)] = []
    var timesig: [(qn: Double, num: Int, den: Int)] = []
    var markers: [(qn: Double, name: String)] = []
    var tracks: [(name: String, file: String?, startQn: Double)] = []
    var title: String?
}

private func run(_ exe: String, _ args: [String]) throws -> Data {
    let p = Process(); p.executableURL = URL(fileURLWithPath: exe); p.arguments = args
    let out = Pipe(); p.standardOutput = out; p.standardError = Pipe()
    try p.run()
    let data = out.fileHandleForReading.readDataToEndOfFile()      // eerst lezen: anders loopt de pijp vol bij grote bestanden
    p.waitUntilExit()
    guard p.terminationStatus == 0 else { throw fail("\(exe) mislukte") }
    return data
}

// ---- Ableton (.als)
private func timeSig(_ v: Int) -> (Int, Int) { (v % 99 + 1, 1 << (v / 99)) }       // Ableton: (teller-1) + 99*log2(noemer)

private func readALS(_ raw: Data) throws -> Meta {
    var data = raw
    if data.count > 2, data[0] == 0x1f, data[1] == 0x8b {
        let tmp = NSTemporaryDirectory() + "ark-als-\(UUID().uuidString).gz"
        try data.write(to: URL(fileURLWithPath: tmp)); defer { try? FileManager.default.removeItem(atPath: tmp) }
        data = try run("/usr/bin/gunzip", ["-c", tmp])
    }
    let doc = try XMLDocument(data: data, options: [])
    func attr(_ n: XMLNode, _ path: String, _ a: String) -> String? { ((try? n.nodes(forXPath: path))?.first as? XMLElement)?.attribute(forName: a)?.stringValue }
    func collapse<T>(_ ev: [(Double, T)]) -> [(Double, T)] {
        var out: [Double: T] = [:]; for (t, v) in ev { out[t] = v }          // het laatste event op een tijdstip is de nieuwe waarde
        return out.sorted { $0.key < $1.key }.map { ($0.key, $0.value) }
    }
    var m = Meta()
    if let t = (try? doc.nodes(forXPath: "//Tempo"))?.first {
        var ev: [(Double, Double)] = ((try? t.nodes(forXPath: "./ArrangerAutomation/Events/FloatEvent")) ?? []).compactMap { n in
            guard let e = n as? XMLElement, let tm = Double(e.attribute(forName: "Time")?.stringValue ?? ""), let v = Double(e.attribute(forName: "Value")?.stringValue ?? "") else { return nil }
            return (max(0, tm), v) }
        if ev.isEmpty, let v = Double(attr(t, "./Manual", "Value") ?? "") { ev = [(0, v)] }
        m.tempo = collapse(ev).map { (qn: $0.0, bpm: $0.1) }
    }
    if let t = (try? doc.nodes(forXPath: "//TimeSignature"))?.first {
        let ev: [(Double, (Int, Int))] = ((try? t.nodes(forXPath: "./ArrangerAutomation/Events/EnumEvent")) ?? []).compactMap { n in
            guard let e = n as? XMLElement, let tm = Double(e.attribute(forName: "Time")?.stringValue ?? ""), let v = Int(e.attribute(forName: "Value")?.stringValue ?? "") else { return nil }
            return (max(0, tm), timeSig(v)) }
        m.timesig = collapse(ev).map { (qn: $0.0, num: $0.1.0, den: $0.1.1) }
    }
    if m.tempo.isEmpty { m.tempo = [(0, 120)] }
    if m.timesig.isEmpty { m.timesig = [(0, 4, 4)] }
    for l in (try? doc.nodes(forXPath: "//LiveSet/Locators/Locators/Locator")) ?? [] {
        if let t = Double(attr(l, "./Time", "Value") ?? "") { m.markers.append((t, (attr(l, "./Name", "Value") ?? "").trimmingCharacters(in: .whitespaces))) }
    }
    m.markers.sort { $0.qn < $1.qn }
    for tr in (try? doc.nodes(forXPath: "//LiveSet/Tracks/AudioTrack")) ?? [] {
        let name = attr(tr, "./Name/EffectiveName", "Value") ?? ""
        for clip in (try? tr.nodes(forXPath: ".//AudioClip")) ?? [] {
            guard let c = clip as? XMLElement else { continue }
            m.tracks.append((name, attr(c, ".//SampleRef/FileRef/Name", "Value"), Double(c.attribute(forName: "Time")?.stringValue ?? "0") ?? 0))
        }
    }
    return m
}

// ---- eigen opname (song.json), zie song.example.json
private func readSongJSON(_ raw: Data, audioNames: [String]) throws -> Meta {
    guard let j = try JSONSerialization.jsonObject(with: raw) as? [String: Any] else { throw fail("song.json: verwacht een object met title, bpm en sections") }
    let title = (j["title"] as? String ?? "").trimmingCharacters(in: .whitespaces)
    if title.isEmpty { throw fail("song.json: \"title\" ontbreekt") }
    func num(_ v: Any?, _ what: String) throws -> Double {
        if let n = v as? NSNumber { return n.doubleValue }
        if let s = v as? String, let d = Double(s) { return d }
        throw fail("song.json: \(what) moet een getal zijn")
    }
    func sig(_ v: Any?) throws -> (Int, Int) {
        guard let s = v as? String else { throw fail("song.json: maatsoort moet tekst zijn als \"4/4\"") }
        let p = s.split(separator: "/").map { Int($0.trimmingCharacters(in: .whitespaces)) }
        guard p.count == 2, let n = p[0], let d = p[1], [1, 2, 4, 8, 16, 32].contains(d) else { throw fail("song.json: maatsoort moet zijn als \"4/4\" of \"6/8\"") }
        return (n, d)
    }
    // maatsoort per maat
    var sigsIn: [(Int, (Int, Int))] = []
    if let s = j["timesig"] as? String { sigsIn = [(1, try sig(s))] }
    else if let l = j["timesig"] as? [[Any]] { for e in l { sigsIn.append((Int(try num(e[0], "maat in timesig")), try sig(e[1]))) } }
    else { sigsIn = [(1, (4, 4))] }
    sigsIn.sort { $0.0 < $1.0 }
    guard sigsIn.first?.0 == 1 else { throw fail("song.json: timesig moet bij maat 1 beginnen") }
    func barToQn(_ bar: Double, _ beat: Double) -> Double {
        let whole = Int(bar)
        var qn = 0.0, b = 1, idx = 0
        while b < whole {
            while idx + 1 < sigsIn.count && sigsIn[idx + 1].0 <= b { idx += 1 }
            qn += Double(sigsIn[idx].1.0) * 4 / Double(sigsIn[idx].1.1); b += 1
        }
        while idx + 1 < sigsIn.count && sigsIn[idx + 1].0 <= whole { idx += 1 }
        let cur = sigsIn[idx].1
        return qn + (bar - Double(whole)) * Double(cur.0) * 4 / Double(cur.1) + (beat - 1) * 4 / Double(cur.1)
    }
    var m = Meta()
    m.timesig = sigsIn.map { (qn: barToQn(Double($0.0), 1), num: $0.1.0, den: $0.1.1) }
    var tempoIn: [(Int, Double)] = []
    if let l = j["tempo"] as? [[Any]] { for e in l { tempoIn.append((Int(try num(e[0], "maat in tempo")), try num(e[1], "tempo"))) } }
    else if j["bpm"] != nil { tempoIn = [(1, try num(j["bpm"], "bpm"))] }
    else { throw fail("song.json: \"bpm\" (of \"tempo\": [[maat, bpm], ...]) ontbreekt") }
    tempoIn.sort { $0.0 < $1.0 }
    guard tempoIn.first?.0 == 1 else { throw fail("song.json: tempo moet bij maat 1 beginnen") }
    if tempoIn.contains(where: { $0.1 < 20 || $0.1 > 400 }) { throw fail("song.json: tempo buiten 20-400 bpm") }
    m.tempo = tempoIn.map { (qn: barToQn(Double($0.0), 1), bpm: $0.1) }
    let tm = TempoMap(tempoQN: m.tempo, sigs: m.timesig.map { (qn: $0.qn, num: Double($0.num), den: Double($0.den)) })
    for entry in (j["sections"] as? [Any]) ?? [] {
        var name = "", bar: Any? = nil, beat: Any? = 1, sec: Any? = nil
        if let d = entry as? [String: Any] { name = d["name"] as? String ?? ""; bar = d["bar"]; beat = d["beat"] ?? 1; sec = d["sec"] }
        else if let a = entry as? [Any] { name = a.first as? String ?? ""; bar = a.count > 1 ? a[1] : nil; beat = a.count > 2 ? a[2] : 1 }
        name = name.trimmingCharacters(in: .whitespaces)
        if name.isEmpty { throw fail("song.json: sectie zonder naam") }
        if sec != nil { m.markers.append((tm.qn(sec: try num(sec, "sec van \(name)")), name)) }
        else if bar != nil {
            let b = try num(bar, "maat van \(name)")
            if b < 1 { throw fail("song.json: maat van \"\(name)\" moet vanaf 1 tellen") }
            m.markers.append((barToQn(b, try num(beat, "tel van \(name)")), name))
        } else { throw fail("song.json: sectie \"\(name)\" heeft een \"bar\" (maat) of \"sec\" (seconden) nodig") }
    }
    m.markers.sort { $0.qn < $1.qn }
    if m.markers.isEmpty { throw fail("song.json: \"sections\" ontbreekt; zonder secties kan er niet gesprongen worden") }
    // stems: opgegeven, anders alle audiobestanden uit de zip
    if let listed = j["stems"] as? [Any], !listed.isEmpty {
        for s in listed {
            let d: [String: Any] = (s as? String).map { ["file": $0] } ?? (s as? [String: Any] ?? [:])
            guard let f = d["file"] as? String, !f.isEmpty else { throw fail("song.json: stem zonder \"file\"") }
            let base = (f as NSString).lastPathComponent
            if base.hasPrefix("._") { continue }
            let start = (d["start"] != nil && (try? num(d["start"], "start")) != 0) ? tm.qn(sec: try num(d["start"], "start")) : 0
            m.tracks.append(((d["name"] as? String) ?? (base as NSString).deletingPathExtension, base, start))
        }
    } else {
        var found: [String: String] = [:]
        for n in audioNames {
            let f = (n as NSString).lastPathComponent
            if f.hasPrefix("._") || f.hasPrefix("Ark Click") || !audioExt.contains((f as NSString).pathExtension.lowercased()) { continue }
            let base = (f as NSString).deletingPathExtension
            if found[base] == nil || f.lowercased().hasSuffix(".wav") { found[base] = f }
        }
        for base in found.keys.sorted(by: { $0.lowercased() < $1.lowercased() }) { m.tracks.append((base, found[base], 0)) }
    }
    if m.tracks.isEmpty { throw fail("song.json: geen audiobestanden (stems) in de zip") }
    // naam in MultiTracks-stijl ("Titel-Album-Toonsoort-120.00bpm"): daar halen de app en de padspeler titel, toonsoort en tempo uit
    func clean(_ s: String) -> String { s.components(separatedBy: CharacterSet(charactersIn: "-\\/:*?\"<>|")).joined(separator: " ").split(separator: " ").joined(separator: " ") }
    let key = (j["key"] as? String ?? "").trimmingCharacters(in: .whitespaces)
    var name = "\(clean(title))-\(clean((j["album"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Eigen opname"))"
    if key.range(of: "^[A-G][#b]?m?$", options: .regularExpression) != nil { name += "-\(key)-\(String(format: "%.2f", tempoIn[0].1))bpm" }
    else if !key.isEmpty { throw fail("song.json: key \"\(key)\" is geen toonsoort (bijv. C, Bb, F#m)") }
    m.title = name
    return m
}

extension SongFetcher {
    /// Een zip kiezen en als nummer op deze computer zetten (vanuit de pagina)
    func importZip(path zipPath: String) {
        let id = "lokaal-" + UUID().uuidString
        let name = ((zipPath as NSString).lastPathComponent as NSString).deletingPathExtension
        lock.lock(); jobs[id] = FetchJob(id: id, folder: "", title: name, rpp: "", state: "uitpakken"); order.append(id); lock.unlock()
        queue.async { [self] in
            do { try importRun(id, zipPath) }
            catch { update(id) { $0.state = "fout"; $0.message = error.localizedDescription } }
        }
    }

    private func importRun(_ id: String, _ zipPath: String) throws {
        let fm = FileManager.default
        // 1. wat zit er in de zip (alleen het beschrijvende bestand wordt uitgepakt)
        let listing = String(data: try run("/usr/bin/unzip", ["-Z1", zipPath]), encoding: .utf8) ?? ""
        let names = listing.split(separator: "\n").map(String.init).filter { !$0.hasSuffix("/") && !$0.contains("__MACOSX") && !($0 as NSString).lastPathComponent.hasPrefix("._") }
        let metaName = names.first(where: { ($0 as NSString).lastPathComponent.lowercased() == "song.json" }) ?? names.first(where: { $0.lowercased().hasSuffix(".als") })
        guard let metaPath = metaName else { throw fail("Geen .als-bestand of song.json in de zip") }
        let metaData = try run("/usr/bin/unzip", ["-p", zipPath, metaPath])
        let meta = metaPath.lowercased().hasSuffix(".json") ? try readSongJSON(metaData, audioNames: names) : try readALS(metaData)
        let root = (metaPath as NSString).deletingLastPathComponent
        let tm = TempoMap(tempoQN: meta.tempo, sigs: meta.timesig.map { (qn: $0.qn, num: Double($0.num), den: Double($0.den)) })

        // 2. speelbestand (zoals de server het beschrijft)
        var byBase: [String: String] = [:]
        for n in names where byBase[(n as NSString).lastPathComponent] == nil { byBase[(n as NSString).lastPathComponent] = n }
        let clickBus = busFor(stem: "click").out
        var stems: [[String: Any]] = [], missing: [String] = [], origClick = false
        for t in meta.tracks {
            guard let file = t.file, !file.isEmpty else { continue }
            let wav = (file as NSString).deletingPathExtension + ".wav"
            guard let found = byBase[file] ?? byBase[wav] else { missing.append(file); continue }
            let isClick = t.name.lowercased().hasPrefix("click") && busFor(stem: t.name).out == clickBus
            origClick = origClick || isClick
            let rel = root.isEmpty ? found : String(found.dropFirst(root.count + 1))
            stems.append(["file": rel, "name": t.name, "offset": (tm.sec(qn: t.startQn) * 1e6).rounded() / 1e6, "mute": isClick || isLive(t.name)])
        }
        guard !stems.isEmpty else { throw fail("Geen van de stems uit de beschrijving zit in de zip") }
        let markers = meta.markers.filter { !$0.name.isEmpty }
        let title = meta.title ?? (root.isEmpty ? ((zipPath as NSString).lastPathComponent as NSString).deletingPathExtension : (root as NSString).lastPathComponent)
        let safe = title.components(separatedBy: CharacterSet(charactersIn: "\\/:*?\"<>|")).joined(separator: " ").trimmingCharacters(in: .whitespaces)
        let rpp = "\(safe).RPP"
        var desc: [String: Any] = [
            "format": 2, "title": title, "rpp": rpp, "root": "", "orig_click": origClick, "stems": stems,
            "sections": markers.enumerated().map { ["id": $0.offset + 1, "name": $0.element.name, "sec": (tm.sec(qn: $0.element.qn) * 1e6).rounded() / 1e6] as [String: Any] },
            "tempo_qn": meta.tempo.map { [$0.qn, $0.bpm] },
            "timesig": meta.timesig.map { [$0.qn, $0.num, $0.den] },
        ]

        // 3. uitpakken in een tijdelijke map en op zijn plaats zetten (bestaat het nummer al, dan niets overschrijven)
        let songs = app.player.songsRoot
        let dest = (songs as NSString).appendingPathComponent(safe)
        if fm.fileExists(atPath: dest) { throw fail("\"\(safe)\" staat al op deze computer. Haal het eerst weg (Prullenbak) als je het opnieuw wilt importeren.") }
        let incoming = (songs as NSString).appendingPathComponent(".ophalen/\(id)")
        try fm.createDirectory(atPath: incoming, withIntermediateDirectories: true)
        defer { try? fm.removeItem(atPath: incoming) }                    // onze eigen tijdelijke map
        update(id) { $0.state = "uitpakken"; $0.title = title; $0.folder = safe; $0.rpp = rpp }
        let p = Process(); p.executableURL = URL(fileURLWithPath: "/usr/bin/ditto"); p.arguments = ["-x", "-k", zipPath, incoming]
        try p.run(); p.waitUntilExit()
        guard p.terminationStatus == 0 else { throw fail("Uitpakken mislukt") }
        let src = root.isEmpty ? incoming : (incoming as NSString).appendingPathComponent(root)
        try fm.moveItem(atPath: src, toPath: dest)

        // 4. eigen click en speelbestand
        update(id) { $0.state = "click" }
        let clicks = try makeClicks(dir: dest, desc: desc)
        desc["stems"] = stems + clicks
        let data = try JSONSerialization.data(withJSONObject: desc, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: URL(fileURLWithPath: (dest as NSString).appendingPathComponent("ark-player.json")), options: .atomic)
        app.player.scanLibrary()
        update(id) { $0.state = "klaar"; $0.progress = 1; $0.message = missing.isEmpty ? "" : "\(missing.count) stems ontbraken in de zip" }
    }
}
