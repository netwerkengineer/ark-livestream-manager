// Eigen certificaat voor de lokale bediening (https zonder dat er een domein of internet nodig is).
//
// - De app maakt één keer een eigen "certificaatautoriteit" (CA) en daarmee een certificaat voor deze Mac (naam.local en de IP-adressen).
// - Elk apparaat (iPad, telefoon, computer) installeert de CA één keer; daarna is de verbinding met de Mac versleuteld en zonder waarschuwing.
// - De CA mag alleen certificaten voor lokale namen (.local en privé-adressen) ondertekenen (name constraints): ook als iemand de sleutel
//   zou stelen, kan er geen certificaat voor een openbare site mee worden gemaakt dat op jullie apparaten wordt vertrouwd.
// - De sleutels staan in de Keychain van deze Mac. De CA-sleutel verlaat de Mac nooit; apparaten krijgen alleen het (openbare) certificaat.
// Gebruikt /usr/bin/openssl (LibreSSL, zit in macOS).

import Foundation
import Security

enum LocalCA {
    static var memory: [String: String]?        // alleen voor de proeven: niets naar de Keychain
    private static func kread(_ k: String) -> String { if let m = memory { return m[k] ?? "" }; return Keychain.get(k) }     // in de proef nooit de echte Keychain
    private static func kwrite(_ k: String, _ v: String) { if memory != nil { memory![k] = v } else { Keychain.set(k, v) } }

    struct Failure: LocalizedError { let message: String; var errorDescription: String? { message } }

