// ark-player - prototype van een eigen multitrack-speler voor de kerkband (macOS)
//
// Doel: op termijn REAPER vervangen voor het afspelen van de tracks. Stand: stap 2 (2 kanalen eerst).
// Kan: song-map laden (stems + song.json), alle stems in het geheugen, afspelen op een audioapparaat,
// uitgangsmodi (stereo | 2ch | 3ch | multi | auto, zoals de bridge), start/pauze/stop/zoeken, mute/volume,
// meters, secties met sprongen (einde sectie | volgende maat | meteen) sample-nauwkeurig, loop van een sectie,
// de guide-aankondiging bij een sprong, Click-stems en LIVE-stems standaard gemute, lokale HTTP-API.
// Nog niet: setlist/overgangen en FreeShow-cues (stap 3).
//
// Bouwen:   swiftc -O -swift-version 5 ark-player.swift -o ark-player
// Gebruik:  ark-player serve [--port 8099] [--device NAAM] [--mode stereo|2ch|3ch|multi|auto] [--master-db -6] [songmap]
//           ark-player jumptest <songmap> <vanaf-sec> <sectie-id> [end|bar|now] [--loop]   (offline sprongtest)
//           ark-player selftest <songmap> [start-sec] [duur-sec]   (offline mixen, geen geluid)
//           ark-player devices
// Songmap:  song.json (title, bpm/tempo, timesig, sections, stems[{file,name}]) of alleen .wav-bestanden.

import AVFoundation
import AudioToolbox
import CoreAudio
import Foundation
import Network

private let logQueue = DispatchQueue(label: "ark.log")
func log(_ s: String) {
    let f = DateFormatter(); f.dateFormat = "HH:mm:ss.SSS"
    let line = "\(f.string(from: Date())) \(s)\n"
    FileHandle.standardError.write(Data(line.utf8))
    // ook in een bestand (~/Library/Logs/ArkTracks.log, klein gehouden), zodat een probleem achteraf te bekijken is
    logQueue.async {
        let dir = NSHomeDirectory() + "/Library/Logs", path = dir + "/ArkTracks.log"
        let day = DateFormatter(); day.dateFormat = "yyyy-MM-dd "
        let fm = FileManager.default
        if let size = (try? fm.attributesOfItem(atPath: path))?[.size] as? Int, size > 1_000_000 { try? fm.removeItem(atPath: path + ".1"); try? fm.moveItem(atPath: path, toPath: path + ".1") }
        if !fm.fileExists(atPath: path) { fm.createFile(atPath: path, contents: nil) }
        if let h = FileHandle(forWritingAtPath: path) { h.seekToEndOfFile(); h.write(Data((day.string(from: Date()) + line).utf8)); try? h.close() }
    }
}

// ------------------------------------------------------------- bus-indeling (zoals busses.example.json)
let defaultBusses: [(name: String, out: Int, match: [String])] = [
    ("CLICK", 1, ["click*", "metronome*"]),
    ("GUIDE", 2, ["guide*", "cues*"]),
    ("DRUMS / PERC", 3, ["drum*", "perc*", "loop*"]),
    ("BASS", 4, ["bass*", "synth bass*", "sub*"]),
    ("KEYS", 5, ["keys*", "piano*", "organ*", "synth*", "rhodes*"]),
    ("GITAREN", 6, ["eg*", "ag*", "gtr*", "guitar*"]),
    ("BGV / KOOR", 7, ["choir*", "bgv*", "vox*", "vocal*", "voc*", "soprano*", "alto*", "tenor*", "bari*", "gang*"]),
    ("PADS / STRINGS / FX", 8, ["pad*", "string*", "fx*", "synth fx*", "brass*"]),
]
let priorityBusses: [(pattern: String, out: Int)] = [("synth fx*", 8), ("synth bass*", 4), ("vox fx*", 7)]

func busFor(stem: String) -> (out: Int, name: String) {
    let s = stem.lowercased().trimmingCharacters(in: .whitespaces)
    for p in priorityBusses where fnmatch(p.pattern, s, 0) == 0 {
        if let b = defaultBusses.first(where: { $0.out == p.out }) { return (b.out, b.name) }
    }
    for b in defaultBusses { for pat in b.match where fnmatch(pat, s, 0) == 0 { return (b.out, b.name) } }
    return (8, "PADS / STRINGS / FX")
}

// ------------------------------------------------------------- model
final class Stem {
    let name: String
    let frames: Int
    let ch: [UnsafeMutablePointer<Float>]
    let bus: Int          // 1-based uitgang in multi-modus
    let busName: String
    let monitor: Bool     // click of guide
    let isGuide: Bool
    var live = false      // LIVE-stem: standaard gemute (de band speelt het zelf)
    var gain: Float = 1
    var mute = false
    var solo = false
    var peak: Float = 0
    // routing (volgt uit de uitgangsmodus)
    var outA = 0, outB = -1, mono = false, trim: Float = 1
    init(name: String, frames: Int, ch: [UnsafeMutablePointer<Float>]) {
        self.name = name; self.frames = frames; self.ch = ch
        let b = busFor(stem: name); bus = b.out; busName = b.name
        let up = name.uppercased().trimmingCharacters(in: .whitespaces)
        monitor = up.hasPrefix("CLICK") || up.hasPrefix("GUIDE") || b.name == "CLICK" || b.name == "GUIDE"
        isGuide = up.hasPrefix("GUIDE")
    }
    deinit { ch.forEach { $0.deallocate() } }
}

let liveStems = ["drums*", "bass", "keys", "piano 1*", "eg 1*"]
func isLive(_ name: String) -> Bool { let s = name.lowercased(); return liveStems.contains { fnmatch($0, s, 0) == 0 } }

