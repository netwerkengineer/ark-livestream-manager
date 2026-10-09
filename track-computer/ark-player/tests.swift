import AVFoundation
import AudioToolbox
import CoreAudio
import Foundation
import Network

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


// ------------------------------------------------------------- cue- en overgangstests (offline, virtuele klok)
final class Sim {
    let mixer = Mixer()
    let player: Player
    var now = 0.0
    var calls: [(t: Double, action: String, data: String)] = []
    init() {
        mixer.sr = 48000; mixer.outCh = 2; mixer.requested = "stereo"; mixer.master = 0.5
        player = Player(mixer: mixer, output: nil)
        player.onFreeShow = { [unowned self] a, d in calls.append((now, a, d)) }
    }
    /// speel `secs` seconden (blokken van 512; de cue-teller draait elke 4 blokken ~ 43 ms, zoals de timer)
    func run(_ secs: Double) {
        let block = 512, total = Int(secs * 48000)
        let bufs = (0..<2).map { _ in UnsafeMutablePointer<Float>.allocate(capacity: block) }
        var done = 0, bi = 0
        while done < total {
            let n = min(block, total - done)
            mixer.render(frames: n, out: bufs)
            done += n; bi += 1; now += Double(n) / 48000
            if bi % 4 == 0 { player.tick() }
        }
    }
    func activate(_ path: String) throws {
        try player.selectSong(path: path, mode: nil)
        for _ in 0..<400 { player.lock.lock(); let ok = player.activeFolder == player.folderOf(path); player.lock.unlock(); if ok { return }; Thread.sleep(forTimeInterval: 0.05) }
        throw PlayerError("laden duurde te lang")
    }
}

func sampleCues(for song: Song) -> String {
    var n = 3, parts = ["show:abc123@lay1"]
    for s in song.sections {
        let nm = s.name.lowercased()
        if ["count off", "intro", "instrumental", "outro", "interlude", "ending"].contains(where: { nm.hasPrefix($0) }) { parts.append("\(s.id):\(nm.hasPrefix("count") ? 1 : 2)") }
        else { parts.append("\(s.id):" + (0..<4).map { "\(n + $0)@\(20 + $0 * 5)" }.joined(separator: ",")); n += 4 }
    }
    return parts.joined(separator: ";")
}

func cuetest(folder: String) throws {
    let sim = Sim(); let p = sim.player
    setenv("ARK_PLAYER_CONFIG", NSTemporaryDirectory() + "ark-player-test-config.json", 1)
    p.cfg.leadBeats = 2
    let rpp = ((try FileManager.default.contentsOfDirectory(atPath: folder)).first { $0.hasSuffix(".RPP") }).map { folder + "/" + $0 }!
    try sim.activate(rpp)
    let s = p.mixer.song
    try p.saveCues(path: rpp, data: sampleCues(for: s))
    print("Cues geladen: \(p.table != nil) | show \(p.table?.showId ?? "-") layout \(p.table?.layoutId ?? "-") | \(p.table?.regions.count ?? 0) secties | tijdlijn \(p.timeline.count) dia's")
    print("Bij het kiezen van het nummer: \(sim.calls.map { "\($0.action) \($0.data)" })")
    // 1. afspelen vanaf het begin: elke dia moet op zijn moment komen
    sim.calls = []; sim.now = 0
    p.mixer.pos = 0; p.mixer.playing = true
    sim.run(150)
    print("\n-- Afspelen 0-150 s: \(sim.calls.count) berichten naar FreeShow")
    var bad = 0
    for c in sim.calls where c.action == "index_select_slide" {
        let idx = Int(c.data.components(separatedBy: "\"index\":").last!.dropLast())!
        // verwachte tijd: moment in de tijdlijn (met de teller van 43 ms als marge)
        let exp = p.timeline.first { $0.n == idx }?.t ?? -1
        let ok = abs(c.t - exp) < 0.12
        if !ok { bad += 1 }
        if abs(c.t - exp) >= 0.12 || idx <= 12 { print(String(format: "   t=%7.2f  dia %2d  (tijdlijn %7.2f)  %@", c.t, idx, exp, ok ? "ok" : "AFWIJKING")) }
    }
    print("   dia's te vroeg/laat (> 0,12 s t.o.v. de tijdlijn): \(bad)")
    // 2. sprong op de volgende maat: de eerste dia van de doelsectie komt voor het sprongmoment
    sim.calls = []
    p.mixer.pos = Int(30 * 48000); p.mixer.playing = true; p.sent = nil
    sim.run(1)
    let target = s.sections.firstIndex { $0.name == "Bridge" }!
    let tSched = sim.now, posSched = p.mixer.posSec
    _ = p.jump(to: target, mode: "bar")
    let atSong = Double(p.mixer.pendAt) / 48000
    let at = tSched + (atSong - posSched)                  // het sprongmoment op de klok van de test
    sim.run(10)
    let first = p.firstSlideOf(target) ?? -1
    let hit = sim.calls.first { $0.data.contains("\"index\":\(first)") }
    print("\n-- Sprong naar \(s.sections[target].name) op de maat (liedtijd \(String(format: "%.2f", atSong)) s, na \(String(format: "%.2f", at - tSched)) s): eerste dia \(first) verstuurd \(hit.map { String(format: "%.2f", at - $0.t) } ?? "NIET") s voor het sprongmoment (verwacht ongeveer \(String(format: "%.2f", p.leadSeconds(atSong))) s)")
    // 3. loop
    sim.calls = []
    p.mixer.pos = Int(87 * 48000); p.mixer.playing = true; p.sent = nil
    sim.run(1)
    _ = p.mixer.startLoop()
    sim.run(20)
    print("-- Loop van \(s.sections[p.mixer.loopSec].name): \(p.mixer.jumpCount) sprongen; dia's verstuurd: \(sim.calls.filter { $0.action == "index_select_slide" }.map { "\(Int($0.t * 10) / 10)s:\($0.data.components(separatedBy: "\"index\":").last!.dropLast())" })")
    p.mixer.stopLoop()
    // 4. timing opnemen
    sim.calls = []
    p.mixer.pos = Int(55 * 48000); p.mixer.playing = true; p.sent = nil
    try p.record("start")
    sim.run(3)
    let before = p.timeline.map { $0.t }
    try p.tap(pos: nil); sim.run(2); try p.tap(pos: nil); sim.run(1)
    try p.record("save")
    print("-- Timing opnemen: taps \(p.lastTaps["sections"] ?? "-") | tijdlijn gewijzigd: \(before != p.timeline.map { $0.t })")
}

