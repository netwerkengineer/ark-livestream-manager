# Verder werken op een andere computer (bijvoorbeeld de Linux-laptop)

Deze repo is **openbaar**. Zet er dus nooit IP-adressen van de kerk, gebruikersnamen, wachtwoorden, sleutels of tokens in. Wat daarvoor nodig is bewaar je privé (wachtwoordmanager of een eigen notitie).

## 1. De repo ophalen
```
git clone git@github.com:netwerkengineer/ark-livestream-manager.git
cd ark-livestream-manager
```
Je hebt daarvoor een SSH-sleutel op de nieuwe computer nodig (`ssh-keygen -t ed25519`) en de openbare sleutel bij GitHub (Settings → SSH keys), of `gh auth login`.

## 2. Gereedschap
- **Claude Code** (de opdrachtregelversie) installeren en inloggen. `CLAUDE.md` en `AGENTS.md` in de repo-map worden dan vanzelf gelezen.
- Voor de webapp: Node.js en `npm install`. Voor de Rust-app: `rustup` (`ark-engine/`), voor Linux-pakketten `cargo install cargo-deb`.
- Voor REAPER-werk: `python3` (voor `mt2reaper`), eventueel `ffmpeg`.

## 3. Toegang tot de servers (privé regelen)
- Een eigen SSH-sleutel per computer; zet de openbare sleutel in `authorized_keys` op de machines die je nodig hebt (NAS, de computer in de kerk, de testserver). Hergebruik nooit de privésleutel van een andere computer.
- Voor het deployen en meekijken is de VPN naar de kerk nodig. Zonder VPN kun je wel bouwen en testen (`cargo test`, de webapp lokaal draaien).
- Zet adressen, accounts en de installatiewachtwoorden in je eigen notitie of wachtwoordmanager, niet in de repo.

## 4. Waar staat wat
- **In de repo:** de webapp (`src/`), `track-computer/` (Mac-app, Rust-versie, `mt2reaper.py`, handleiding in `docs/`), `deploy_nas.py`, de GitHub-workflows.
- **Niet in de repo (op de eigen schijf):** ontwerpnotities, gebouwde bestanden (`.deb`, `.msi`), MultiTracks-zips, het REAPER-project met stems, geheugen en notities van Claude. Neem de bestanden die je nodig hebt zelf mee (USB-stick of een privé opslag).
- Technische valkuilen staan in `ONTWIKKELNOTITIES.md` in deze map.

## 5. Eerste dingen om te controleren op de nieuwe computer
1. `git pull` en `git log -3`: is alles er?
2. Webapp: `npm install && npm run build`, of laat die bouwen op de testserver.
3. Rust: `cd track-computer/ark-engine && cargo test --locked --features app`.
4. Linux-pakket maken: `cargo build --release --locked --features app && cargo deb --no-build`; installeren met `sudo apt install ./target/debian/ark-tracks_*.deb`.
5. Deployen: alleen met VPN en SSH-sleutel (`python3 deploy_nas.py`).