struct Section { var id = 0; let name: String; var start: Double; var end: Double }

// Tempo-afhankelijke tijden. Maten -> kwartnoten (qnPerBar) -> seconden, met stapsgewijze tempowissels.
struct TempoMap {
    var seg: [(qn: Double, sec: Double, bpm: Double)] = [(0, 0, 120)]
    var qnPerBar = 4.0
    var sigs: [(qn: Double, qpb: Double)] = [(0, 4)]       // maatsoort per stuk: kwartnoten per maat
    init() {}
    /// Uit ark-player.json: tempo en maatsoort in kwartnoten (zoals Ableton/MultiTracks ze geeft)
    init(tempoQN: [(qn: Double, bpm: Double)], sigs sg: [(qn: Double, num: Double, den: Double)]) {
        var out: [(qn: Double, sec: Double, bpm: Double)] = []
        for t in tempoQN.sorted(by: { $0.qn < $1.qn }) {
            if let l = out.last { out.append((t.qn, l.sec + (t.qn - l.qn) * 60 / l.bpm, t.bpm)) } else { out.append((0, 0, t.bpm)) }
        }
        if !out.isEmpty { seg = out }
        let list = sg.sorted(by: { $0.qn < $1.qn }).map { (qn: $0.qn, qpb: $0.num * 4 / $0.den) }
        if !list.isEmpty { sigs = list; qnPerBar = list[0].qpb }
    }
    init(tempo: [(bar: Double, bpm: Double)], qnPerBar: Double) {
        self.qnPerBar = qnPerBar
        self.sigs = [(0, qnPerBar)]
        var out: [(qn: Double, sec: Double, bpm: Double)] = []
        for t in tempo.sorted(by: { $0.bar < $1.bar }) {
            let qn = (t.bar - 1) * qnPerBar
            if let l = out.last { out.append((qn, l.sec + (qn - l.qn) * 60 / l.bpm, t.bpm)) } else { out.append((0, 0, t.bpm)) }
        }
        if !out.isEmpty { seg = out }
    }
    func sec(qn: Double) -> Double { let s = seg.last(where: { $0.qn <= qn }) ?? seg[0]; return s.sec + (qn - s.qn) * 60 / s.bpm }
    func qn(sec: Double) -> Double { let s = seg.last(where: { $0.sec <= sec }) ?? seg[0]; return s.qn + (sec - s.sec) * s.bpm / 60 }
    func sec(bar: Double) -> Double { sec(qn: (bar - 1) * qnPerBar) }
    /// begin van de eerstvolgende maat na (of op) tijdstip t
    func nextBar(after t: Double) -> Double {
        let q = qn(sec: t)
        let i = sigs.lastIndex(where: { $0.qn <= q + 1e-9 }) ?? 0
        let n = ((q - sigs[i].qn) / sigs[i].qpb).rounded(.up)
        var cand = sigs[i].qn + n * sigs[i].qpb
        if i + 1 < sigs.count && sigs[i + 1].qn < cand - 1e-9 { cand = sigs[i + 1].qn }   // een maatwissel begint op een maatgrens
        return sec(qn: cand)
    }
    /// "maat.tel.honderdsten" zoals REAPER het toont, bijvoorbeeld 12.3.50
    func barBeat(qn q: Double) -> String {
        let q = max(0, q)
        var bars = 0.0
        var i = 0
        while i + 1 < sigs.count && sigs[i + 1].qn <= q + 1e-9 { bars += (sigs[i + 1].qn - sigs[i].qn) / sigs[i].qpb; i += 1 }
        let into = q - sigs[i].qn
        let bar = bars + (into / sigs[i].qpb).rounded(.down) + 1
        let inBar = into.truncatingRemainder(dividingBy: sigs[i].qpb)
        let beat = inBar.rounded(.down) + 1
        let frac = Int(((inBar - inBar.rounded(.down)) * 100).rounded(.down))
        return "\(Int(bar)).\(Int(beat)).\(String(format: "%02d", frac))"
    }
    func nextBeat(after t: Double) -> Double { sec(qn: qn(sec: t).rounded(.up)) }
}

final class Song {
    var title = ""
    var folder = ""
    var stems: [Stem] = []
    var sections: [Section] = []
    var tempo = TempoMap()
    var sampleRate = 48000.0
    var hasOriginalClick = false
    var rpp: String?                // naam van het REAPER-project naast de stems (de cuetabel heet <rpp>.cues)
    var total: Int { stems.map { $0.frames }.max() ?? 0 }
}

func parseSong(_ j: [String: Any], total: Double) -> (sections: [Section], tempo: TempoMap) {
    var tempoList: [(bar: Double, bpm: Double)] = []
    if let t = j["tempo"] as? [[Any]] { tempoList = t.compactMap { r in
        guard r.count == 2, let b = (r[0] as? NSNumber)?.doubleValue, let v = (r[1] as? NSNumber)?.doubleValue else { return nil }; return (b, v) } }
    else if let b = (j["bpm"] as? NSNumber)?.doubleValue { tempoList = [(1, b)] }
    var qnPerBar = 4.0
    if let ts = j["timesig"] as? String {
        let p = ts.split(separator: "/").compactMap { Double($0) }
        if p.count == 2 { qnPerBar = p[0] * 4 / p[1] }
    }
    let tm = tempoList.isEmpty ? TempoMap() : TempoMap(tempo: tempoList, qnPerBar: qnPerBar)
    var out: [Section] = []
    for s in (j["sections"] as? [Any] ?? []) {
        if let a = s as? [Any], a.count == 2, let n = a[0] as? String, let bar = (a[1] as? NSNumber)?.doubleValue { out.append(Section(name: n, start: tm.sec(bar: bar), end: 0)) }
        else if let d = s as? [String: Any], let n = d["name"] as? String {
            if let sec = (d["sec"] as? NSNumber)?.doubleValue { out.append(Section(name: n, start: sec, end: 0)) }
            else if let bar = (d["bar"] as? NSNumber)?.doubleValue { out.append(Section(name: n, start: tm.sec(bar: bar), end: 0)) }
        }
    }
    out.sort { $0.start < $1.start }
    for i in 0..<out.count { out[i].id = i + 1; out[i].end = i + 1 < out.count ? out[i + 1].start : total }
    return (out, tm)
}