func transtest(a: String, b: String) throws {
    let sim = Sim(); let p = sim.player
    setenv("ARK_PLAYER_CONFIG", NSTemporaryDirectory() + "ark-player-test-config.json", 1)
    func rpp(_ f: String) -> String { f + "/" + ((try? FileManager.default.contentsOfDirectory(atPath: f))?.first { $0.hasSuffix(".RPP") } ?? "") }
    let pa = rpp(a), pb = rpp(b)
    try sim.activate(pa)
    p.setSetlist([pa, pb])
    for _ in 0..<400 { p.lock.lock(); let n = p.cache.count; p.lock.unlock(); if n >= 2 { break }; Thread.sleep(forTimeInterval: 0.05) }
    print("Setlist geladen: \(p.cache.count) nummers in het geheugen | volgende: \(p.nextSong.map { ($0 as NSString).lastPathComponent } ?? "-")")
    // overgang op de volgende maat
    p.mixer.pos = Int(30 * 48000); p.mixer.playing = true
    sim.run(1)
    let t0 = p.mixer.posSec
    try p.selectSong(path: pb, mode: "bar")
    let at = Double(p.mixer.pendSongAt) / 48000
    print("\nOvergang op de volgende maat gepland vanaf \(String(format: "%.3f", t0)) s: wisselmoment \(String(format: "%.3f", at)) s, fade \(String(format: "%.3f", Double(p.mixer.songFade) / 48000)) s | in state: pending_song \(p.switchTarget != nil)")
    sim.run(3)
    print("Na afloop: nummer gewisseld \(p.mixer.switched) keer | actief: \((p.activePath as NSString).lastPathComponent) | positie \(String(format: "%.2f", p.mixer.posSec)) s | pending leeg: \(p.mixer.pendSongAt < 0)")
    // einde van het nummer: het volgende klaarzetten (hier: terug naar a, want b is het laatste)
    p.setSetlist([pb, pa])
    for _ in 0..<100 { Thread.sleep(forTimeInterval: 0.02) }
    p.mixer.pos = p.mixer.song.total - Int(2 * 48000); p.mixer.playing = true
    sim.run(4)
    print("Einde van het nummer: gestopt \(!p.mixer.playing) | actief nu: \((p.activePath as NSString).lastPathComponent) | positie \(String(format: "%.2f", p.mixer.posSec)) s")
}
