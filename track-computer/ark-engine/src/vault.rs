//! Geheimen (de sleutel van de app, de privésleutel van het eigen certificaat) in de sleutelbos van het systeem:
//! Linux: Secret Service (gnome-keyring, KWallet), macOS: Sleutelhanger, Windows: Referentiebeheer.
//! Is er geen sleutelbos (bijvoorbeeld zonder grafische sessie), dan blijven de geheimen in een bestand met rechten 0600 staan;
//! `available()` zegt welke van de twee geldt. Niets gaat verloren: een bestaand bestand wordt pas gewist nadat de sleutelbos de waarde teruggeeft.

use crate::player::log;
use std::sync::OnceLock;

fn service() -> String {
    std::env::var("ARK_VAULT_SERVICE").unwrap_or_else(|_| "nl.arkchurch.tracks-desktop".into()) // aparte naam voor de proeven
}

fn entry(name: &str) -> Option<keyring::Entry> {
    keyring::Entry::new(&service(), name).ok()
}

static AVAILABLE: OnceLock<bool> = OnceLock::new();

/// Werkt de sleutelbos? (Eén keer proberen met een proefwaarde; een geblokkeerde sleutelbos kan hier om het wachtwoord vragen.)
pub fn available() -> bool {
    *AVAILABLE.get_or_init(|| {
        if std::env::var_os("ARK_VAULT_DISABLE").is_some() {
            return false; // alleen voor proeven: doen alsof er geen sleutelbos is
        }
        let ok = (|| {
            let e = entry("probe")?;
            e.set_password("ok").ok()?;
            let back = e.get_password().ok()?;
            let _ = e.delete_credential();
            Some(back == "ok")
        })()
        .unwrap_or(false);
        log(&format!("Sleutelbos van het systeem: {}", if ok { "beschikbaar" } else { "niet beschikbaar; geheimen blijven in een beveiligd bestand" }));
        ok
    })
}

/// Waarde ophalen (None: er is niets, of de sleutelbos werkt niet)
pub fn get(name: &str) -> Option<String> {
    if !available() {
        return None;
    }
    match entry(name)?.get_password() {
        Ok(v) if !v.is_empty() => Some(v),
        _ => None,
    }
}

/// Waarde bewaren. Geeft true als de sleutelbos de waarde heeft (en teruggeeft); anders false en moet de aanroeper een bestand gebruiken.
pub fn set(name: &str, value: &str) -> bool {
    if !available() {
        return false;
    }
    let Some(e) = entry(name) else { return false };
    if value.is_empty() {
        let _ = e.delete_credential();
        return true;
    }
    if e.set_password(value).is_err() {
        return false;
    }
    e.get_password().map(|v| v == value).unwrap_or(false)
}

pub fn delete(name: &str) {
    if let Some(e) = entry(name) {
        let _ = e.delete_credential();
    }
}