func loadStem(url: URL, name: String, offsetFrames: Int = 0) throws -> Stem {
    let f = try AVAudioFile(forReading: url)
    let fmt = f.processingFormat                       // float32, niet-geinterleaved
    let n = Int(f.length), chn = min(2, Int(fmt.channelCount))
    let lead = max(0, offsetFrames)                    // een stem die later begint: stilte ervoor
    if fmt.sampleRate != 48000 { return try loadStemResampled(file: f, name: name, lead: lead, chn: chn) }
    var ch: [UnsafeMutablePointer<Float>] = []
    for _ in 0..<chn { let p = UnsafeMutablePointer<Float>.allocate(capacity: max(n + lead, 1)); p.initialize(repeating: 0, count: max(n + lead, 1)); ch.append(p) }
    let block: AVAudioFrameCount = 1 << 16
    guard let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: block) else { throw NSError(domain: "ark", code: 1) }
    var done = 0
    while done < n {
        try f.read(into: buf, frameCount: min(block, AVAudioFrameCount(n - done)))
        let got = Int(buf.frameLength); if got == 0 { break }
        for c in 0..<chn { memcpy(ch[c] + lead + done, buf.floatChannelData![c], got * 4) }
        done += got
    }
    return Stem(name: name, frames: lead + done, ch: ch)
}

/// Een stem met een andere samplefrequentie (MultiTracks: 44,1 kHz) naar 48 kHz omrekenen, in het geheugen, met de beste kwaliteit.
/// De speler werkt altijd op 48 kHz; zonder omrekenen klinkt zo'n nummer te snel en te hoog.
func loadStemResampled(file f: AVAudioFile, name: String, lead: Int, chn: Int) throws -> Stem {
    let inFmt = f.processingFormat
    guard let outFmt = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48000, channels: AVAudioChannelCount(chn), interleaved: false),
          let conv = AVAudioConverter(from: inFmt, to: outFmt) else { throw NSError(domain: "ark", code: 4, userInfo: [NSLocalizedDescriptionKey: "\(name): omrekenen naar 48 kHz niet mogelijk"]) }
    conv.sampleRateConverterQuality = AVAudioQuality.max.rawValue
    let nIn = Int(f.length)
    let want = Int((Double(nIn) * 48000 / inFmt.sampleRate).rounded())
    let block: AVAudioFrameCount = 1 << 15
    guard let inBuf = AVAudioPCMBuffer(pcmFormat: inFmt, frameCapacity: block), let outBuf = AVAudioPCMBuffer(pcmFormat: outFmt, frameCapacity: 1 << 16) else { throw NSError(domain: "ark", code: 1) }
    var out = [[Float]](repeating: [], count: chn)
    for c in 0..<chn { out[c].reserveCapacity(want + 4096) }
    var readFrames = 0
    var readError: Error?
    while true {
        var err: NSError?
        let status = conv.convert(to: outBuf, error: &err) { _, inStatus in
            if readFrames >= nIn || readError != nil { inStatus.pointee = .endOfStream; return nil }
            do { try f.read(into: inBuf, frameCount: min(block, AVAudioFrameCount(nIn - readFrames))) } catch { readError = error; inStatus.pointee = .endOfStream; return nil }
            if inBuf.frameLength == 0 { inStatus.pointee = .endOfStream; return nil }
            readFrames += Int(inBuf.frameLength)
            inStatus.pointee = .haveData
            return inBuf
        }
        if let e = readError ?? err { throw e }
        let got = Int(outBuf.frameLength)
        if got > 0 { for c in 0..<chn { out[c].append(contentsOf: UnsafeBufferPointer(start: outBuf.floatChannelData![c], count: got)) } }
        if status == .endOfStream || status == .error || (status == .inputRanDry && got == 0) { break }
    }
    // precies de verwachte lengte (afronden): de rest weg of met stilte aanvullen
    let total = want + lead
    var ch: [UnsafeMutablePointer<Float>] = []
    for c in 0..<chn {
        let p = UnsafeMutablePointer<Float>.allocate(capacity: max(total, 1)); p.initialize(repeating: 0, count: max(total, 1))
        let n = min(want, out[c].count)
        out[c].withUnsafeBufferPointer { _ = memcpy(p + lead, $0.baseAddress!, n * 4) }
        ch.append(p)
    }
    return Stem(name: name, frames: total, ch: ch)
}

func loadSong(folder: String) throws -> Song {
    if let d = try? Data(contentsOf: URL(fileURLWithPath: folder).appendingPathComponent("ark-player.json")),
       let j = try JSONSerialization.jsonObject(with: d) as? [String: Any] { return try loadPlayerFile(folder: folder, json: j) }
    return try loadSongJson(folder: folder)
}

