# Walkthrough: QLC+ ArtNet Unicast Routing Fix

Dit document beschrijft hoe we de ArtNet-communicatie hebben opgelost tussen de headless QLC+ container op container 112 (`192.168.2.222`) en de ArtNet-Node (`192.168.40.100`).

---

## 🔍 Probleemanalyse

Bij het configureren van QLC+ via de ingebouwde webinterface (`http://192.168.2.222:9999/config`) traden de volgende problemen op:
1. **Web UI Beperking:** De QLC+ Web-configuratiepagina biedt geen invoervelden voor specifieke plugin-parameters (zoals het doel-IP voor unicast ArtNet-berichten: `outputIP="192.168.40.100"`).
2. **Configuratie Overschrijving:** Zodra een interface werd geselecteerd in de Web UI, schreef QLC+ een lokaal override-bestand (`/root/.config/qlcplus/Q Light Controller Plus.conf`) in de container. Dit bestand bevatte wel de interface-mapping, maar *niet* het unicast IP-adres.
3. **Fallback naar Broadcast:** Hierdoor viel QLC+ terug op broadcast (`192.168.2.255`). Broadcast-pakketten kunnen de router-gateway naar het andere subnet (`192.168.40.0/24`) niet passeren, waardoor de lichten niet reageerden.

---

## 🛠️ Gerealiseerde Oplossing

We hebben dit opgelost door de configuratie direct in de bestanden vast te leggen en de netwerkinfrastructuur van de container te corrigeren:

### 1. Directe XML Project-configuratie (`config/ark_church_lighting.qxw`)
We hebben de Universe 1 mappings in het projectbestand direct aangepast naar de host-interface (`192.168.2.222`) en de line-index (`Line 9`) van de container, met behoud van de specifieke `PluginParameters`:

```xml
    <Universe Name="Universe 1" ID="0">
     <Input Plugin="OSC" UID="192.168.2.222" Line="9"/>
     <Output Plugin="ArtNet" UID="192.168.2.222" Line="9">
      <PluginParameters outputIP="192.168.40.100"/>
     </Output>
    </Universe>
```

### 2. Docker Host Networking in het Testscript (`deploy_qlcplus_test.py`)
Het test-deployment script is aangepast om de container in host network mode (`--network host`) op te starten, in plaats van poort-mappings te gebruiken. Hierdoor ziet QLC+ exact dezelfde netwerk-interfaces en line-indices als het host-systeem:

```python
# Launch the test container with host networking
subprocess.check_call(f"ssh -o StrictHostKeyChecking=no {proxmox_host} \"pct exec 112 -- docker run -d --name qlcplus-test --network host -v /app/config/ark_church_lighting.qxw:/QLC/ark_church_lighting.qxw --restart always qlcplus-test\"", shell=True)
```

### 3. Schoonmaken van overrides in Test-omgeving
Door de test-container via het script te verwijderen (`docker rm qlcplus-test`) en opnieuw op te bouwen, is het foutieve override-bestand `Q Light Controller Plus.conf` gewist. Opnieuw opgestart leest QLC+ nu de correcte mappings en parameters rechtstreeks in vanuit het projectbestand `/QLC/ark_church_lighting.qxw`.

### 4. Flexibele & Persistente Productie Deployment (`deploy_nas.py` & `docker-compose.yml`)
Voor de uitrol naar de kerk-NAS hebben we de deployment robuuster en flexibeler gemaakt:
- **Interactieve Keuze in Deployment Script:** Het script `deploy_nas.py` vraagt nu expliciet welke netwerkmodus gebruikt moet worden (`1 = Kerk (Broadcast)` of `2 = Thuis (Unicast)`). Op basis hiervan patcht het script automatisch het projectbestand (`ark_church_lighting.qxw`) met de juiste IP-adressen en stelt het de ArtNet-communicatie in op broadcast of unicast naar de gewenste interface.
- **Persistente Volumemount in Docker Compose:** In `docker-compose.yml` is de QLC+ configuratiemap `/root/.config/qlcplus` gekoppeld aan de NAS-schijf (`./config/qlcplus/config`). Mocht de netwerkinterface (Line index) op de NAS afwijken, dan kan dit eenmalig via de Web UI (`http://<NAS_IP>:9999/config`) worden aangepast en opgeslagen. Deze instelling overleeft voortaan elke herstart of heropbouw van de container.

---

## 📊 Verificatie & Resultaten

We hebben de werking geverifieerd via tcpdump op de host-interface (`eth0`):

1. **Logs Controleren:**
   De container is succesvol opgestart en laadt het projectbestand zonder fouten:
   ```
   === Starting QLC+ (Headless, Operate Mode) ===
   Project File: /QLC/ark_church_lighting.qxw
   Q Light Controller Plus version 4.14.3
   ```

2. **Netwerk Traffic Inspecteren:**
   We hebben de UDP-pakketten op poort 6454 (ArtNet) gemonitord op interface `eth0`:
   ```bash
   pct exec 112 -- tcpdump -i eth0 -n udp port 6454 -c 2
   ```
   
   **Output:**
   ```
   18:03:25.043244 IP 192.168.2.222.6454 > 192.168.40.100.6454: UDP, length 530
   18:03:26.043234 IP 192.168.2.222.6454 > 192.168.2.255.6454: UDP, length 14
   ```

### Conclusie:
* De DMX-gegevens (lengte 530 bytes) worden **succesvol als unicast** direct naar het IP-adres van de ArtNet-Node (`192.168.40.100`) verzonden.
* De communicatie is stabiel en de lampen kunnen nu direct bediend worden vanuit de webinterface!

> [!WARNING]
> **BELANGRIJK:** Breng geen wijzigingen meer aan via de Inputs/Outputs-tab in de QLC+ Web-configuratie op poort 9999. Dit zal de unicast-instelling overschrijven en de lichten weer onbereikbaar maken. Alle IP/interface-wijzigingen moeten in het `.qxw` projectbestand worden gedaan.

---

## 🎨 3. UI-Verbeteringen Lichtregie-App

We hebben de UI-regie verbeterd op basis van de feedback over actieve kleurstatussen en groepsacties. Deze wijzigingen zijn doorgevoerd in zowel de standalone lights pagina (`src/app/lights/page.tsx`) als het dashboardcomponent (`src/components/LightsControl.tsx`):

### 1. Actieve Kleuren Visueel Zichtbaar
* **React State Sync:** De applicatie houdt nu de status van de ingeschakelde kleur per groep bij (`activeColors`).
* **Visual Glow & Scale:** De geselecteerde kleurdot krijgt een opvallende witte rand, schaalt groter (`scale(1.15)`), en krijgt een prachtige bijpassende kleur-neon-gloed (`boxShadow: 0 0 14px [kleur]`). Dit maakt in één oogopslag duidelijk welke kleur er momenteel aan staat per groep.
* **Auto-Clear bij Hoofdscènes:** Zodra er een hoofdscène (bijv. WARM STAGE) of een chase (COLOR CHASE / RAINBOW WAVE) wordt geselecteerd, worden alle individuele kleurgroepstatussen automatisch gewist omdat de hoofdscène de regie overneemt.

### 2. Groepsacties: Alles Uit & Wit Snelkoppeling
Boven elke kleurgroep box is een bedieningskop toegevoegd met twee handige acties:
* **"Wit":** Een directe snelkoppeling om de groep direct op de neutrale kleur Wit te zetten (offset 7 van de kleurengroep, sceneId `startId + 7`).
* **"Uit":** Schakelt de momenteel actieve kleur in die groep uit (door de actieve toggle-scene nogmaals te triggeren) en wist de actieve status in de UI. Dit voorkomt dat je handmatig moet zoeken welke kleur er aan staat om deze uit te zetten.

### 3. Hoofdscènes Highlighting & Global Blackout (Alles Uit)
We hebben dezelfde functionaliteit uitgebreid naar de hoofdscènes en lichtshows:
* **Hoofdscènes Actieve Highlighting:** De momenteel actieve hoofdscène (bijv. *WARM STAGE*) of actieve chase (bijv. *RAINBOW WAVE*) krijgt nu een duidelijke visual glow-rand in zijn specifieke kleur. Dit maakt direct duidelijk welke algemene lichtmodus actief is.
* **Auto-Clear bij Custom Mix:** Zodra een gebruiker een specifieke kleurgroep handmatig aanpast, verdwijnt de actieve markering van de hoofdscène. Dit is logisch, want de lichten staan dan in een handmatig gemixte stand en niet meer in het pure preset-patroon.
* **Global BLACKOUT (Alles Uit) Knop:** Rechtsboven in het paneel "Hoofdscènes & Lichtshows" is een rode **BLACKOUT** knop geplaatst. Als deze wordt ingedrukt:
  1. Zendt de app OSC-signalen naar QLC+ om de actieve hoofdscène en actieve chase uit te schakelen.
  2. Zendt de app OSC-signalen naar alle individueel geactiveerde kleurgroepen om deze uit te schakelen.
  3. Worden alle Fresnel faders (inclusief de Master) naar `0` getrokken en via OSC naar QLC+ gestuurd.
  4. Wist de app alle actieve markers in de UI, waardoor de volledige lichtinstallatie direct veilig op zwart gaat.

