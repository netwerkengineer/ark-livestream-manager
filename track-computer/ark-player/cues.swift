// FreeShow-cues: de cuetabel van een nummer (<project>.RPP.cues, door de app geschreven) en de tijdlijn die eruit volgt.
// Zelfde regels als de bridge (ark_tracks_bridge.lua), zodat REAPER en ark-player naast elkaar dezelfde dia's tonen.

import Foundation

struct CueSlide { let n: Int; let w: Int; let q: Double?; let text: String }
struct SlideTime { var t: Double; let n: Int }

final class CueTable {
    var showId: String?
    var layoutId: String?
    var regions: [Int: [CueSlide]] = [:]     // regionnummer (zoals in het RPP) -> dia's van die sectie

    /// Regel "<regionId> dia@gewicht@tel#tekst ...": gewicht = tekstlengte (voor de schatting), tel = opgenomen moment in
    /// kwartnoten vanaf het sectiebegin, tekst = eerste regel van de dia (+ = spatie, %XX voor andere tekens).
    static func read(path: String) -> CueTable? {
        guard let content = try? String(contentsOfFile: path, encoding: .utf8) else { return nil }
        let lines = content.components(separatedBy: "\n")
        guard let first = lines.first, first.range(of: "^ark-cues [1234]$", options: .regularExpression) != nil else { return nil }
        let table = CueTable()
        let token = try! NSRegularExpression(pattern: "^(\\d+)@?(\\d*)@?([\\d.]*)#?(.*)$")
        for line in lines.dropFirst() {
            let parts = line.split(whereSeparator: { $0 == " " || $0 == "\t" }).map(String.init)
            guard let head = parts.first else { continue }
            if head == "show", parts.count >= 2 { table.showId = parts[1]; table.layoutId = parts.count >= 3 ? parts[2] : nil; continue }
            guard let id = Int(head) else { continue }
            var list: [CueSlide] = []
            for t in parts.dropFirst() {
                let ns = t as NSString
                guard let m = token.firstMatch(in: t, range: NSRange(location: 0, length: ns.length)) else { continue }
                let n = Int(ns.substring(with: m.range(at: 1))) ?? 0
                let w = max(1, Int(ns.substring(with: m.range(at: 2))) ?? 1)
                let q = Double(ns.substring(with: m.range(at: 3)))
                list.append(CueSlide(n: n, w: w, q: q, text: decodeText(ns.substring(with: m.range(at: 4)))))
            }
            table.regions[id] = list
        }
        return table
    }

    static func decodeText(_ s: String) -> String {
        let plus = s.replacingOccurrences(of: "+", with: " ")
        return plus.removingPercentEncoding ?? plus
    }
}

/// Tijdlijn (tijd, dia) van een nummer: de eerste dia van een sectie `lead` kwartnoten voor het begin, de rest op het
/// opgenomen moment of naar verhouding van de tekstlengte (generateCueItems in de bridge).
func buildTimeline(song: Song, table: CueTable, lead: Double) -> [SlideTime] {
    let tm = song.tempo
    var out: [SlideTime] = []
    for sec in song.sections {
        guard let list = table.regions[sec.id], !list.isEmpty else { continue }
        let qs = tm.qn(sec: sec.start)
        let len = tm.qn(sec: sec.end) - qs
        let total = Double(list.reduce(0) { $0 + $1.w })
        var useRecorded = true, last = 0.0
        if list.count >= 2 {
            for k in 1..<list.count {
                if let q = list[k].q {
                    if q <= last || q >= len - 0.25 { useRecorded = false }
                    last = q
                }
            }
        }
        var acc = 0.0
        var prev: Double? = nil
        for (k, s) in list.enumerated() {
            var qn: Double
            if k == 0 { qn = qs - lead }
            else if let q = s.q, useRecorded { qn = qs + q }
            else { qn = qs + (acc / total * len + 0.5).rounded(.down) - lead }
            if let p = prev, qn < p + 0.25 { qn = min(p + 0.5, qs + len - 0.25) }   // altijd in volgorde
            prev = qn
            acc += Double(s.w)
            out.append(SlideTime(t: tm.sec(qn: max(0, qn)), n: s.n))
        }
    }
    out.sort { $0.t < $1.t }
    return out
}

/// Timing opnemen: de dia's binnen een sectie gaan alleen verder op een tik.
struct Recording {
    var region: Int? = nil              // sectie-index
    var idx = 1
    var taps: [Int: [Int: Double]] = [:] // sectie-index -> dia-volgnummer in de sectie -> kwartnoten vanaf het sectiebegin
}