/// ark-player.json (door mt2reaper naast het RPP geschreven): stems met startpositie en standaard-mute, secties in seconden, tempo en maatsoort in kwartnoten
func loadPlayerFile(folder: String, json j: [String: Any]) throws -> Song {
    let song = Song(); song.folder = folder
    let base = URL(fileURLWithPath: folder)
    song.title = j["title"] as? String ?? base.lastPathComponent
    struct E { let file: String; let name: String; let offset: Int; let mute: Bool }
    var entries: [E] = []
    for s in (j["stems"] as? [[String: Any]] ?? []) {
        guard let f = s["file"] as? String else { continue }
        entries.append(E(file: f, name: s["name"] as? String ?? ((f as NSString).lastPathComponent as NSString).deletingPathExtension,
                         offset: Int(((s["offset"] as? NSNumber)?.doubleValue ?? 0) * song.sampleRate), mute: (s["mute"] as? Bool) ?? false))
    }
    var loaded = [Stem?](repeating: nil, count: entries.count)
    let lock = NSLock(); var failure: String?
    let gate = DispatchSemaphore(value: 3)        // niet alle stems tegelijk: elke stem heeft tijdens het omrekenen even het dubbele aan geheugen nodig
    DispatchQueue.concurrentPerform(iterations: entries.count) { i in
        gate.wait(); defer { gate.signal() }
        do { let st = try loadStem(url: base.appendingPathComponent(entries[i].file), name: entries[i].name, offsetFrames: entries[i].offset)
             st.mute = entries[i].mute; lock.lock(); loaded[i] = st; lock.unlock() }
        catch { lock.lock(); failure = "\(entries[i].file): \(error.localizedDescription)"; lock.unlock() }
    }
    if let f = failure { throw NSError(domain: "ark", code: 2, userInfo: [NSLocalizedDescriptionKey: f]) }
    song.stems = loaded.compactMap { $0 }
    if song.stems.isEmpty { throw NSError(domain: "ark", code: 3, userInfo: [NSLocalizedDescriptionKey: "Geen stems gevonden in \(folder)"]) }
    for st in song.stems { st.live = isLive(st.name) }
    let tempo = (j["tempo_qn"] as? [[Any]] ?? []).compactMap { r -> (qn: Double, bpm: Double)? in
        guard r.count == 2, let q = (r[0] as? NSNumber)?.doubleValue, let b = (r[1] as? NSNumber)?.doubleValue else { return nil }; return (q, b) }
    let sigs = (j["timesig"] as? [[Any]] ?? []).compactMap { r -> (qn: Double, num: Double, den: Double)? in
        guard r.count == 3, let q = (r[0] as? NSNumber)?.doubleValue, let n = (r[1] as? NSNumber)?.doubleValue, let d = (r[2] as? NSNumber)?.doubleValue else { return nil }; return (q, n, d) }
    song.tempo = tempo.isEmpty ? TempoMap() : TempoMap(tempoQN: tempo, sigs: sigs)
    var secs: [Section] = []
    for (k, s) in (j["sections"] as? [[String: Any]] ?? []).enumerated() {
        if let n = s["name"] as? String, let t = (s["sec"] as? NSNumber)?.doubleValue { secs.append(Section(id: (s["id"] as? NSNumber)?.intValue ?? (k + 1), name: n, start: t, end: 0)) }
    }
    secs.sort { $0.start < $1.start }
    let total = Double(song.total) / song.sampleRate
    for i in 0..<secs.count { secs[i].end = i + 1 < secs.count ? secs[i + 1].start : total }
    song.rpp = j["rpp"] as? String
    song.sections = secs
    song.hasOriginalClick = song.stems.contains { $0.name.lowercased().hasPrefix("click") && !$0.name.hasPrefix("Click 1/") }
    return song
}

func loadSongJson(folder: String) throws -> Song {
    let song = Song(); song.folder = folder
    let base = URL(fileURLWithPath: folder)
    var entries: [(file: String, name: String)] = []
    var json: [String: Any] = [:]
    let sj = base.appendingPathComponent("song.json")
    if let d = try? Data(contentsOf: sj), let j = try JSONSerialization.jsonObject(with: d) as? [String: Any] {
        json = j
        song.title = j["title"] as? String ?? base.lastPathComponent
        for s in (j["stems"] as? [[String: Any]] ?? []) { if let f = s["file"] as? String { entries.append((f, s["name"] as? String ?? (f as NSString).deletingPathExtension)) } }
    } else { song.title = base.lastPathComponent }
    let all = ((try? FileManager.default.contentsOfDirectory(atPath: folder)) ?? []).filter { $0.lowercased().hasSuffix(".wav") && !$0.hasPrefix("._") }.sorted()
    if entries.isEmpty { entries = all.map { ($0, ($0 as NSString).deletingPathExtension) } }
    // eigen click-stems (mt2reaper schrijft ze naast de stems, ze staan niet in song.json)
    song.hasOriginalClick = entries.contains { $0.name.lowercased().hasPrefix("click") }
    let ark: [(file: String, name: String)] = [("Ark Click 1-4.wav", "Click 1/4"), ("Ark Click 1-8.wav", "Click 1/8"), ("Ark Click 1-16.wav", "Click 1/16")]
    for c in ark where all.contains(c.file) && !entries.contains(where: { $0.file == c.file }) { entries.append(c) }
    var loaded = [Stem?](repeating: nil, count: entries.count)
    let lock = NSLock(); var failure: String?
    let gate = DispatchSemaphore(value: 3)        // niet alle stems tegelijk: elke stem heeft tijdens het omrekenen even het dubbele aan geheugen nodig
    DispatchQueue.concurrentPerform(iterations: entries.count) { i in
        gate.wait(); defer { gate.signal() }
        do { let s = try loadStem(url: base.appendingPathComponent(entries[i].file), name: entries[i].name); lock.lock(); loaded[i] = s; lock.unlock() }
        catch { lock.lock(); failure = "\(entries[i].file): \(error.localizedDescription)"; lock.unlock() }
    }
    if let f = failure { throw NSError(domain: "ark", code: 2, userInfo: [NSLocalizedDescriptionKey: f]) }
    song.stems = loaded.compactMap { $0 }
    if song.stems.isEmpty { throw NSError(domain: "ark", code: 3, userInfo: [NSLocalizedDescriptionKey: "Geen stems gevonden in \(folder)"]) }
    let parsed = parseSong(json, total: Double(song.total) / song.sampleRate)
    song.sections = parsed.sections; song.tempo = parsed.tempo
    for s in song.stems {
        s.live = isLive(s.name)
        if s.live { s.mute = true }                                   // de band speelt dit zelf
        if s.name.hasPrefix("Click 1/") { s.mute = !(song.hasOriginalClick && s.name == "Click 1/4") }  // zoals mt2reaper
    }
    return song
}

