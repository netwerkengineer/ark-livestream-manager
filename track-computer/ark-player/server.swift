import AVFoundation
import AudioToolbox
import CoreAudio
import Foundation
import Network

// ------------------------------------------------------------- state / HTTP
func jsonString(_ o: Any) -> String { (try? String(data: JSONSerialization.data(withJSONObject: o, options: [.sortedKeys]), encoding: .utf8)) ?? "{}" }
func db(_ g: Float) -> Double { g <= 0.000001 ? -150 : Double(20 * log10(g)) }

/// Lokale HTTP-API (alleen 127.0.0.1). Opdrachten komen als GET met query, het antwoord is JSON.
final class Server {
    let player: Player
    var mixer: Mixer { player.mixer }
    let q = DispatchQueue(label: "ark-player.http")
    init(player: Player) { self.player = player }

    func state() -> [String: Any] {
        let p = player
        p.lock.lock(); defer { p.lock.unlock() }
        let m = p.mixer, s = m.song
        let dur = Double(s.total) / m.sr
        let st: String = m.playing ? "playing" : (m.pos > 0 && m.pos < s.total ? "paused" : "stopped")
        let cur = m.sectionIndex(at: m.pos)
        var d: [String: Any] = ["title": s.title, "path": p.activePath, "state": st, "position": m.posSec, "position_beats": s.tempo.barBeat(qn: s.tempo.qn(sec: m.posSec)), "duration": dur, "loading": !p.loading.isEmpty, "error": p.error ?? "",
                "device": p.output?.deviceName ?? "", "outputs": p.output?.hwChannels ?? m.outCh, "output_mode": m.requested, "output_applied": m.applied,
                "master_db": db(m.master), "master_mute": m.masterMuted, "jump_mode": m.jumpMode, "lead_beats": p.cfg.leadBeats,
                "freeshow": p.fsHost.isEmpty ? "" : "\(p.fsHost):\(p.fsPort)", "freeshow_override": !p.cfg.fsHost.isEmpty,
                "has_cues": p.table != nil, "slide": p.sent ?? 0, "last_cmd": p.lastCmd,
                "setlist": p.setlist, "loaded": p.cache.keys.sorted(),
                "sections": s.sections.enumerated().map { ["id": $0.offset, "region": $0.element.id, "name": $0.element.name, "start": $0.element.start, "end": $0.element.end,
                                                           "start_qn": s.tempo.qn(sec: $0.element.start), "end_qn": s.tempo.qn(sec: $0.element.end)] },
                "stems": s.stems.map { ["name": $0.name, "bus": $0.bus, "bus_name": $0.busName, "mute": $0.mute, "solo": $0.solo, "live": $0.live, "monitor": $0.monitor, "gain_db": db($0.gain), "gain": Double($0.gain), "meter_db": db($0.peak)] },
                "busses": defaultBusses.map { b in ["bus": b.out, "name": b.name, "mute": m.groupMute[b.out], "solo": m.groupSolo[b.out], "gain": Double(m.groupGain[b.out])] },
                "render": ["blocks": m.blocks, "avg_us": m.blocks > 0 ? m.sumMicros / Double(m.blocks) : 0, "max_us": m.maxMicros]]
        let pd = m.pads
        d["pads"] = ["playing": pd.playing, "loading": pd.loading, "set": pd.set, "layer": pd.layer, "key": pd.key, "volume": Double(pd.volume), "output": m.applied,
                     "device": p.output?.deviceName ?? "", "sets": pd.sets, "lastCmd": pd.lastCmd] as [String: Any]
        if !pd.error.isEmpty { d["pads_error"] = pd.error }
        if let c = cur { d["section"] = c }
        if m.pendSection >= 0 { d["pending"] = m.pendSection; d["pending_at"] = Double(m.pendAt) / m.sr }
        if m.loopSec >= 0 { d["loop"] = m.loopSec }
        if let n = p.nextSong { d["next_song"] = n }
        if let t = p.switchTarget, m.pendSongAt >= 0 { d["pending_song"] = t.path; d["pending_song_at"] = Double(m.pendSongAt) / m.sr }
        if let r = p.rec { d["recording"] = true; d["rec_slide"] = r.idx; d["rec_slides"] = r.region.map { p.regionNotes($0).count } ?? 0 }
        return d
    }

    func ok(_ extra: [String: Any] = [:]) -> (Int, String) { (200, jsonString(["ok": true].merging(extra) { $1 })) }
    func bad(_ msg: String, _ code: Int = 400) -> (Int, String) { (code, jsonString(["error": msg])) }

