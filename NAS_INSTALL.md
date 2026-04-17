# NAS Installatie Handleiding: Ark Church Livestream Manager

Deze handleiding helpt je om de Livestream Manager (NAS-Pro versie) op je Synology NAS te installeren en te onderhouden.

## Voorwaarden op de NAS
1.  **SSH Toegang**: Schakel SSH in via *Configuratiescherm > Terminal & SNMP*.
2.  **Container Manager**: Zorg dat het pakket "Container Manager" (voorheen Docker) is geïnstalleerd.
3.  **Mappenstructuur**:
    -   Het hoofdpad van de app: `/volume1/docker/ark-livestream-manager`
    -   Het pad voor thumbnails: `/volume1/Beamer/FreeShow/Media` (Dient te bestaan).

---

## Installatie & Updates via Mac
We maken gebruik van een automatisch Python-script om de app naar de NAS te sturen en te starten.

### 1. Voorbereiding op je Mac
Zorg dat je in de map van het project staat op je Mac.

### 2. Het Deployment Script starten
Voer het volgende commando uit in je Terminal:
```bash
python3 deploy_nas.py
```

Het script zal je vragen om:
-   **NAS IP**: Het (VPN) IP-adres van je NAS.
-   **Gebruikersnaam**: De naam waarmee je inlogt op de NAS (bijv. `jeffrey`).
-   **Wachtwoord**: Je NAS wachtwoord (voor sudo-rechten).
-   **Doelpad**: Waar de bestanden moeten komen (standaard `/volume1/docker/ark-livestream-manager`).

### 3. Wat het script doet
-   Het pakt de code in (zonder overbodige bestanden).
-   Het verstuurt alles veilig naar de NAS via SSH.
-   Het maakt de mappen aan en zet de rechten goed (`777` voor de data-map).
-   Het bouwt de Docker-image op de NAS en start deze op.

---

## Eerste Configuratie (Wizard)
Zodra het script klaar is, bezoek je:
`http://[NAS-IP]:3000` (of je eigen domeinnaam via Reverse Proxy).

1.  De **Setup Wizard** verschijnt automatisch.
2.  Vul je Google en Facebook API keys in.
3.  Stel de NAS-paden in voor de thumbnails.
4.  Klik op **Voltooien**. De app herstart zichzelf op de NAS om de nieuwe keys te activeren.

---

## Onderhoud
-   **Updates**: Wil je een nieuwe versie van de code live zetten? Draai simpelweg `python3 deploy_nas.py` opnieuw.
-   **Logs**: Als er iets misgaat, kun je in Container Manager op de NAS de logs van de `livestream-manager` container bekijken.
-   **Back-up**: De instellingen en tokens staan in de map `/data` in de app-directory op je NAS. Maak hier af en toe een kopie van.

---
*Gemaakt voor Ark Church* ⛪