    /// Een opdracht van openssl in een tijdelijke map (die daarna weer verdwijnt)
    private static func openssl(_ dir: URL, _ args: [String]) throws {
        let p = Process(); p.executableURL = URL(fileURLWithPath: "/usr/bin/openssl"); p.arguments = args; p.currentDirectoryURL = dir
        let err = Pipe(); p.standardError = err; p.standardOutput = Pipe()
        do { try p.run() } catch { throw Failure(message: "openssl niet gevonden: \(error.localizedDescription)") }
        let text = String(decoding: err.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        p.waitUntilExit()
        if p.terminationStatus != 0 { throw Failure(message: "openssl \(args.first ?? "") mislukte: \(text.split(separator: "\n").last.map(String.init) ?? "")") }
    }

    private static func tempDir() throws -> URL {
        let d = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("ark-ca-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: d, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        return d
    }

    // ---- de CA
    static var caCertPEM: String { kread("lan-ca-cert") }
    static var exists: Bool { !caCertPEM.isEmpty && !kread("lan-ca-key").isEmpty }

    /// Maakt de CA als die er nog niet is
    static func ensureCA(name: String) throws {
        if exists { return }
        let d = try tempDir(); defer { try? FileManager.default.removeItem(at: d) }
        let cn = String(name.filter { $0.isLetter || $0.isNumber || $0 == " " || $0 == "-" || $0 == "." }.prefix(40))
        let cnf = """
        [req]
        distinguished_name = dn
        prompt = no
        [dn]
        CN = Ark Tracks Lokale CA (\(cn.isEmpty ? "Mac" : cn))
        O = Ark Tracks
        [v3_ca]
        basicConstraints = critical, CA:TRUE, pathlen:0
        keyUsage = critical, keyCertSign, cRLSign
        subjectKeyIdentifier = hash
        nameConstraints = critical, permitted;DNS:local, permitted;IP:192.168.0.0/255.255.0.0, permitted;IP:172.16.0.0/255.240.0.0, permitted;IP:10.0.0.0/255.0.0.0, permitted;IP:127.0.0.1/255.255.255.255
        """
        try cnf.write(to: d.appendingPathComponent("ca.cnf"), atomically: true, encoding: .utf8)
        try openssl(d, ["ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", "ca.key"])
        try openssl(d, ["req", "-new", "-x509", "-key", "ca.key", "-config", "ca.cnf", "-extensions", "v3_ca", "-days", "3650", "-sha256", "-out", "ca.crt"])
        guard let cert = try? String(contentsOf: d.appendingPathComponent("ca.crt")), let key = try? String(contentsOf: d.appendingPathComponent("ca.key")) else { throw Failure(message: "CA niet te lezen") }
        kwrite("lan-ca-key", key); kwrite("lan-ca-cert", cert)
    }

    /// Verwijdert de CA: een nieuwe moet daarna opnieuw op alle apparaten worden geïnstalleerd
    static func reset() { kwrite("lan-ca-key", ""); kwrite("lan-ca-cert", "") }

    static var caDER: Data? {
        let pem = caCertPEM
        guard let a = pem.range(of: "-----BEGIN CERTIFICATE-----"), let b = pem.range(of: "-----END CERTIFICATE-----") else { return nil }
        let body = pem[a.upperBound..<b.lowerBound].components(separatedBy: .whitespacesAndNewlines).joined()
        return Data(base64Encoded: body)
    }

    /// Vingerafdruk van het CA-certificaat (SHA-256), om te controleren dat een apparaat het goede certificaat installeert
    static var fingerprint: String {
        guard let der = caDER else { return "" }
        let d = try? tempDir(); guard let dir = d else { return "" }
        defer { try? FileManager.default.removeItem(at: dir) }
        try? der.write(to: dir.appendingPathComponent("ca.der"))
        let p = Process(); p.executableURL = URL(fileURLWithPath: "/usr/bin/openssl"); p.arguments = ["x509", "-inform", "der", "-in", "ca.der", "-noout", "-fingerprint", "-sha256"]; p.currentDirectoryURL = dir
        let out = Pipe(); p.standardOutput = out; p.standardError = Pipe()
        try? p.run(); let s = String(decoding: out.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self); p.waitUntilExit()
        return s.components(separatedBy: "=").last?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    /// Profiel voor iPhone en iPad: één tik om het certificaat te installeren (daarna nog het vertrouwen aanzetten)
    static func mobileconfig(name: String) -> Data? {
        guard let der = caDER else { return nil }
        let esc = { (s: String) in s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;") }
        let title = esc("Ark Tracks Lokale CA (\(name))")
        let xml = """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0"><dict>
          <key>PayloadContent</key><array><dict>
            <key>PayloadCertificateFileName</key><string>ark-tracks-ca.crt</string>
            <key>PayloadContent</key><data>\(der.base64EncodedString())</data>
            <key>PayloadDescription</key><string>Certificaat voor de lokale bediening van Ark Tracks</string>
            <key>PayloadDisplayName</key><string>\(title)</string>
            <key>PayloadIdentifier</key><string>nl.arkchurch.tracks.ca.cert</string>
            <key>PayloadType</key><string>com.apple.security.root</string>
            <key>PayloadUUID</key><string>\(UUID().uuidString)</string>
            <key>PayloadVersion</key><integer>1</integer>
          </dict></array>
          <key>PayloadDescription</key><string>Zet de lokale bediening van Ark Tracks op deze iPhone of iPad op vertrouwd (versleutelde verbinding met de Mac).</string>
          <key>PayloadDisplayName</key><string>Ark Tracks – lokale bediening</string>
          <key>PayloadIdentifier</key><string>nl.arkchurch.tracks.ca</string>
          <key>PayloadRemovalDisallowed</key><false/>
          <key>PayloadType</key><string>Configuration</string>
          <key>PayloadUUID</key><string>\(UUID().uuidString)</string>
          <key>PayloadVersion</key><integer>1</integer>
        </dict></plist>
        """
        return Data(xml.utf8)
    }

    // ---- het certificaat van deze Mac
    /// Maakt een certificaat voor deze namen en adressen en geeft de identiteit voor de TLS-verbinding terug
    static func identity(hosts: [String], ips: [String], name: String) throws -> SecIdentity {
        try ensureCA(name: name)
        let d = try tempDir(); defer { try? FileManager.default.removeItem(at: d) }
        try caCertPEM.write(to: d.appendingPathComponent("ca.crt"), atomically: true, encoding: .utf8)
        try kread("lan-ca-key").write(to: d.appendingPathComponent("ca.key"), atomically: true, encoding: .utf8)
        var san = hosts.map { "DNS:\($0)" } + ips.map { "IP:\($0)" }
        if !ips.contains("127.0.0.1") { san.append("IP:127.0.0.1") }
        let ext = """
        basicConstraints = CA:FALSE
        keyUsage = critical, digitalSignature
        extendedKeyUsage = serverAuth
        subjectKeyIdentifier = hash
        authorityKeyIdentifier = keyid:always
        subjectAltName = \(san.joined(separator: ", "))
        """
        try ext.write(to: d.appendingPathComponent("leaf.ext"), atomically: true, encoding: .utf8)
        try openssl(d, ["ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", "leaf.key"])
        try openssl(d, ["req", "-new", "-key", "leaf.key", "-subj", "/CN=\(hosts.first ?? "ark-tracks.local")", "-out", "leaf.csr"])
        try openssl(d, ["x509", "-req", "-in", "leaf.csr", "-CA", "ca.crt", "-CAkey", "ca.key", "-CAcreateserial", "-days", "397", "-sha256", "-extfile", "leaf.ext", "-out", "leaf.crt"])
        let pass = UUID().uuidString
        try openssl(d, ["pkcs12", "-export", "-inkey", "leaf.key", "-in", "leaf.crt", "-certfile", "ca.crt", "-out", "leaf.p12", "-passout", "pass:\(pass)"])
        let p12 = try Data(contentsOf: d.appendingPathComponent("leaf.p12"))
        var items: CFArray?
        let status = SecPKCS12Import(p12 as CFData, [kSecImportExportPassphrase as String: pass, kSecImportToMemoryOnly as String: true] as CFDictionary, &items)
        guard status == errSecSuccess, let arr = items as? [[String: Any]], let id = arr.first?[kSecImportItemIdentity as String] else { throw Failure(message: "Certificaat laden mislukt (\(status))") }
        return id as! SecIdentity
    }
}