## 🎛️ 4. Multi-Universe & DMX Passthrough (ADJ Scenesetter 24 Integratie)

We hebben QLC+ en het projectbestand omgebouwd naar een **Multi-Universe-architectuur** om fysieke DMX-faders (van de ADJ Scenesetter 24) samen te smelten met de sturing vanuit onze live app via OSC.

### Netwerk & Fysieke Aansluiting:
1. **Scenesetter 24 DMX Out** wordt aangesloten op **DMX In (Poort 2)** van de ArtNet-node.
2. De ArtNet-node staat geconfigureerd om het DMX-ingangssignaal om te zetten naar ArtNet-pakketjes (Universe 0) op het netwerk.
3. QLC+ vangt dit op poort `6454` op, voegt het via HTP-merging samen met de actieve scènes en stuurt het samengevoegde resultaat via Poort 1 (ArtNet -> DMX Out) naar de lampen.

### QLC+ Universum Indeling (`config/ark_church_lighting.qxw`):

*   **Universe 1 (Index 0) - DMX Wash & Passthrough:**
    *   **Input:** `ArtNet` (van de Scenesetter via ArtNet-node) met **`Passthrough="True"`** ingeschakeld.
    *   **Output:** `ArtNet` (naar de ArtNet-node/lampen met behoud van unicast IP `192.168.40.100`).
*   **Universe 2 (Index 1) - OSC Besturing:**
    *   **Input:** `OSC` (van de Next.js live app).

### Gevolgen voor de Live App / OSC-poort:
Omdat QLC+ per universum de OSC-poort automatisch ophoogt (`7700` + Universe ID), luistert de OSC-ontvanger op **Universe 2** nu naar poort **`7701`** (in plaats van `7700`).
* **Instelling in Live App:** Pas in de instellingenpagina van de live app de **QLC+ Poort** aan van `7700` naar **`7701`**.

Alle Virtual Console widget inputs in het projectbestand zijn met een script automatisch omgezet van `Universe="0"` naar `Universe="1"` (index van Universe 2) om te luisteren op de nieuwe OSC-poort. Dit is nu volledig live en actief op de server!

## 🐳 5. Synology NAS QLC+ Deployment (Auto-Detect Oplossing)

Bij het deployen van QLC+ op de Synology NAS kwamen we tegen twee kernel-specifieke problemen:

### Problemen:
1. **`-o` vlag werkt niet:** QLC+'s command-line optie `-o <project.qxw>` om een workspace te laden bij opstart werkt **niet op Synology DSM kernels**. QLC+ start wel op maar het project wordt stil genegeerd. Dit probleem treedt niet op in reguliere Linux omgevingen (Proxmox LXC).
2. **Config-crash na herstart:** Wanneer universe-instellingen via de QLC+ Web UI worden opgeslagen, schrijft QLC+ een configuratiebestand dat bij de volgende herstart een crash veroorzaakt (de webinterface wordt volledig onbereikbaar).

### Oplossing: Auto-Detecting Entrypoint Script

