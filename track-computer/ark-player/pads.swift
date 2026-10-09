// Padspeler in de speler: ambient pads per toonsoort, los van de nummers (ze lopen door bij stoppen, starten en nummerwissels).
// Zelfde bestanden en dezelfde uitgangen als ArkPads op de track-computer:
//   <padsmap>/<set>/<laag>/<toon>.wav   (bv. Fundamental/Deep/Eb.wav)
//   uitgangsmodus multi -> uitgang 8 (PADS-bus van de X32), 3ch -> uitgang 2+3, 2ch -> uitgang 2, stereo -> 1+2
// De pad wordt volledig in het geheugen geladen (op de achtergrond) en daarna met een crossfade ingewisseld.

import Foundation
import AVFoundation

final class PadVoice {
    let l: [Float], r: [Float]
    var pos = 0
    var gain: Float = 0
    var target: Float = 1
    var step: Float = 0           // gain-verandering per frame
    var dying = false
    init(l: [Float], r: [Float]) { self.l = l; self.r = r }
}

final class PadPlayer {
    var voices: [PadVoice] = []
    var current: PadVoice?
    var volume: Float = 0.8
    var set = "", layer = "", key = ""
    var error = ""
    var loading = false
    var lastCmd = ""
    var root = ""                 // pads-map (leeg = ~/Tracks/Pads)
    private var mutex = pthread_mutex_t()
    private let loader = DispatchQueue(label: "ark-player.pads")
    private var library: [String: [String]] = [:]
    private var generation = 0

    init() { pthread_mutex_init(&mutex, nil) }

    var dir: String { root.isEmpty ? NSHomeDirectory() + "/Tracks/Pads" : root }
    var playing: Bool { current != nil }

    // ---- bibliotheek
    func scan() {
        var sets: [String: [String]] = [:]
        let fm = FileManager.default
        for s in (try? fm.contentsOfDirectory(atPath: dir)) ?? [] where !s.hasPrefix(".") && !s.hasPrefix("_") {
            var layers: [String] = []
            for l in (try? fm.contentsOfDirectory(atPath: "\(dir)/\(s)")) ?? [] where !l.hasPrefix(".") {
                if ((try? fm.contentsOfDirectory(atPath: "\(dir)/\(s)/\(l)")) ?? []).contains(where: { $0.lowercased().hasSuffix(".wav") }) { layers.append(l) }
            }
            if !layers.isEmpty { sets[s] = layers.sorted() }
        }
        pthread_mutex_lock(&mutex); library = sets; pthread_mutex_unlock(&mutex)
    }
    var sets: [String: [String]] { pthread_mutex_lock(&mutex); defer { pthread_mutex_unlock(&mutex) }; return library }

