# Handleiding: lokale bediening van Ark Tracks vanaf tablet en telefoon

Versie 2.46 · voor de Mac die de muziek afspeelt (de "Mac") en de apparaten waarmee je hem bedient (iPad, iPhone, Android, laptop).

## 1. Waar is het voor?

Met de **lokale bediening** bedien je Ark Tracks op de Mac vanaf een tablet of telefoon, **zonder dat de server of de NAS nodig is**. Handig als de NAS of het internet uitvalt tijdens een dienst, of als je de server niet wilt gebruiken.

Je krijgt twee schermen:
- **Podium** (`/tracks`): spelen, secties kiezen, setlist, pads. Zonder faders, zodat er niets per ongeluk verandert.
- **Mixer** (`/tracks/mixer`): alleen de faders van de acht groepen, met het master.

De verbinding is **versleuteld (https)** met een eigen certificaat dat de Mac zelf maakt. Daarom installeer je op elk apparaat **eenmalig** dat certificaat. Daarna werkt alles zonder waarschuwing.

> Normaal bedien je via de server (`https://ops.arkchurch.nl/tracks`, na het kiezen van de desktop-app als speler). De lokale bediening is de terugval.

## 2. Eenmalig instellen op de Mac

1. Start **Ark Tracks** op de Mac die de muziek afspeelt.
2. Kies in het menu **Ark Tracks › Bediening op afstand…**
3. Vink **Lokale bediening toestaan** aan. Laat **Versleuteld (https)** aan staan.
4. macOS kan vragen: *"Wil je dat Ark Tracks inkomende netwerkverbindingen accepteert?"* Kies **Sta toe**.
5. In het venster zie je nu twee adressen en twee QR-codes:
   - **Stap 1** (poort 8766): het certificaat installeren.
   - **Stap 2** (poort 8765): het Podium openen.

Het venster toont ook de **vingerafdruk** van het certificaat en de lijst met **gekoppelde apparaten**.

Zorg dat de Mac en het apparaat **op hetzelfde netwerk** zitten (zelfde wifi). Staat er later een apart gastennetwerk of VLAN, dan moet het apparaat op het netwerk van de Mac zitten of de verbinding naar de Mac toegestaan zijn (poort 8765 en 8766).

## 3. Per apparaat: certificaat installeren (eenmalig)

Open op het apparaat het adres van **stap 1** (of scan de eerste QR-code). Je ziet een pagina met een knop **Download het certificaat** en uitleg per type apparaat. Dit is wat je doet:

### iPhone en iPad
1. Tik op **Download het certificaat** en kies **Toestaan**.
2. Open **Instellingen**. Bovenaan staat **Profiel gedownload**. Tik erop, daarna op **Installeer** (rechtsboven). Voer je toegangscode in en tik nog een keer op **Installeer**. De melding "Niet ondertekend" is normaal.
3. **Daarna nog (vaak vergeten):** ga naar **Instellingen › Algemeen › Info › Certificaatvertrouwen** en zet de schakelaar bij **Ark Tracks Lokale CA** aan. Bevestig met **Ga door**.

### Android
1. Download het certificaat (**Download het certificaat** op de pagina).
2. Ga naar **Instellingen › Beveiliging › Meer beveiliging › Versleuteling en inloggegevens › Een certificaat installeren › CA-certificaat** (de naam verschilt per telefoon; zoek op "certificaat").
3. Kies **Toch installeren** en selecteer het bestand.

### Mac
1. Download het certificaat en dubbelklik erop. **Sleutelhangertoegang** opent; voeg het toe aan de sleutelhanger **inloggen**.
2. Zoek "Ark Tracks Lokale CA", dubbelklik, open **Vertrouwen** en kies bij *Bij gebruik van dit certificaat*: **Altijd vertrouwen**.

### Windows
1. Download het certificaat en dubbelklik erop › **Certificaat installeren** › **Huidige gebruiker**.
2. Kies **Alle certificaten in het volgende archief plaatsen** › **Vertrouwde basiscertificeringsinstanties**.
3. Firefox heeft een eigen lijst: gebruik Edge of Chrome, of importeer het certificaat ook in Firefox.