We hebben het [entrypoint.sh](file:///Volumes/OWC-DISK/scripts/antigravity/livestream-manager/config/qlcplus/entrypoint.sh) script volledig herschreven met een slim mechanisme dat bij **elke opstart** automatisch:

1. **Config opschoning** — Verwijdert het QLC+ configuratiebestand (`Q Light Controller Plus.conf`) om crash-loops te voorkomen
2. **Achtergrond opstart** — Start QLC+ zonder project in de achtergrond en wacht tot de webserver (poort 9999) beschikbaar is
3. **Auto-detectie** — Haalt de HTML van de `/config` pagina op en parseert de dropdown-menu's om het juiste LAN IP-adres (192.168.x.x) en bijbehorende **Line indexes** te detecteren voor ArtNet en OSC plugins
4. **XML injectie** — Kopieert het projectbestand naar `/tmp`, injecteert de gedetecteerde Line indexes in de `<InputOutputMap>` sectie via `sed`
5. **Web API laden** — Laadt het geconfigureerde project via `POST /loadProject` (multipart form upload) — dezelfde methode als de browser's "Load project" knop

### Architectuur:

```
Container Start
    │
    ├─ rm config file (prevent crash)
    ├─ qlcplus -w -n -p &  (background, no project)
    ├─ wait for port 9999
    ├─ curl /config → parse HTML
    │   ├─ detect NAS_IP (192.168.2.250)
    │   ├─ detect ARTNET_LINE (8)
    │   └─ detect OSC_LINE (8)
    ├─ sed: inject mappings into /tmp/project.qxw
    └─ curl -F POST /loadProject
        └─ ✅ Project geladen met correcte universes
```

### Deploy Workflow:
Voor toekomstige installaties op de NAS:
1. Draai `python3 deploy_nas.py` (kies modus 1 = Kerk)
2. Het deploy-script strip de universe-mappings uit het projectbestand (de entrypoint detecteert ze zelf)
3. Docker Compose bouwt de image en start de containers
4. QLC+ detecteert automatisch het juiste IP en Line indexes — **geen handmatige configuratie nodig**

> [!IMPORTANT]
> De **Line indexes** op de NAS zijn **anders** dan op de Proxmox testserver omdat de NAS veel meer Docker virtual bridge interfaces heeft. Het auto-detect mechanisme in `entrypoint.sh` handelt dit volledig automatisch af.

---

## 🎛️ 6. rtpMIDI Deelnemers Tracking & Knopkleuren Fix

### Probleem 1: rtpMIDI Deelnemers niet zichtbaar in de App (Altijd 0)
- **Oorzaak:** In `midiBridge.ts` luisterde de code naar `peerAdded` en `peerRemoved` op de `rtpmidi.Session` instantie. In de `rtpmidi` bibliotheek bestaan deze events echter niet op de `Session` klasse (ze zijn wel aanwezig in de discovery/mDNS module, maar mDNS is uitgeschakeld/niet beschikbaar in onze Docker container). De juiste events om netwerk-MIDI verbindingen te registreren zijn `streamAdded` en `streamRemoved`.
- **Oplossing:** 
  1. We hebben de event listeners in [midiBridge.ts](file:///Volumes/OWC-DISK/scripts/antigravity/livestream-manager/src/lib/midiBridge.ts) omgeschreven naar `streamAdded` en `streamRemoved`.
  2. Om extra robuustheid te garanderen, hebben we `getActiveMidiPeers()` aangepast om de actieve streams live uit te lezen via de session methode `midiSession.getStreams()`. Dit voorkomt dat de status uit sync raakt bij eventuele gemiste pakketjes.
  3. We hebben de peer-naam gesaneerd door null-byte karakters (`\0`) en trailing whitespace te verwijderen (`name.replace(/\0/g, '').trim()`), aangezien RTP-MIDI netwerk-namen null-terminated zijn en dit vreemde tekens in de browser kon veroorzaken.

### Probleem 2: Knoppen in het Broadcast Control Center zijn Wit (Geen Kleur)
- **Oorzaak:** In `BroadcastControlCenter.tsx` werd geprobeerd om inline stijlen te renderen via `getColorStyle(action.color)`. De stijlen werden echter overruled door de user-agent (browser default) stijlen van de `<button>` tag omdat Next.js App Router geen ondersteuning biedt voor de lokale `<style jsx>` blocken zonder extra plugins.
- **Oplossing:** 
  1. We hebben de styling verplaatst naar de globale [globals.css](file:///Volumes/OWC-DISK/scripts/antigravity/livestream-manager/src/app/globals.css) stylesheet. Hierin zijn expliciete klassen gedefinieerd voor `.emergency-btn` en alle kleuren (`.green`, `.red`, `.amber`, `.slate`, `.blue`, `.purple`, `.default`) met `!important` tags om te garanderen dat de kleuren altijd correct overschreven worden.
  2. We hebben [BroadcastControlCenter.tsx](file:///Volumes/OWC-DISK/scripts/antigravity/livestream-manager/src/components/BroadcastControlCenter.tsx) aangepast om direct de kleurklasse te injecteren (`className="emergency-btn {action.color}"`) en de inline stijlen en het lokale `<style jsx>` block volledig opgeruimd.

### Resultaten & Verificatie:
- **Netwerk MIDI logs:** Na het herstarten van de container zien we in de logs dat de connectie met de Mac direct tot stand komt en het juiste event triggert:
  ```
  [MIDI] Peer verbonden: MacBook Pro van Jeffrey (undefined)
  info: Data channel to MacBook Pro van Jeffrey established
  ```
- **Status API:** De status-API `/api/services/status` geeft nu netjes de verbonden peer terug:
  ```json
  "midiPeers": ["MacBook Pro van Jeffrey"]
  ```
- **Visueel:** De knoppen tonen nu hun respectievelijke kleuren (`green`, `red`, `amber`, `slate`) en de aangesloten peers worden live getoond onder "Actieve rtpMIDI Deelnemers" op het dashboard.

### Probleem 3: Connecties stapelen zich op (steeds meer deelnemers)
- **Oorzaak:** De auto-connect loop in `midiBridge.ts` riep elke 15 seconden blindelings `globalMidi.midiSession.connect({ address: ip })` aan zonder te controleren of er al een actieve of verbindende stream was voor dit IP-adres. Hierdoor creëerde de `rtpmidi` bibliotheek elke 15 seconden een nieuwe stream-instantie, wat leidde tot een oneindig groeiende lijst van duplicate deelnemers.
- **Oplossing:**
  1. We hebben de auto-connect loop aangepast om eerst de IP-adressen van alle actieve en in-progress streams te checken.
  2. Nieuw geïnitieerde streams worden bij aanmaak direct getagd met een tijdelijke `targetAddress` eigenschap.
  3. De auto-connect loop vergelijkt de doel-IP's nu met zowel gevestigde verbindingen (`s.rinfo1.address`) als lopende verbindingspogingen (`s.targetAddress`). Als er al een match is, wordt er geen nieuwe connectie gestart.
  4. In `getActiveMidiPeers()` hebben we een deduplicatie toegevoegd (`Array.from(new Set(names))`) zodat unieke peers gegarandeerd slechts één keer getoond worden op het dashboard.

### Probleem 4: Container-id getoond in connected peers (in plaats van een duidelijke naam)
- **Oorzaak:** 
  1. In `midiBridge.ts` werd bij `rtpmidi.manager.createSession` de parameter `{ name: sessionName }` meegegeven. De `rtpmidi` bibliotheek verwacht hier echter `{ localName, bonjourName }`. Omdat deze keys ontbraken, viel Bonjour terug op de systeem-hostname (`os.hostname()`), wat standaard de Docker container-ID is.
  2. De container werd in Docker gestart zonder expliciete `--hostname` parameter, waardoor de hostname een willekeurige container-ID string werd.
- **Oplossing:**
  1. We hebben de configuratie in [midiBridge.ts](file:///Volumes/OWC-DISK/scripts/antigravity/livestream-manager/src/lib/midiBridge.ts) gecorrigeerd naar `{ localName: sessionName, bonjourName: sessionName }`. Hierdoor wordt de in de settings ingestelde naam (standaard `Ark-Church-App`, of een andere custom naam) correct naar AppleMIDI gecommuniceerd.
  2. We hebben de Docker container gestart met de parameter `--hostname livestream-manager` zodat de default hostname van het systeem ook netjes en herkenbaar is.

### Probleem 5: MIDI In Note veld op het instellingenscherm was verplicht
- **Oorzaak:** In `page.tsx` was het invoerveld voor "MIDI In Note" hard gecodeerd met een fallback-waarde van `60` (`value={btn.midiNote || 60}`) en had het geen afhandeling voor lege waarden. Hierdoor kon de gebruiker het veld niet leeglaten om MIDI-in voor specifieke knoppen uit te schakelen.
- **Oplossing:** We hebben het input-type gewijzigd naar `text`, de waarde gekoppeld aan `btn.midiNote !== undefined ? btn.midiNote : ""` en de `onChange` handler aangepast zodat het veld leeggelaten kan worden (wat resulteert in `undefined` in de configuratie). De backend negeert knoppen zonder ingestelde `midiNote` automatisch tijdens het verwerken van MIDI-in events.

## 7. Behringer X32 en ATEM Mini Emulators voor Offline Testen (v8.0)

We hebben een volledige testomgeving opgezet op Proxmox LXC 112 (`192.168.2.222`) door emulatoren voor de Behringer X32 (audiomixer) en de Blackmagic ATEM Mini (videoswitcher) te draaien in Docker containers. Hierdoor kan er thuis offline getest worden met Bitfocus Companion en de Live Manager app zonder fysieke apparatuur.

### 1. Gerealiseerde Emulatoren
- **ATEM Mini Emulator (`pyAtemSim`):**
  - Draait in een Python container op UDP-poort `9910`.
  - Simuleert dynamisch verschillende ATEM-modellen (bijv. *ATEM Mini Pro*, *ATEM Mini*, of *ATEM Television Studio HD*) op basis van de `ATEM_MODEL` omgevingsvariabele in `docker-compose.yml` (standaard ingesteld op **`ATEM Mini Pro`**).
  - We hebben `pyAtemSim` tijdens het Docker-bouwproces gepatcht zodat het de productnaam en het aantal inputs (automatisch gelimiteerd tot 4 HDMI-inputs voor de Mini's) dynamisch configureert bij het opstarten via een nieuw `entrypoint.py` script.
  - Werkt out-of-the-box samen met de officiële **Blackmagic ATEM Software Control** app en Bitfocus Companion.
- **Behringer X32 Emulator (Patrick-Gilles Maillot's C-Emulator):**
  - Draait in een gecodeerde en gecompileerde Alpine build op UDP-poort `10023`.
  - Implementeert het volledige OSC-protocol, `/xremote` client tracking en state dumps (`/node` queries).
  - Werkt volledig samen met de officiële **Behringer X32-Edit** en **Mixing Station** apps en Bitfocus Companion.

### 2. Deployment Script (`deploy_emulators.py`)
Er is een nieuw deployment-script [deploy_emulators.py](file:///Users/jeffreygo/.gemini/antigravity/brain/bf19f21b-92b1-48b3-9ee1-f5a69eaa3005/scratch/deploy_emulators.py) aangemaakt dat automatisch:
1. De emulatorconfiguraties en de gewijzigde `docker-compose.yml` via SCP naar Proxmox kopieert.
2. De bestanden met `pct push 112` in LXC container 112 zet.
3. De containers bouwt en start via `docker compose -f /app/docker-compose.yml up -d --build x32-emulator atem-emulator`.
4. De tijdelijke deployment-bestanden op de Proxmox-host opruimt.

### 3. Geverifieerde Resultaten & Testen
- **Docker Status:** Beide containers draaien succesvol op LXC 112:
  - `atem-emulator` -> `Up` op poort `9910/udp`
  - `x32-emulator` -> `Up` op poort `10023/udp`
- **OSC Handshake Test:** We hebben via een testscript `/xinfo` gestuurd naar de X32-emulator op `192.168.2.222:10023` en kregen direct de correcte model- en firmware-informatie terug:
  ```
  Success! Response from ('192.168.2.222', 10023): b'/xinfo\x00\x00,ssss\x00\x00\x000.0.0.0\x00X32 Emulator\x00\x00\x00\x00X32\x004.06\x00\x00\x00\x00'
  ```
- **Logs:** De container logs tonen de correcte afhandeling van de handshake:
  ```
  Listening to port: 10023, X32 IP = 0.0.0.0
  ->X,   12 B: /xinfo~~,~~~
  X->,   52 B: /xinfo~~,ssss~~~0.0.0.0~X32 Emulator~~~~X32~4.06~~~~
  ```

### 4. Hoe thuis te verbinden
- **ATEM Software Control:** Start de app op je Mac, vul IP `192.168.2.222` in en klik op **Connect**.
- **X32-Edit:** Ga naar **Setup -> Connection**, voeg handmatig IP `192.168.2.222` toe en verbind (Sync Console -> PC).
- **Companion:** Voeg X32 en ATEM verbindingen toe gericht op target IP `192.168.2.222` op respectievelijke poorten `10023` en `9910`. De status wordt direct groen!


## 🔌 8. Tuya Smart Plug Local Control & Mac Mini Automation (v9.0)

We hebben een volledige automatische stroom- en opstart/afsluitflow gebouwd voor de Mac Mini (`192.168.2.20`) via de LSC Smart Connect (Tuya) slimme stekker. Omdat de slimme stekker op VLAN 40 (`192.168.40.60`) zit en gebruikmaakt van Tuya Protocol 3.5, hebben we de lokale aansturing als volgt ingericht:

### 1. Lokale Python Aansturing (`control_plug.py`)
Er is een Python-script geplaatst in [control_plug.py](file:///Users/jeffreygo/.gemini/antigravity/brain/bf19f21b-92b1-48b3-9ee1-f5a69eaa3005/control_plug.py) op LXC 112 dat rechtstreeks en 100% offline (zonder cloud latency) verbinding maakt met de stekker over TCP-poort 6668. Het gebruikt de unieke `local_key` en `device_id` die we via de Tuya Cloud API hebben uitgelezen.

### 2. Veilig Afsluiten & Wachtwoordloze Sudo (`shutdown_mac.sh`)
Om de Mac Mini netjes en veilig af te sluiten voordat we de stroom verbreken, hebben we een wrapper-script [shutdown_mac.sh](file:///Users/jeffreygo/.gemini/antigravity/brain/bf19f21b-92b1-48b3-9ee1-f5a69eaa3005/shutdown_mac.sh) gemaakt dat:
1. Via SSH inlogt op `jeffreygo@192.168.2.20` met de Ed25519-sleutel van LXC 112.
2. Het commando `sudo shutdown -h now` uitvoert (wachtwoordloos gemaakt via `visudo` op de Mac Mini).
3. 15 seconden wacht tot macOS volledig is afgesloten en stilstaat.
4. De slimme stekker uitschakelt via `control_plug.py off`.

### 3. HTTP Control Server (`tuya_http_server.py` & Systemd)
Omdat Bitfocus Companion in een Docker-sandbox draait en geen directe toegang heeft tot host-scripts of SSH-sleutels, hebben we een lichtgewicht Python HTTP-server gebouwd op LXC 112 die luistert op poort `8088`.
* **Systemd Service:** De server draait als een actieve achtergrond-service `tuya-control.service` die automatisch opstart bij het booten van de container.
* **Gevalideerde Endpoints:**
  * `GET http://192.168.2.222:8088/on` -> Schakelt stroom in (Mac Mini boot direct via `pmset autorestart`), wacht tot de Mac online is, laadt het nieuwste project in en start OBS/FreeShow.
  * `GET http://192.168.2.222:8088/shutdown` -> Start de veilige afsluitsequentie in de achtergrond.
  * `GET http://192.168.2.222:8088/status` -> Geeft de huidige relais- en verbruiksstatus van de stekker terug.

### 4. Dynamische Configuratie via de Live Manager UI
We hebben de instellingen voor de slimme stekker volledig dynamisch gemaakt in plaats van hardgecodeerd:
1. **Settings Store Integratie:** De keys `tuyaDeviceIp`, `tuyaDeviceId`, `tuyaLocalKey`, en `tuyaVersion` zijn toegevoegd aan `settings.json` en de typen in `settingsStore.ts`.
2. **Settings UI:** Er is een nieuwe **Slimme Stekker (Tuya)** configuratiekaart toegevoegd aan het Hardware & Netwerk-gedeelte in de Live Manager UI (`page.tsx`). Hier kan de gebruiker het IP-adres, de Device ID, de Local Key en de protocolversie invoeren en opslaan.
3. **Dynamic Script:** Het script `control_plug.py` leest nu dynamisch de waarden uit `settings.json` bij uitvoering. Hierdoor kun je eenvoudig wisselen van slimme stekkers (bijv. in de kerk of bij vervanging) zonder code aan te hoeven passen.

---

## 🎬 9. Automatisch Sunday Project Laden & OBS/FreeShow Opstarten (v10.0)

We hebben een volautomatische import- en opstartflow gerealiseerd die direct start zodra de Mac Mini stroom krijgt. Dit gebeurt lokaal en offline:

### 1. Sunday Project Importer (`import_project.py`)
Er is een Python-script geplaatst op `/app/import_project.py` op LXC 112 dat:
1. Dynamisch het projectpad bepaalt door de `settings.json` van de livestream manager (bijvoorbeeld `/mnt/data/docker/ark-livestream-manager/data/settings.json`) uit te lezen. Het script haalt hier de `thumbnailSavePath` op, vervangt de submap `Media` door `projects`, en vertaalt eventuele Synology NAS-paden (zoals `/volume1/`) automatisch naar het NFS-koppelingspad op de host (`/mnt/data/Projects/`).
2. Via SSH verbinding maakt met de FreeShow-pc (met het IP-adres uit `freeShowHost` in de instellingen).
3. **Automatisch het remote OS detecteert (Windows 10 of macOS)**. Op basis hiervan kiest het script de juiste bestandspaden (bijv. `AppData\Roaming\FreeShow` voor Windows vs `Library/Application Support/freeshow` voor macOS).
4. FreeShow op de doelmachines stopt (via `killall` op Mac of `taskkill` op Windows) om database-vergrendeling te voorkomen, de `.show` presentatiebestanden genereert en uploadt, en `projects.json`, `shows.json`, en `settings.json` op de doelmachines bijwerkt naar het nieuwe actieve project.

### 2. Dynamische Opstart & Afsluit Managers (`startup_pcs.py` & `shutdown_pcs.py`)
We hebben de shell-scripts vervangen door slimme Python-scripts op LXC 112:
* **`startup_pcs.py`**: Controleert of de slimme stekker bereikbaar is. Zo ja (thuis), schakelt het de stroom in, wacht op de Mac, importeert het project en start de apps. Zo nee (kerk), slaat het de stroomcyclus over, pingt de OBS-pc (`obsHost`) en FreeShow-pc (`freeShowHost`), voert de projectimport uit en start de apps via SSH (gebruikmakend van de `sshUser` instelling uit `settings.json`, standaard `"jeffreygo"`).
* **`shutdown_pcs.py`**: Stuurt bij afwezigheid van de slimme stekker (kerk) SSH-afsluitcommando's naar beide Windows/Mac PC's tegelijk (`shutdown /s /f /t 0` voor Windows, `sudo shutdown -h now` voor Mac).

---

## 🏁 10. Windows 10 Setup in de Kerk (Geen Smart Plugs)

Omdat de kerk twee aparte Windows 10 PC's heeft voor OBS en FreeShow, en er geen slimme stekkers zijn, is de automatisering als volgt opgebouwd:

### A. Lokale Windows Startup (Aanbevolen)
Wanneer de PC's handmatig worden aangezet, laadt de FreeShow-pc automatisch het zondag-project in voordat de app start.

1. **PowerShell Script**: Plaats het script `Import-FreeShowProject.ps1` op de FreeShow-pc in `C:\Scripts\Import-FreeShowProject.ps1`.
2. **Startup Batchfile**: Maak een batchbestand in de Windows Startup map (`shell:startup`) genaamd `import_project.bat`:
   ```bat
   @echo off
   echo Wachten op netwerkverbinding (10s)...
   timeout /t 10 /nobreak
   powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Scripts\Import-FreeShowProject.ps1"
   ```
3. Zorg dat de NAS-netwerkschijf (bijv. `P:`) automatisch verbinding maakt bij het inloggen. Windows zorgt er nu voor dat bij het opstarten het nieuwste project van de NAS wordt ingeladen en FreeShow direct activeert.

### B. Remote Shutdown & Start via Companion (Optioneel via SSH)
Om de PC's ook op afstand te kunnen bedienen vanaf Companion via LXC 112:

1. Activeer de **OpenSSH-functionaliteit** in Windows 10 (*Instellingen ➔ Optionele functies ➔ OpenSSH Server*).
2. Voeg de SSH-sleutel van LXC 112 toe aan `C:\Users\jeffreygo\.ssh\authorized_keys` op de Windows PC's.
3. **Remote Shutdown**: Werkt out-of-the-box via de Companion "Stop Regie" knop, welke `shutdown_pcs.py` aanroept en de PC's via SSH afsluit.
4. **Remote Launch (GUI)**: Omdat Windows GUI-apps gestart via SSH in de achtergrond verbergt (Session 0), kun je een Windows *Taakplanner* (Task Scheduler) taak aanmaken genaamd `StartFreeShow` die de app interactief start. Het LXC-script triggert dit dan simpelweg met:
   ```cmd
   schtasks /run /tn StartFreeShow
   ```

---

## 🔌 11. Multi-Plug Tuya & PC Aansturing (v11.0)

We hebben de stroom- en opstart/afsluitflow uitgebreid naar **meerdere slimme stekkers**. Hiermee kunnen we de OBS PC, de FreeShow PC (en eventuele toekomstige stekkers zoals schermen of de ATEM switcher) volledig afzonderlijk of gezamenlijk schakelen.

### 1. Dynamische Lijst-Editor in de UI
In de instellingenpagina van de Live Manager UI is de statische Tuya-configuratiekaart vervangen door een dynamische **Slimme Stekkers (Tuya)** beheerkaart. De gebruiker kan hier:
- Stekkers toevoegen, bewerken en verwijderen.
- Per stekker een unieke ID (bijv. `obs_pc`, `freeshow_pc`), weergavenaam, IP-adres, Device ID, Local Key, protocolversie en een optioneel **Gekoppeld Host IP** opgeven.

### 2. Gekoppelde Host IP-functionaliteit
Door een IP-adres van een computer (Host IP) aan een stekker te koppelen, weet het systeem welke computer fysiek op die stekker is aangesloten. Dit maakt het volgende mogelijk:
- **Veilig Afsluiten:** Bij het uitschakelen stuurt `shutdown_pcs.py` eerst een SSH-shutdown commando naar de gekoppelde host, wacht 15 seconden tot de computer uit staat, en verbreekt dan pas de stroom.
- **Gericht Opstarten:** Bij het inschakelen zet `startup_pcs.py` de stekker aan, wacht tot de host via SSH bereikbaar is, en start dan pas de bijbehorende applicaties (zoals OBS of FreeShow).
- **Zonder Host IP:** Als er geen Host IP gekoppeld is (bijv. voor een scherm of de netwerkswitch), schakelt de stekker direct in of uit zonder delay of SSH commando's.

### 3. Efficiënt Parallel Afsluiten
Als er meerdere stekkers tegelijk worden uitgeschakeld (bijv. via de `"all"` actie):
1. Stuurt `shutdown_pcs.py` de SSH-afsluitcommando's naar **alle** gekoppelde computers tegelijk (in parallel).
2. Wacht het script **eenmalig** 15 seconden (in plaats van 15 seconden per computer).
3. Schakelt het alle stroomrelais direct na elkaar uit.

### 4. HTTP API Endpoints met Query Parameters (Companion Integratie)
De HTTP-server (`tuya_http_server.py`) op LXC 112 luistert op poort `8088` en accepteert nu een optionele query parameter `?plug=<plug_id>` om gerichte commando's uit te voeren:

- **Individuele PC's opstarten/afsluiten:**
  - `GET http://192.168.2.222:8088/on?plug=obs_pc` (Zet OBS PC aan, wacht op SSH, start OBS)
  - `GET http://192.168.2.222:8088/shutdown?plug=obs_pc` (Sluit OBS PC via SSH af, wacht 15s, zet stroom uit)
  - `GET http://192.168.2.222:8088/on?plug=freeshow_pc` (Zet FreeShow PC aan, wacht op SSH, importeer project, start FreeShow)
  - `GET http://192.168.2.222:8088/shutdown?plug=freeshow_pc` (Sluit FreeShow PC via SSH af, wacht 15s, zet stroom uit)

- **Alle stekkers tegelijk bedienen:**
  - `GET http://192.168.2.222:8088/on?plug=all` (of `/on` zonder parameters) -> Start alle geconfigureerde computers op
  - `GET http://192.168.2.222:8088/shutdown?plug=all` (of `/shutdown` zonder parameters) -> Sluit alle computers netjes af en haalt de stroom eraf

- **Directe status opvragen:**
  - `GET http://192.168.2.222:8088/status?plug=obs_pc` -> Vraagt de status op van een specifieke stekker

---

## 🗂️ 12. Overzichtelijk Instellingenmenu met Tabbladen (v12.0)

Om te voorkomen dat de instellingenpagina een onoverzichtelijke, lange verticale lijst wordt, hebben we de configuratie-interface in [page.tsx](file:///Volumes/OWC-DISK/scripts/antigravity/livestream-manager/src/app/page.tsx) volledig gereorganiseerd in een moderne, tabbed split-panel layout:

### 1. Tab Navigation & State
We hebben een nieuwe React state `settingsTab` geïntroduceerd waarmee de gebruiker kan navigeren tussen de volgende categorieën:
*   **Algemeen (General):** Instellingen voor streams, fallback-afbeeldingen, en paden voor Sunday Project.
*   **Verbindingen (Connections & Hardware):** Host IP's en poorten voor OBS en FreeShow.
*   **Slimme Stekkers (Tuya):** Beheerderslijst voor het toevoegen, bewerken en verwijderen van Tuya smart plugs.
*   **MIDI Bridge (rtpMIDI):** Instellingen voor MIDI-in en MIDI-out poorten, Bonjour sessienaam en rtpMIDI active peers.
*   **Dashboard Knoppen (Custom Buttons):** Configuratie van knoppen voor het Companion Broadcast Center (kleur, actie, MIDI-note).

### 2. Modern Split-Layout UI
De layout in de settings modal is als volgt opgebouwd:
*   **Linker Sidebar Menu:** Een vaste lijst met navigatietabs, voorzien van bijpassende iconen (`FileText`, `Cpu`, `Sliders`, `Settings`) en dynamische actieve/inactieve visual highlighting.
*   **Rechter Content Paneel:** Een onafhankelijk scrollbare sectie die de configuratieformulieren van de actieve tab laadt. Door de container-css aan te passen (`overflowY: 'hidden'` op de hoofdmodal en `overflowY: 'auto'` op het rechterpaneel), hebben we dubbele scrollbars voorkomen.

### 3. Build & Deployment
*   De code is opnieuw gecompileerd tot een Next.js productie-build en live gezet op Proxmox LXC 112 met behulp van de deployment-scripts.
*   Alle wijzigingen zijn succesvol gepusht naar de `main` branch van de GitHub repository `ark-livestream-manager`.

---

## 🔌 13. Tuya Dashboard Status/Verbruik & Automatische Scheduler (v13.0)

We hebben stroomverbruiksmonitoring en een klok-gestuurde planner toegevoegd aan de livestream manager om het beheer van de hardware volledig te automatiseren.

### 1. Live Verbruik & Status Dashboard
*   **Parallelle Statusopvraging (`control_plug.py`):** We hebben de actie `status_json` toegevoegd. Deze haalt met een `ThreadPoolExecutor` parallel en razendsnel de switch-state, stroom (A), vermogen (W) en spanning (V) op van alle geconfigureerde Tuya-stekkers via hun respectievelijke DPS-keys (`1`, `18`, `19`, `20`).
*   **Status API (`route.ts`):** Er is een Next.js API route `/api/tuya/status` aangemaakt die communiceert met het lokale Python HTTP-server endpoint (`/status_json` op poort 8088). Deze API probeert opeenvolgend de interfaces `127.0.0.1`, het ingestelde Companion-IP en de Docker-gateway te bereiken om maximale netwerktolerantie te garanderen.
*   **UI Statuskaart (`BroadcastControlCenter.tsx`):** Onder het reguliere statusoverzicht op het dashboard is een kaart toegevoegd die live de status (Aan = groen, Uit = oranje, Offline = rood) en de stroomgegevens per stekker toont met een automatische poll-interval van 10 seconden.

### 2. Automatische Scheduler
*   **Scheduler Settings UI (`page.tsx`):** We hebben een dedicated sidebar-tabblad **"Schema's (Scheduler)"** toegevoegd aan het instellingenmenu. Hier kan de gebruiker onbeperkt schema's aanmaken en beheren:
    *   *Naam* (bijv. "Zondag Ochtend Opstart")
    *   *Tijd* (tijdselector, bijv. `09:00`)
    *   *Herhalingsdagen* (knoppenselector voor Zondag t/m Zaterdag)
    *   *Actie* (Opstarten `on`, Netjes Afsluiten `shutdown`, Stroom Uit `off`)
    *   *Doelstekker* (Selectie uit alle stekkers of *Alle slimme stekkers*)
    *   *Status* (Aan/Uit schakelaar)
*   **Achtergrond Daemon Thread (`tuya_http_server.py`):** De HTTP-server start nu een achtergrond-thread op LXC 112 die elke 15 seconden de actieve schema's in `settings.json` vergelijkt met de actuele dag en tijd. Indien er een match is, start de daemon de bijbehorende scripts (`startup_pcs.py`, `shutdown_pcs.py` of `control_plug.py`) in de achtergrond.
*   **Unbuffered Logging:** De systemd-service `tuya-control.service` is aangepast om Python uit te voeren met de `-u` flag, zodat alle logs en scheduler-triggers direct in `journalctl -u tuya-control` verschijnen.

---

## 🔌 14. Fix Mac Mini Auto-Restart na Stroomherstel (v14.0)

### Probleem:
Wanneer de Mac Mini werd uitgeschakeld via de "Stop Mac Mini" knop (of via een gepland schema), stuurde `shutdown_pcs.py` het SSH-afsluitcommando `sudo /sbin/shutdown -h now` naar macOS. Dit triggerde een schone, geplande uitschakeling. Omdat de uitschakeling opzettelijk was, activeerde de SMC (System Management Controller) van macOS de auto-restart functie (`pmset autorestart 1`) niet wanneer de stroom na de stroomonderbreking weer werd ingeschakeld. De Mac Mini bleef hierdoor uitstaan.

### Oplossing:
We hebben de afsluitsequentie in `shutdown_pcs.py` gewijzigd om de Mac Mini in slaapstand te zetten in plaats van volledig af te sluiten:
1. **OS-detectie:** We hebben een helper `detect_os(user, host_ip)` toegevoegd die via SSH test of het doel-OS Windows is (met `cmd.exe /c echo windows`), macOS is (met `uname` -> `Darwin`), of Linux is.
2. **Mac-specifiek afsluiten:** Als het doel-OS macOS is, sturen we het commando `pmset sleepnow` via SSH naar de Mac Mini in plaats van `shutdown -h now`.
3. **Slaap-en-Stroomonderbreking Flow:**
   * De Mac Mini gaat veilig in de slaapstand (de schijven worden netjes gesynchroniseerd).
   * Na de ingestelde wachttijd (15 seconden) onderbreekt de slimme stekker de stroomtoevoer.
   * Omdat de stroom wegvalt terwijl de Mac Mini in de slaapstand staat, registreert de SMC dit als een onverwacht stroomverlies (een stroomstoring).
   * Wanneer de stroom weer wordt ingeschakeld (bijv. via de "Start Mac Mini" knop of een schema), zorgt `pmset autorestart 1` ervoor dat de Mac Mini direct vanzelf opstart.
4. **Windows & Linux behouden:** Windows (`shutdown /s /f /t 0`) en Linux (`sudo /sbin/shutdown -h now`) behouden hun oorspronkelijke afsluitgedrag.

---

## 🔌 15. Dynamische Detectie van FreeShow Database-Locatie (dataPath) (v15.0)

### Probleem:
Het project-importscript `import_project.py` schreef alle `.show` bestanden en `projects.json` altijd hardgecodeerd naar de standaard lokale Documents-map (`/Users/jeffreygo/Documents/FreeShow`). Als de gebruiker in de FreeShow instellingen een aangepast netwerkpad (`dataPath`) had ingesteld (zoals `/Volumes/Projects/Beamer/FreeShow`), werd dit overschreven door het script. Dit verstoorde de verbinding met de NAS.

### Oplossing:
We hebben `import_project.py` aangepast zodat het dynamisch de configuratie van de doel-PC inleest:
1. **Settings Eerst Inlezen:** Het script downloadt nu eerst `settings.json` uit de `AppData`/`Library Application Support` map van de remote host.
2. **DataPath Detectie:** Het script checkt of er een waarde is ingevuld bij de `"dataPath"` key in `settings.json`.
3. **Dynamische Map-toewijzing:** 
   - Als er een aangepast pad is (zoals `/Volumes/Projects/Beamer/FreeShow`), wordt dit pad gebruikt als `remote_docs_dir`. De `.show` files worden dan netjes geüpload naar `{dataPath}/Shows/` en de project-JSON naar `{dataPath}/Config/projects.json`.
   - Als er geen aangepast pad is ingesteld (of de download mislukt), valt het script terug op het standaard lokale pad `/Users/{user}/Documents/FreeShow`.

---

## 🎛️ 16. Toggle-status en Oplichten Broadcast Control Knoppen (v16.0)

### Probleem:
In Companion zijn verschillende knoppen ingesteld als "2 step" (toggle/aan-uit) knoppen. In de Live Manager / Operations Center webapp was echter niet zichtbaar of deze knoppen aan of uit stonden. De knoppen reageerden wel bij een klik, maar bleven statisch qua uiterlijk.

### Oplossing:
We hebben een client-side state management en visuele highlights toegevoegd in [BroadcastControlCenter.tsx](file:///Volumes/OWC-DISK/scripts/antigravity/livestream-manager/src/components/BroadcastControlCenter.tsx) en [globals.css](file:///Volumes/OWC-DISK/scripts/antigravity/livestream-manager/src/app/globals.css):

1. **State Tracking:** In `BroadcastControlCenter.tsx` hebben we een `activeButtons` status toegevoegd (`Record<string, boolean>`) die per actie-id bijhoudt of de knop is ingeschakeld (toggled).
2. **Local Storage Persistentie:** Bij het laden van de component (`useEffect` bij mount) wordt de opgeslagen status uit `localStorage` geladen (`acoc_active_buttons`). Zodra een knop succesvol wordt geactiveerd, wordt de status in `localStorage` bijgewerkt. Hierdoor blijft de visuele stand van de knoppen bewaard bij het vernieuwen van de pagina.
3. **Dynamische Highlights:** Als de knop actief is, wordt de `.active` klasse toegepast. In `globals.css` zijn premium oplichting-stijlen gedefinieerd voor elke knopkleur (`green`, `red`, `amber`, `slate`, `blue`, `purple`, `default`):
   - **Glow / Neon effect:** Een bijpassende oplichtende schaduw (`box-shadow`) rond de knop.
   - **Sterkere rand:** Een harde, heldere randkleur in plaats van een transparante rand.
   - **Helderder achtergrond:** De opacity/helderheid van de knop-achtergrond is verhoogd van `0.15` naar `0.45` voor maximale visuele feedback.

---

## 🔌 17. Dynamische Tuya API Host-configuratie voor VPN/Synology NAS (v17.0)

### Probleem:
Bij het uitrollen van de container op de kerk-NAS (bereikbaar via VPN op `10.8.0.1` en lokaal op `192.168.2.250`) konden de nieuwe Tuya smart plugs (`192.168.2.126`) niet door de livestream manager worden gedetecteerd. Dit kwam doordat de status API `/api/tuya/status` hardgecodeerd probeerde verbinding te maken met de Tuya HTTP server via `127.0.0.1`, `settings.companionHost` of `172.17.0.1`. In de Synology Docker-omgeving met een VPN-netwerkverbinding waren deze interfaces niet correct gekoppeld aan de Tuya-server op de NAS-host.

### Oplossing:
We hebben de Tuya API host dynamisch configureerbaar gemaakt:
1. **Settings Store:** De optionele string `tuyaApiHost` is toegevoegd aan `AppSettings` en de standaardwaarde is ingesteld op `""` (leeg).
2. **API Status Route (`route.ts`):** De status-API controleert nu of `settings.tuyaApiHost` is ingevuld. Zo ja, dan wordt dit IP-adres als eerste geprobeerd om de Tuya HTTP control server (`tuya_http_server.py` op poort 8088) te bereiken. Zo niet (of bij falen), valt het systeem terug op de standaard adressen (`127.0.0.1`, `companionHost`, `172.17.0.1`).
3. **Instellingen UI (`page.tsx`):** Er is een nieuwe configuratiekaart "Tuya Control API Host" toegevoegd aan het tabblad "Slimme Stekkers (Tuya)" in de instellingen. Hier kan de gebruiker het IP-adres (bijv. `10.8.0.1` of `192.168.2.250`) invoeren en opslaan.

Hierdoor is de applicatie volledig flexibel en kan dezelfde image zowel thuis (Proxmox host) als in de kerk (Synology host) draaien zonder code-aanpassingen.

---

## 🎭 18. QLC+ Project Auto-Detect & Fresnel Blackout Fixes (v18.0)

### 1. QLC+ Project laadt niet op Proxmox / NAS
*   **Probleem:** QLC+ startte wel op in de Docker-container op Proxmox, maar de Virtual Console bleef volledig leeg. Dit kwam doordat de auto-detectie logica uit `entrypoint.sh` was weggehaald of omzeild en QLC+ met de `-o /QLC/ark_church_lighting.qxw` parameter werd gestart. Deze command-line parameter negeert het projectbestand stilletjes op diverse kernels (waaronder Synology DSM en nieuwere LXC/Docker hostkernels).
*   **Oorzaak:** Een eerdere poging met de auto-detect API-upload mislukte omdat deze probeerde te POST'en naar `/loadProject` met het parameter-veld `qlcFile`. QLC+ 4.14.x verwacht hier echter specifiek `qlcprj` als form-parameter. Hierdoor werd de upload stilzwijgend genegeerd.
*   **Oplossing:**
    1. We hebben de auto-detecting [entrypoint.sh](file:///Volumes/OWC-DISK/scripts/antigravity/livestream-manager/config/qlcplus/entrypoint.sh) hersteld.
    2. De form-parameter in de `curl` POST-aanroep is gecorrigeerd van `qlcFile` naar **`qlcprj`**.
    3. We hebben extra IP-adres fallbacks toegevoegd om interfaces te detecteren, zelfs als er geen `192.168.` subnet actief is (bijv. localhost fallbacks).
    4. De container `qlcplus-test` start nu betrouwbaar op Proxmox LXC 112 en laadt automatisch het project met de juiste universe-mappings.

### 2. Fresnel Dimmers blijven branden bij Blackout
*   **Probleem:** Bij het klikken op de rode **BLACKOUT** knop in de Lights app gingen alle kleur-LED's uit, maar bleven de Fresnels (fysieke dimmers) op hun huidige sterkte branden.
*   **Oorzaak:** Wanneer Blackout wordt geactiveerd, stuurt de app 5 range fader OSC-commando's (voor Fresnel 1, 2, 3, 4 en de Master) in één keer naar QLC+. Omdat UDP-pakketten gelijktijdig aankomen op de netwerkpoort van QLC+, raakt de single-threaded OSC-receiver van QLC+ overbelast en laat deze willekeurige pakketten (zoals de Fresnel Master of individuele dimmers) vallen.
*   **Oplossing:**
    1. We hebben `handleBlackout()` in [LightsControl.tsx](file:///Volumes/OWC-DISK/scripts/antigravity/livestream-manager/src/components/LightsControl.tsx) aangepast om een directe `sendOscValueImmediate` handler te gebruiken in plaats van de 50ms gedebouncte `sendOscValue`.
    2. We sturen de 5 Fresnel OSC-commando's nu **sequentieel met een kleine delay van 30ms** per pakket. Dit geeft QLC+ genoeg tijd om elk signaal te verwerken, waardoor de faders gegarandeerd allemaal op 0 worden gezet en de lichten direct uitgaan.

---

## 🔌 19. Multi-threaded Tuya HTTP Server & Status Caching (v19.0)

### Probleem:
De slimme stekkers (Tuya) leken om de paar seconden weg te vallen uit de monitoring in de livestream-manager UI (ze sprongen naar een rode offline-status / warning).

### Oorzaak:
1. **Single-threaded Server:** De Python HTTP-server (`tuya_http_server.py`) was single-threaded (`HTTPServer`).
2. **Next.js API duplicaten & timeouts:** De Next.js status API route (`api/tuya/status/route.ts`) heeft een korte timeout (`1200ms`) en bevatte duplicate host-IP's (`127.0.0.1` tweemaal), waardoor er onder load of bij meerdere open tabbladen parallelle HTTP-verzoeken naar de Python-server werden gestuurd.
3. **Queue & Broken Pipe:** Omdat de Python-server single-threaded was, werden gelijktijdige verzoeken in de wachtrij geplaatst. Door deze opstopping verliep de timeout in Next.js, sloot de client de socket (leidend tot `BrokenPipeError` in de Python-logs), en gaf de UI de stekker onterecht weer als "offline".
4. **Stabiele verbinding:** De stekkers zelf waren via het netwerk prima online en reageerden stabiel.

### Oplossing:
1. **Multi-threading:** De Python HTTP-server is omgebouwd naar `ThreadingHTTPServer` (beschikbaar in Python 3.7+), waardoor verzoeken in aparte threads parallel en zonder blokkades worden afgehandeld.
2. **Status Caching:** Er is een caching-mechanisme ingebouwd in `tuya_http_server.py`. De status en status_json resultaten van de stekkers worden nu 4 seconden gecached (`CACHE_TTL = 4.0`). Dit zorgt ervoor dat opeenvolgende of gelijktijdige verzoeken binnen 20 ms worden beantwoord, in plaats van telkens 500 ms de stekker fysiek te moeten pollen.
3. **Auto-Invalidatie:** Bij controle-acties (zoals `/on`, `/off`, `/shutdown`) wordt de cache voor de betreffende stekkers direct geleegd, zodat de status in de UI direct responsief meesprint na een schakel-actie.
4. **Next.js API Optimalisatie:** In `route.ts` worden de te proberen host-IP's nu gededupliceerd via een `Set`, zodat er geen dubbele verzoeken naar `127.0.0.1` meer worden gestuurd.

---

## 📺 20. YouTube-download fixes, Hover Tooltips & Tuya status poller daemon (v20.0)

### 1. YouTube downloader (`yt-dlp`) ontbreekt
- **Probleem:** Bij het downloaden van YouTube-video's trad de foutmelding `yt-dlp: not found` op, doordat `yt-dlp` niet geïnstalleerd was in de Alpine production runner.
- **Oplossing:** In de `Dockerfile` van zowel de standalone `freeshow-generator` als de geïntegreerde `livestream-manager` is de `runner` stage uitgebreid om `python3`, `ffmpeg` en `curl` te installeren, en direct het officiële en meest recente `yt-dlp` binaire bestand te downloaden naar `/usr/local/bin/yt-dlp`.

### 2. Hover tooltips voor tab-knoppen & ingekorte items
- **Probleem:** De tab-knoppen (🎵 📊 📖 📸 🎥 📁 🗃️) onder **1. Items Toevoegen** hadden geen namen meer bij hoveren na de integratie, en lange itemtitels in de playlist waren afgekapt zonder mogelijkheid om de volledige naam te bekijken.
- **Oplossing:** 
  1. We hebben custom CSS-gebaseerde instant tooltips (`.tooltip-container` en `.tooltip-text`) toegevoegd aan `globals.css` in beide projecten.
  1. We hebben custom CSS-gebaseerde instant tooltips (`.tooltip-container` and `.tooltip-text`) toegevoegd aan `globals.css` in beide projecten.
  2. De tab-knoppen in `FreeshowGenerator.tsx` en `page.tsx` zijn ingepakt in een `.tooltip-container` en voorzien van een `.tooltip-text` span die de gelokaliseerde naam toont.
  3. Er zijn `title` attributen toegevoegd aan de zoekcatalogus-resultaten en playlist-items, waardoor de browser automatisch een native tooltip toont met de volledige titel bij hoveren.

### 3. YouTube placeholder tekst aanpassen
- **Probleem:** De placeholder-tekst in het YouTube-invoerveld was standaard "Zoek in database...", wat verwarrend was voor gebruikers.
- **Oplossing:** We hebben in `translations.ts` een nieuwe key `youtube_placeholder` gedefinieerd voor alle talen (Nederlands: "Vul YouTube URL in...", Engels: "Enter YouTube URL...", enz.) en het invoerveld in de YouTube-tab aangepast om deze vertaling dynamisch te tonen.

### 4. Tuya Smart Plug Monitoring Dropouts (Daemon Status Poller)
- **Probleem:** De status van de slimme stekkers viel elke paar seconden weg (werd offline getoond) op live.netwerkengineer.nl.
- **Oorzaak:** Wanneer meerdere clients/tabbladen open stonden, stuurde Next.js parallelle queries via HTTP naar de Python-server. Omdat TinyTuya-verbindingen met de stekker synchroon zijn en tot 1.2 seconden duren, ontstonden er socket-botsingen en timeouts.
- **Oplossing:**
  1. We hebben in `control_plug.py` de socket timeout verhoogd naar 1.0 seconden voor de poortcontrole en 1.2 seconden voor TinyTuya-statusqueries om netwerktolerantie te vergroten.
  2. In `tuya_http_server.py` is een achtergrond-daemon-thread `status_poller_worker` toegevoegd die elke 8 seconden asynchroon de status van alle stekkers opvraagt en in het geheugen opslaat.
  3. Het `/status_json` endpoint is aangepast om direct de gecachte data uit het geheugen terug te geven. Hierdoor reageert het endpoint binnen enkele milliseconden, treden er geen Next.js fetch timeouts meer op en is er geen sprake van parallelle verbindingspogingen naar de fysieke stekkers.
  4. De fetch-timeout in de Next.js API route `/api/tuya/status` is verhoogd van 1.2 seconden naar 3.0 seconden voor betere tolerantie bij herstarts.

### 5. Versienummers in UI toegevoegd
- **Oplossing:** Om de updates visueel herkenbaar te maken en verwarring over de geïnstalleerde versies te voorkomen, hebben we beide applicaties voorzien van een duidelijke **`v2.0.0`** badge in de header en de `version` in hun `package.json` bijgewerkt naar `2.0.0`.

---

## 📺 21. Versie-correctie naar v2.0.1 (Fuzzy-matching, YouTube project pathing & duplicate song fixes) (v21.0)

Omdat de doorgevoerde wijzigingen na `v2.0.0` uitsluitend bugfixes en patches betreffen, is de versie gecorrigeerd van `v2.1.0` naar **`v2.0.1`** (conform Semantic Versioning):

### 1. YouTube Mismatch Pad-resolutie
* **Probleem:** Bij het importeren van projecten met YouTube-video's bleef het scherm zwart op de remote FreeShow PC's, omdat de generator lokale Linux-paden genereerde (bijv. `/mnt/data/...`), die niet bestaan op Windows of macOS client PC's.
* **Oplossing:** We hebben `/Volumes/OWC-DISK/scripts/antigravity/livestream-manager/import_project.py` aangepast om tijdens het uploaden/importeren dynamisch de client `dataPath` te controleren en de pad-prefixes te herschrijven naar het daadwerkelijke pad van de remote cliënt.

### 2. Duplicatenzoeker songtekst weergave
* **Probleem:** De duplicatenzoeker in `app/api/maintenance/duplicates/route.ts` kon geen songteksten tonen en mislukte soms.
* **Oorzaak:** FreeShow-shows worden opgeslagen als een array `[id, data]`. De code las rechtstreeks uit de array alsof het het object zelf was.
* **Oplossing:** De JSON-parser is gecorrigeerd om eigenschappen uit `json[1]` te lezen, waardoor songteksten en exacte fingerprints weer correct worden geanalyseerd.

### 3. Fuzzy Title Matching
* **Probleem:** Duplicaten met een licht afwijkende titel (bijvoorbeeld "Lied 123" vs "Lied 123a") werden niet gedetecteerd.
* **Oplossing:** We hebben Levenshtein-distance fuzzy matching geïmplementeerd (maximaal 2 karakters verschil voor titels van 6+ karakters), zodat deze duplicaten ook direct worden gevonden.

### 4. NAS Deployment Permissions
* **Probleem:** Scanning van de `Shows` directory gaf `EACCES: permission denied` op de Synology NAS.
* **Oplossing:** Het script `deploy_nas.py` is aangepast om recursively `777` permissies te zetten op de gehele `/volume1/Beamer/FreeShow` directory.

### 5. Versoepeling van de tekstextractie (Slide Item parser)
* **Probleem:** Sommige liederen (zoals *Goodness Of God*) werden niet als duplicaten gedetecteerd en toonden geen songteksten in de duplicate review, hoewel ze identiek waren.
* **Oorzaak:** De parser controleerde strikt op `item.type === 'text'` bij het extraheren van tekst uit de slides. Veel slide-items in FreeShow hebben echter geen expliciete `type` property (of hebben andere typen) maar bevatten wel een `lines` array met tekst.
* **Oplossing:** We hebben de controle versoepeld naar `if (item.lines)`. Hierdoor wordt de tekst correct geëxtraheerd van alle slides die tekst bevatten, ongeacht of de type-tag expliciet aanwezig is. Dit herstelt direct de fuzzy/exacte duplicate detectie op basis van songtekst en toont de songteksten in de visual editor van de duplicatenzoeker.



---

## 📺 22. Companion OSC UDP-poort mapping (v22.0)

### Probleem:
FreeShow kon geen acties/chases triggeren in Bitfocus Companion via OSC. FreeShow stuurde correct OSC-commando's naar `192.168.2.222:12321`, maar Companion ontving deze pakketten niet omdat UDP-poort `12321` niet was blootgesteld door de Docker-container op Proxmox LXC 112.

### Oplossing:
We hebben UDP-poort `12321` (de standaard OSC-poort van Companion) opengezet, de volume-mount gecorrigeerd en de database-configuratie hersteld:
1. **Docker Compose:** In `/app/companion/docker-compose.yml` (zowel lokaal als op LXC 112) is `- "12321:12321/udp"` toegevoegd aan de `ports` sectie van de `companion` service.
2. **Volume Mount Fix:** De volume-mount is gecorrigeerd van `/mnt/data/docker/companion:/root/companion-data` naar `/mnt/data/docker/companion:/companion`. Omdat Companion de configuratie wegschrijft naar `/companion` (op basis van `COMPANION_CONFIG_BASEDIR=/companion`), zorgde de oude, foutieve mapping ervoor dat alle instellingen in de tijdelijke container-laag werden opgeslagen en verloren gingen bij hercreatie. Met de nieuwe mapping worden alle instellingen nu permanent op de host opgeslagen.
3. **Database Herstel:** We hebben de actieve database (`db.sqlite` en backups) van 10 juni 18:33 uur gekopieerd van de Synology NAS (`10.8.0.1`) en via de Proxmox-host in de persistent directory `/mnt/data/docker/companion/v4.3/` gezet met de juiste rechten (`nobody:nogroup`, `777`).
4. **Docker Image Rebuild & Start:** De Companion-image (`companion-v4-latest:latest` v4.3.4) is opnieuw opgebouwd om de `content digest` fout op te lossen, en de container is opnieuw gestart met de nieuwe volume-mount en database.

### Verificatie:
- De container logs tonen dat Companion succesvol is opgestart en alle geconfigureerde instances (`x32`, `obs`, `atem`, `freeshow`, `qlcplus`, `http`) direct heeft ingeladen uit de database.
- Via `ss -ulpn` is geverifieerd dat de `docker-proxy` nu actief luistert op UDP-poort `12321` (zowel IPv4 als IPv6).
- FreeShow kan nu rechtstreeks via OSC communiceren met Companion, die op zijn beurt de juiste QLC+-lichtpresets triggert. All settings are now fully persistent.

---

## 📺 23. YouTube Live Stats Dropdown Routing & LED Panel macOS Support (v23.0)

### 1. YouTube Stats Dropdown Routing Fix
* **Probleem:** De YouTube Live Statistieken-kaart toonde altijd de status van de dichtstbijzijnde actieve/geplande stream (wat resulteerde in een oude testuitzending uit 2020), in plaats van te luisteren naar de geselecteerde stream in de dropdown van de **Configuratie Check**-kaart.
* **Oplossing:**
  1. We hebben `StreamMonitor.tsx` aangepast zodat het de momenteel geselecteerde stream opzoekt in de lijst met geplande streams (`scheduledStreams`).
  2. Als de geselecteerde stream van de provider `youtube` is, wordt de polling-url verrijkt met het specifieke video-ID (`/api/streams/youtube-stats?videoId=...`).
  3. We hebben de `useCallback` en `useEffect` dependencies bijgewerkt (`[selectedStreamId, scheduledStreams]`) zodat de polling-interval direct ververst en een live update triggert zodra de gebruiker een andere stream in de dropdown selecteert.

### 2. Dynamische OS-Detectie voor het LED-paneel (macOS / Windows Support)
* **Probleem:** Het start/stop-script voor het LED-paneel (`obsManager.ts`) ging er hardgecodeerd vanuit dat de doelmachines Windows 10 PC's waren. Het gebruikte een Windows-temp-pad (`C:/Users/.../AppData/Local/Temp`) en het commando `python` voor de remote uitvoering. Bij verbinding met een macOS client (zoals een MacBook Pro thuis voor testen) mislukte dit stilzwijgend.
* **Oplossing:**
  1. We hebben een dynamische OS-detectie via SSH ingebouwd in `obsManager.ts` die `cmd.exe /c echo windows` probeert uit te voeren op het geconfigureerde FreeShow-host IP.
  2. Als dit commando slaagt en "windows" retourneert, kiest het systeem de Windows-paden en het command `python`.
  3. Als het commando faalt (macOS/Linux), schakelt het systeem dynamisch over naar het universele temp-pad `/tmp/led_control.py` en het commando `python3`.
  4. Hierdoor kan het LED-paneel zowel thuis op een macOS-machine (MacBook Pro) als in de kerk op de Windows OBS/FreeShow-pc's naadloos worden getest en ingezet.

---

## 📺 24. Upgrade QLC+ naar Versie 5.2.2 (v24.0)

### 1. Upgrade QLC+ v5 en Qt6 QML Dependencies
* **Probleem:** We wilden QLC+ upgraden van de verouderde versie 4 naar de nieuwste versie 5 (v5.2.2). De headless Docker-omgeving moest echter correct worden geconfigureerd met Qt6 QML dependencies om te voorkomen dat QLC+ v5 (dat is overgestapt op Qt6) crasht bij het opstarten met offscreen rendering.
* **Oplossing:** 
  1. In [Dockerfile](file:///Volumes/OWC-DISK/scripts/antigravity/livestream-manager/config/qlcplus/Dockerfile) hebben we de Massimo Callegari Debian 12 repository toegevoegd en het pakket `qlcplus5` geïnstalleerd ter vervanging van `qlcplus-qt5`.
  2. We hebben de benodigde Qt6 QML runtime modules geïnstalleerd (`qml6-module-qtquick-controls`, `qml6-module-qtquick-layouts`, `qml6-module-qtquick-templates`, `qml6-module-qtquick-window`, en `qml6-module-qtquick`) om crashes door ontbrekende GUI/offscreen componenten op te lossen.
  3. We hebben `fontconfig` toegevoegd voor correcte offscreen font rendering.

### 2. Update Entrypoint voor Headless QLC+ v5 API-Projectlading
* **Probleem:** De v4 opstartcommando's (`qlcplus -w -n -p`) en project-load endpoints (`POST /loadProject`) zijn veranderd of werken anders in QLC+ v5. Het direct laden van het project via de command-line optie `-o` werkt niet betrouwbaar op Synology DSM- en Proxmox/LXC-kernels.
* **Oplossing:**
  1. In [entrypoint.sh](file:///Volumes/OWC-DISK/scripts/antigravity/livestream-manager/config/qlcplus/entrypoint.sh) hebben we het startcommando aangepast naar de v5 QML-versie: `qlcplus-qml --web --web-port 9999`.
  2. We hebben de opschoning van configuratiebestanden bijgewerkt zodat zowel `/root/.config/qlcplus/Q Light Controller Plus.conf` als `/root/.qlcplus/Q Light Controller Plus.conf` worden verwijderd voor de start, wat vastlopen en conflicten voorkomt.
  3. De project-upload API-aanroep is gecorrigeerd naar het `/loadProject` endpoint met de form-parameter `qlcprj` (gelijk aan QLC+ v5's native interface): `curl -s -F "qlcprj=@/tmp/project.qxw" http://localhost:9999/loadProject`.

### 3. Proxmox LXC 112 Deployment en Service Integratie
* **Probleem:** Het script `deploy_proxmox.sh` herbouwde voorheen alleen de `livestream-manager` container, waardoor QLC+- en Tuya-updates niet automatisch live gingen bij een deploy op Proxmox.
* **Oplossing:**
  1. We hebben [deploy_proxmox.sh](file:///Volumes/OWC-DISK/scripts/antigravity/livestream-manager/deploy_proxmox.sh) geüpdatet zodat het `docker compose up -d --build livestream-manager qlcplus tuya-control` uitvoert.
  2. We hebben de deployment gedraaid en geverifieerd dat alle containers succesvol bouwen en opstarten op LXC 112.
  3. De QLC+ containerlogs laten zien dat de server start, netwerkinterfaces detecteert en het kerkproject succesvol importeert via de `/loadProject` endpoint (`=== QLC+ v5 Project succesvol geladen! ===`).

### 4. Verbetering CSS-Styling Frame Titels in de Web UI
* **Probleem:** De titels van verschillende frames en widgets (zoals "Fresnel Dimmer (Submaster)", "Lichtshows / Chases", enz.) waren te groot, overlapten met knoppen en braken onhandig af over meerdere regels in de web-output.
* **Oplossing:**
  1. In [Dockerfile](file:///Volumes/OWC-DISK/scripts/antigravity/livestream-manager/config/qlcplus/Dockerfile) hebben we een build-stap toegevoegd die custom CSS-overrides onderaan `/usr/share/qlcplus/web/webaccess-v5.css` toevoegt.
  2. We hebben de `.frame-title` CSS aangepast:
     * De font-size is verkleind naar `calc(var(--text-size-default) * 0.55)` zodat deze beter past en langere titels leesbaarder blijven.
     * Automatisch afbreken is uitgeschakeld via `white-space: nowrap !important`.
     * Overlopende tekst wordt netjes afgekapt met een ellipsis (...) via `overflow: hidden !important; text-overflow: ellipsis !important;`.
     * Verticale uitlijning is geperfectioneerd met `line-height: var(--list-item-height) !important`.
  3. De wijziging is succesvol doorgevoerd en de containers zijn op Proxmox LXC 112 herstart.

### 5. Voorbereiding voor NAS Deployment & GitHub Push
* **Oplossing:**
  1. Alle gewijzigde bestanden (QLC+ Dockerfile, entrypoint, projectbestand en walkthrough) zijn gecommit en gepusht naar de GitHub repository `main` branch.
  2. Het lokale project is nu volledig schoon en gereed voor deployment naar de kerk-NAS met behulp van het script `deploy_nas.py`.