// ------------------------------------------------------------- mixer (draait in de audio-callback: geen allocaties, geen locks)
final class Mixer {
    var song = Song()
    var pos = 0
    var playing = false
    var env: Float = 0
    var master: Float = 1
    var masterMuted = false
    var masterNow: Float = 1
    var outCh = 2
    let pads = PadPlayer()          // pads lopen los van het nummer
    var sr = 48000.0
    var requested = "stereo"       // gevraagde uitgangsmodus: auto | multi | 2ch | 3ch | stereo
    var applied = "stereo"         // wat er echt gebeurt (hangt af van het aantal uitgangen)
    var jumpMode = "end"           // standaard sprongmoment: end | bar | now
    // geplande sprong en loop (alles in frames)
    var pendAt = -1, pendTo = 0, pendSection = -1
    var loopSec = -1, loopStart = 0, loopEnd = 0
    var fadeIn = 0
    var groupMute = [Bool](repeating: false, count: 10), groupSolo = [Bool](repeating: false, count: 10), groupGain = [Float](repeating: 1, count: 10)   // per bus (uitgangsnummer 1-8)
    var pendSongObj: Song? = nil, pendSongAt = -1, songFade = 0, switched = 0   // overgang naar een ander nummer
    let dip = 160                  // korte fade rond een sprong (~3,3 ms): geen klik
    // guide-aankondiging: in [gWs, gWe) speelt de guide-stem vanaf gSrc (gSrc < 0: stil)
    var gWs = -1, gWe = -1, gSrc = 0
    // meting
    var blocks = 0, maxMicros = 0.0, sumMicros = 0.0
    var lastJump: (from: Int, to: Int) = (-1, -1)
    var jumpCount = 0
    let envBuf = UnsafeMutablePointer<Float>.allocate(capacity: 16384)

    // --- uitgangsmodus (zoals de bridge): stereo | 2ch | 3ch | multi | auto
    func applyRouting() { applyRouting(to: song) }
    func applyRouting(to target: Song) {
        var how = requested
        if how == "auto" { how = outCh >= 8 ? "multi" : "stereo" }
        if how == "3ch" && outCh < 3 { how = outCh >= 2 ? "2ch" : "stereo" }
        if how == "2ch" && outCh < 2 { how = "stereo" }
        if how == "multi" && outCh < 8 { how = outCh >= 3 ? "3ch" : (outCh >= 2 ? "2ch" : "stereo") }
        applied = how
        for st in target.stems {
            st.trim = 1
            switch how {
            case "multi": st.outA = st.bus - 1; st.outB = -1; st.mono = true
            case "2ch": st.mono = true; st.outB = -1; st.outA = st.monitor ? 0 : 1; if st.monitor { st.trim = 0.7079 }
            case "3ch":
                if st.monitor { st.mono = true; st.outA = 0; st.outB = -1; st.trim = 0.7079 } else { st.mono = false; st.outA = 1; st.outB = 2 }
            default: st.mono = false; st.outA = 0; st.outB = 1
            }
        }
    }

    // --- tijd <-> frames
    func frame(_ sec: Double) -> Int { Int((sec * sr).rounded()) }
    var posSec: Double { Double(pos) / sr }
    func sectionIndex(at frameNo: Int) -> Int? {
        let t = Double(frameNo) / sr
        return song.sections.lastIndex(where: { $0.start <= t + 0.0005 })
    }

    // --- sprong naar een sectie
    func jump(to idx: Int, mode m: String?) -> String? {
        guard idx >= 0 && idx < song.sections.count else { return "sectie niet gevonden" }
        let mode = m ?? jumpMode
        let D = frame(song.sections[idx].start)
        stopLoop()
        if !playing || mode == "now" {
            if !playing { pos = D; pendAt = -1; pendSection = -1; clearGuide(); lastJump = (pos, D); return nil }
            gWs = -1; gWe = -1; pendTo = D; pendSection = idx; pendAt = pos + 256
            return nil
        }
        let now = posSec
        var T: Double
        if mode == "bar" {
            T = song.tempo.nextBar(after: now)
            if T - now < 0.15 { T = song.tempo.nextBar(after: T + 0.01) }
        } else {
            if let cur = sectionIndex(at: pos) { T = song.sections[cur].end } else { T = song.tempo.nextBar(after: now) }
            if T - now < 0.1 { T = song.tempo.nextBar(after: T + 0.01) }
        }
        T = min(T, Double(song.total) / sr)
        // guide: de originele aankondiging van de doelsectie ervoor in de plaats (twee maten, 8 kwartnoten)
        let tm = song.tempo
        var ws = tm.sec(qn: tm.qn(sec: T) - 8)
        if ws < now + 0.3 { ws = tm.nextBeat(after: now + 0.3) }
        gWs = -1; gWe = -1
        if song.stems.contains(where: { $0.isGuide }) && ws < T - 0.01 {
            let len = T - ws
            let beat = tm.sec(qn: tm.qn(sec: T)) - tm.sec(qn: tm.qn(sec: T) - 1)
            let src = D - frame(len)
            let w0 = frame(ws), w1 = frame(T)
            gSrc = (len >= beat * 0.9 && src >= 0) ? src : -1   // liever even stil dan een halve of verkeerde cue
            gWs = w0; gWe = w1
        }
        pendTo = D; pendSection = idx
        pendAt = frame(T)                                       // als laatste: de audio-thread kijkt hiernaar
        return nil
    }

