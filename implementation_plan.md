# Implementatieplan: Backup & Restore Module

Je wilt de bestaande instellingen uitbreiden met een volledige Backup & Restore module die verder gaat dan alleen FreeShow. Deze module pakt ook de configuratie, QLC+ en Bitfocus Companion aan, en ondersteunt externe opslag via WebDAV (voor bijvoorbeeld TransIP Stack).

## Doel

1.  **Selectieve Backups:** De gebruiker moet kunnen kiezen wat er geback-upt wordt:
    *   **App Configuratie:** De applicatie-instellingen (`data/settings.json`, `tokens.json`, etc.).
    *   **FreeShow Database:** Alle FreeShow projecten en instellingen (de bestaande map structuur inpakken).
    *   **QLC+ Project:** De `ark_church_lighting.qxw` workspace file en QLC+ configuratie.
    *   **Companion Config:** De lokale `companion-data` (waaronder de `db` file).
2.  **Opslaglocatie:** Keuze tussen direct downloaden (lokaal) of wegschrijven naar externe opslag (WebDAV/SFTP, via bijv. TransIP Stack).
3.  **Restore functionaliteit:** De mogelijkheid om in de app een zip-bestand te uploaden om een eerdere status te herstellen.

> [!IMPORTANT]
> Bij het herstellen van configuraties (zoals Companion of QLC+) moeten de betreffende Docker containers in Proxmox tijdelijk opnieuw worden opgestart. Dit kan een korte onderbreking (downtime) veroorzaken.

## Voorgestelde Wijzigingen

### 1. Frontend (UI)

#### [MODIFY] `src/app/page.tsx`
*   Voeg een nieuwe `settingsTab` toe: `"backup"`.
*   Zorg dat de Backup-knop in de navigatiebalk wordt getoond onder het Instellingen-paneel.

#### [NEW] `src/components/BackupRestoreSettings.tsx`
*   Nieuw component voor het Backup & Restore paneel.
*   Bevat secties per onderdeel (Config, FreeShow, QLC+, Companion).
*   Per sectie knoppen voor:
    *   `Download (Lokaal)`
    *   `Verzend naar Externe Opslag (TransIP Stack)`
    *   `Herstel (Upload bestand)`
*   Geïntegreerde configuratiemogelijkheden voor de TransIP Stack inloggegevens (als deze afwijken van de algemene instellingen).

### 2. Backend (API Routes)

#### [NEW] `src/app/api/backup/route.ts` (GET)
*   **Vervangt/Breidt uit:** Het bestaande `api/maintenance/backup/route.ts` om meerdere types te ondersteunen.
*   **Query parameter:** `?type=config|freeshow|qlc|companion`.
*   Zipt de specifieke mappen en bestanden en retourneert dit bestand direct als download. Het zip bestand wordt tevens bewaard in `data/backups`.

#### [MODIFY] `src/app/api/maintenance/remote/route.ts` (POST of GET uitbreiding)
*   Koppelt aan TransIP Stack via WebDAV (gebruikmakend van `webdav-client`).
*   Ondersteunt parameter `?type=...` om de correcte, laatst gemaakte zip door te sturen naar je Stack.

#### [NEW] `src/app/api/restore/route.ts` (POST)
*   Accepteert een multipart form-data upload met een `zip` bestand.
*   Ontleedt de `zip` file.
*   **Veiligheid:** Maakt éérst een automatische pre-restore kopie van de huidige bestanden voor als het fout gaat.
*   Overschrijft de doelbestanden (bijv. in `./data` of `./companion-data`).
*   Als vereist (bijv. Companion), activeert een commando in Proxmox (via de reeds werkende methodes) om de specifieke Docker service te herstarten.

## Open Vragen

> [!WARNING]
> Voor een vlekkeloze werking, heb ik de volgende feedback nodig:
> 
> 1.  **TransIP Stack:** Welke map op de TransIP stack wil je gebruiken (bijv. `/remote.php/webdav/Backups/Livestream/`)? 
> 2.  **FreeShow Database:** Momenteel pakt het backup script alleen de mappen `Shows` en `Bibles` in. Wil je de volledige FreeShow map inclusief Media ingepakt hebben, of was deze scope voldoende? Let op: Media kan heel groot worden (enkele gigabytes), wat downloaden en zippen vertraagt.
> 3.  **Automatische schema's:** Wil je dat deze backups (buiten handmatige knoppen om) óók onderdeel kunnen worden van automatische wekelijkse/dagelijkse schema's (in de "Scheduler" tab)?
> 4.  **Bitfocus Companion Herstart:** Om Companion configuraties met succes terug te plaatsen, moet de `companion` docker container worden geherstart. Mag het Restore-proces hiervoor korte commando's uitvoeren via SSH (naar Proxmox)?

## Verificatie Plan

### Handmatige Validatie
1. Ik simuleer een handmatige backup van alle 4 componenten.
2. Ik test de configuratie-instellingen voor WebDAV om een connectie te maken met een mock WebDAV server, óf vraag jou dit in Productie te doen met een echt TransIP Token.
3. Ik upload een 'lege' Companion backup en verifieer of de container de nieuwe (lege) knoppen toont na de restore.
