// ArkPads - pad-speler voor de kerkband (track-computer)
//
// Speelt ambient pads (per toonsoort) los van REAPER's transport: ze lopen door bij
// stoppen, starten en songwissels. Wisselen van toonsoort gaat met een crossfade.
// Gebruikt hetzelfde audioapparaat als REAPER (reaper.ini) en dezelfde uitgang als de
// gekozen uitgangsmodus van de tracks (bridge-state): X32 -> uitgang 8 (PADS-bus),
// 2 kanalen -> uitgang 2 (tracks), stereo -> 1+2.
//
// Bediening via REAPER's webinterface (zelfde route als de rest van de app):
//   app -> SET/EXTSTATE/ArkPads/cmd/<id \t opdracht \t arg...>
//   ArkPads -> SET/EXTSTATE/ArkPads/state/<json>
// Opdrachten: play <set> <laag> <toon> [fade-sec] | stop [fade-sec] | volume <0-1>
// Pads: ~/Tracks/Pads/<set>/<laag>/<toon>.wav  (bv. Fundamental/Deep/Eb.wav)

import AVFoundation
import AudioToolbox
import CoreAudio
import Foundation

let home = FileManager.default.homeDirectoryForCurrentUser.path
let padsDir = home + "/Tracks/Pads"
let reaperIni = home + "/Library/Application Support/REAPER/reaper.ini"
let web = "http://127.0.0.1:8080/_/"
let queue = DispatchQueue(label: "arkpads")

func log(_ s: String) {
    let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd HH:mm:ss"
    print("\(f.string(from: Date())) \(s)"); fflush(stdout)
}

// ------------------------------------------------------------- REAPER webinterface
func http(_ path: String) -> String? {
    guard let url = URL(string: web + path) else { return nil }
    let sem = DispatchSemaphore(value: 0)
    var out: String?
    var req = URLRequest(url: url); req.timeoutInterval = 2
    URLSession.shared.dataTask(with: req) { data, _, _ in
        out = data.flatMap { String(data: $0, encoding: .utf8) }; sem.signal()
    }.resume()
    _ = sem.wait(timeout: .now() + 3)
    return out
}

func getExtState(_ section: String, _ key: String) -> String {
    guard let text = http("GET/EXTSTATE/\(section)/\(key)") else { return "" }
    let parts = text.trimmingCharacters(in: .newlines).components(separatedBy: "\t")
    guard parts.count >= 4 else { return "" }
    // \t, \n en \\ zijn ge-escaped
    var out = ""; var esc = false
    for c in parts[3...].joined(separator: "\t") {
        if esc { out.append(c == "t" ? "\t" : c == "n" ? "\n" : c); esc = false }
        else if c == "\\" { esc = true } else { out.append(c) }
    }
    return out
}

func setExtState(_ section: String, _ key: String, _ value: String) {
    let v = value.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
    _ = http("SET/EXTSTATE/\(section)/\(key)/\(v)")
}

// ------------------------------------------------------------- audioapparaat
func reaperOutputDeviceName() -> String? {
    guard let ini = try? String(contentsOfFile: reaperIni, encoding: .utf8) else { return nil }
    for line in ini.components(separatedBy: .newlines) where line.hasPrefix("coreaudiooutdevnew=") {
        let name = String(line.dropFirst("coreaudiooutdevnew=".count))
        return name == "<default>" || name.isEmpty ? nil : name
    }
    return nil
}

func deviceID(named name: String?) -> AudioDeviceID? {
    var size: UInt32 = 0
    var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDevices, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size) == noErr else { return nil }
    var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
    guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &ids) == noErr else { return nil }
    if name == nil {
        var def = AudioDeviceID(0); var s = UInt32(MemoryLayout<AudioDeviceID>.size)
        var a = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultOutputDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &a, 0, nil, &s, &def)
        return def
    }
    for id in ids {
        var cf: Unmanaged<CFString>?
        var s = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        var a = AudioObjectPropertyAddress(mSelector: kAudioObjectPropertyName, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        if AudioObjectGetPropertyData(id, &a, 0, nil, &s, &cf) == noErr, let n = cf?.takeRetainedValue() as String?, n == name {
            return id
        }
    }
    return nil
}

// ------------------------------------------------------------- pad-engine
final class Pad {
    let player = AVAudioPlayerNode()
    let file: AVAudioFile
    init(file: AVAudioFile) { self.file = file }
}

