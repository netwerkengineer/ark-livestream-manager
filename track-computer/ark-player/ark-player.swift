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

func log(_ s: String) {
    let f = DateFormatter(); f.dateFormat = "HH:mm:ss.SSS"
    FileHandle.standardError.write(Data("\(f.string(from: Date())) \(s)\n".utf8))
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

struct Section { let name: String; var start: Double; var end: Double }

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
    for i in 0..<out.count { out[i].end = i + 1 < out.count ? out[i + 1].start : total }
    return (out, tm)
}

func loadStem(url: URL, name: String, offsetFrames: Int = 0) throws -> Stem {
    let f = try AVAudioFile(forReading: url)
    let fmt = f.processingFormat                       // float32, niet-geinterleaved
    let n = Int(f.length), chn = min(2, Int(fmt.channelCount))
    let lead = max(0, offsetFrames)                    // een stem die later begint: stilte ervoor
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
    if fmt.sampleRate != 48000 { log("LET OP: \(name) heeft \(Int(fmt.sampleRate)) Hz (verwacht 48000; omrekenen is nog niet gebouwd)") }
    return Stem(name: name, frames: lead + done, ch: ch)
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
    DispatchQueue.concurrentPerform(iterations: entries.count) { i in
        do { let st = try loadStem(url: base.appendingPathComponent(entries[i].file), name: entries[i].name, offsetFrames: entries[i].offset)
             st.mute = entries[i].mute; lock.lock(); loaded[i] = st; lock.unlock() }
        catch { lock.lock(); failure = "\(entries[i].file): \(error.localizedDescription)"; lock.unlock() }
    }
    if let f = failure { throw NSError(domain: "ark", code: 2, userInfo: [NSLocalizedDescriptionKey: f]) }
    song.stems = loaded.compactMap { $0 }
    for st in song.stems { st.live = isLive(st.name) }
    let tempo = (j["tempo_qn"] as? [[Any]] ?? []).compactMap { r -> (qn: Double, bpm: Double)? in
        guard r.count == 2, let q = (r[0] as? NSNumber)?.doubleValue, let b = (r[1] as? NSNumber)?.doubleValue else { return nil }; return (q, b) }
    let sigs = (j["timesig"] as? [[Any]] ?? []).compactMap { r -> (qn: Double, num: Double, den: Double)? in
        guard r.count == 3, let q = (r[0] as? NSNumber)?.doubleValue, let n = (r[1] as? NSNumber)?.doubleValue, let d = (r[2] as? NSNumber)?.doubleValue else { return nil }; return (q, n, d) }
    song.tempo = tempo.isEmpty ? TempoMap() : TempoMap(tempoQN: tempo, sigs: sigs)
    var secs: [Section] = []
    for s in (j["sections"] as? [[String: Any]] ?? []) { if let n = s["name"] as? String, let t = (s["sec"] as? NSNumber)?.doubleValue { secs.append(Section(name: n, start: t, end: 0)) } }
    secs.sort { $0.start < $1.start }
    let total = Double(song.total) / song.sampleRate
    for i in 0..<secs.count { secs[i].end = i + 1 < secs.count ? secs[i + 1].start : total }
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
    DispatchQueue.concurrentPerform(iterations: entries.count) { i in
        do { let s = try loadStem(url: base.appendingPathComponent(entries[i].file), name: entries[i].name); lock.lock(); loaded[i] = s; lock.unlock() }
        catch { lock.lock(); failure = "\(entries[i].file): \(error.localizedDescription)"; lock.unlock() }
    }
    if let f = failure { throw NSError(domain: "ark", code: 2, userInfo: [NSLocalizedDescriptionKey: f]) }
    song.stems = loaded.compactMap { $0 }
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
    var outCh = 2
    var sr = 48000.0
    var requested = "stereo"       // gevraagde uitgangsmodus: auto | multi | 2ch | 3ch | stereo
    var applied = "stereo"         // wat er echt gebeurt (hangt af van het aantal uitgangen)
    var jumpMode = "end"           // standaard sprongmoment: end | bar | now
    // geplande sprong en loop (alles in frames)
    var pendAt = -1, pendTo = 0, pendSection = -1
    var loopSec = -1, loopStart = 0, loopEnd = 0
    var fadeIn = 0
    let dip = 160                  // korte fade rond een sprong (~3,3 ms): geen klik
    // guide-aankondiging: in [gWs, gWe) speelt de guide-stem vanaf gSrc (gSrc < 0: stil)
    var gWs = -1, gWe = -1, gSrc = 0
    // meting
    var blocks = 0, maxMicros = 0.0, sumMicros = 0.0
    var lastJump: (from: Int, to: Int) = (-1, -1)
    var jumpCount = 0
    let envBuf = UnsafeMutablePointer<Float>.allocate(capacity: 16384)

    // --- uitgangsmodus (zoals de bridge): stereo | 2ch | 3ch | multi | auto
    func applyRouting() {
        var how = requested
        if how == "auto" { how = outCh >= 8 ? "multi" : "stereo" }
        if how == "3ch" && outCh < 3 { how = outCh >= 2 ? "2ch" : "stereo" }
        if how == "2ch" && outCh < 2 { how = "stereo" }
        if how == "multi" && outCh < 8 { how = outCh >= 3 ? "3ch" : (outCh >= 2 ? "2ch" : "stereo") }
        applied = how
        for st in song.stems {
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
        let total = song.total
        var off = 0
        while off < frames {
            if !(playing || env > 0.0001) || total == 0 { for st in song.stems { st.peak *= 0.9 }; break }
            var seg = frames - off
            var event = 0
            if pendAt >= 0 {
                if pendAt <= pos { seg = 0; event = 1 } else if pendAt - pos < seg { seg = pendAt - pos; event = 1 }
            }
            if event != 1 && loopSec >= 0 {
                if loopEnd <= pos { seg = 0; event = 2 } else if loopEnd - pos < seg { seg = loopEnd - pos; event = 2 }
            }
            if event == 0 && total - pos <= seg { seg = max(0, total - pos); event = 3 }
            if seg > 0 { mix(n: seg, off: off, out: out); pos += seg; off += seg }
            if event == 1 { jumpCount += 1; lastJump = (pos, pendTo); pos = pendTo; pendAt = -1; pendSection = -1; fadeIn = dip; clearGuide() }
            else if event == 2 { jumpCount += 1; lastJump = (pos, loopStart); pos = loopStart; fadeIn = dip }
            else if event == 3 { playing = false; pos = total; for st in song.stems { st.peak *= 0.9 }; break }
            if seg == 0 && event == 0 { break }
        }
        let us = Double(DispatchTime.now().uptimeNanoseconds - t0) / 1000
        blocks += 1; sumMicros += us; maxMicros = max(maxMicros, us)
    }

    func mix(n: Int, off: Int, out: [UnsafeMutablePointer<Float>]) {
        let nOut = out.count
        let step = Float(1.0 / (0.005 * sr))
        let target: Float = playing ? 1 : 0
        let fdip = Float(dip)
        for i in 0..<n {
            if env < target { env = min(target, env + step) } else if env > target { env = max(target, env - step) }
            var g = env
            let ap = pos + i
            if pendAt >= 0 { g *= min(1, max(0, Float(pendAt - ap) / fdip)) }
            if loopSec >= 0 { g *= min(1, max(0, Float(loopEnd - ap) / fdip)) }
            if fadeIn > 0 { g *= Float(dip - fadeIn) / fdip; fadeIn -= 1 }
            envBuf[i] = g
        }
        let guideActive = gWs >= 0
        for s in song.stems {
            if s.mute { s.peak *= 0.9; continue }
            let g = s.gain * master * s.trim
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

    func start(device: String?) throws {
        engine.stop(); engine = AVAudioEngine()
        let out = engine.outputNode
        if let name = device, var id = allDevices().first(where: { $0.name == name })?.id, let au = out.audioUnit {
            AudioUnitSetProperty(au, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0, &id, UInt32(MemoryLayout<AudioDeviceID>.size))
            deviceName = name
        }
        let hw = out.outputFormat(forBus: 0)
        hwChannels = Int(hw.channelCount); mixer.sr = hw.sampleRate > 0 ? hw.sampleRate : 48000
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
        log("Audio: \(deviceName), \(hwChannels) uitgangen, \(Int(mixer.sr)) Hz, uitgangsmodus \(mixer.requested) -> \(mixer.applied)")
    }
}

// ------------------------------------------------------------- state / HTTP
func jsonString(_ o: Any) -> String { (try? String(data: JSONSerialization.data(withJSONObject: o, options: [.sortedKeys]), encoding: .utf8)) ?? "{}" }
func db(_ g: Float) -> Double { g <= 0.000001 ? -150 : Double(20 * log10(g)) }

final class Server {
    let mixer: Mixer; let output: Output; let q = DispatchQueue(label: "ark-player.http")
    var loading = false; var error: String?
    init(mixer: Mixer, output: Output) { self.mixer = mixer; self.output = output }

    func state() -> [String: Any] {
        let m = mixer, s = m.song
        let dur = Double(s.total) / m.sr
        let st: String = m.playing ? "playing" : (m.pos > 0 && m.pos < s.total ? "paused" : "stopped")
        let cur = m.sectionIndex(at: m.pos)
        var d: [String: Any] = ["title": s.title, "state": st, "position": m.posSec, "duration": dur, "loading": loading, "error": error ?? "",
                "device": output.deviceName, "outputs": output.hwChannels, "output_mode": m.requested, "output_applied": m.applied,
                "master_db": db(m.master), "jump_mode": m.jumpMode,
                "sections": s.sections.enumerated().map { ["id": $0.offset, "name": $0.element.name, "start": $0.element.start, "end": $0.element.end] },
                "stems": s.stems.map { ["name": $0.name, "bus": $0.bus, "bus_name": $0.busName, "mute": $0.mute, "live": $0.live, "monitor": $0.monitor, "gain_db": db($0.gain), "meter_db": db($0.peak)] },
                "render": ["blocks": m.blocks, "avg_us": m.blocks > 0 ? m.sumMicros / Double(m.blocks) : 0, "max_us": m.maxMicros]]
        if let c = cur { d["section"] = c }
        if m.pendSection >= 0 { d["pending"] = m.pendSection; d["pending_at"] = Double(m.pendAt) / m.sr }
        if m.loopSec >= 0 { d["loop"] = m.loopSec }
        return d
    }

    func handle(_ method: String, _ path: String, _ qs: [String: String]) -> (Int, String) {
        switch path {
        case "/state": return (200, jsonString(state()))
        case "/play": mixer.playing = true; return (200, jsonString(["ok": true]))
        case "/pause": mixer.playing = false; return (200, jsonString(["ok": true]))
        case "/stop": mixer.playing = false; mixer.pos = 0; mixer.stopLoop(); mixer.cancelPending(); return (200, jsonString(["ok": true]))
        case "/jump":
            guard let id = Int(qs["id"] ?? "") else { return (400, jsonString(["error": "id ontbreekt"])) }
            if let e = mixer.jump(to: id, mode: qs["mode"]) { return (400, jsonString(["error": e])) }
            return (200, jsonString(["ok": true]))
        case "/loop":
            if (qs["on"] ?? "1") == "0" { mixer.stopLoop(); return (200, jsonString(["ok": true])) }
            if let e = mixer.startLoop() { return (400, jsonString(["error": e])) }
            return (200, jsonString(["ok": true]))
        case "/cancel": mixer.cancelPending(); return (200, jsonString(["ok": true]))
        case "/mode":
            guard let m = qs["m"], ["end", "bar", "now"].contains(m) else { return (400, jsonString(["error": "m = end|bar|now"])) }
            mixer.jumpMode = m; return (200, jsonString(["ok": true]))
        case "/output":
            guard let m = qs["mode"], ["auto", "multi", "2ch", "3ch", "stereo"].contains(m) else { return (400, jsonString(["error": "mode = auto|multi|2ch|3ch|stereo"])) }
            mixer.requested = m; mixer.applyRouting(); log("Uitgangsmodus \(m) -> \(mixer.applied)"); return (200, jsonString(["ok": true, "applied": mixer.applied]))
        case "/seek":
            guard let t = Double(qs["t"] ?? "") else { return (400, jsonString(["error": "t ontbreekt"])) }
            mixer.pos = max(0, min(mixer.song.total, Int(t * mixer.sr))); return (200, jsonString(["ok": true]))
        case "/mute":
            let on = (qs["on"] ?? "1") != "0"
            for s in mixer.song.stems where qs["stem"] == nil || s.name.lowercased() == qs["stem"]!.lowercased() { s.mute = on }
            return (200, jsonString(["ok": true]))
        case "/gain":
            guard let d = Double(qs["db"] ?? "") else { return (400, jsonString(["error": "db ontbreekt"])) }
            for s in mixer.song.stems where s.name.lowercased() == (qs["stem"] ?? "").lowercased() { s.gain = Float(pow(10, d / 20)) }
            return (200, jsonString(["ok": true]))
        case "/master":
            guard let d = Double(qs["db"] ?? "") else { return (400, jsonString(["error": "db ontbreekt"])) }
            mixer.master = Float(pow(10, min(0, d) / 20)); return (200, jsonString(["ok": true]))
        case "/load":
            guard let p = qs["path"] else { return (400, jsonString(["error": "path ontbreekt"])) }
            if loading { return (409, jsonString(["error": "bezig met laden"])) }
            loading = true; error = nil; mixer.playing = false; mixer.stopLoop(); mixer.cancelPending()
            DispatchQueue.global().async { [self] in
                let t0 = Date()
                do {
                    let song = try loadSong(folder: p)
                    mixer.pos = 0; mixer.stopLoop(); mixer.cancelPending(); mixer.song = song; mixer.applyRouting()
                    log("Geladen: \(song.title), \(song.stems.count) stems, \(String(format: "%.1f", Double(song.total) / mixer.sr)) s in \(String(format: "%.1f", Date().timeIntervalSince(t0))) s")
                } catch { self.error = error.localizedDescription; log("Laden mislukt: \(error)") }
                loading = false
            }
            return (202, jsonString(["ok": true]))
        default: return (404, jsonString(["error": "onbekend"]))
        }
    }

    func run(port: UInt16) throws {
        let params = NWParameters.tcp
        params.requiredInterfaceType = .loopback          // alleen deze computer; aansturing vanaf de app volgt later met een token
        let l = try NWListener(using: params, on: NWEndpoint.Port(rawValue: port)!)
        l.newConnectionHandler = { [self] c in
            c.start(queue: q)
            c.receive(minimumIncompleteLength: 1, maximumLength: 8192) { data, _, _, _ in
                guard let d = data, let req = String(data: d, encoding: .utf8), let line = req.split(separator: "\r\n").first else { c.cancel(); return }
                let parts = line.split(separator: " ")
                var res = (400, jsonString(["error": "ongeldig"]))
                if parts.count >= 2, let comps = URLComponents(string: String(parts[1])) {
                    var qs: [String: String] = [:]; for i in comps.queryItems ?? [] { qs[i.name] = i.value ?? "" }
                    res = self.handle(String(parts[0]), comps.path, qs)
                }
                let body = res.1
                let head = "HTTP/1.1 \(res.0) OK\r\nContent-Type: application/json\r\nContent-Length: \(body.utf8.count)\r\nConnection: close\r\n\r\n"
                c.send(content: (head + body).data(using: .utf8), completion: .contentProcessed { _ in c.cancel() })
            }
        }
        l.start(queue: q)
        log("HTTP op 127.0.0.1:\(port)")
    }
}

// ------------------------------------------------------------- selftest (offline)
func writeWav(path: String, channels: [[Float]], sr: Double) throws {
    let n = channels[0].count
    let fmt = makeFormat(sr: sr, channels: channels.count)
    let f = try AVAudioFile(forWriting: URL(fileURLWithPath: path), settings: fmt.settings)
    let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: AVAudioFrameCount(n))!
    buf.frameLength = AVAudioFrameCount(n)
    for c in 0..<channels.count { _ = channels[c].withUnsafeBufferPointer { memcpy(buf.floatChannelData![c], $0.baseAddress!, n * 4) } }
    try f.write(from: buf)
}

func outCount(for mode: String) -> Int { mode == "multi" || mode == "auto" ? 8 : (mode == "3ch" ? 3 : 2) }

func render(_ m: Mixer, secs: Double, block: Int = 512, onBlock: ((Int, Mixer) -> Void)? = nil) -> [[Float]] {
    let nOut = m.outCh
    let total = Int(secs * m.sr)
    var out = [[Float]](repeating: [Float](repeating: 0, count: total), count: nOut)
    let bufs = (0..<nOut).map { _ in UnsafeMutablePointer<Float>.allocate(capacity: block) }
    var done = 0, bi = 0
    while done < total {
        let n = min(block, total - done)
        onBlock?(bi, m)
        m.render(frames: n, out: bufs)
        for c in 0..<nOut { for i in 0..<n { out[c][done + i] = bufs[c][i] } }
        done += n; bi += 1
    }
    return out
}

func peakDb(_ x: [Float]) -> String { String(format: "%.1f", db(x.map { abs($0) }.max() ?? 0)) }

func selftest(folder: String, mode: String, start: Double, secs: Double) throws {
    let t0 = Date()
    let song = try loadSong(folder: folder)
    let loadSec = Date().timeIntervalSince(t0)
    let m = Mixer(); m.song = song; m.sr = 48000; m.outCh = outCount(for: mode); m.requested = mode; m.applyRouting(); m.master = 0.5
    m.pos = Int(start * m.sr); m.playing = true
    let w0 = Date()
    let out = render(m, secs: secs)
    let wall = Date().timeIntervalSince(w0)
    let tot = song.stems.reduce(0) { $0 + $1.frames * $1.ch.count * 4 }
    print("Song: \(song.title) | \(song.stems.count) stems | \(String(format: "%.1f", Double(song.total) / 48000)) s | \(tot / 1_000_000) MB | laden \(String(format: "%.1f", loadSec)) s")
    print("Secties: " + song.sections.map { "\($0.name)@\(String(format: "%.1f", $0.start))" }.joined(separator: ", "))
    print("Modus \(mode) -> \(m.applied) op \(m.outCh) uitgangen | mix \(secs) s in \(String(format: "%.2f", wall)) s | blok gem. \(String(format: "%.0f", m.sumMicros / Double(max(m.blocks, 1)))) us, max \(String(format: "%.0f", m.maxMicros)) us (beschikbaar \(Int(512.0 / 48000 * 1_000_000)) us)")
    for c in 0..<m.outCh { print("  uitgang \(c + 1): piek \(peakDb(out[c])) dBFS") }
    for s in song.stems { print("  stem \(s.name.padding(toLength: 14, withPad: " ", startingAt: 0)) bus \(s.bus) \(s.busName.padding(toLength: 20, withPad: " ", startingAt: 0)) mute:\(s.mute ? "ja" : "nee") live:\(s.live ? "ja" : "nee") -> uitgang \(s.outA + 1)\(s.outB >= 0 ? "+\(s.outB + 1)" : "")\(s.mono ? " mono" : "")") }
    let path = ProcessInfo.processInfo.environment["ARK_SELFTEST_WAV"] ?? (NSTemporaryDirectory() + "ark-player-selftest.wav")
    try writeWav(path: path, channels: out, sr: 48000)
    print("Geschreven: \(path)")
}

// Sprongtest: speel vanaf `from`, plan na 2 s een sprong naar sectie `to` en kijk waar en hoe hij gebeurt
func jumptest(folder: String, from: Double, to: Int, mode: String, loop: Bool) throws {
    let song = try loadSong(folder: folder)
    let m = Mixer(); m.song = song; m.sr = 48000; m.outCh = 2; m.requested = "stereo"; m.applyRouting(); m.master = 0.5
    let guideOnly = ProcessInfo.processInfo.environment["ARK_GUIDE_CHECK"] != nil
    for s in song.stems { s.mute = guideOnly ? !s.isGuide : (s.live ? false : s.mute) }   // voor de test alles laten klinken
    m.pos = Int(from * m.sr); m.playing = true
    var scheduledAt = 0.0, expectT = 0.0
    var win: (ws: Int, we: Int, src: Int) = (-1, -1, 0)
    let secs = loop ? 30.0 : 25.0
    let out = render(m, secs: secs) { bi, mm in
        if bi == Int(2.0 * 48000 / 512) {
            scheduledAt = mm.posSec
            if loop { _ = mm.startLoop() } else { _ = mm.jump(to: to, mode: mode) }
            win = (mm.gWs, mm.gWe, mm.gSrc)
            if let c = mm.sectionIndex(at: mm.pos) {
                let now = mm.posSec
                switch mode { case "bar": expectT = mm.song.tempo.nextBar(after: now); case "now": expectT = now; default: expectT = mm.song.sections[c].end }
            }
        }
    }
    let sr = m.sr
    func sec(_ f: Int) -> String { String(format: "%.3f", Double(f) / sr) }
    print("Gepland op \(String(format: "%.3f", scheduledAt)) s: \(loop ? "loop van de huidige sectie" : "sprong naar \(song.sections[to].name) (\(String(format: "%.3f", song.sections[to].start)) s), moment: \(mode)")")
    print("Verwacht sprongmoment: \(String(format: "%.3f", expectT)) s | werkelijk: \(sec(m.lastJump.from)) s -> \(sec(m.lastJump.to)) s | aantal sprongen: \(m.jumpCount) | positie na afloop: \(String(format: "%.3f", m.posSec)) s")
    // klik-meting: grootste stap tussen twee samples rond het sprongmoment t.o.v. de gemiddelde stap
    if m.lastJump.from >= 0 {
        let startF = Int(from * sr)
        let cut = m.lastJump.from - startF                                // positie in de uitvoer
        let x = out[0]
        var maxD: Float = 0, sumD: Float = 0
        for i in 1..<x.count { sumD += abs(x[i] - x[i - 1]) }
        let meanD = sumD / Float(x.count - 1)
        for i in max(1, cut - 400)..<min(x.count, cut + 400) { maxD = max(maxD, abs(x[i] - x[i - 1])) }
        print("Stap rond de sprong: max \(String(format: "%.4f", maxD)) | gemiddeld over het hele stuk \(String(format: "%.4f", meanD)) | piek stuk \(peakDb(x)) dBFS")
    }
    if guideOnly, win.ws >= 0, let g = song.stems.first(where: { $0.isGuide }) {
        let startF = Int(from * sr)
        var maxErr: Float = 0, maxRef: Float = 0, checked = 0
        for f in (win.ws + 300)..<(win.we - 300) {
            let o = f - startF
            let expect: Float = win.src >= 0 ? g.ch[0][win.src + (f - win.ws)] * 0.5 : 0
            maxErr = max(maxErr, abs(out[0][o] - expect)); maxRef = max(maxRef, abs(expect)); checked += 1
        }
        print("Guide-venster \(sec(win.ws))-\(sec(win.we)) s: \(win.src >= 0 ? "speelt de aankondiging van de doelsectie vanaf \(sec(win.src)) s" : "stil (geen volledige cue mogelijk)") | \(checked) samples vergeleken, max verschil \(String(format: "%.6f", maxErr)) (piek referentie \(String(format: "%.3f", maxRef)))")
    }
    var stems = song.stems.filter { $0.isGuide }.map { $0.name }
    if stems.isEmpty { stems = ["(geen guide-stem)"] }
    print("Guide-venster: \(m.gWs >= 0 ? "actief" : "gewist na de sprong") | guide-stem(s): \(stems.joined(separator: ", "))")
    let path = ProcessInfo.processInfo.environment["ARK_SELFTEST_WAV"] ?? (NSTemporaryDirectory() + "ark-player-jumptest.wav")
    try writeWav(path: path, channels: out, sr: sr)
    print("Geschreven: \(path)")
}

// ------------------------------------------------------------- main
var args = Array(CommandLine.arguments.dropFirst())
let cmd = args.isEmpty ? "serve" : args.removeFirst()
func opt(_ name: String) -> String? { if let i = args.firstIndex(of: name), i + 1 < args.count { let v = args[i + 1]; args.removeSubrange(i...(i + 1)); return v }; return nil }
func flag(_ name: String) -> Bool { if let i = args.firstIndex(of: name) { args.remove(at: i); return true }; return false }

switch cmd {
case "devices":
    for d in allDevices() where d.outCh > 0 { print("\(d.name)  (\(d.outCh) uitgangen)") }
case "selftest":
    let mode = opt("--mode") ?? (flag("--multi") ? "multi" : "stereo")
    guard let folder = args.first else { print("gebruik: ark-player selftest <songmap> [start] [duur] [--mode stereo|2ch|3ch|multi]"); exit(2) }
    do { try selftest(folder: folder, mode: mode, start: args.count > 1 ? Double(args[1]) ?? 30 : 30, secs: args.count > 2 ? Double(args[2]) ?? 20 : 20) }
    catch { print("fout: \(error)"); exit(1) }
case "jumptest":
    let loop = flag("--loop")
    guard args.count >= 3, let from = Double(args[1]), let to = Int(args[2]) else { print("gebruik: ark-player jumptest <songmap> <vanaf-sec> <sectie-id> [end|bar|now] [--loop]"); exit(2) }
    do { try jumptest(folder: args[0], from: from, to: to, mode: args.count > 3 ? args[3] : "end", loop: loop) } catch { print("fout: \(error)"); exit(1) }
case "serve":
    let port = UInt16(opt("--port") ?? "8099") ?? 8099
    let device = opt("--device")
    let mode = opt("--mode") ?? (flag("--multi") ? "multi" : "stereo")
    let mdb = Double(opt("--master-db") ?? "0") ?? 0
    let mixer = Mixer(); mixer.requested = mode; mixer.master = Float(pow(10, min(0, mdb) / 20))
    let output = Output(mixer: mixer)
    let server = Server(mixer: mixer, output: output)
    do { try output.start(device: device); try server.run(port: port) } catch { print("starten mislukt: \(error)"); exit(1) }
    if let folder = args.first { _ = server.handle("GET", "/load", ["path": folder]) }
    RunLoop.main.run()
default:
    print("gebruik: ark-player serve|selftest|jumptest|devices")
}
