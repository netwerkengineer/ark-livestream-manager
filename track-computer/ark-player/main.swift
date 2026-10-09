import AVFoundation
import AudioToolbox
import CoreAudio
import Foundation
import Network

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
case "cuetest":
    guard let folder = args.first else { print("gebruik: ark-player cuetest <songmap met .RPP en ark-player.json>"); exit(2) }
    do { try cuetest(folder: folder) } catch { print("fout: \(error)"); exit(1) }
case "transtest":
    guard args.count >= 2 else { print("gebruik: ark-player transtest <songmapA> <songmapB>"); exit(2) }
    do { try transtest(a: args[0], b: args[1]) } catch { print("fout: \(error)"); exit(1) }
case "serve":
    let port = UInt16(opt("--port") ?? "8099") ?? 8099
    let device = opt("--device")
    let modeArg = opt("--mode") ?? (flag("--multi") ? "multi" : nil)
    let mdb = Double(opt("--master-db") ?? "0") ?? 0
    let songsRoot = opt("--songs")
    let fsArg = opt("--freeshow")
    let leadArg = opt("--lead")
    let mixer = Mixer(); mixer.master = Float(pow(10, min(0, mdb) / 20))
    let output = Output(mixer: mixer)
    let player = Player(mixer: mixer, output: output)
    if let r = songsRoot { player.songsRoot = r }
    player.start()                                           // bewaarde instellingen en bibliotheek
    if let m = modeArg { player.setOutputMode(m) }
    if let f = fsArg { let p = f.split(separator: ":"); player.setFreeShow(host: String(p.first ?? ""), port: p.count > 1 ? Int(p[1]) : nil) }
    if let l = leadArg, let b = Double(l) { try? player.setLead(b) }
    let server = Server(player: player)
    do { try output.start(device: device); try server.run(port: port) } catch { print("starten mislukt: \(error)"); exit(1) }
    if let folder = args.first { try? player.selectSong(path: folder, mode: nil) }
    RunLoop.main.run()
default:
    print("gebruik: ark-player serve|selftest|jumptest|cuetest|transtest|devices")
}