final class PadEngine {
    var engine = AVAudioEngine()
    var current: Pad?
    var fading: [Pad] = []
    var volume: Float = 0.8
    var setName = "", layer = "", key = ""
    var device: String?
    var output = ""   // multi | 2ch | stereo
    var error: String?
    var configured = false

    // Uitgangsmodus van de tracks -> kanalen op het apparaat
    func channelMap(hwChannels: Int) -> (clientChannels: AVAudioChannelCount, map: [Int32]) {
        var map = [Int32](repeating: -1, count: max(hwChannels, 1))
        switch output {
        case "multi" where hwChannels >= 8:
            map[7] = 0; return (1, map)                 // uitgang 8: PADS-bus van de X32
        case "2ch" where hwChannels >= 2:
            map[1] = 0; return (1, map)                 // uitgang 2: tracks
        default:
            map[0] = 0; if hwChannels > 1 { map[1] = 1 }  // stereo
            return (hwChannels > 1 ? 2 : 1, map)
        }
    }

    func configure() {
        let wasPlaying = current
        engine.stop()
        engine = AVAudioEngine()
        current = nil; fading = []
        let out = engine.outputNode
        if let name = device, var id = deviceID(named: name), let au = out.audioUnit {
            AudioUnitSetProperty(au, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0, &id, UInt32(MemoryLayout<AudioDeviceID>.size))
        }
        let hw = out.outputFormat(forBus: 0)
        let (clientCh, map) = channelMap(hwChannels: Int(hw.channelCount))
        let fmt = AVAudioFormat(standardFormatWithSampleRate: hw.sampleRate > 0 ? hw.sampleRate : 48000, channels: clientCh)!
        engine.connect(engine.mainMixerNode, to: out, format: fmt)
        if let au = out.audioUnit {
            var m = map
            AudioUnitSetProperty(au, kAudioOutputUnitProperty_ChannelMap, kAudioUnitScope_Output, 0, &m, UInt32(m.count * MemoryLayout<Int32>.size))
        }
        engine.mainMixerNode.outputVolume = volume
        do { try engine.start(); error = nil } catch { self.error = "Audio starten mislukt: \(error.localizedDescription)" }
        configured = true
        log("Audio: \(device ?? "standaard"), \(hw.channelCount) kanalen, uitgang \(output)")
        if let p = wasPlaying { start(file: p.file, fade: 0.5) }
    }

    func scheduleLoop(_ pad: Pad) {
        // twee keer vooruit inplannen: naadloos doorlopen
        func schedule() {
            pad.player.scheduleFile(pad.file, at: nil, completionCallbackType: .dataConsumed) { [weak pad] _ in
                guard let pad = pad else { return }
                queue.async { if pad.player.engine != nil { schedule() } }
            }
        }
        schedule(); schedule()
    }

    func ramp(_ steps: [(Pad, Float, Float)], seconds: Double, done: @escaping () -> Void) {
        let n = max(1, Int(seconds / 0.03))
        for i in 1...n {
            queue.asyncAfter(deadline: .now() + Double(i) * 0.03) {
                let t = Float(i) / Float(n)
                for (pad, from, to) in steps { pad.player.volume = from + (to - from) * t }
                if i == n { done() }
            }
        }
    }

    func start(file: AVAudioFile, fade: Double) {
        let pad = Pad(file: file)
        engine.attach(pad.player)
        engine.connect(pad.player, to: engine.mainMixerNode, format: file.processingFormat)
        pad.player.volume = 0
        scheduleLoop(pad)
        if !engine.isRunning { try? engine.start() }
        pad.player.play()
        var steps: [(Pad, Float, Float)] = [(pad, 0, 1)]
        if let old = current { steps.append((old, old.player.volume, 0)); fading.append(old) }
        current = pad
        let old = fading
        ramp(steps, seconds: fade) { [weak self] in
            for o in old where o !== self?.current { o.player.stop(); self?.engine.detach(o.player) }
            self?.fading.removeAll { f in old.contains { $0 === f } }
        }
    }

    func play(set: String, layer: String, key: String, fade: Double) {
        let path = "\(padsDir)/\(set)/\(layer)/\(key).wav"
        guard let file = try? AVAudioFile(forReading: URL(fileURLWithPath: path)) else {
            error = "Pad niet gevonden: \(set)/\(layer)/\(key)"; return
        }
        if !configured { configure() }
        setName = set; self.layer = layer; self.key = key; error = nil
        start(file: file, fade: fade)
    }