    // ---- bestand -> geheugen (48 kHz, stereo)
    static func decode(path: String, sr: Double) throws -> ([Float], [Float]) {
        let file = try AVAudioFile(forReading: URL(fileURLWithPath: path))
        guard let out = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sr, channels: 2, interleaved: false) else { throw NSError(domain: "pads", code: 1) }
        let inFmt = file.processingFormat
        let total = AVAudioFrameCount(file.length)
        var l: [Float] = [], r: [Float] = []
        let chunk: AVAudioFrameCount = 1 << 17
        if inFmt.sampleRate == sr && inFmt.channelCount <= 2 {
            guard let buf = AVAudioPCMBuffer(pcmFormat: inFmt, frameCapacity: chunk) else { throw NSError(domain: "pads", code: 2) }
            l.reserveCapacity(Int(total)); r.reserveCapacity(Int(total))
            while file.framePosition < file.length {
                try file.read(into: buf, frameCount: chunk)
                let n = Int(buf.frameLength); if n == 0 { break }
                let a = buf.floatChannelData![0], b = inFmt.channelCount > 1 ? buf.floatChannelData![1] : a
                l.append(contentsOf: UnsafeBufferPointer(start: a, count: n)); r.append(contentsOf: UnsafeBufferPointer(start: b, count: n))
            }
        } else {
            guard let conv = AVAudioConverter(from: inFmt, to: out), let inBuf = AVAudioPCMBuffer(pcmFormat: inFmt, frameCapacity: chunk),
                  let outBuf = AVAudioPCMBuffer(pcmFormat: out, frameCapacity: AVAudioFrameCount(Double(chunk) * sr / inFmt.sampleRate) + 4096) else { throw NSError(domain: "pads", code: 3) }
            var done = false
            while !done {
                outBuf.frameLength = 0
                var err: NSError?
                let status = conv.convert(to: outBuf, error: &err) { _, st in
                    if file.framePosition >= file.length { st.pointee = .endOfStream; return nil }
                    do { try file.read(into: inBuf, frameCount: chunk) } catch { st.pointee = .endOfStream; return nil }
                    st.pointee = .haveData; return inBuf
                }
                if let e = err { throw e }
                let n = Int(outBuf.frameLength)
                if n > 0 {
                    l.append(contentsOf: UnsafeBufferPointer(start: outBuf.floatChannelData![0], count: n))
                    r.append(contentsOf: UnsafeBufferPointer(start: outBuf.floatChannelData![1], count: n))
                }
                if status == .endOfStream || n == 0 { done = true }
            }
        }
        if l.isEmpty { throw NSError(domain: "pads", code: 4, userInfo: [NSLocalizedDescriptionKey: "leeg bestand"]) }
        return (l, r)
    }

    // ---- bediening (niet vanuit de audiothread)
    func play(set s: String, layer l: String, key k: String, fade: Double, sr: Double) {
        let path = "\(dir)/\(s)/\(l)/\(k).wav"
        guard FileManager.default.fileExists(atPath: path) else { error = "Pad niet gevonden: \(s)/\(l)/\(k)"; return }
        error = ""; loading = true
        generation += 1
        let gen = generation
        set = s; layer = l; key = k
        loader.async { [self] in
            do {
                let (a, b) = try PadPlayer.decode(path: path, sr: sr)
                let v = PadVoice(l: a, r: b)
                let n = Float(max(0.05, fade) * sr)
                v.target = 1; v.step = 1 / n
                pthread_mutex_lock(&mutex)
                if gen == generation {                       // een nieuwere keuze wint
                    if let old = current { old.target = 0; old.step = -max(old.gain, 0.0001) / n; old.dying = true }
                    voices.append(v); current = v
                }
                loading = false
                pthread_mutex_unlock(&mutex)
            } catch {
                self.error = "Pad laden mislukt: \(error.localizedDescription)"; loading = false
            }
        }
    }

    func stop(fade: Double, sr: Double) {
        generation += 1
        pthread_mutex_lock(&mutex); defer { pthread_mutex_unlock(&mutex) }
        key = ""; loading = false
        guard let c = current else { return }
        current = nil
        c.target = 0; c.step = -max(c.gain, 0.0001) / Float(max(0.05, fade) * sr); c.dying = true
    }

    // ---- audiothread: mengt de pads bij de uitgangen van de mixer (zonder te wachten: is de lock bezet dan slaat dit blok de pads over)
    func mix(frames: Int, out: [UnsafeMutablePointer<Float>], mode: String) {
        if pthread_mutex_trylock(&mutex) != 0 { return }
        defer { pthread_mutex_unlock(&mutex) }
        if voices.isEmpty { return }
        let nOut = out.count
        // doeluitgangen: (links, rechts of -1 voor mono)
        var a = 0, b = -1
        switch mode {
        case "multi": a = min(7, nOut - 1); b = -1
        case "3ch": a = min(1, nOut - 1); b = min(2, nOut - 1); if a == b { b = -1 }
        case "2ch": a = min(1, nOut - 1); b = -1
        default: a = 0; b = nOut > 1 ? 1 : -1
        }
        let vol = volume
        for v in voices {
            let n = v.l.count
            for i in 0..<frames {
                v.gain += v.step
                if (v.step > 0 && v.gain >= v.target) || (v.step < 0 && v.gain <= v.target) { v.gain = v.target; v.step = 0 }
                let g = v.gain * vol
                let p = v.pos
                if b >= 0 { out[a][i] += v.l[p] * g; out[b][i] += v.r[p] * g }
                else { out[a][i] += (v.l[p] + v.r[p]) * 0.5 * g }
                v.pos = p + 1 >= n ? 0 : p + 1
            }
        }
        voices.removeAll { $0.dying && $0.gain <= 0 }
    }
}
