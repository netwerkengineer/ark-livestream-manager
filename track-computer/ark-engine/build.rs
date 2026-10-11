// Windows: pictogram en programma-gegevens in het .exe opnemen (taakbalk, bestandsverkenner, "Eigenschappen")
fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").map(|t| t == "windows").unwrap_or(false) && std::path::Path::new("wix/ArkTracks.ico").exists() {
        let mut res = winresource::WindowsResource::new();
        res.set_icon("wix/ArkTracks.ico");
        res.set("ProductName", "Ark Tracks");
        res.set("FileDescription", "Ark Tracks");
        res.set("CompanyName", "Ark Church");
        res.set("LegalCopyright", "Ark Church");
        if let Err(e) = res.compile() {
            println!("cargo:warning=pictogram niet opgenomen: {e}");
        }
    }
    println!("cargo:rerun-if-changed=wix/ArkTracks.ico");
    println!("cargo:rerun-if-changed=build.rs");
}