    func stop(fade: Double) {
        guard let pad = current else { return }
        current = nil; key = ""
        fading.append(pad)
        ramp([(pad, pad.player.volume, 0)], seconds: fade) { [weak self] in
            pad.player.stop(); self?.engine.detach(pad.player)
            self?.fading.removeAll { $0 === pad }
        }
    }
}

// ------------------------------------------------------------- beschikbare pads
func library() -> [String: Any] {
    var sets: [String: Any] = [:]
    let fm = FileManager.default
    for set in (try? fm.contentsOfDirectory(atPath: padsDir)) ?? [] where !set.hasPrefix(".") && !set.hasPrefix("_") {
        var layers: [String] = []
        for layer in (try? fm.contentsOfDirectory(atPath: "\(padsDir)/\(set)")) ?? [] where !layer.hasPrefix(".") {
            let files = (try? fm.contentsOfDirectory(atPath: "\(padsDir)/\(set)/\(layer)")) ?? []
            if files.contains(where: { $0.hasSuffix(".wav") }) { layers.append(layer) }
        }
        if !layers.isEmpty { sets[set] = layers.sorted() }
    }
    return sets
}

// ------------------------------------------------------------- hoofdlus
let pads = PadEngine()
var lastCmd = ""
var lastStateWrite = Date.distantPast
var lastConfigCheck = Date.distantPast
var cachedLibrary = library()

func bridgeOutput() -> String {
    let s = getExtState("ArkTracks", "state")
    guard let data = s.data(using: .utf8), let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return "stereo" }
    // Toegepaste stand; als REAPER's audio nog niet draait de gekozen stand
    if let out = json["output"] as? String { return out }
    if let mode = json["outputMode"] as? String, mode == "multi" || mode == "2ch" { return mode }
    return "stereo"
}

func handle(_ raw: String) {
    let p = raw.components(separatedBy: "\t")
    guard p.count >= 2 else { return }
    lastCmd = p[0]
    let arg = Array(p.dropFirst(2))
    switch p[1] {
    case "play" where arg.count >= 3:
        pads.play(set: arg[0], layer: arg[1], key: arg[2], fade: Double(arg.count > 3 ? arg[3] : "") ?? 4)
    case "stop":
        pads.stop(fade: Double(arg.first ?? "") ?? 4)
    case "volume":
        pads.volume = max(0, min(1, Float(arg.first ?? "") ?? pads.volume))
        pads.engine.mainMixerNode.outputVolume = pads.volume
    case "rescan":
        cachedLibrary = library()
    default:
        pads.error = "Onbekende opdracht: \(p[1])"
    }
    lastStateWrite = .distantPast
}

func writeState() {
    var state: [String: Any] = [
        "lastCmd": lastCmd, "playing": pads.current != nil, "set": pads.setName, "layer": pads.layer,
        "key": pads.key, "volume": pads.volume, "output": pads.output, "device": pads.device ?? "standaard",
        "sets": cachedLibrary,
    ]
    if let e = pads.error { state["error"] = e }
    if let data = try? JSONSerialization.data(withJSONObject: state), let s = String(data: data, encoding: .utf8) {
        setExtState("ArkPads", "state", s)
    }
}

func tick() {
    let raw = getExtState("ArkPads", "cmd")
    if !raw.isEmpty, let id = raw.components(separatedBy: "\t").first, id != lastCmd { handle(raw) }
    // Apparaat of uitgangsmodus veranderd (bv. X-USB aangesloten, 2 kanalen gekozen)
    if Date().timeIntervalSince(lastConfigCheck) > 3 {
        lastConfigCheck = Date()
        let dev = reaperOutputDeviceName(), out = bridgeOutput()
        if dev != pads.device || out != pads.output || !pads.configured {
            pads.device = dev; pads.output = out
            // Ook als er niets speelt: anders komt de volgende pad nog op de oude uitgang
            pads.configure()
        }
    }
    if Date().timeIntervalSince(lastStateWrite) > 0.5 { writeState(); lastStateWrite = Date() }
}

log("ArkPads gestart, pads in \(padsDir)")
// De eerstvolgende opdracht die er al stond niet opnieuw uitvoeren na een herstart
lastCmd = getExtState("ArkPads", "cmd").components(separatedBy: "\t").first ?? ""
let timer = DispatchSource.makeTimerSource(queue: queue)
timer.schedule(deadline: .now(), repeating: .milliseconds(100))
timer.setEventHandler { tick() }
timer.resume()
RunLoop.main.run()