    func cancelPending() { pendAt = -1; pendSection = -1; if loopSec < 0 { clearGuide() } }
    func clearGuide() { gWs = -1; gWe = -1 }

    func startLoop() -> String? {
        guard let cur = sectionIndex(at: pos) else { return "geen sectie op de huidige positie" }
        let sec = song.sections[cur]
        cancelPending()
        let tm = song.tempo
        let start = frame(sec.start), end = frame(sec.end)
        let ws = tm.sec(qn: tm.qn(sec: sec.end) - 8)
        var gs = -1, ge = -1, src = -1
        if song.stems.contains(where: { $0.isGuide }) && ws < sec.end - 0.01 {
            let len = sec.end - ws
            let beat = tm.sec(qn: tm.qn(sec: sec.end)) - tm.sec(qn: tm.qn(sec: sec.end) - 1)
            gs = frame(ws); ge = end
            src = (len >= beat * 0.9 && start - frame(len) >= 0) ? start - frame(len) : -1
        }
        gSrc = src; gWs = gs; gWe = ge
        loopStart = start; loopEnd = end; loopSec = cur
        return nil
    }
    func stopLoop() { if loopSec >= 0 { loopSec = -1; clearGuide() } }

    // --- audio
    func render(frames: Int, out: [UnsafeMutablePointer<Float>]) {
        let t0 = DispatchTime.now().uptimeNanoseconds
        let nOut = out.count
        for c in 0..<nOut { out[c].update(repeating: 0, count: frames) }
        var total = song.total
        var off = 0
        while off < frames {
            if !(playing || env > 0.0001) || total == 0 { for st in song.stems { st.peak *= 0.9 }; break }
            var seg = frames - off
            var event = 0
            if pendAt >= 0 {
                if pendAt <= pos { seg = 0; event = 1 } else if pendAt - pos < seg { seg = pendAt - pos; event = 1 }
            }
            if event != 1 && pendSongAt >= 0 {
                if pendSongAt <= pos { seg = 0; event = 5 } else if pendSongAt - pos < seg { seg = pendSongAt - pos; event = 5 }
            }
            if event == 0 && loopSec >= 0 {
                if loopEnd <= pos { seg = 0; event = 2 } else if loopEnd - pos < seg { seg = loopEnd - pos; event = 2 }
            }
            if event == 0 && total - pos <= seg { seg = max(0, total - pos); event = 3 }
            if seg > 0 { mix(n: seg, off: off, out: out); pos += seg; off += seg }
            if event == 1 { jumpCount += 1; lastJump = (pos, pendTo); pos = pendTo; pendAt = -1; pendSection = -1; fadeIn = dip; clearGuide() }
            else if event == 2 { jumpCount += 1; lastJump = (pos, loopStart); pos = loopStart; fadeIn = dip }
            else if event == 5 {
                switched += 1
                if let n = pendSongObj { song = n; total = n.total }
                pendSongObj = nil; pendSongAt = -1; pendAt = -1; pendSection = -1; loopSec = -1; clearGuide()
                lastJump = (pos, 0); pos = 0; fadeIn = dip
            }
            else if event == 3 { playing = false; pos = total; for st in song.stems { st.peak *= 0.9 }; break }
            if seg == 0 && event == 0 { break }
        }
        pads.mix(frames: frames, out: out, mode: applied)
        let us = Double(DispatchTime.now().uptimeNanoseconds - t0) / 1000
        blocks += 1; sumMicros += us; maxMicros = max(maxMicros, us)
    }

