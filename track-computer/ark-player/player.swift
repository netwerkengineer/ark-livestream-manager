// Player: alles rond de mixer wat REAPER + de bridge samen deden - nummers en setlist, overgangen tussen nummers,
// FreeShow-cues (REST) met voorlooptijd, timing opnemen en de bewaarde instellingen.

import Foundation

struct LibSong { let name: String; let path: String; let folder: String }

/// Instellingen die na een herstart bewaard blijven (zoals ExtState in de bridge).
final class Config {
    var outputMode = "stereo", jumpMode = "end"
    var leadBeats = 2.0
    var fsHost = "", fsPort = 5506
    var lastHost = "", lastPort = 5506     // het adres dat de server het laatst opgaf: zonder server blijft dat bruikbaar
    var device = ""              // audioapparaat (naam); leeg = standaardapparaat
    var songsRoot = ""           // map met de nummers; leeg = ~/Tracks/Songs
    let path: String
    init() { path = ProcessInfo.processInfo.environment["ARK_PLAYER_CONFIG"] ?? (NSHomeDirectory() + "/Library/Application Support/ArkPlayer/config.json") }
    func load() {
        guard let d = try? Data(contentsOf: URL(fileURLWithPath: path)), let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return }
        outputMode = j["output_mode"] as? String ?? outputMode
        jumpMode = j["jump_mode"] as? String ?? jumpMode
        leadBeats = (j["lead_beats"] as? NSNumber)?.doubleValue ?? leadBeats
        fsHost = j["freeshow_host"] as? String ?? fsHost
        fsPort = (j["freeshow_port"] as? NSNumber)?.intValue ?? fsPort
        lastHost = j["freeshow_last_host"] as? String ?? lastHost
        lastPort = (j["freeshow_last_port"] as? NSNumber)?.intValue ?? lastPort
        device = j["device"] as? String ?? device
        songsRoot = j["songs_root"] as? String ?? songsRoot
    }
    func save() {
        let j: [String: Any] = ["output_mode": outputMode, "jump_mode": jumpMode, "lead_beats": leadBeats, "freeshow_host": fsHost, "freeshow_port": fsPort, "freeshow_last_host": lastHost, "freeshow_last_port": lastPort, "device": device, "songs_root": songsRoot]
        try? FileManager.default.createDirectory(atPath: (path as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
        if let d = try? JSONSerialization.data(withJSONObject: j, options: [.prettyPrinted, .sortedKeys]) { try? d.write(to: URL(fileURLWithPath: path), options: .atomic) }
    }
}

extension Song {
    var memBytes: Int { stems.reduce(0) { $0 + $1.frames * $1.ch.count * 4 } }
}

final class Player {
    let mixer: Mixer
    let output: Output?
    let cfg = Config()
    let lock = NSRecursiveLock()
    var songsRoot = NSHomeDirectory() + "/Tracks/Songs"
    var maxCacheBytes = 6_000_000_000

    var library: [LibSong] = []
    var cache: [String: Song] = [:]            // songmap -> geladen nummer
    var loading: Set<String> = []
    var setlist: [String] = []
    var activePath = "", activeFolder = ""
    var wantActive: (path: String, folder: String, cueNow: Bool)? = nil
    var switchTarget: (path: String, folder: String)? = nil
    var error: String?, lastCmd = ""

    // cues
    var table: CueTable?
    var timeline: [SlideTime] = []
    var sent: Int?
    var wasPlaying = false
    var cueWhenStopped = false
    var rec: Recording?
    var lastTaps: [String: Any] = [:]
    var seenSwitch = 0
    var lastScan = Date()
    var fsRuntimeHost = "", fsRuntimePort = 5506      // adres van de server-instellingen (niet bewaard); een eigen adres in cfg gaat voor
    var onFreeShow: ((String, String) -> Void)?   // hook voor tests
    var timer: DispatchSourceTimer?

    init(mixer: Mixer, output: Output?) { self.mixer = mixer; self.output = output }

    var song: Song { mixer.song }

    // ------------------------------------------------------------- instellingen
    func start() {
        cfg.load()
        fsRuntimeHost = cfg.lastHost; fsRuntimePort = cfg.lastPort
        mixer.requested = cfg.outputMode; mixer.jumpMode = cfg.jumpMode
        if !cfg.songsRoot.isEmpty { songsRoot = cfg.songsRoot }
        scanLibrary()
        let t = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "ark-player.cues"))
        t.schedule(deadline: .now() + 0.1, repeating: .milliseconds(40))
        t.setEventHandler { [weak self] in self?.tick() }
        t.resume(); timer = t
    }

    func setLead(_ beats: Double) throws {
        guard beats >= 0 && beats <= 4 else { throw PlayerError("Ongeldige voorlooptijd") }
        lock.lock(); defer { lock.unlock() }
        cfg.leadBeats = beats; cfg.save(); rebuildTimeline()
    }
    var fsHost: String { cfg.fsHost.isEmpty ? fsRuntimeHost : cfg.fsHost }
    var fsPort: Int { cfg.fsHost.isEmpty ? fsRuntimePort : cfg.fsPort }
    func setFreeShowRuntime(host: String, port: Int?) {
        lock.lock(); defer { lock.unlock() }
        fsRuntimeHost = host; if let p = port { fsRuntimePort = p }; sent = nil
        if !host.isEmpty, host != cfg.lastHost || fsRuntimePort != cfg.lastPort { cfg.lastHost = host; cfg.lastPort = fsRuntimePort; cfg.save() }
    }
    func setFreeShow(host: String, port: Int?) {
        lock.lock(); defer { lock.unlock() }
        cfg.fsHost = host; if let p = port { cfg.fsPort = p }; cfg.save(); sent = nil
    }
    func setSongsRoot(_ path: String) { lock.lock(); songsRoot = path.isEmpty ? NSHomeDirectory() + "/Tracks/Songs" : path; cfg.songsRoot = path; cfg.save(); lock.unlock(); scanLibrary() }
    func setDevice(_ name: String) { lock.lock(); cfg.device = name; cfg.save(); lock.unlock() }
    func setOutputMode(_ m: String) { lock.lock(); defer { lock.unlock() }; mixer.requested = m; mixer.applyRouting(); cfg.outputMode = m; cfg.save() }
    func setJumpMode(_ m: String) { lock.lock(); defer { lock.unlock() }; mixer.jumpMode = m; cfg.jumpMode = m; cfg.save() }

    // ------------------------------------------------------------- bibliotheek en nummers
    func folderOf(_ path: String) -> String {
        let f = path.lowercased().hasSuffix(".rpp") ? (path as NSString).deletingLastPathComponent : path
        return (f as NSString).standardizingPath
    }

    func scanLibrary() {
        var found: [LibSong] = []
        let fm = FileManager.default
        func walk(_ dir: String, _ depth: Int) {
            guard depth <= 3, let items = try? fm.contentsOfDirectory(atPath: dir) else { return }
            if items.contains("ark-player.json"), let d = try? Data(contentsOf: URL(fileURLWithPath: dir + "/ark-player.json")),
               let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any] {
                let rpp = j["rpp"] as? String
                found.append(LibSong(name: j["title"] as? String ?? (dir as NSString).lastPathComponent, path: rpp != nil ? dir + "/" + rpp! : dir, folder: dir))
                return
            }
            for i in items.sorted() where !i.hasPrefix(".") {
                var isDir: ObjCBool = false
                if fm.fileExists(atPath: dir + "/" + i, isDirectory: &isDir), isDir.boolValue { walk(dir + "/" + i, depth + 1) }
            }
        }
        walk(songsRoot, 0)
        lock.lock(); library = found.sorted { $0.name.lowercased() < $1.name.lowercased() }; lock.unlock()
        log("Bibliotheek: \(found.count) nummers met ark-player.json in \(songsRoot)")
    }

    /// Nummer in het geheugen zetten (op de achtergrond). completion draait nadat het klaar is.
    func ensureLoaded(path: String, completion: (() -> Void)? = nil) {
        let f = folderOf(path)
        lock.lock()
        if cache[f] != nil { lock.unlock(); completion?(); return }
        if loading.contains(f) { lock.unlock(); return }
        loading.insert(f); lock.unlock()
        DispatchQueue.global().async { [self] in
            let t0 = Date()
            do {
                let s = try loadSong(folder: f)
                lock.lock()
                cache[f] = s; loading.remove(f)
                log("Geladen: \(s.title), \(s.stems.count) stems, \(s.memBytes / 1_000_000) MB in \(String(format: "%.1f", Date().timeIntervalSince(t0))) s")
                if let w = wantActive, w.folder == f { wantActive = nil; activate(path: w.path, folder: f, cueNow: w.cueNow) }
                lock.unlock()
            } catch {
                lock.lock(); loading.remove(f); self.error = error.localizedDescription; wantActive = nil; lock.unlock()
                log("Laden mislukt: \(error)")
            }
            completion?()
        }
    }

    /// Dit nummer actief maken: stoppen, naar het begin, cues voor dit nummer. Moet onder de lock draaien.
    private func activate(path: String, folder: String, cueNow: Bool) {
        guard let s = cache[folder] else { return }
        mixer.playing = false; mixer.stopLoop(); mixer.cancelPending(); mixer.pendSongAt = -1; mixer.pendSongObj = nil
        mixer.applyRouting(to: s); mixer.pos = 0; mixer.song = s
        useSong(s, path: path, folder: folder, cueNow: cueNow)
        error = nil
    }

    private func useSong(_ s: Song, path: String, folder: String, cueNow: Bool) {
        activePath = path; activeFolder = folder
        loadCues(s)
        sent = nil; cueWhenStopped = cueNow; rec = nil
        if let id = table?.showId { freeshowCall("id_select_show", "{\"id\":\"\(id)\"}") }
    }

    /// Ander nummer kiezen. Speelt er iets en is er een modus (end | bar | now), dan op dat muzikale moment overgaan: het huidige
    /// nummer fadet kort uit en het nieuwe begint bij zijn Count Off. Zonder modus of stilstaand: stoppen en klaarzetten.
    func selectSong(path: String, mode: String?) throws {
        lock.lock(); defer { lock.unlock() }
        let f = folderOf(path)
        mixer.pendSongAt = -1; mixer.pendSongObj = nil; switchTarget = nil
        if mixer.playing, let m = mode, ["end", "bar", "now"].contains(m), f != activeFolder {
            guard let n = cache[f] else { throw PlayerError("Dit nummer staat nog niet klaar (zet de setlist klaar)") }
            let cur = mixer.song, pos = mixer.posSec, tm = cur.tempo
            var at: Double
            switch m {
            case "end": at = mixer.sectionIndex(at: mixer.pos).map { cur.sections[$0].end } ?? pos + 0.3; mixer.stopLoop()
            case "bar": at = tm.nextBar(after: pos + 0.001)
            default: at = pos + 0.35
            }
            let beat = tm.sec(qn: tm.qn(sec: at)) - tm.sec(qn: tm.qn(sec: at) - 1)
            let fade = min(beat, m == "now" ? 0.3 : 0.6)
            let from = max(pos, at - fade)
            mixer.applyRouting(to: n)
            switchTarget = (path, f)
            mixer.songFade = mixer.frame(at - from); mixer.pendSongObj = n; mixer.pendSongAt = mixer.frame(at)
            return
        }
        wantActive = nil
        if cache[f] != nil { activate(path: path, folder: f, cueNow: true) }
        else { wantActive = (path, f, true); ensureLoaded(path: path) }
    }

    func cancelSong() { lock.lock(); mixer.pendSongAt = -1; mixer.pendSongObj = nil; switchTarget = nil; lock.unlock() }

    func setSetlist(_ paths: [String]) {
        lock.lock(); setlist = paths.filter { !$0.isEmpty }; let list = setlist; lock.unlock()
        DispatchQueue.global().async { [self] in
            for p in list {
                lock.lock(); let used = cache.values.reduce(0) { $0 + $1.memBytes }; let have = cache[folderOf(p)] != nil; lock.unlock()
                if have { continue }
                if used > maxCacheBytes { log("Setlist: geheugenlimiet bereikt, rest wordt later geladen"); break }
                let sem = DispatchSemaphore(value: 0)
                ensureLoaded(path: p) { sem.signal() }
                sem.wait()
            }
            lock.lock()
            let keep = Set(list.map { folderOf($0) } + [activeFolder])
            for k in cache.keys where !keep.contains(k) && mixer.song !== cache[k] { cache[k] = nil }
            lock.unlock()
        }
    }

    var nextSong: String? {
        guard let i = setlist.firstIndex(where: { folderOf($0) == activeFolder }), i + 1 < setlist.count else { return nil }
        return setlist[i + 1]
    }

    // ------------------------------------------------------------- cues
    func cuesPath(for s: Song) -> String? {
        let rpp = s.rpp ?? ((try? FileManager.default.contentsOfDirectory(atPath: s.folder)) ?? []).first(where: { $0.lowercased().hasSuffix(".rpp") })
        return rpp.map { s.folder + "/" + $0 + ".cues" }
    }

    private func loadCues(_ s: Song) {
        table = nil; timeline = []
        if let p = cuesPath(for: s) { table = CueTable.read(path: p) }
        rebuildTimeline()
    }

    func rebuildTimeline() {
        if let t = table { timeline = buildTimeline(song: mixer.song, table: t, lead: cfg.leadBeats) } else { timeline = [] }
    }

    /// Cuetabel van de app opslaan: "show:ID@LAYOUT;regionId:dia,dia;..." (leeg = cues uit voor dit nummer)
    func saveCues(path: String, data: String) throws {
        lock.lock(); defer { lock.unlock() }
        let f = folderOf(path)
        // het RPP-bestand zelf hoeft er niet te staan (de desktop-app heeft alleen de stems en het speelbestand), de map wel
        guard path.lowercased().hasSuffix(".rpp"), FileManager.default.fileExists(atPath: f) else { throw PlayerError("Map van het nummer niet gevonden") }
        let file = path + ".cues"
        if data.isEmpty { try? FileManager.default.removeItem(atPath: file) }
        else {
            var out = "ark-cues 4\n"
            for entry in data.split(separator: ";") {
                let e = String(entry)
                if e.hasPrefix("show:") {
                    let body = e.dropFirst(5).split(separator: "@", omittingEmptySubsequences: false)
                    out += "show \(body.first ?? "") \(body.count > 1 ? String(body[1]) : "")\n"
                } else if let c = e.firstIndex(of: ":"), Int(e[e.startIndex..<c]) != nil {
                    out += "\(e[e.startIndex..<c]) \(e[e.index(after: c)...].replacingOccurrences(of: ",", with: " "))\n"
                }
            }
            try out.write(toFile: file, atomically: true, encoding: .utf8)
        }
        if f == activeFolder { loadCues(mixer.song); sent = nil }
    }

    func freeshowCall(_ action: String, _ data: String) {
        onFreeShow?(action, data)
        guard !fsHost.isEmpty else { return }
        var c = URLComponents(); c.scheme = "http"; c.host = fsHost; c.port = fsPort; c.path = "/"
        c.queryItems = [URLQueryItem(name: "action", value: action), URLQueryItem(name: "data", value: data)]
        guard let url = c.url else { return }
        URLSession.shared.dataTask(with: URLRequest(url: url, timeoutInterval: 2)).resume()   // op de achtergrond: niet wachten
    }

    func sendSlide(_ n: Int) {
        guard let id = table?.showId else { return }
        let layout = table?.layoutId.map { "\"layoutId\":\"\($0)\"," } ?? ""
        freeshowCall("index_select_slide", "{\"showId\":\"\(id)\",\(layout)\"index\":\(n)}")
    }

    // --- hulpfuncties op de tijdlijn
    func sectionIndex(at t: Double) -> Int? { mixer.song.sections.lastIndex(where: { $0.start <= t + 0.0005 }) }
    func leadSeconds(_ pos: Double) -> Double { let tm = mixer.song.tempo; return pos - tm.sec(qn: tm.qn(sec: pos) - cfg.leadBeats) }
    func slideAtTime(_ pos: Double) -> Int? { var pick: Int?; for e in timeline { if e.t <= pos + 0.001 { pick = e.n } else { break } }; return pick }

    /// Dia's van een sectie in de tijdlijn: vanaf `lead` voor het begin tot het einde
    func regionNotes(_ idx: Int) -> [Int] {
        guard idx >= 0 && idx < mixer.song.sections.count else { return [] }
        let r = mixer.song.sections[idx]
        let from = r.start - leadSeconds(r.start) - 0.05
        return timeline.indices.filter { timeline[$0].t >= from && timeline[$0].t < r.end }
    }
    func firstSlideOf(_ idx: Int) -> Int? {
        if let i = regionNotes(idx).first { return timeline[i].n }
        let sec = mixer.song.sections[idx]
        return table?.regions[sec.id]?.first?.n
    }
    func recordedSlide(_ idx: Int?) -> Int? {
        guard let idx = idx else { return nil }
        let notes = regionNotes(idx)
        if notes.isEmpty { return nil }
        if rec?.region != idx { rec?.region = idx; rec?.idx = 1 }
        return timeline[notes[min(rec?.idx ?? 1, notes.count) - 1]].n
    }

    func slideAt(_ pos: Double, playing: Bool) -> Int? {
        if !playing { return slideAtTime(pos) }
        let s = mixer.song, tm = s.tempo
        let cur = sectionIndex(at: pos)
        let look = tm.sec(qn: tm.qn(sec: pos) + cfg.leadBeats)
        var target: Int? = nil
        if mixer.pendSection >= 0 && mixer.pendAt >= 0 && look >= Double(mixer.pendAt) / mixer.sr { target = mixer.pendSection }
        else if let c = cur, mixer.loopSec == c, look >= s.sections[c].end { target = c }
        if rec != nil { return recordedSlide(target ?? sectionIndex(at: look)) }
        if let t = target { return firstSlideOf(t) }
        return slideAtTime(pos)
    }

    /// Elke 40 ms: nummerwissel opmerken, dia bepalen en naar FreeShow sturen (updateCues in de bridge)
    func tick() {
        lock.lock(); defer { lock.unlock() }
        // nieuwe nummers in de map (bijvoorbeeld net gekopieerd) vanzelf oppikken
        if !mixer.playing && Date().timeIntervalSince(lastScan) > 10 {
            lastScan = Date()
            DispatchQueue.global().async { [self] in scanLibrary() }
        }
        if mixer.switched != seenSwitch {
            seenSwitch = mixer.switched
            if let t = switchTarget { useSong(mixer.song, path: t.path, folder: t.folder, cueNow: false); switchTarget = nil }
        }
        let playing = mixer.playing
        if playing != wasPlaying {
            wasPlaying = playing
            if playing { sent = nil }
            else if mixer.pos >= mixer.song.total && mixer.song.total > 0, let n = nextSong {
                // einde van het nummer: het volgende uit de setlist klaarzetten (gestopt, bij zijn begin)
                let f = folderOf(n)
                if cache[f] != nil { activate(path: n, folder: f, cueNow: true) } else { wantActive = (n, f, true); ensureLoaded(path: n) }
            }
        }
        guard table != nil else { return }
        if !playing && !cueWhenStopped { return }
        let slide = slideAt(mixer.posSec, playing: playing)
        if let s = slide, s != sent, s >= 1 { sendSlide(s); sent = s }
        if !playing && slide != nil { cueWhenStopped = false }
    }

    // ------------------------------------------------------------- bediening met cues
    func jump(to idx: Int, mode: String?) -> String? {
        lock.lock(); defer { lock.unlock() }
        let was = mixer.playing
        let e = mixer.jump(to: idx, mode: mode)
        if e == nil && !was { cueWhenStopped = true }
        return e
    }

    func record(_ action: String) throws {
        lock.lock(); defer { lock.unlock() }
        switch action {
        case "start": rec = Recording(); sent = nil
        case "save":
            guard let r = rec else { throw PlayerError("Er wordt geen timing opgenomen") }
            var sections: [String: Any] = [:]
            for (idx, taps) in r.taps where idx < mixer.song.sections.count {
                sections[mixer.song.sections[idx].name] = taps.sorted { $0.key < $1.key }.map { [$0.key, $0.value] }
            }
            let rpp = cuesPath(for: mixer.song).map { String($0.dropLast(5)) } ?? ""
            lastTaps = ["path": rpp, "sections": sections]
            rec = nil; sent = nil
        default: rec = nil; sent = nil
        }
    }

    /// Tik tijdens het opnemen: volgende dia van de sectie, moment vastleggen
    func tap(pos: Double?) throws {
        lock.lock(); defer { lock.unlock() }
        guard rec != nil else { throw PlayerError("Er wordt geen timing opgenomen") }
        let p = pos ?? mixer.posSec
        guard let id = rec!.region ?? sectionIndex(at: p) else { return }
        let notes = regionNotes(id)
        guard !notes.isEmpty, rec!.idx < notes.count else { return }
        let s = mixer.song, tm = s.tempo, r = s.sections[id]
        let qs = tm.qn(sec: r.start), len = tm.qn(sec: r.end) - qs
        var q = ((tm.qn(sec: p) - qs) * 4 + 0.5).rounded(.down) / 4
        let prevQ = rec!.taps[id]?[rec!.idx]
        q = max(q, (prevQ ?? 0) + 0.5, 0.25)
        q = min(q, len - 0.5)
        rec!.region = id
        rec!.idx += 1
        rec!.taps[id, default: [:]][rec!.idx] = q
        timeline[notes[rec!.idx - 1]].t = tm.sec(qn: qs + q)        // het moment van deze dia in de tijdlijn
        timeline.sort { $0.t < $1.t }
    }
}

struct PlayerError: LocalizedError {
    let message: String
    init(_ m: String) { message = m }
    var errorDescription: String? { message }
}