**Controle (optioneel):** onderaan de pagina staat de vingerafdruk van het certificaat. Die moet gelijk zijn aan de vingerafdruk in het venster "Bediening op afstand" op de Mac.

## 4. De eerste keer koppelen

1. Open het adres van **stap 2** (`https://<naam-van-de-mac>.local:8765/tracks`, of scan de tweede QR-code).
2. Het apparaat vraagt om een **naam** (bijvoorbeeld "iPad podium"). Tik op **Koppelen**.
3. Op de **Mac** verschijnt: *"'iPad podium' wil de bediening koppelen"*. Kies **Toestaan** (alleen als jij dit zelf aanvraagt).
4. Het apparaat is gekoppeld en opent het Podium. Dit hoef je maar één keer te doen.

Een gekoppeld apparaat kan **spelen, springen, de mix en master aanpassen en de pads bedienen**. Het kan **niet** de instellingen wijzigen, opnemen of bestanden beheren.

## 5. Dagelijks gebruik

- Open het Podium via de bladwijzer of het pictogram op het beginscherm.
- Tik rechtsboven op **Mixer** voor de faders; op de Mixer-pagina brengt **Podium** je terug.
- Op een telefoon kies je onderin het scherm tussen **Secties**, **Setlist** en **Pads**.
- Zonder server toont de setlist de diensten die de app het laatst met de server heeft gezien (de komende diensten), of je eigen setlist.
- Meerdere apparaten tegelijk is mogelijk. Het laatst gegeven commando wint.

### Op het beginscherm zetten (iPad en iPhone)
Open het Podium in **Safari** › deelknop › **Zet op beginscherm**. Het opent dan volledig scherm, zonder adresbalk.

## 6. Een apparaat intrekken of een nieuw certificaat maken

- **Een apparaat verwijderen:** menu **Bediening op afstand…** › bij het apparaat op **Intrekken**. Het apparaat moet daarna opnieuw koppelen (met jouw toestemming).
- **Nieuw certificaat maken:** knop **Nieuw certificaat maken…** Doe dit alleen als je denkt dat het certificaat niet meer veilig is, bijvoorbeeld als de Mac is overgedragen. **Alle apparaten moeten dan het nieuwe certificaat opnieuw installeren** (stap 3) en opnieuw koppelen.
- Het certificaat van de Mac zelf (geldig 397 dagen) wordt vanzelf vernieuwd bij elke start van de app, en als het netwerkadres van de Mac verandert. Daarvoor hoef je op de apparaten niets te doen.

## 7. Problemen oplossen

| Wat je ziet | Wat je doet |
|---|---|
| "Kan geen beveiligde verbinding maken" / "Niet privé" | Het certificaat is niet geïnstalleerd of het **vertrouwen** staat niet aan. Doe stap 3 opnieuw. Op iPhone/iPad: Instellingen › Algemeen › Info › Certificaatvertrouwen. |
| Pagina laadt niet / geen verbinding | Staat de lokale bediening aan op de Mac (menu *Bediening op afstand…*)? Zitten Mac en apparaat op hetzelfde netwerk? Probeer het adres met het **IP-nummer** (staat in het venster) in plaats van `….local`. |
| Het adres met `.local` werkt niet | Sommige netwerken blokkeren dat. Gebruik het adres met het IP-nummer. Het IP-nummer van de Mac kan wisselen; zet bij voorkeur een **vaste (gereserveerde) IP** in de router voor de Mac. |
| "Niet gekoppeld" op het apparaat | Het apparaat is ingetrokken of de Mac heeft een nieuw certificaat gemaakt. Koppel opnieuw (stap 4). |
| De vraag om toestemming verschijnt niet op de Mac | Het venster van Ark Tracks kan achter andere vensters staan. Klik op het programma in het Dock. Er mag maar één verzoek tegelijk wachten; na 90 seconden vervalt het. |
| Firewall-melding op de Mac | Kies **Sta toe**. Is het eerder geweigerd: Systeeminstellingen › Netwerk › Firewall › Opties › Ark Tracks op **Sta inkomende verbindingen toe**. |
| De poort is al in gebruik | Wijzig in het venster de **poort** (alleen 1024–65535) en klik **Pas toe**. De installatiepagina staat dan op die poort + 1. |
| De Mac gaat slapen | Een slapende Mac speelt niet en reageert niet. Zet in Systeeminstellingen › Batterij/Energie dat de Mac tijdens het gebruik niet slaapt. |
| Na een nieuwe app-versie krijg ik een Sleutelhanger-vraag | Kies **Altijd toestaan**. |
| Iets werkt niet en ik wil weten waarom | De app houdt een logbestand bij op de Mac: `~/Library/Logs/ArkTracks.log`. Daarin staan koppelverzoeken, wat er naar een apparaat is gestuurd en meldingen van de pagina op het apparaat (regels met "Pagina op …"). Stuur de laatste regels mee als je hulp vraagt. |