    func mix(n: Int, off: Int, out: [UnsafeMutablePointer<Float>]) {
        let nOut = out.count
        let step = Float(1.0 / (0.005 * sr))
        let target: Float = playing ? 1 : 0
        let fdip = Float(dip)
        let masterTarget: Float = masterMuted ? 0 : master
        let mk = Float(1.0 / (0.01 * sr))                 // ~10 ms: geen klik bij dempen of verschuiven
        for i in 0..<n {
            masterNow += (masterTarget - masterNow) * mk
            if env < target { env = min(target, env + step) } else if env > target { env = max(target, env - step) }
            var g = env
            let ap = pos + i
            if pendAt >= 0 { g *= min(1, max(0, Float(pendAt - ap) / fdip)) }
            if loopSec >= 0 { g *= min(1, max(0, Float(loopEnd - ap) / fdip)) }
            if pendSongAt >= 0 && songFade > 0 { g *= min(1, max(0, Float(pendSongAt - ap) / Float(songFade))) }
            if fadeIn > 0 { g *= Float(dip - fadeIn) / fdip; fadeIn -= 1 }
            envBuf[i] = g * masterNow
        }
        let guideActive = gWs >= 0
        let soloActive = groupSolo.contains(true) || song.stems.contains { $0.solo }
        for s in song.stems {
            let b = min(max(s.bus, 0), 9)
            if s.mute || groupMute[b] || (soloActive && !(s.solo || groupSolo[b])) { s.peak *= 0.9; continue }
            let g = s.gain * groupGain[b] * s.trim
            var pk: Float = 0
            let o0 = out[min(max(0, s.outA), nOut - 1)] + off
            let o1: UnsafeMutablePointer<Float> = s.outB >= 0 && s.outB < nOut ? out[s.outB] + off : o0
            let l = s.ch[0], r = s.ch.count > 1 ? s.ch[1] : s.ch[0]
            if s.isGuide && guideActive {
                for i in 0..<n {
                    let ap = pos + i
                    var idx = ap
                    if ap >= gWs && ap < gWe { idx = gSrc >= 0 ? gSrc + (ap - gWs) : -1 }
                    if idx < 0 || idx >= s.frames { continue }
                    let e = g * envBuf[i]
                    if s.mono { let v = (l[idx] + r[idx]) * 0.5 * e; o0[i] += v; pk = max(pk, abs(v)) }
                    else { let a = l[idx] * e, b2 = r[idx] * e; o0[i] += a; o1[i] += b2; pk = max(pk, max(abs(a), abs(b2))) }
                }
            } else {
                let m = min(n, max(0, s.frames - pos))
                if m == 0 { s.peak *= 0.9; continue }
                let lp = l + pos, rp = r + pos
                if s.mono {
                    for i in 0..<m { let v = (lp[i] + rp[i]) * 0.5 * g * envBuf[i]; o0[i] += v; pk = max(pk, abs(v)) }
                } else {
                    for i in 0..<m { let e = g * envBuf[i]; let a = lp[i] * e, b2 = rp[i] * e; o0[i] += a; o1[i] += b2; pk = max(pk, max(abs(a), abs(b2))) }
                }
            }
            s.peak = max(pk, s.peak * 0.9)
        }
    }
}

// Formaat met n kanalen (meer dan 2 kanalen heeft een kanaalindeling nodig)
func makeFormat(sr: Double, channels: Int, interleaved: Bool = false) -> AVAudioFormat {
    if channels <= 2, let f = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sr, channels: AVAudioChannelCount(channels), interleaved: interleaved) { return f }
    let layout = AVAudioChannelLayout(layoutTag: kAudioChannelLayoutTag_DiscreteInOrder | UInt32(channels))!
    return AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sr, interleaved: interleaved, channelLayout: layout)
}

// ------------------------------------------------------------- audioapparaat
func allDevices() -> [(id: AudioDeviceID, name: String, outCh: Int)] {
    var size: UInt32 = 0
    var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDevices, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size) == noErr else { return [] }
    var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
    guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &ids) == noErr else { return [] }
    return ids.map { id in
        var cf: Unmanaged<CFString>?; var s = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        var a = AudioObjectPropertyAddress(mSelector: kAudioObjectPropertyName, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        _ = AudioObjectGetPropertyData(id, &a, 0, nil, &s, &cf)
        let name = cf?.takeRetainedValue() as String? ?? "?"
        var sz: UInt32 = 0
        var sa = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyStreamConfiguration, mScope: kAudioObjectPropertyScopeOutput, mElement: kAudioObjectPropertyElementMain)
        var chn = 0
        if AudioObjectGetPropertyDataSize(id, &sa, 0, nil, &sz) == noErr, sz > 0 {
            let raw = UnsafeMutableRawPointer.allocate(byteCount: Int(sz), alignment: 16); defer { raw.deallocate() }
            if AudioObjectGetPropertyData(id, &sa, 0, nil, &sz, raw) == noErr {
                let abl = UnsafeMutableAudioBufferListPointer(raw.assumingMemoryBound(to: AudioBufferList.self))
                chn = abl.reduce(0) { $0 + Int($1.mNumberChannels) }
            }
        }
        return (id, name, chn)
    }
}

final class Output {
    let mixer: Mixer
    var engine = AVAudioEngine()
    var deviceName = "standaard"
    var hwChannels = 2
    init(mixer: Mixer) { self.mixer = mixer }

    /// Het apparaat op 48 kHz zetten: de stems zijn 48 kHz en er wordt (nog) niet omgerekend. Geeft de uiteindelijke samplerate terug.
    func setNominalRate(device id: AudioDeviceID, rate: Double) -> Double {
        var addr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyNominalSampleRate, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var cur = 0.0; var size = UInt32(MemoryLayout<Double>.size)
        AudioObjectGetPropertyData(id, &addr, 0, nil, &size, &cur)
        if cur != rate {
            var r = rate
            AudioObjectSetPropertyData(id, &addr, 0, nil, UInt32(MemoryLayout<Double>.size), &r)
            Thread.sleep(forTimeInterval: 0.3)
            AudioObjectGetPropertyData(id, &addr, 0, nil, &size, &cur)
            log("Samplerate van het apparaat: \(Int(cur)) Hz (was ingesteld op \(Int(rate)) Hz gezet)")
        }
        return cur
    }

