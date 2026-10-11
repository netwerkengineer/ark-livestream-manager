//! Wat per besturingssysteem verschilt: waar bestanden staan, bestandsrechten, werkgeheugen, een link openen.
//! Alles op één plek, zodat de rest van de code voor Linux, macOS en Windows gelijk is.

use std::path::Path;

/// De thuismap van de gebruiker
pub fn home() -> String {
    #[cfg(windows)]
    {
        std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).unwrap_or_else(|_| ".".into())
    }
    #[cfg(not(windows))]
    {
        std::env::var("HOME").unwrap_or_else(|_| ".".into())
    }
}

/// Instellingen: Linux ~/.config/ArkTracks, Windows %APPDATA%\ArkTracks
pub fn config_dir() -> String {
    #[cfg(windows)]
    {
        let base = std::env::var("APPDATA").unwrap_or_else(|_| format!("{}\\AppData\\Roaming", home()));
        format!("{base}\\ArkTracks").replace('\\', "/")
    }
    #[cfg(not(windows))]
    {
        let base = std::env::var("XDG_CONFIG_HOME").unwrap_or_else(|_| format!("{}/.config", home()));
        format!("{base}/ArkTracks")
    }
}

/// Het logbestand: Linux ~/.local/state/ArkTracks/ArkTracks.log, Windows %LOCALAPPDATA%\ArkTracks\ArkTracks.log
pub fn log_path() -> String {
    if let Ok(p) = std::env::var("ARK_LOG") {
        return p;
    }
    #[cfg(windows)]
    {
        let base = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| format!("{}\\AppData\\Local", home()));
        format!("{base}\\ArkTracks\\ArkTracks.log").replace('\\', "/")
    }
    #[cfg(not(windows))]
    {
        let base = std::env::var("XDG_STATE_HOME").unwrap_or_else(|_| format!("{}/.local/state", home()));
        format!("{base}/ArkTracks/ArkTracks.log")
    }
}

pub fn default_songs_dir() -> String {
    format!("{}/Tracks/Songs", home().replace('\\', "/"))
}
pub fn default_pads_dir() -> String {
    format!("{}/Tracks/Pads", home().replace('\\', "/"))
}

/// Alleen deze gebruiker mag het bestand lezen (Linux/macOS: rechten 600; Windows: de map in %APPDATA% is al van de gebruiker)
pub fn make_private(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
}

/// Een http(s)-adres in de standaardbrowser openen
pub fn open_external(url: &str) {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return;
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open").arg(url).spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(url).spawn();
    }
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("rundll32").args(["url.dll,FileProtocolHandler", url]).spawn();
    }
}

/// (beschikbaar, totaal) werkgeheugen in bytes, voor zover het systeem dat laat zien
pub fn memory() -> (Option<u64>, Option<u64>) {
    #[cfg(target_os = "linux")]
    {
        let t = std::fs::read_to_string("/proc/meminfo").ok();
        let get = |key: &str| -> Option<u64> {
            let kb: u64 = t.as_ref()?.lines().find(|l| l.starts_with(key))?.split_whitespace().nth(1)?.parse().ok()?;
            Some(kb * 1024)
        };
        (get("MemAvailable:"), get("MemTotal:"))
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
        let mut s: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
        s.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
        // SAFETY: s is een geldige, geïnitialiseerde MEMORYSTATUSEX met dwLength gezet
        if unsafe { GlobalMemoryStatusEx(&mut s) } != 0 {
            (Some(s.ullAvailPhys), Some(s.ullTotalPhys))
        } else {
            (None, None)
        }
    }
    #[cfg(not(any(target_os = "linux", windows)))]
    {
        (None, None)
    }
}