## 8. Veiligheid in het kort

- Het verkeer tussen apparaat en Mac is **versleuteld**; gasten op hetzelfde wifi kunnen niet meelezen.
- Een apparaat kan alleen bedienen na **jouw toestemming op de Mac**. Er worden maximaal 4 koppelverzoeken per minuut aangenomen.
- Het certificaat werkt **alleen voor lokale namen** (`….local` en privé-adressen). Zelfs als iemand de sleutel zou stelen, kan daarmee geen certificaat voor een openbare website worden gemaakt dat op jullie apparaten wordt vertrouwd.
- De **sleutel** van het certificaat staat alleen op de computer zelf (Keychain, sleutelbos of Credential Manager; zie hieronder voor de terugval) en verlaat de computer nooit. Apparaten krijgen alleen het openbare certificaat.
- Alleen een vaste lijst opdrachten is bereikbaar. Instellingen, opnemen en bestanden niet.
- Staat **Versleuteld (https)** uit, dan werkt het ook, maar zonder versleuteling (alleen op een netwerk dat je vertrouwt).
- Wil je de bediening niet gebruiken? Zet **Lokale bediening toestaan** uit; dan luistert de Mac nergens meer naar.

## 9. Technische gegevens

| | |
|---|---|
| Podium en bediening (https) | poort **8765** (instelbaar) |
| Installatiepagina en certificaat (http) | poort **8766** (= poort + 1); alleen de uitleg en het openbare certificaat |
| Certificaat | ECDSA P-256, eigen CA (10 jaar), certificaat van de Mac 397 dagen, SAN: `naam.local` + IP-adressen |
| Beperking van de CA | name constraints: `.local`, 192.168.0.0/16, 172.16.0.0/12, 10.0.0.0/8, 127.0.0.1 |
| Opslag | Keychain van de Mac (CA-sleutel, apparaten als hash); op Linux de sleutelbos, op Windows de Credential Manager. Op een Mac die zelf inlogt (Mac mini) staat de Keychain vergrendeld; de app bewaart daarom ook een kopie in `~/Library/Application Support/ArkTracks/vault.json` (rechten 0600, alleen leesbaar voor dat account) |
| Gebruikt | `/usr/bin/openssl` (zit in macOS) om certificaten te maken |

## 10. Goed om te weten

- De apparaten moeten de Mac kunnen **bereiken**. Bij een scheiding van het netwerk (VLAN) moeten poort 8765 en 8766 naar de Mac openstaan voor de apparaten.
- Veranderen de **naam of het adres** van de Mac, dan werkt de installatiepagina op het nieuwe adres. Het certificaat op de apparaten hoeft **niet** opnieuw: het vertrouwen geldt voor de CA, en de Mac maakt zelf een nieuw certificaat voor het nieuwe adres.
- Heb je meerdere Macs met de app (bijvoorbeeld de Mac mini in de zaal en een laptop), dan heeft **elke Mac een eigen CA**: installeer het certificaat van elke Mac waarmee je wilt koppelen.

## 11. Linux

### Installeren
1. Zet het bestand `ark-tracks_0.4.1-1_amd64.deb` op de computer (USB-stick, `scp` of download).
2. Open een terminal en voer uit: `sudo apt install ./ark-tracks_0.4.1-1_amd64.deb` (met het juiste pad). Een oudere versie wordt netjes bijgewerkt; instellingen, sleutel en nummers blijven staan.
3. Start **Ark Tracks** via het menu of het icoon. Staat er nog een oude losse kopie in `~/.local/bin`, verwijder die dan: die wordt eerder gevonden dan de geïnstalleerde versie en heeft geen menubalk.