    /// Het audioapparaat of de samplerate veranderde en de engine stopte: opnieuw opbouwen (na een korte pauze, zonder lus)
    func recover() {
        if restarting { return }
        restarting = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [self] in
            // alleen opnieuw starten als er echt iets stuk is (engine gestopt of ander formaat), anders ontstaat een lus
            let f = engine.outputNode.outputFormat(forBus: 0)
            if engine.isRunning && Int(f.channelCount) == hwChannels && f.sampleRate == 48000 { restarting = false; return }
            log("Audio-configuratie gewijzigd: engine opnieuw starten")
            do { try start(device: lastDevice) } catch { log("Opnieuw starten mislukt: \(error.localizedDescription)") }
            restarting = false
        }
    }
    var lastDevice: String?
    var observer: NSObjectProtocol?
    var restarting = false

    func start(device: String?) throws {
        lastDevice = device
        engine.stop()
        if let o = observer { NotificationCenter.default.removeObserver(o); observer = nil }
        // eerst het apparaat op 48 kHz zetten, daarna pas de engine maken (anders loopt hij met de oude samplerate)
        var devID: AudioDeviceID? = nil
        if let name = device, let id = allDevices().first(where: { $0.name == name })?.id { devID = id; deviceName = name }
        else {
            var def = AudioDeviceID(0); var sz = UInt32(MemoryLayout<AudioDeviceID>.size)
            var a = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultOutputDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
            if AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &a, 0, nil, &sz, &def) == noErr { devID = def }
        }
        if let id = devID {
            let rate = setNominalRate(device: id, rate: 48000)
            if rate != 48000 { log("LET OP: dit apparaat draait op \(Int(rate)) Hz en niet op 48000 Hz; de muziek klinkt dan te langzaam (omrekenen is nog niet gebouwd)") }
        }
        engine = AVAudioEngine()
        let out = engine.outputNode
        if var id = devID, let au = out.audioUnit { AudioUnitSetProperty(au, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0, &id, UInt32(MemoryLayout<AudioDeviceID>.size)) }
        let hw = out.outputFormat(forBus: 0)
        hwChannels = Int(hw.channelCount); mixer.sr = 48000     // de stems zijn 48 kHz; het apparaat is hierboven op 48 kHz gezet
        mixer.outCh = hwChannels
        mixer.applyRouting()
        let fmt = makeFormat(sr: mixer.sr, channels: hwChannels)
        let m = mixer
        let src = AVAudioSourceNode(format: fmt) { _, _, frameCount, abl -> OSStatus in
            let list = UnsafeMutableAudioBufferListPointer(abl)
            var ptrs: [UnsafeMutablePointer<Float>] = []
            for b in list { if let d = b.mData { ptrs.append(d.assumingMemoryBound(to: Float.self)) } }
            if ptrs.count == list.count { m.render(frames: Int(frameCount), out: ptrs) }
            return noErr
        }
        engine.attach(src)
        engine.connect(src, to: out, format: fmt)
        try engine.start()
        observer = NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil) { [weak self] _ in self?.recover() }
        log("Audio: \(deviceName), \(hwChannels) uitgangen, \(Int(mixer.sr)) Hz, uitgangsmodus \(mixer.requested) -> \(mixer.applied)")
    }
}


/// Secties en tempo van een nummer lezen zonder de audio te laden (alleen de lengte uit de bestandskoppen)
func songOutline(folder: String) -> (title: String, sections: [Section], tempo: TempoMap, rpp: String?)? {
    let base = URL(fileURLWithPath: folder)
    func duration(_ files: [(String, Double)]) -> Double {
        var d = 0.0
        for (f, off) in files { if let af = try? AVAudioFile(forReading: base.appendingPathComponent(f)) { d = max(d, off + Double(af.length) / af.processingFormat.sampleRate) } }
        return d
    }
    if let data = try? Data(contentsOf: base.appendingPathComponent("ark-player.json")), let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
        let files = (j["stems"] as? [[String: Any]] ?? []).compactMap { s -> (String, Double)? in (s["file"] as? String).map { ($0, (s["offset"] as? NSNumber)?.doubleValue ?? 0) } }
        let total = duration(files)
        let tempo = (j["tempo_qn"] as? [[Any]] ?? []).compactMap { r -> (qn: Double, bpm: Double)? in
            guard r.count == 2, let q = (r[0] as? NSNumber)?.doubleValue, let b = (r[1] as? NSNumber)?.doubleValue else { return nil }; return (q, b) }
        let sigs = (j["timesig"] as? [[Any]] ?? []).compactMap { r -> (qn: Double, num: Double, den: Double)? in
            guard r.count == 3, let q = (r[0] as? NSNumber)?.doubleValue, let n = (r[1] as? NSNumber)?.doubleValue, let d = (r[2] as? NSNumber)?.doubleValue else { return nil }; return (q, n, d) }
        var secs: [Section] = []
        for (k, s) in (j["sections"] as? [[String: Any]] ?? []).enumerated() {
            if let n = s["name"] as? String, let t = (s["sec"] as? NSNumber)?.doubleValue { secs.append(Section(id: (s["id"] as? NSNumber)?.intValue ?? (k + 1), name: n, start: t, end: 0)) }
        }
        secs.sort { $0.start < $1.start }
        for i in 0..<secs.count { secs[i].end = i + 1 < secs.count ? secs[i + 1].start : total }
        return (j["title"] as? String ?? base.lastPathComponent, secs, tempo.isEmpty ? TempoMap() : TempoMap(tempoQN: tempo, sigs: sigs), j["rpp"] as? String)
    }
    if let data = try? Data(contentsOf: base.appendingPathComponent("song.json")), let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
        let files = (j["stems"] as? [[String: Any]] ?? []).compactMap { s -> (String, Double)? in (s["file"] as? String).map { ($0, 0) } }
        let parsed = parseSong(j, total: duration(files))
        return (j["title"] as? String ?? base.lastPathComponent, parsed.sections, parsed.tempo, nil)
    }
    return nil
}
