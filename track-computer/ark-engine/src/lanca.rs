//! Eigen certificaat voor de lokale bediening (https zonder dat er een domein of internet nodig is) — LocalCA.swift.
//!
//! - De app maakt één keer een eigen "certificaatautoriteit" (CA) en daarmee een certificaat voor deze computer (naam.local en de IP-adressen).
//! - Elk apparaat (iPad, telefoon, computer) installeert de CA één keer; daarna is de verbinding versleuteld en zonder waarschuwing.
//! - De CA mag alleen certificaten voor lokale namen (.local en privé-adressen) ondertekenen (name constraints): ook als iemand de sleutel
//!   zou stelen, kan er geen certificaat voor een openbare site mee worden gemaakt dat op jullie apparaten wordt vertrouwd.
//! - De CA-sleutel verlaat de computer nooit; apparaten krijgen alleen het (openbare) certificaat.

use rcgen::{BasicConstraints, CertificateParams, CidrSubnet, DistinguishedName, DnType, ExtendedKeyUsagePurpose, GeneralSubtree, IsCa, KeyPair, KeyUsagePurpose, NameConstraints, SanType};
use sha2::{Digest, Sha256};
use std::net::IpAddr;
use std::path::PathBuf;
use std::sync::Mutex;

const KEY_NAME: &str = "lan-ca-key";

pub struct Ca {
    dir: Option<PathBuf>, // None: alleen in het geheugen (voor de proeven)
    mem: Mutex<Option<(String, String)>>, // (cert pem, sleutel pem)
}

fn san_ip(s: &str) -> Option<IpAddr> {
    s.parse().ok()
}

impl Ca {
    pub fn new(dir: Option<PathBuf>) -> Ca {
        Ca { dir, mem: Mutex::new(None) }
    }

    fn read(&self) -> Option<(String, String)> {
        match &self.dir {
            None => self.mem.lock().unwrap().clone(),
            Some(d) => {
                let cert = std::fs::read_to_string(d.join("ca.crt.pem")).ok()?;
                if cert.is_empty() {
                    return None;
                }
                // de privésleutel: sleutelbos, anders het bestand (en dan meteen proberen over te zetten naar de sleutelbos)
                let file_key = std::fs::read_to_string(d.join("ca.key.pem")).unwrap_or_default();
                if let Some(k) = crate::vault::get(KEY_NAME) {
                    if !file_key.is_empty() {
                        let _ = std::fs::remove_file(d.join("ca.key.pem")); // staat veilig in de sleutelbos: het bestand kan weg
                    }
                    return Some((cert, k));
                }
                if file_key.is_empty() {
                    return None;
                }
                if crate::vault::set(KEY_NAME, &file_key) {
                    let _ = std::fs::remove_file(d.join("ca.key.pem"));
                    crate::player::log("Certificaatsleutel overgezet naar de sleutelbos van het systeem");
                }
                Some((cert, file_key))
            }
        }
    }
    fn write(&self, cert: &str, key: &str) -> Result<(), String> {
        match &self.dir {
            None => {
                *self.mem.lock().unwrap() = Some((cert.into(), key.into()));
                Ok(())
            }
            Some(d) => {
                use std::os::unix::fs::PermissionsExt;
                std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
                std::fs::write(d.join("ca.crt.pem"), cert).map_err(|e| e.to_string())?;
                let kp = d.join("ca.key.pem");
                if crate::vault::set(KEY_NAME, key) {
                    let _ = std::fs::remove_file(&kp);
                } else {
                    std::fs::write(&kp, key).map_err(|e| e.to_string())?;
                    let _ = std::fs::set_permissions(&kp, std::fs::Permissions::from_mode(0o600)); // alleen deze gebruiker
                }
                Ok(())
            }
        }
    }

    pub fn exists(&self) -> bool {
        self.read().is_some()
    }

    /// Verwijdert de CA: een nieuwe moet daarna opnieuw op alle apparaten worden geïnstalleerd
    pub fn reset(&self) {
        match &self.dir {
            None => *self.mem.lock().unwrap() = None,
            Some(d) => {
                let _ = std::fs::remove_file(d.join("ca.crt.pem"));
                let _ = std::fs::remove_file(d.join("ca.key.pem"));
                crate::vault::delete(KEY_NAME);
            }
        }
    }