    func handle(_ method: String, _ path: String, _ qs: [String: String], _ items: [URLQueryItem] = []) -> (Int, String) {
        let p = player
        p.lastCmd = path
        switch path {
        case "/state": return (200, jsonString(state()))
        case "/play":
            p.lock.lock(); if mixer.pos >= mixer.song.total { mixer.pos = 0 }; mixer.playing = true; p.lock.unlock(); return ok()
        case "/pause": mixer.playing = false; return ok()
        case "/stop": mixer.playing = false; mixer.pos = 0; mixer.stopLoop(); mixer.cancelPending(); p.cancelSong(); return ok()
        case "/seek":
            guard let t = Double(qs["t"] ?? "") else { return bad("t ontbreekt") }
            mixer.pos = max(0, min(mixer.song.total, Int(t * mixer.sr))); return ok()
        case "/mute":
            let on = (qs["on"] ?? "1") != "0"
            for s in mixer.song.stems where qs["stem"] == nil || s.name.lowercased() == qs["stem"]!.lowercased() { s.mute = on }
            return ok()
        case "/gain":
            guard let d = Double(qs["db"] ?? "") else { return bad("db ontbreekt") }
            for s in mixer.song.stems where s.name.lowercased() == (qs["stem"] ?? "").lowercased() { s.gain = Float(pow(10, d / 20)) }
            return ok()
        case "/solo":
            let on = (qs["on"] ?? "1") != "0"
            for s in mixer.song.stems where s.name.lowercased() == (qs["stem"] ?? "").lowercased() { s.solo = on }
            return ok()
        case "/group":
            guard let b = Int(qs["bus"] ?? ""), b >= 1 && b <= 8 else { return bad("bus = 1-8") }
            if let v = qs["mute"] { mixer.groupMute[b] = v != "0" }
            if let v = qs["solo"] { mixer.groupSolo[b] = v != "0" }
            if let v = qs["gain"], let g = Double(v) { mixer.groupGain[b] = Float(max(0, min(4, g))) }
            return ok()
        case "/unmute":
            for s in mixer.song.stems { s.mute = false; s.solo = false }
            for b in 0..<mixer.groupMute.count { mixer.groupMute[b] = false; mixer.groupSolo[b] = false }
            return ok()
        case "/master":
            if let v = qs["mute"] { mixer.masterMuted = v != "0" }
            if let d = Double(qs["db"] ?? "") { mixer.master = Float(pow(10, max(-90, min(6, d)) / 20)) }
            else if qs["mute"] == nil { return bad("db of mute ontbreekt") }
            return ok()
        case "/jump":
            guard let id = Int(qs["id"] ?? "") else { return bad("id ontbreekt") }
            if let e = p.jump(to: id, mode: qs["mode"]) { return bad(e) }
            return ok()
        case "/loop":
            if (qs["on"] ?? "1") == "0" { mixer.stopLoop(); return ok() }
            if let e = mixer.startLoop() { return bad(e) }
            return ok()
        case "/cancel": mixer.cancelPending(); return ok()
        case "/mode":
            guard let m = qs["m"], ["end", "bar", "now"].contains(m) else { return bad("m = end|bar|now") }
            p.setJumpMode(m); return ok()
        case "/output":
            guard let m = qs["mode"], ["auto", "multi", "2ch", "3ch", "stereo"].contains(m) else { return bad("mode = auto|multi|2ch|3ch|stereo") }
            p.setOutputMode(m); log("Uitgangsmodus \(m) -> \(mixer.applied)"); return ok(["applied": mixer.applied])
        // --- nummers en setlist
        case "/load", "/song":
            guard let target = qs["path"] else { return bad("path ontbreekt") }
            let isLoad = path == "/load"
            do { try p.selectSong(path: target, mode: isLoad ? nil : qs["mode"]) } catch { return bad(error.localizedDescription) }
            return (202, jsonString(["ok": true]))
        case "/songcancel": p.cancelSong(); return ok()
        case "/setlist":
            var paths = items.filter { $0.name == "p" }.compactMap { $0.value?.replacingOccurrences(of: "+", with: " ") }
            if let j = qs["paths"] { paths += j.components(separatedBy: "|") }
            p.setSetlist(paths); return (202, jsonString(["ok": true, "count": paths.count]))
        case "/scan": p.scanLibrary(); return ok()
        case "/sections":
            guard let target = qs["path"] else { return bad("path ontbreekt") }
            guard let o = songOutline(folder: p.folderOf(target)) else { return bad("Geen speelbestand (ark-player.json of song.json) bij dit nummer") }
            return (200, jsonString(["title": o.title, "lead": p.cfg.leadBeats,
                                     "sections": o.sections.map { ["id": $0.id, "name": $0.name, "start": $0.start, "finish": $0.end,
                                                                   "startQn": o.tempo.qn(sec: $0.start), "finishQn": o.tempo.qn(sec: $0.end)] }]))
        case "/pad":
            let pd = mixer.pads
            pd.lastCmd = qs["id"] ?? String(Int(Date().timeIntervalSince1970 * 1000))
            switch qs["op"] ?? "" {
            case "play":
                guard let s = qs["set"], let l = qs["layer"], let k = qs["key"], !s.isEmpty, !l.isEmpty, !k.isEmpty else { return bad("set, laag en toon ontbreken") }
                pd.play(set: s, layer: l, key: k, fade: Double(qs["fade"] ?? "") ?? 4, sr: mixer.sr)
            case "stop": pd.stop(fade: Double(qs["fade"] ?? "") ?? 4, sr: mixer.sr)
            case "volume": pd.volume = Float(max(0, min(1, Double(qs["volume"] ?? "") ?? Double(pd.volume))))
            case "rescan": pd.scan()
            default: return bad("Onbekende pad-actie")
            }
            return ok()
        case "/configure":
            // instellingen van de speler wijzigen (apparaat, uitgangen, nummermap, FreeShow); moet op de hoofdthread draaien
            var deviceChanged = false
            if let d = qs["device"] { if d != p.cfg.device { deviceChanged = true }; p.setDevice(d) }
            if let m = qs["output_mode"], ["auto", "multi", "3ch", "2ch", "stereo"].contains(m) { p.setOutputMode(m) }
            if let r = qs["songs_root"] { p.setSongsRoot(r) }
            if let r = qs["pads_root"] { p.setPadsRoot(r) }
            if let h = qs["freeshow_host"] { p.setFreeShow(host: h, port: Int(qs["freeshow_port"] ?? "")) }
            if deviceChanged, let o = p.output {
                do { try o.start(device: p.cfg.device.isEmpty ? nil : p.cfg.device) } catch { return bad("Audio starten mislukt: \(error.localizedDescription)") }
            }
            return ok()
        case "/devices":
            return (200, jsonString(["devices": allDevices().filter { $0.outCh > 0 }.map { ["name": $0.name, "outputs": $0.outCh] }, "current": p.output?.deviceName ?? ""]))
        case "/settings":
            return (200, jsonString(["device": p.cfg.device, "songs_root": p.songsRoot, "pads_root": p.cfg.padsRoot, "freeshow_host": p.cfg.fsHost, "freeshow_port": p.cfg.fsPort,
                                     "output_mode": p.cfg.outputMode, "lead_beats": p.cfg.leadBeats]))
        case "/library":
            p.lock.lock(); defer { p.lock.unlock() }
            return (200, jsonString(["songs": p.library.map { ["name": $0.name, "path": $0.path, "loaded": p.cache[p.folderOf($0.path)] != nil] }]))
        // --- cues
        case "/cues":
            guard let path = qs["path"] else { return bad("path ontbreekt") }
            do { try p.saveCues(path: path, data: qs["data"] ?? "") } catch { return bad(error.localizedDescription) }
            return ok()
        case "/lead":
            guard let b = Double(qs["beats"] ?? "") else { return bad("beats ontbreekt") }
            do { try p.setLead(b) } catch { return bad(error.localizedDescription) }
            return ok()
        case "/freeshow":
            if qs["runtime"] == "1" { p.setFreeShowRuntime(host: qs["host"] ?? "", port: Int(qs["port"] ?? "")) }
            else { p.setFreeShow(host: qs["host"] ?? "", port: Int(qs["port"] ?? "")) }
            return ok()
        case "/record":
            do { try p.record(qs["action"] ?? "cancel") } catch { return bad(error.localizedDescription) }
            return ok()
        case "/tap":
            do { try p.tap(pos: Double(qs["pos"] ?? "")) } catch { return bad(error.localizedDescription) }
            return ok()
        case "/taps": p.lock.lock(); defer { p.lock.unlock() }; return (200, jsonString(p.lastTaps))
        case "/notes":
            p.lock.lock(); defer { p.lock.unlock() }
            return (200, jsonString(["path": p.activePath, "notes": p.timeline.map { ["t": $0.t, "n": $0.n] }]))
        default: return bad("onbekend", 404)
        }
    }

    func run(port: UInt16) throws {
        let params = NWParameters.tcp
        params.requiredInterfaceType = .loopback          // alleen deze computer; aansturing vanaf de app volgt later met een token
        let l = try NWListener(using: params, on: NWEndpoint.Port(rawValue: port)!)
        l.newConnectionHandler = { [self] c in
            c.start(queue: q)
            c.receive(minimumIncompleteLength: 1, maximumLength: 65536) { data, _, _, _ in
                guard let d = data, let req = String(data: d, encoding: .utf8), let line = req.components(separatedBy: "\r\n").first else { c.cancel(); return }
                let parts = line.split(separator: " ")
                var res = (400, jsonString(["error": "ongeldig"]))
                if parts.count >= 2, let comps = URLComponents(string: String(parts[1])) {
                    var qs: [String: String] = [:]; for i in comps.queryItems ?? [] { qs[i.name] = (i.value ?? "").replacingOccurrences(of: "+", with: " ") }
                    res = self.handle(String(parts[0]), comps.path, qs, comps.queryItems ?? [])
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