### Menu en instellingen
De app heeft een **menubalk** (Linux en Windows):
- **Ark Tracks**: Instellingen, Bediening op afstand, Afsluiten.
- **Weergave**: Ververs, Terug, Zonder server werken (aan/uit), Kopie bijwerken, Groter/Kleiner/Normale grootte, Beeldvullend.
- **Help**: Logbestand tonen.

In **Instellingen** staan het adres van de server, de sleutel van deze computer, de **map met nummers** en de **map met pads** (met een knop *Kies…* per map), de audio-uitgang en het aantal uitgangen. Zonder iets in te vullen gebruikt de app `Tracks/Songs` en `Tracks/Pads` in je gebruikersmap.

### Verschillen met de Mac
- Het scherm **Bediening op afstand** open je met **Ctrl+Shift+L** (of via het menu).
- De vraag om een apparaat toe te staan verschijnt als een venster "Bediening koppelen" (kies **Toestaan**).
- De computer heeft een **eigen certificaat**: ook als je iPad al het certificaat van de Mac heeft, installeer je dat van de Linux-computer er nog bij (stap 3).
- Op de installatiepagina staat een kaart voor Linux (Chrome en Firefox).
- De instellingen en het certificaat staan in `~/.config/ArkTracks/`; het logbestand in `~/.local/state/ArkTracks/ArkTracks.log`. De sleutel van deze computer staat in de sleutelbos van het systeem.
- Staat er een firewall aan (bijvoorbeeld `ufw`), laat dan de poorten 8765 en 8766 toe.
- Een groot nummer dat niet in het geheugen past wordt **geweigerd met een melding** in plaats van de computer vast te laten lopen.

## 12. Windows

- Installeer **ark-tracks-0.4.1-x64.msi** (dubbelklik); de app staat daarna in het Startmenu. Een nieuwere versie werkt de oude bij.
- Het menu en de Instellingen werken zoals bij Linux (zie 11). Instellingen en certificaat staan in `%APPDATA%\ArkTracks`, het logbestand in `%LOCALAPPDATA%\ArkTracks\ArkTracks.log`. De sleutel staat in de **Credential Manager** van Windows.
- Bij de eerste start vraagt Windows om de **firewall** voor Ark Tracks toe te staan (nodig voor de lokale bediening).
- Koppelen vraagt om toestemming in een venster op de computer (wacht maximaal 90 seconden).

## 13. Een Mac zonder iemand erbij (bijvoorbeeld een Mac mini in de zaal)

- De Mac logt **automatisch in** met een eigen account voor de app en start **ArkTracks** vanzelf (als inlogonderdeel). REAPER kan als reserve naast de app draaien (launch agent, op de achtergrond; ArkTracks wordt daarna naar voren gehaald).
- Na een stroomonderbreking start de Mac vanzelf op (`pmset autorestart`). **Let op:** een Mac die echt is **afgesloten** start niet zelf op als de stroom terugkomt en Wake-on-LAN werkt dan niet. Daarom gebruikt de webapp voor zo'n Mac bij *Netjes afsluiten* geen shutdown, maar: apps netjes stoppen, schijf wegschrijven, slaapstand, en daarna de stekker uit. Zo start de Mac weer op als de stekker aan gaat.
- Een Mac die zelf inlogt heeft een **vergrendelde Keychain**. ArkTracks vraagt daar niet om, maar bewaart zijn sleutel ook in `vault.json` (zie hierboven). Na een nieuwe installatie vul je de sleutel eenmalig in onder Instellingen.
- Meekijken op afstand kan via Schermdeling, bij voorkeur alleen over een VPN. Werkt inloggen met gebruikersnaam en wachtwoord niet, dan werkt vaak wel een apart VNC-wachtwoord met een viewer die dat ondersteunt (bijvoorbeeld TigerVNC met `-SecurityTypes VncAuth`). Zet dat wachtwoord weer uit als je het niet meer nodig hebt.
- Voor het netjes afsluiten via de webapp (per stekker in de instellingen): het adres van de computer, de SSH-gebruiker en een SSH-sleutel van de server die op die computer is toegestaan.