    /// Maakt de CA als die er nog niet is
    pub fn ensure(&self, name: &str) -> Result<(), String> {
        if self.exists() {
            return Ok(());
        }
        // Staat het certificaat er wel maar is de sleutel niet te lezen (bijvoorbeeld een vergrendelde sleutelbos), dan NIET stilletjes een
        // nieuwe CA maken: alle apparaten zouden dan opnieuw het certificaat moeten installeren.
        if let Some(d) = &self.dir {
            if d.join("ca.crt.pem").exists() {
                return Err("De sleutel van het certificaat is niet te lezen (is de sleutelbos vergrendeld?). Ontgrendel de sleutelbos en start de app opnieuw, of maak bewust een nieuw certificaat.".into());
            }
        }
        let cn: String = name.chars().filter(|c| c.is_alphanumeric() || *c == ' ' || *c == '-' || *c == '.').take(40).collect();
        let mut p = CertificateParams::default();
        let mut dn = DistinguishedName::new();
        dn.push(DnType::CommonName, format!("Ark Tracks Lokale CA ({})", if cn.is_empty() { "computer" } else { &cn }));
        dn.push(DnType::OrganizationName, "Ark Tracks");
        p.distinguished_name = dn;
        p.is_ca = IsCa::Ca(BasicConstraints::Constrained(0));
        p.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign];
        p.not_before = time::OffsetDateTime::now_utc() - time::Duration::days(1);
        p.not_after = time::OffsetDateTime::now_utc() + time::Duration::days(3650);
        p.name_constraints = Some(NameConstraints {
            permitted_subtrees: vec![
                GeneralSubtree::DnsName("local".into()),
                GeneralSubtree::IpAddress(CidrSubnet::from_v4_prefix([192, 168, 0, 0], 16)),
                GeneralSubtree::IpAddress(CidrSubnet::from_v4_prefix([172, 16, 0, 0], 12)),
                GeneralSubtree::IpAddress(CidrSubnet::from_v4_prefix([10, 0, 0, 0], 8)),
                GeneralSubtree::IpAddress(CidrSubnet::from_v4_prefix([127, 0, 0, 1], 32)),
            ],
            excluded_subtrees: vec![],
        });
        let key = KeyPair::generate_for(&rcgen::PKCS_ECDSA_P256_SHA256).map_err(|e| e.to_string())?;
        let cert = p.self_signed(&key).map_err(|e| e.to_string())?;
        self.write(&cert.pem(), &key.serialize_pem())
    }

    pub fn cert_pem(&self) -> String {
        self.read().map(|c| c.0).unwrap_or_default()
    }

    pub fn der(&self) -> Option<Vec<u8>> {
        let pem = self.cert_pem();
        let a = pem.find("-----BEGIN CERTIFICATE-----")? + "-----BEGIN CERTIFICATE-----".len();
        let b = pem.find("-----END CERTIFICATE-----")?;
        use base64::Engine;
        let body: String = pem[a..b].chars().filter(|c| !c.is_whitespace()).collect();
        base64::engine::general_purpose::STANDARD.decode(body).ok()
    }

    /// Vingerafdruk (SHA-256) om te controleren dat een apparaat het goede certificaat installeert, zoals "AB:CD:..."
    pub fn fingerprint(&self) -> String {
        match self.der() {
            Some(d) => Sha256::digest(&d).iter().map(|b| format!("{b:02X}")).collect::<Vec<_>>().join(":"),
            None => String::new(),
        }
    }

    /// Profiel voor iPhone en iPad: één tik om het certificaat te installeren (daarna nog het vertrouwen aanzetten)
    pub fn mobileconfig(&self, name: &str) -> Option<Vec<u8>> {
        use base64::Engine;
        let der = self.der()?;
        let esc = |s: &str| s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
        let title = esc(&format!("Ark Tracks Lokale CA ({name})"));
        let b64 = base64::engine::general_purpose::STANDARD.encode(der);
        let u1 = uuid_like();
        let u2 = uuid_like();
        let xml = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>PayloadContent</key><array><dict>
    <key>PayloadCertificateFileName</key><string>ark-tracks-ca.crt</string>
    <key>PayloadContent</key><data>{b64}</data>
    <key>PayloadDescription</key><string>Certificaat voor de lokale bediening van Ark Tracks</string>
    <key>PayloadDisplayName</key><string>{title}</string>
    <key>PayloadIdentifier</key><string>nl.arkchurch.tracks.ca.cert</string>
    <key>PayloadType</key><string>com.apple.security.root</string>
    <key>PayloadUUID</key><string>{u1}</string>
    <key>PayloadVersion</key><integer>1</integer>
  </dict></array>
  <key>PayloadDescription</key><string>Zet de lokale bediening van Ark Tracks op deze iPhone of iPad op vertrouwd (versleutelde verbinding met de computer).</string>
  <key>PayloadDisplayName</key><string>Ark Tracks – lokale bediening</string>
  <key>PayloadIdentifier</key><string>nl.arkchurch.tracks.ca</string>
  <key>PayloadRemovalDisallowed</key><false/>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadUUID</key><string>{u2}</string>
  <key>PayloadVersion</key><integer>1</integer>
</dict></plist>"#
        );
        Some(xml.into_bytes())
    }

    /// Maakt een certificaat voor deze namen en adressen: (certificaat DER, sleutel PKCS#8 DER)
    pub fn leaf(&self, hosts: &[String], ips: &[String], name: &str) -> Result<(Vec<u8>, Vec<u8>), String> {
        self.ensure(name)?;
        let (cert_pem, key_pem) = self.read().ok_or("CA niet te lezen")?;
        let ca_key = KeyPair::from_pem(&key_pem).map_err(|e| e.to_string())?;
        let ca_params = CertificateParams::from_ca_cert_pem(&cert_pem).map_err(|e| e.to_string())?;
        let ca = ca_params.self_signed(&ca_key).map_err(|e| e.to_string())?; // zelfde naam en sleutel als de bewaarde CA
        let mut p = CertificateParams::default();
        let mut dn = DistinguishedName::new();
        dn.push(DnType::CommonName, hosts.first().cloned().unwrap_or_else(|| "ark-tracks.local".into()));
        p.distinguished_name = dn;
        p.is_ca = IsCa::NoCa;
        p.key_usages = vec![KeyUsagePurpose::DigitalSignature];
        p.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
        let mut sans: Vec<SanType> = Vec::new();
        for h in hosts {
            sans.push(SanType::DnsName(h.clone().try_into().map_err(|_| format!("ongeldige naam: {h}"))?));
        }
        let mut seen_local = false;
        for i in ips {
            if let Some(ip) = san_ip(i) {
                seen_local |= ip.is_loopback();
                sans.push(SanType::IpAddress(ip));
            }
        }
        if !seen_local {
            sans.push(SanType::IpAddress("127.0.0.1".parse().unwrap()));
        }
        p.subject_alt_names = sans;
        p.not_before = time::OffsetDateTime::now_utc() - time::Duration::days(1);
        p.not_after = time::OffsetDateTime::now_utc() + time::Duration::days(397);
        let leaf_key = KeyPair::generate_for(&rcgen::PKCS_ECDSA_P256_SHA256).map_err(|e| e.to_string())?;
        let leaf = p.signed_by(&leaf_key, &ca, &ca_key).map_err(|e| e.to_string())?;
        Ok((leaf.der().to_vec(), leaf_key.serialize_der()))
    }
}

pub fn uuid_like() -> String {
    let mut b = [0u8; 16];
    getrandom::getrandom(&mut b).ok();
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h: Vec<String> = b.iter().map(|x| format!("{x:02X}")).collect();
    format!("{}-{}-{}-{}-{}", h[0..4].concat(), h[4..6].concat(), h[6..8].concat(), h[8..10].concat(), h[10..16].concat())
}
