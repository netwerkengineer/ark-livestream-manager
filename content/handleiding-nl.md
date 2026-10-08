# Handleiding — Ark Church Livestream Manager

*Versie van dit document: bij app-versie 2.40.0*

## Inleiding

Deze handleiding beschrijft alle onderdelen van de Ark Church Livestream Manager: het plannen en uitzenden van diensten op YouTube, de live-bediening tijdens een uitzending, het samenstellen van FreeShow-presentaties (inclusief de automatische e-mail-aanlevering), lichtregie, het afspelen van de band-tracks (REAPER) met een oefenspeler voor bandleden, en het beheer van gebruikers en instellingen.

Het document bestaat uit twee delen:

- **Deel 1 — Voor operators & vrijwilligers**: alles wat je nodig hebt om de app te bedienen tijdens en rond een dienst.
- **Deel 2 — Technische bijlage**: voor de beheerder(s) — alle instellingen, serverconfiguratie, beveiliging en bekende beperkingen.

### De zeven hoofdonderdelen

Bovenin de app vind je (afhankelijk van je rechten) tot zeven tabbladen — de knoppen zelf zijn kort gelabeld, de volledige naam staat hieronder tussen haakjes:

| Tabblad | Rechtennaam | Waarvoor |
|---|---|---|
| 📅 Planner (Stream Planner) | `planner` | YouTube-uitzendingen inplannen |
| 🎛️ Regie (Control Center) | `control` | Live bediening: OBS, stroom, noodknoppen |
| 📺 Monitor (Live Monitor) | `monitor` | Live status, statistieken, OBS-detailbediening |
| 💡 Licht (Lichtregie) | `lights` | QLC+ lichtbediening |
| 🎚️ Tracks (REAPER) | `tracks` | De band-tracks afspelen en per sectie bedienen (zie 6a) |
| 🎧 Oefenen (band) | `oefenen` | Oefenspeler voor bandleden thuis, in de browser (zie 6b) |
| ⛪ FreeShow (FreeShow Projecten) | `freeshow` | Liederen, Bijbelteksten en media tot een dienst samenstellen |

Een **Administrator** ziet altijd alle zeven. Een **Operator** ziet alleen de tabbladen waarvoor hij/zij expliciet rechten heeft gekregen (zie hoofdstuk 1). Alleen een Administrator ziet het tandwiel-icoon rechtsboven naar Instellingen.

> ℹ️ De app past zich aan telefoon- en tabletschermen aan: op een smal scherm komen kolommen onder elkaar te staan en is het instellingenmenu één rij waar je zijwaarts doorheen swipet.

---

# Deel 1 — Voor operators & vrijwilligers

## 1. Inloggen en rollen

Er zijn twee manieren om in te loggen, en (los daarvan) twee rollen.

### Inlogmethodes

- **Team-login (SSO)** — de standaardmanier van inloggen als dit is ingeschakeld (zie 8.11): je logt in met je bestaande account bij de identity provider van je organisatie (op de testomgeving is dat Authentik, op productie de Synology NAS zelf via SSO Server). Er is geen apart wachtwoord voor deze app nodig, en er hoeft ook niemand in deze app zelf een gebruikerslijst bij te houden — dat gebeurt al bij de identity provider. Je rol en rechten worden automatisch bepaald op basis van de groep(en) waar je daar lid van bent (zie 8.11). Zit je in geen enkele herkende groep, dan kun je nog gewoon inloggen, maar zie je nergens toegang toe — er is bewust geen aparte "mag niet inloggen"-instelling nodig.
- **Lokaal account (noodtoegang)** — een gebruikersnaam/wachtwoord die alleen in deze app zelf bestaat (zie 7. Gebruikersbeheer), volledig los van je Team-login-account. Is Team-login ingeschakeld, dan staat deze optie standaard verborgen achter de link **"Lokaal account gebruiken (noodtoegang)"** onder de Team-login-knop — bedoeld voor het geval de identity provider zelf een keer niet bereikbaar is tijdens een dienst. Is Team-login niet ingeschakeld, dan is dit gewoon de enige, altijd zichtbare inlogmethode.

> ⚠️ **Belangrijk bij eerste installatie**: de app maakt bij de allereerste start automatisch twee standaard lokale accounts aan: `admin` / `arkadmin` en `operator` / `arkoperator`. Wijzig deze wachtwoorden **onmiddellijk** na installatie via Gebruikersbeheer (hoofdstuk 7) — dit zijn bekende, voorspelbare inloggegevens.

### Rollen (gelden voor beide inlogmethodes)

- **Administrator** — volledige toegang tot alle zeven tabbladen én Instellingen/Gebruikersbeheer.
- **Operator** — alleen bediening; ziet alleen de tabbladen waarvoor rechten zijn toegekend (een combinatie van `planner`/`control`/`monitor`/`lights`/`tracks`/`oefenen`/`freeshow`) — bij een lokaal account ingesteld via Gebruikersbeheer (hoofdstuk 7), bij Team-login via de groep→rechten-koppeling (8.11). Heeft iemand *alleen* het recht `oefenen`, dan opent de app na het inloggen meteen de oefenspeler (zie 6b).

Rechtsboven in de balk vind je:
- **?** — helpvenster (korte uitleg + link naar deze handleiding)
- **⚙️** (alleen Administrator) — Instellingen
- Je rol en gebruikersnaam
- **Afmelden** — logt je uit bij deze app. Bij Team-login blijft je sessie bij de identity provider zelf (Authentik/Synology) daarbij nog gewoon actief — logt iemand daarna opnieuw in via Team-login, dan gebeurt dat zonder opnieuw om een wachtwoord te vragen, zolang die onderliggende sessie nog geldig is. Wil je dat echt testen met een schone lei, gebruik dan een incognito/privévenster, of log ook expliciet uit bij de identity provider zelf.

Er is ook een aparte "Inloggen met Google"-knop specifiek voor het koppelen van het YouTube-account (zie hoofdstuk 2; de status van de koppeling en de knoppen **Opnieuw inloggen** en **Loskoppelen** staan ook bij Instellingen → Algemeen, zie 8.1) — dit is *geen* gewoon operator-account en geeft automatisch volledige (Administrator-)rechten op elke API-aanvraag. Zie de beveiligingsnotitie in hoofdstuk 10.

---

## 2. Stream Planner — uitzendingen inplannen

Voordat je hier iets kunt inplannen moet het YouTube-kanaal gekoppeld zijn. Is dat nog niet gebeurd (of is de koppeling verlopen), dan zie je een knop **"Inloggen met Google"** — dit start de standaard Google-inlogflow. Na een succesvolle koppeling verschijnt het planningsformulier.

Komt de geschatte YouTube-API-quota van vandaag boven de 70%, dan verschijnt bij "YouTube Kanaal" de waarschuwing "⚠️ API-quota: x% gebruikt vandaag (schatting)". Bij 100% werken YouTube-acties (inplannen, thumbnail, live-status) tijdelijk niet totdat het quotum 's ochtends rond 9:00 uur (Nederlandse tijd) vanzelf wordt vernieuwd. De beheerder krijgt bij 80% ook een melding per e-mail (zie 8.10).

### Stream inplannen

| Veld | Uitleg |
|---|---|
| Uitzending Titel | De titel van de YouTube-livestream |
| Beschrijving | Videobeschrijving (meerdere regels) |
| Datum / Tijd | Geplande starttijd |
| YouTube Privacy | Openbaar / Verborgen / Privé |
| YouTube Categorie | YouTube-videocategorie (dropdown) |
| YouTube Playlist | Voegt de stream toe aan een bestaande afspeellijst (of "Geen Playlist") |
| YouTube Tags | Kommagescheiden trefwoorden |
| Facebook Live | *Informatief veld* — Facebook wordt niet automatisch ingepland, dit moet je zelf doen via de Facebook Live Producer |

Klik op **"Plan Alles In"** om de uitzending aan te maken. Bij succes verschijnt een bevestiging die je er ook aan herinnert om Facebook Live handmatig in te plannen.

> ℹ️ Nieuwe uitzendingen starten **niet** automatisch zodra er een videosignaal binnenkomt — je start de uitzending zelf handmatig in YouTube wanneer je klaar bent.

### Thumbnail

Klik op de thumbnail-voorvertoning of "Open Editor" om een thumbnail-afbeelding te maken/bewerken. Deze wordt zowel naar YouTube geüpload als lokaal opgeslagen (o.a. als `thema.jpg` op de NAS) zodat OBS/FreeShow deze automatisch als beeld kunnen tonen vóór de uitzending begint.

Daarnaast controleert de app elke 10 minuten zelf of er een nieuwe eerstvolgende livestream is en zet de thumbnail dan automatisch als `thema.jpg` klaar (zie hoofdstuk 9). Op een omgeving die de YouTube-koppeling niet gebruikt, bijvoorbeeld een testomgeving, kan een beheerder dit uitzetten (zie 8.1).

### Geplande streams

Rechts zie je de lijst met geplande uitzendingen, gegroepeerd op titel/tijd. Per uitzending:
- 🔗 **Bekijk op YouTube**
- 💬 **Deel via WhatsApp** — genereert een uitnodigingsbericht op basis van de sjabloon die je bij Instellingen → Algemeen hebt ingesteld (met plekhouders `{link}`, `{titel}`, `{datum}`, `{tijd}`)
- 🗑️ **Verwijder** — verwijdert de uitzending (bevestiging vereist)

---

## 3. Live Uitzending — Control Center

Dit is het centrale bedieningspaneel tijdens een dienst.

### Systeemstatus

Bovenaan zie je de status van alle gekoppelde diensten (Companion, OBS, X32, QLC+, FreeShow, Atem, Tuya) — groen/blauw = actief, rood = niet bereikbaar. Klik op het ververs-icoon om opnieuw te controleren.

### Slimme stekkers

Als er stekkers zijn ingesteld (Instellingen → Slimme Stekkers), zie je hier per stekker: naam, online/offline-status, aan/uit-status, en (indien online) spanning/stroom/vermogen. De status wordt elke 10 seconden automatisch ververst. Een stekkerdoos met meerdere stopcontacten (bijvoorbeeld een 4-voudige met USB-poort) toont één kaart per ingesteld stopcontact, en eventueel een extra kaart die alle stopcontacten tegelijk schakelt (zie 8.3).

> ℹ️ Voor de Beamer-PC en de OBS-PC geldt: zodra Windows daadwerkelijk wordt afgesloten — via de app, via een schema, óf gewoon handmatig door iemand die op de PC zelf op "Afsluiten" klikt — gaat de bijbehorende slimme stekker automatisch ná een korte vertraging uit (genoeg tijd om Windows echt te laten afsluiten voordat de stroom wordt verbroken). Dit geldt niet voor extra FreeShow-doelen (zie 8.8).

### rtpMIDI-deelnemers

Informatief overzicht van apparaten die op dit moment via rtpMIDI verbonden zijn (bijvoorbeeld een presentatie-Mac). Geen klikbare acties, puur ter controle dat de verbinding er is.

### Noodknoppen

Onderaan staat een configureerbare rij knoppen (ingesteld door een Administrator via Instellingen → Dashboard Knoppen), bijvoorbeeld "OBS PC Starten" of "Beamer PC starten". Welke knoppen jij ziet hangt af van je toegewezen rechten — een Administrator kan een knop koppelen aan een specifiek recht, zodat bijvoorbeeld alleen mensen met FreeShow-rechten de Beamer-knop zien.

---

## 4. Live Monitor — Stream Monitor

Dit scherm geeft gedetailleerd inzicht in en bediening van OBS en de live YouTube-uitzending zelf.

### OBS Studio Status

Groen = verbonden, rood = niet verbonden (met foutmelding). Knop **"Opnieuw verbinden"** forceert een nieuwe verbindingspoging.

### Live Statistieken

Status (STREAMING/STANDBY), bitrate, fps, en dropped frames (oranje als er frames verloren gaan).

### Program Output

Een live (elke 3 sec ververst) voorbeeldbeeld van wat OBS op dit moment uitzendt.

### OBS Controls

- **Start/Stop Streaming**
- **Start/Stop Recording**

### Scènes & Bronnen

Lijst van OBS-scènes — klik **"Zet Live"** om te wisselen. Per bron in de actieve scène kun je zichtbaarheid aan/uit zetten (oog-icoon).

### Audio Mixer

Per audio-ingang: een volumeschuif (-100 tot 0 dB) en een mute-knop.

### Configuratie Check

Kies een geplande uitzending uit de lijst. De app vergelijkt de echte stream-sleutel van dat platform met wat er op dit moment in OBS is ingesteld:
- **"Komt overeen"** (groen) — alles goed
- **"Mismatch!"** (rood) — de sleutel in OBS klopt niet meer; klik **"Corrigeer OBS Instellingen"** om dit automatisch te laten herstellen

### YouTube Live Uitzending

Toont: LIVE/STANDBY-status, titel, aantal kijkers, likes, weergaven, en een link om de stream direct op YouTube te openen.

### LED Sign Board Test

(Alleen zichtbaar als dit is ingeschakeld bij Instellingen.) Handmatige testknoppen om het LED-scherm te sturen: **"ON AIR (Rood)"** / **"OFFLINE (Groen)"**.

De automatische omschakeling (het scherm gaat vanzelf op ON AIR zodra YouTube meldt dat je live bent, en terug naar OFFLINE erna) werkt alleen op zondag binnen het tijdvak dat bij Instellingen → Verbindingen is ingesteld (standaard 10:00–12:30, zie 8.2). Op een andere dag, bijvoorbeeld bij een kerstavonddienst, gebruik je deze testknoppen.

---

## 5. FreeShow Projecten

Dit is het grootste onderdeel van de app: hier stel je liederen, Bijbelteksten en media samen tot een compleet FreeShow-project voor de dienst, en beheer je de FreeShow-showbibliotheek zelf. Het tabblad heeft drie gelijkwaardige modi bovenin: **🎤 Setlist** (standaard geopend), **➕ Snel toevoegen** en **🗃️ Beheer**.

Als de FreeShow-paden nog niet zijn ingesteld (zie Instellingen → FreeShow, hoofdstuk 8), zie je een melding dat dit eerst geconfigureerd moet worden — dat kan alleen een Administrator doen.

### 5.1 Setlist — de setlist voor een dienst bouwen

Dit is de plek waar een worship leader of operator een complete dienst opbouwt: liederen, Bijbelteksten en media, allemaal in dezelfde weergave, of ze nu handmatig zijn ingevoerd of via een liturgie-mail zijn binnengekomen (zie 5.5) — beide komen in hetzelfde record terecht en kunnen gerust gemengd worden.

**Dienstdatum** staat rechtsboven (standaard: de eerstvolgende zondag). Ernaast staat **"🔄 Check nu (mail)"** om direct te controleren op nieuwe liturgie-mail (dit gebeurt anders automatisch elke 10 minuten op de achtergrond) — de knop toont na afloop een resultaat ("✅ 1 dienst(en) bijgewerkt" of "✅ Gecontroleerd — geen nieuwe mails"). Ontbreekt of klopt er iets in een eerder verwerkte mail, dan hoeft niet de hele dienst opnieuw aangeleverd: markeer de mail in de mailbox gewoon weer als **ongelezen** en klik nogmaals op "Check nu" — de app verwerkt 'm dan opnieuw en vult alleen aan wat er nog niet in stond (al aanwezige liederen/teksten/media worden niet dubbel toegevoegd).

Twee waarschuwingsblokken kunnen verschijnen:
- **⚠️ Niet-toegewezen mails** — mail die niet aan een dienstdatum gekoppeld kon worden (bijvoorbeeld een ontbrekende of onleesbare datumregel); met een 🗑️-icoontje haal je 'm uit dit lijstje (de mail zelf blijft in de mailbox staan).
- **⚠️ Niet herkende regels uit de mail** — tekst die niet volgens het verwachte formaat was en dus met de hand nagekeken moet worden.

**Een lied, Bijbeltekst of media-item toevoegen**: kies eerst de **standaard-sectie** voor het volgende item (dropdown met de echte secties uit het sjabloon, bijvoorbeeld Start/Worship/Collecte/Worship 2/Preek/Einde), en kies dan één van de drie knoppen:

- **🎵 Lied** — zoek in de catalogus of typ zelf een titel (eventueel `Titel - Artiest`). Er verschijnt meteen een voorvertoning met de automatisch opgezochte songtekst (uit de catalogus, of anders van internet) — deze mag je hier ter plekke nog aanpassen — plus een sectie **Akkoorden**: typ ze zelf als vrije tekst (bijvoorbeeld `G` boven `Amazing grace...`; wordt niet als ChordPro geïnterpreteerd, gewoon letterlijk overgenomen), of klik op **"📎 of upload een akkoordenbestand (.txt/.pdf)"** om het bestaande akkoordschema van de band (een .txt of .pdf) rechtstreeks bij te voegen — dan hoeft niemand dat over te typen. Een geüpload bestand vervangt de vrije tekst voor dit lied (en andersom); met het 🗑️-knopje naast de bestandsnaam verwijder je het geüploade bestand weer, waarna het tekstveld terugkomt. Had je (of iemand anders) voor dit lied al eens akkoorden ingevuld — hier of via de show-editor, zie 5.3.1 — dan staan ze er al: akkoorden worden bewaard per lied, niet alleen voor deze ene dienst. Kies of bevestig de sectie en klik **"+ Toevoegen aan setlist"**.
- **📖 Bijbeltekst** — kies vertaling, boek, hoofdstuk en vers(en), kies de sectie, en klik "+ Toevoegen aan setlist".
- **🎬 Media** — kies YouTube (plak een link), Bestand (upload een afbeelding/video) of Link (plak een gewone URL), kies de sectie, en klik "+ Toevoegen aan setlist".

**De lijsten**: Liederen, Bijbelteksten en Media staan onder elkaar, elk item met een sectie-label. Bij liederen: 📬 als het lied via e-mail is aangeleverd, 📝 als er tekst/akkoorden zijn toegevoegd, ▲▼ om de volgorde te wijzigen, ✏️ om songtekst/akkoorden/sectie achteraf te bewerken, en 🗑️ om te verwijderen. Bijbelteksten en media hebben dezelfde sectie-badge en 🗑️, maar geen volgorde-pijltjes.

> ℹ️ De sectie **Einde** is een uitzondering: de vaste afsluitende show "Bedankt" blijft daar altijd het allerlaatste item — een lied, tekst of media die je aan Einde toevoegt komt er automatisch vóór te staan, nooit erna.

**Project aanmaken / bijwerken** genereert of actualiseert het FreeShow-project voor deze dienst — zelfde mechanisme als hieronder bij "Verstuur naar team" (die knop werkt het project ook automatisch bij, zie verderop), en dezelfde waarschuwing bij een conflict met een handmatige wijziging in FreeShow zelf (zie 5.2.6).

**📤 Verstuur naar team**: klapt een paneel open met:
- Contactpersonen (uit Beheer → Team, zie 5.3.3), gegroepeerd op rol (Band / Beamer-operator / Overig) — vink aan wie de mail moet krijgen. Met **"Alles deselecteren"** (rechtsboven in het paneel) haal je in één keer alle vinkjes weg. Ernaast staat per contactpersoon met een e-mailadres een kleine **"↩️ antwoord aan"**-vinkje: vink dit aan bij wie een eventuele reactie op de mail moet ontvangen. Dit staat los van "wie krijgt de mail" en moet apart aangevinkt worden — zonder dit vinkje komt een antwoord van iemand die op "Beantwoorden" klikt namelijk bij het eigen afzenderadres van de app terecht (zie de uitleg bij BCC in hoofdstuk 9), niet bij een mens.
- **Extra bericht** (optioneel, vrij tekstveld) — voor bijvoorbeeld een dresscode, een opmerking, of een persoonlijke groet (bijvoorbeeld "God bless, Jeffrey"); wordt onderaan de e-mail geplaatst en per browser onthouden zodat je 'm niet elke week hoeft te herschrijven.
- **"Songtekst (.txt) bijvoegen"**, **"PDF bijvoegen"**, **"Akkoorden bijvoegen"** en **"YouTube bijvoegen"** — vier losse vinkjes. Songtekst en PDF bevatten alleen de liedtekst; akkoorden komen (indien aanwezig) als eigen bijlage per lied mee — het geüploade bestand zelf, of anders een gegenereerd tekstbestand uit de vrije akkoordentekst. "YouTube bijvoegen" voegt geen bijlage toe, maar zet de opgeslagen YouTube-referenties (zie 5.3.1) als linkjes onderaan de berichttekst. Zet alles uit om de mail zonder bijlagen te versturen (alleen de liedjeslijst in de berichttekst).
- **"✉️ Verstuur e-mail"** opent eerst een **controlescherm**: ontvangers, eventuele "Antwoord aan"-adressen, onderwerp en berichttekst (beide hier nog aan te passen) en de lijst bijlagen — pas na **"✅ Akkoord, versturen"** gaat de mail daadwerkelijk uit. Ontbrak er nog songtekst bij een lied (bijvoorbeeld een via e-mail aangeleverd lied waar niemand tekst bij heeft gezet), dan wordt die op het moment van versturen automatisch alsnog opgezocht (als "Songtekst bijvoegen" of "PDF bijvoegen" aanstaat). Het versturen werkt in dezelfde stap ook het FreeShow-project bij, dus je hoeft daarna niet nog los op "Project bijwerken" te klikken.
- **"📱 WhatsApp-samenvatting"** opent een kant-en-klaar bericht (datum + liederen op volgorde) via `wa.me` in je eigen WhatsApp — je kiest daar zelf de ontvanger uit je eigen contacten; er is geen telefoonnummer bij de contactpersonen nodig en WhatsApp wordt niet automatisch verstuurd.

### 5.2 Snel toevoegen — losse items direct in een FreeShow-project

Deze modus is voor ad-hoc werk dat niet per se bij "de setlist van aankomende zondag" hoort: een losse presentatie, een bijzondere dienst, of iets tijdens een uitzending snel toevoegen. De basiswerkwijze in vier stappen:

1. Zoek een lied, Bijbeltekst, media-bestand, YouTube-video, of maak een sectie aan via een van de tabbladen bovenin.
2. Het item verschijnt in de **Staging Area** (links) — controleer en bewerk het hier.
3. Kies waar het moet komen: bij welke sectie, en vóór of ná.
4. Voeg het toe aan de **Playlist** (rechts) om het onderdeel te maken van het uiteindelijke project.

### 5.2.1 Item toevoegen

Zes tabbladen bovenaan het toevoegpaneel:

**🎵 Liederen** — zoek in de catalogus (typen filtert live), klik een resultaat om het direct te selecteren, of typ een titel (eventueel `Titel - Artiest`) en klik "Handmatig lied toevoegen" als het lied niet in de catalogus staat. Bestaat het lied al in de catalogus, dan wordt de originele lay-out hergebruikt; bestaat het nog niet, dan wordt automatisch geprobeerd de tekst via internet op te zoeken (zie ook 5.5 voor hoe dit via e-mail werkt). Zijn er meerdere categorieën, dan kun je met een rijtje aanvinkbare categorieën boven de zoekresultaten de zoekopdracht beperken tot bepaalde categorieën; het aantal resultaten staat erbij.

**📊 Presentaties** — zelfde als Liederen, maar toont alleen catalogusitems met categorie "Presentatie".

**📖 Bijbel** — kies vertaling, boek, hoofdstuk, begin- en eindvers, en klik "+ Voeg Bijbel Toe".

**📸 Media** — kies een afbeelding/video-bestand. Twee belangrijke keuzes:
- **Plaatsing**: "Bestand" (simpele directe plaatsing in de afspeellijst — geeft videobediening zoals bij een gewone FreeShow-mediaclip) of "Show" (media wordt in een FreeShow-show verpakt, nodig als je met lagen of automatische timers wilt werken).
- **Laag/Rol**: "Voorgrond" of "Achtergrond".

  Je kunt media ook koppelen aan een *bestaand* item in plaats van een nieuw item te maken: kies in de dropdown welk item, en gebruik dan "Koppelen" (vervangt de achtergrond van dat item) of "Voeg Slide Toe" (voegt een extra media-slide toe aan dat item, bijvoorbeeld voor een diashow). Items met gekoppelde media krijgen een 🎞️-icoontje in de Playlist.

**🎥 YouTube** — plak een YouTube-URL en klik "Download & Toevoegen". De video wordt gedownload en automatisch op de voorgrond ingevoegd als een echte, losstaande show met geluid aan — zie de uitleg over de livestream-stijl hieronder.

**📁 Sectie** — maak een nieuwe sectiekop aan met een titel en kleur. Secties worden direct aan de Playlist toegevoegd (gaan niet via de Staging Area).

> ℹ️ **Livestream-stijl schakelt automatisch mee.** Elk stuk media dat op de voorgrond wordt geplaatst (zowel via 📸 Media als 🎥 YouTube) krijgt automatisch een actie mee die, zodra het item afspeelt, de output voor de livestream omschakelt naar de stijl "Livestream Video fullscreen". Zodra daarna een lied of Bijbeltekst speelt, schakelt diezelfde output automatisch terug naar "Livestream Liederen" — dit gebeurt zowel bij nieuw gegenereerde projecten als bij elk bestaand lied in de catalogus, dat deze terugschakel-actie al standaard heeft. Je hoeft hier zelf niets voor te doen; dit werkt alleen als bij Instellingen → FreeShow het veld "Output-ID voor livestream-video-stijl" is ingevuld (zie 8.8) — zonder dat veld wordt het item gewoon aangemaakt, alleen zonder de automatische stijl-omschakeling.

### 5.2.2 Plaatsing: sectie + vóór/ná

Onder elk toevoegtabblad (behalve wanneer een item al in bewerking is) staat "📍 Plaatsing in sectie:" — kies bij welke sectie het nieuwe item moet komen, en of het er vóór of ná moet. Deze lijst bevat, anders dan bij de Setlist-modus, niet alleen de sectiekoppen zelf maar ook losse vaste items zoals "Welkom", "Collecte Givt", "Thema" of "Bedankt" als aparte ankerpunten — handig voor deze fijnmazige, ad-hoc manier van invoegen. Dit werkt zowel met sjabloon-secties (als je een template gebruikt) als met je eigen handmatig aangemaakte secties.

### 5.2.3 Staging Area

Na het toevoegen van een lied/Bijbeltekst/media/YouTube-item verschijnt het in de Staging Area, waar je:
- de tekst kunt nalezen/aanpassen (bij liederen en Bijbelteksten),
- de sectie/plaatsing nog kunt wijzigen,
- en kiest wat er met het item gebeurt:
  - **👉 Playlist** — direct toevoegen aan de planning
  - **🛠️+ Bouwer** — toevoegen aan de Bouwer om te combineren met andere slides tot één samengestelde presentatie (zie 5.2.4) — deze sessie werk je verder af onder **🗃️ Beheer → 🛠️ Bouwer-sessie** (zie 5.3)
  - **💾 Alleen opslaan in bibliotheek** — slaat het lied/Bijbeltekst op in de FreeShow-catalogus zonder het aan de huidige planning of Bouwer toe te voegen
  - **Annuleren**

### 5.2.4 Bouwer — eigen presentaties samenstellen

Bouw een presentatie van meerdere slides (bijvoorbeeld tekst + een paar foto's achter elkaar) door items vanuit de Staging Area hierheen te sturen ("🛠️+ Bouwer"). Zodra er minstens één slide is toegevoegd, verschijnt onder **🗃️ Beheer** het tabblad "🛠️ Bouwer-sessie" (met het aantal slides erbij) om verder te werken; geef de show een naam en klik "Maak Show & Voeg Toe" om de complete presentatie als één item aan de Playlist toe te voegen.

### 5.2.5 Project genereren

Onder "2. Project Genereren":
- **"Template gebruiken (Playlist)"** — aan: de vaste onderdelen/secties van het gekozen sjabloon blijven staan en jouw items worden erin ingevoegd op de gekozen plek. Uit: alleen jouw eigen items, geen sjabloon.
- **Project Naam** (optioneel)
- **Download** — laadt het `.project`-bestand naar je eigen computer
- **Stuur naar server** — slaat het project direct op in de FreeShow-projectenmap op de NAS

### 5.2.6 Bestaand project inladen

Onder "📂 Bestaand Project Inladen" zie je alle opgeslagen projecten op de server, of je kunt een `.project`-bestand vanaf je eigen computer uploaden. Klik "Inladen" om het terug te halen in de Bouwer.

Dit werkt voor **elk** `.project`-bestand — of het nu handmatig via deze app is gemaakt, automatisch via de e-mail-koppeling, of rechtstreeks in FreeShow zelf is aangemaakt. Als het project geen "eigen" opslagformaat van deze app heeft, reconstrueert de app een zo goed mogelijke playlist rechtstreeks uit de projectgegevens — je krijgt dan een melding met hoeveel items zijn teruggehaald en of er items zijn overgeslagen (bijvoorbeeld type media die deze app zelf niet kan aanmaken). Controleer in dat geval de ingeladen lijst even voordat je verdergaat.

> ⚠️ Als iemand het gegenereerde project rechtstreeks in FreeShow heeft aangepast sinds de laatste update (vanuit de Setlist-modus of hier), waarschuwt de app hiervoor in plaats van die wijziging stil te overschrijven — je moet dan expliciet op "Toch overschrijven" klikken.

### 5.2.7 Playlist beheren

Rechts zie je de complete, samengevoegde afspeellijst. Per item:
- Pijl-omhoog / Pijl-omlaag om te verplaatsen
- ✏️ om terug naar de Staging Area te gaan en het item te bewerken
- ✕ om te verwijderen (bij sjabloon-items: verbergt het item in plaats van het echt te verwijderen)

Meerdere items selecteren (vinkjes) en dan "🗑️ Wis" verwijdert ze in één keer; "🗑️ Alles wissen" leegt de hele lijst.

### 5.3 Beheer — catalogus, onderhoud en team

### 5.3.1 Catalogus

Doorzoek, filter (op categorie, met het aantal shows per categorie erbij — categorieën zonder shows worden niet getoond) en sorteer (naam / laatst gewijzigd) alle FreeShow-shows. Per show:
- **📝 Bewerken** — opent de show-editor (zie hieronder)
- **👁️ Preview** — bekijk de slides, met optioneel een ander sjabloon eroverheen om te zien hoe het er dan uitziet
- **👯 Dupliceren** — maakt een kopie onder een nieuwe naam
- **🗑️ Verwijderen** — verplaatst naar de prullenbak op de NAS (niet direct definitief)

**Show-editor**: kies tussen een **Visuele editor** (per slide tekst aanpassen, slides toevoegen/verwijderen/herordenen, type wisselen tussen tekst/media) of de **Raw JSON Editor** (de volledige showdata direct als tekst bewerken — alleen voor gevorderde gebruikers).

In de Visuele editor staat bovenaan **"🖼️ Achtergrond (hele show)"**: kies hiermee een bestaande afbeelding of video uit de mediabibliotheek als achtergrond voor het hele lied — zoek op bestandsnaam, klik een resultaat om 'm meteen in te stellen, en klik daarna "Wijzigingen Opslaan". Staat er al een achtergrond, dan zie je een voorbeeld met "Wijzigen"/"Verwijderen"-knoppen. Dit is dezelfde blijvende wijziging als je in FreeShow zelf zou maken — handig voor medewerkers die doordeweeks niet bij de Beamer PC/FreeShow kunnen.

In de Visuele editor staat de knop **"📋 Plak volledige tekst"**: plak hier de complete songtekst in één keer (lege regel = nieuwe slide, `[Refrein]` of `Couplet 1` wordt automatisch als groepslabel herkend) en klik "Toepassen" om alle bestaande slides in deze show in één keer te vervangen — handig om een lied snel over te typen/plakken in plaats van slide voor slide te bewerken. Had de show al slides, dan vraagt de app eerst om bevestiging, want dit is niet ongedaan te maken.

In de Visuele editor staat ook **"🎸 Akkoorden & 🎥 YouTube-link"**: voor akkoorden kies je tussen zelf typen (vrije tekst) of **"📎 of upload een akkoordenbestand (.txt/.pdf)"** om een bestaand akkoordschema van de band rechtstreeks bij te voegen — een geüpload bestand vervangt de vrije tekst (en andersom, via het 🗑️-knopje). Ernaast staat een los veld voor een referentie-YouTube-link (bijvoorbeeld een instructievideo). Alles wordt per lied bewaard in een eigen opslag van de app zelf (`data/songMeta.json`), niet in het `.show`-bestand — zo blijft dit bewaard ongeacht wat er verder met de show in FreeShow gebeurt (bijvoorbeeld een her-import vanuit een extern bestand, wat FreeShow's eigen songgegevens wél zou overschrijven). Dezelfde gegevens staan ook — en zijn ook hier al aan te vullen — in de Setlist-modus (zie 5.1) zodra je dit lied aan een setlist toevoegt.

### 5.3.2 Onderhoud

**Duplicaten** — "Start Scan" zoekt shows met (vrijwel) dezelfde naam/inhoud. Per gevonden paar: "Vergelijk" opent een scherm waarin je de twee versies naast elkaar ziet (inclusief gekoppelde achtergrondmedia) en met één klik kiest welke bewaard blijft; het andere wordt verwijderd.

**Bibliotheek** — "Optimaliseer Media" corrigeert/herstelt mediaverwijzingen in shows; "Back-up" downloadt een kopie van de hele showbibliotheek; hier kun je ook los een show uit de bibliotheek verwijderen. **"Max. 2 regels"** splitst bestaande liederen met meer dan 2 regels per dia op (zie hieronder).

**Max. 2 regels per dia** — voor liederen geldt een maximum van 2 regels per dia, omdat meer er in de onderste beeldbalk van de livestream slecht uitziet. Een regel langer dan 32 tekens loopt door op het scherm en telt dus voor 2. Nieuwe liederen worden automatisch zo opgesplitst en de show-editor houdt zich hieraan. Met de knop **"Max. 2 regels"** pas je de liederen aan die er al staan: je krijgt eerst een lijst te zien van de liederen die veranderen en moet bevestigen; er wordt vooraf een back-up gemaakt (de map staat in de melding achteraf). Liederen die al aan de regel voldoen blijven ongewijzigd.

**Prullenbak** — verwijderde shows staan hier tijdelijk; "Herstellen" haalt ze terug, "Prullenbak Leegmaken" verwijdert ze definitief (kan niet ongedaan gemaakt worden).

**Systeemacties**:
- **Handmatige Sync Starten** — synchroniseert Shows, Media, Bibles én Templates (inclusief submappen) tussen de NAS en de Beamer-PC en/of elk extra geconfigureerd doel (zie 8.8) — gebeurt voor de Beamer-PC normaal ook automatisch elke nacht, zie hoofdstuk 9. Vóór de knop staat per doel een aanvinkvakje (Beamer-PC staat standaard aan; extra doelen staan standaard uit, omdat die meestal toch niet aanstaan) — alleen aangevinkte doelen worden meegenomen in die run. Terwijl de sync loopt zie je per doel een statusregel (⏳ bezig, ✅ klaar, ❌ fout, ⏭️ overgeslagen); bij afronding verschijnt bovenin een melding ("✅ Sync voltooid." of "❌ Sync mislukt: ..."). Deze voortgang wordt ook getoond als een sync die al liep (bijvoorbeeld de automatische nachtelijke sync) nog bezig is wanneer je dit scherm opent.
- **Project nu klaarzetten** — stuurt het laatst gegenereerde project direct naar de Beamer-PC en zet het klaar in FreeShow, zonder te wachten op het nachtelijke schema. Handig als de PC al aanstaat en je niet tot 's nachts wilt wachten. De status (✅/❌) verschijnt direct onder de knop.
- **Wis Alle Bijbelteksten** (rode, destructieve actie) — verwijdert in één keer alle Bijbeltekst-shows van zowel de NAS als de Beamer-PC. Let op: dit kan niet ongedaan worden gemaakt.

### 5.3.3 Team

Het adresboek voor "📤 Verstuur naar team" in de Setlist-modus (zie 5.1): per contactpersoon een naam, rol (Band / Beamer-operator / Overig), e-mailadres, en een "Actief"-vinkje om iemand tijdelijk te pauzeren zonder de gegevens kwijt te raken. Klik "+ Contact toevoegen" om een nieuwe regel te starten; wijzigingen worden per veld direct en automatisch opgeslagen (geen aparte "Opslaan"-knop, en los van de rest van de instellingen).

> ℹ️ Anders dan de rest van Instellingen (hoofdstuk 8) is dit scherm bereikbaar voor **iedereen met FreeShow-rechten**, niet alleen een Administrator — omdat het adresboek nu eenmaal bij het dagelijkse werk van een worship leader/operator hoort. Er zit bewust geen telefoonnummer bij: de WhatsApp-samenvatting (zie 5.1) gebruikt geen nummer en verstuurt niets automatisch, dus is dat gegeven niet nodig.

### 5.4 Nieuwe liederen automatisch aanmaken

Staat een aangeleverd lied nog niet in de catalogus, dan maakt de app automatisch een nieuwe show aan:
- **Categorie**: de categorie uit de mail (`Liederen (categorie: X):`) wordt gematcht tegen je echte FreeShow-categorieën. Geen match? Dan komt het lied in de standaardcategorie "Lied" terecht, met een duidelijke melding erbij.
- **Inhoud**: de aangeleverde tekst (zie 5.5) als die er is; anders wordt automatisch op internet gezocht; is ook dat niet gelukt, dan komt er een duidelijke placeholder-slide ("Tekst nog toevoegen") in te staan.

### 5.5 Bijlage: het e-mailformaat voor dienstaanlevering

Worship leaders/vrijwilligers leveren de liturgie aan via e-mail, in een vast, door de app herkenbaar formaat. Het onderwerp van de mail moet één van de trefwoorden bevatten die bij Instellingen → FreeShow zijn ingesteld (standaard: **"Liturgie"**; er mogen ook meerdere, kommagescheiden trefwoorden ingesteld worden). Naast Postvak IN wordt ook de Spam-map van het postvak gecontroleerd, als vangnet voor liturgie-mails die daar per ongeluk in terechtkomen.

**Basisopbouw:**

```
Dienst datum: 23-08-2026

[Sectie: Worship]
Liederen (categorie: Opwekkings liederen Ops Pro):
- Way Maker - Sinach
- 10.000 Redenen

[Sectie: Preek]
Bijbeltekst:
Johannes 3:16-18 (NBV21)

[Sectie: Einde]
Media:
https://youtu.be/xxxxxxxxxxx
```

**Onderdelen:**

- `Dienst datum: DD-MM-YYYY` — verplicht, precies één keer, bepaalt bij welke dienst alles hoort.
- `[Sectie: Naam]` — bepaalt in welk onderdeel van de dienst-orde de erop volgende items terechtkomen (moet overeenkomen met een sectienaam uit het gebruikte sjabloon, bijvoorbeeld Start/Worship/Collecte/Worship 2/Preek/Einde). Hoofdletters en spaties maken niet uit — `[sectie: worship]` werkt net zo goed als `[Sectie: Worship]`.
- `Liederen (categorie: X):` gevolgd door regels die beginnen met `- `. Per lied:
  - Alleen een titel: `- Way Maker`
  - Titel + artiest: `- Way Maker - Sinach` (de artiest helpt bij het opzoeken/matchen)
  - Songtekst **in de mail zelf**, direct onder de liedregel:
    ```
    - Way Maker - Sinach
    [Tekst]
    Verse1
    Way maker
    Miracle worker

    Chorus
    That is who You are
    [/Tekst]
    ```
    Regels als `Verse1`, `Chorus`, `Refrein`, `Couplet 2`, etc. worden automatisch herkend als groepslabel (net als FreeShow's eigen `[Chorus]`-notatie) en niet als gewone tekst getoond.
  - Songtekst **als bijlage** (.txt, .pdf of .docx), direct achter de liedregel:
    ```
    - 10.000 Redenen (bijlage: 10000_redenen.pdf)
    ```
    (de bijlage moet dan ook daadwerkelijk aan de mail zijn toegevoegd, met exact die bestandsnaam)
- `Bijbeltekst:` gevolgd door één of meer regels in het formaat `Boek Hoofdstuk:VersBegin-VersEind (VERTALING)`, bijvoorbeeld `Johannes 3:16-18 (NBV21)`. De vertaling mag ook één keer voor het hele blokje worden opgegeven in plaats van per regel: `Bijbeltekst (NBG):` — handig voor een lijstje zoals je die vanuit WhatsApp kopieert. Boeknamen mogen ook afgekort (`Ef.`, `Joh.`, `Ps.`, `2 Cor.`) en de spaties rondom zijn flexibel:
  ```
  Bijbeltekst (NBG):
  Ef. 2:1-10
  Joh. 3:15-18
  Ps. 100:3
  2 Cor.12:9
  ```
  Wordt een boeknaam of vertaling nergens herkend, dan verschijnt dat als "niet herkend" in de Setlist-weergave (5.1) in plaats van geraden te worden.

  **Herkende afkortingen per Bijbelboek** (met of zonder punt; een niet-genoemde afkorting wordt ook herkend als hij eenduidig bij precies één boeknaam past, bijvoorbeeld "Efez"):

  | Boek | Afk. | Boek | Afk. |
  |---|---|---|---|
  | Genesis | Gen. | Mattheüs | Matt. |
  | Exodus | Ex. | Marcus | Mark. |
  | Leviticus | Lev. | Lukas | Luk. |
  | Numeri | Num. | Johannes | Joh. |
  | Deuteronomium | Deut. | Handelingen | Hand. |
  | Jozua | Joz. | Romeinen | Rom. |
  | Rechters | Recht. | 1 Korinthiërs | 1 Kor. / 1 Cor. |
  | Ruth | — | 2 Korinthiërs | 2 Kor. / 2 Cor. |
  | 1 Samuël | 1 Sam. | Galaten | Gal. |
  | 2 Samuël | 2 Sam. | Efeziërs | Ef. |
  | 1 Koningen | 1 Kon. | Filippenzen | Fil. |
  | 2 Koningen | 2 Kon. | Kolossenzen | Kol. |
  | 1 Kronieken | 1 Kron. | 1 Thessalonicenzen | 1 Thess. |
  | 2 Kronieken | 2 Kron. | 2 Thessalonicenzen | 2 Thess. |
  | Ezra | — | 1 Timotheüs | 1 Tim. |
  | Nehemia | Neh. | 2 Timotheüs | 2 Tim. |
  | Esther | Est. | Titus | Tit. |
  | Job | — | Filemon | Filem. |
  | Psalmen | Ps. | Hebreeën | Hebr. |
  | Spreuken | Spr. | Jakobus | Jak. |
  | Prediker | Pred. | 1 Petrus | 1 Petr. |
  | Hooglied | Hoogl. | 2 Petrus | 2 Petr. |
  | Jesaja | Jes. | 1 Johannes | 1 Joh. |
  | Jeremia | Jer. | 2 Johannes | 2 Joh. |
  | Klaagliederen | Klaagl. | 3 Johannes | 3 Joh. |
  | Ezechiël | Ez. | Judas | Jud. |
  | Daniël | Dan. | Openbaring | Openb. |
  | Hosea | Hos. | | |
  | Joël | Jl. | | |
  | Amos | Am. | | |
  | Obadja | Ob. | | |
  | Jona | — | | |
  | Micha | Mi. | | |
  | Nahum | Nah. | | |
  | Habakuk | Hab. | | |
  | Sefanja | Sef. | | |
  | Haggaï | Hag. | | |
  | Zacharia | Zach. | | |
  | Maleachi | Mal. | | |

- `Media:` gevolgd door regels met een YouTube-link, een gewone link, of `(bijlage: bestandsnaam)` voor een bijgevoegde afbeelding/video/PowerPoint.
- Een lege regel sluit het huidige blok af (behalve binnen een `[Tekst]...[/Tekst]`-blok, waar lege regels juist bewaard blijven voor couplet/refrein-scheiding).
- **Commentaar**: een regel die begint met `#` wordt volledig genegeerd (bijvoorbeeld `# nog even nakijken`); een `#` verderop in een regel, met een spatie ervoor, negeert de rest van díe regel als toelichting, bijvoorbeeld:
  ```
  - Opw 717 - Heer U Doorgrondt En Kent Mij # in een lagere toonsoort
  ```
  Een `#` zonder voorafgaande spatie (zoals in een URL-fragment `#top` of een akkoord `F#`) wordt met rust gelaten.
- Vergeet je een `[/Tekst]` af te sluiten, dan sluit de app het blok automatisch af zodra de volgende herkenbare regel begint (een nieuw lied, sectie, Bijbeltekst of media-blok) — je krijgt hier een opmerking over in de Setlist-weergave (5.1), maar de rest van de mail wordt niet overgeslagen.
- Een normale **e-mailhandtekening** (alles na een regel die begint met `-- `) wordt automatisch herkend en genegeerd, ook als de `--` per ongeluk aan het einde van de voorgaande regel is blijven plakken.
- Zowel platte-tekst- als opgemaakte (HTML/rich-text) mails worden ondersteund, en een doorgestuurde mail met `>`-aanhalingstekens ervoor wordt ook herkend.
- Alles wat niet herkend wordt, verschijnt zichtbaar als "niet herkende regel" in de Setlist-weergave (5.1) — er wordt nooit stilzwijgend geraden.

**Een fout corrigeren via een vervolgmail.** Is er al een lied, Bijbeltekst of media-item aangeleverd dat toch niet klopt, dan hoeft niet de hele dienst opnieuw: stuur een korte vervolgmail (zelfde `Dienst datum:`) met een regel `Verwijder lied: ...`, `Verwijder bijbeltekst: ...` of `Verwijder media: ...`. Deze regels mogen overal in de mail staan, ook samen met nieuwe items in dezelfde mail:

```
Dienst datum: 23-08-2026

Verwijder lied: Way Maker
Verwijder bijbeltekst: Efeziërs 2:1-10

[Sectie: Worship]
Liederen:
- Great Are You Lord
```

- `Verwijder lied: Titel` (optioneel `Titel - Artiest` om tussen twee gelijknamige liederen van verschillende artiesten te onderscheiden) verwijdert dat lied uit de dienst.
- `Verwijder bijbeltekst: Boek H:V-V` (zelfde boeknaam-afkortingen als hierboven toegestaan) verwijdert die ene tekst.
- `Verwijder media: ...` gevolgd door de YouTube-link, gewone link, of bijlagenaam verwijdert dat media-item.
- Is er geen match gevonden, dan verschijnt dat als opmerking bij de dienst in de Setlist-weergave (5.1) in plaats van dat er iets fout gaat — er wordt nooit per ongeluk het verkeerde item verwijderd of stilzwijgend niets gedaan. Hetzelfde kan ook los, met het 🗑️-icoontje naast elk lied/tekst/media-item in de Setlist-weergave (5.1) zelf, zonder een e-mail te hoeven sturen.

---

## 6. Lichtregie (QLC+)

(Alleen zichtbaar als QLC+ is ingeschakeld bij Instellingen → Verbindingen.)

- **BLACKOUT (ALL OFF)** — zet in één keer alles uit
- **Hoofdscènes**: Warm Stage, Worship Blue, Pre-Service, Full House
- **Lichtshows**: Color Chase (Alle), Rainbow Wave
- **Kleurgroepen** — per lichtgroep (bijvoorbeeld LED-bars, SlimPARs, KLS-200-spots) een kleur kiezen, met een instelbare overgangstijd (fade)
- **Stroboscoop** — kleur + snelheid, met een aparte "STROBE UIT"-knop
- **Fresnel Dimmers** — vier losse dimmers plus een hoofdregelaar

### Overgangstijd (fade)

Bovenin het blok **Kleurgroepen** staat **Overgangstijd (Fade)** met zes knoppen: *Direct (0s)*, *0.5s*, *1s*, *2s*, *3s* en *5s*.

- Het is **één instelling voor alle lichtgroepen samen**; per lamptype apart instellen kan niet. De tijd geldt voor alles wat je daarna schakelt via de **Hoofdscènes** en de **Kleurgroepen**: LED-bars, SlimPARs, Color Bar Spots, KLS-200-spots, en de Fresnels voor zover die in een hoofdscène meedoen.
- Hij geldt **niet** voor de **Lichtshows** (Color Chase en Rainbow Wave hebben een eigen tempo), voor de **Stroboscoop** en voor de losse **Fresnel Dimmers**-schuifjes (die zetten direct een niveau).
- De gekozen tijd werkt vanaf de eerstvolgende scène of kleur die je kiest.
- Na een herstart van QLC+ staat de overgangstijd weer op *Direct*, ook als de app nog een andere knop als gekozen toont. Kies dan opnieuw een tijd.

### Stroboscoop

Kies een kleur en stel met de schuif **Snelheid** het tempo in: van *Langzaam* (ongeveer één flits per 2 seconden) tot *Extreem* (enkele tientallen milliseconden tussen de flitsen). **STROBE UIT** zet de flitser uit.

> ⚠️ Snelle stroboscoop-effecten kunnen bij mensen met lichtgevoelige epilepsie klachten veroorzaken. Gebruik ze spaarzaam en waarschuw aanwezigen.

---

## 6a. Tracks — de band-tracks afspelen (REAPER)

Dit tabblad bedient de **track-computer** (een Mac met REAPER) waarop de backing tracks van de band worden afgespeeld: een click, een guide (die de secties aankondigt) en de stems per groep, zoals drums, bas en keys. Je ziet het tabblad met het recht `tracks`, en alleen als het is ingeschakeld bij Instellingen → Verbindingen → **Tracks (REAPER)** (zie 8.2). Staat de koppeling uit, dan zie je "Koppeling met REAPER staat uit"; is de track-computer niet bereikbaar, dan zie je "REAPER niet bereikbaar".

> ℹ️ REAPER zelf, de bridge en de agent op de track-computer worden buiten deze app geïnstalleerd en vallen buiten deze handleiding. Hier staat alleen wat je in de app doet.

Bovenaan kies je tussen **Live**, **Bibliotheek** en de link **Podiumweergave (telefoon/tablet)**.

### 6a.1 Live

**Transportbalk** — toont de **Song** en de huidige **Sectie**, met knoppen voor naar het begin, afspelen, pauze en stop. Met **Opslaan** bewaar je de huidige mix (faders en mutes) in het REAPER-project van dat nummer, zodat die de volgende keer weer zo klaarstaat.

**Setlist** — de liederen van de dienst, uit de setlist die je bij FreeShow hebt gebouwd (zie 5.1). Elk lied wordt op naam gekoppeld aan een track in de bibliotheek. Per lied zie je de status:

- **Actief** — dit nummer is geladen en staat klaar of speelt
- **Klaar** — het project van dit nummer staat al open in REAPER; het volgende nummer van de setlist wordt automatisch klaargezet zodra het huidige afgelopen is
- **volgt…** — je hebt tijdens het afspelen een ander nummer gekozen. Het nieuwe nummer start op het eerstvolgende muzikale moment (zie Sprongmoment hieronder). Tik nogmaals om dit te annuleren.
- **geen track gevonden** — er staat geen bijpassende track in de bibliotheek; upload hem bij Bibliotheek (6a.2)
- **audio wordt opgehaald…** — het nummer is bekend, maar de audio staat nog niet op de track-computer. Die wordt vanzelf opgehaald.

Met het vernieuw-icoon laad je de lijst opnieuw. Een tweede knop opent alle gevonden songs als projecttabs in REAPER.

**Arrangement** — een knop per sectie van het nummer (Intro, Couplet, Refrein, enzovoort; elke soort heeft een eigen kleur). Tik op een sectie om ernaartoe te springen. Met **Sprongmoment** kies je *wanneer* de sprong gebeurt:

- **Einde sectie** — de sectie waar je nu in zit eerst afmaken en dan naadloos doorgaan
- **Volgende maat** — springt op de eerstvolgende maatstreep
- **Direct** — springt meteen

**Loop sectie** herhaalt de huidige sectie totdat je de loop weer uitzet, bijvoorbeeld als de voorganger nog even doorgaat. De guide past zich bij een sprong aan, zodat de aankondiging past bij de sectie waar je naartoe springt.

**Groepen** — per groep (bijvoorbeeld drums) een fader en een **MUTE**-knop. Klap een groep open om de afzonderlijke stems te zien. Dubbeltik op een fader om hem op 0 dB te zetten. Stems die de band normaal zelf live speelt zijn gemarkeerd met **LIVE** en staan standaard gemute; mist er iemand, zet dan de mute van die stem uit. **Alles unmuten** zet alle stems in één keer weer aan.

**Pads** — twaalf toetsen (een per toonsoort) waarmee je een pad-klank onder de dienst kunt laten liggen. Je stelt **Klank**, **Volume** en **Uitfaden** in; de toonsoort van het huidige nummer wordt gemarkeerd. Dit werkt alleen als de padspeler (ArkPads) op de track-computer draait. Anders zie je "De padspeler draait niet op de track-computer (ArkPads)."

**Songteksten in FreeShow automatisch mee laten lopen** — bij elk lied in de setlist staat een knop **Tekst**. Hiermee koppel je de FreeShow-show van het lied aan de secties van de track. De app maakt in die show een aparte indeling "Tracks" met een startdia, een lege dia voor instrumentale stukken en de tekstdia's in de volgorde van het arrangement. Tijdens het afspelen schakelt FreeShow daarna vanzelf naar de juiste dia, ook na een sprong of loop. Je kunt de show laten zoeken of zelf een andere kiezen, een **Voorstel** laten maken en dat per sectie aanpassen of weghalen.

Klopt de automatische timing van de dia's niet, gebruik dan **Timing opnemen**: speel het nummer af en tik op het moment dat de **Volgende dia** moet komen. Met **Opslaan** wordt dat per sectie onthouden en gebruikt de app voortaan jouw timing. Hoeveel tellen de dia's eerder dan de muziek worden getoond (standaard 2) stel je in bij 8.2.

### 6a.2 Bibliotheek

**Track-bibliotheek** — alle nummers waarvoor tracks beschikbaar zijn. Nieuwe tracks voeg je toe door een **MultiTracks-zip** naar het vak te slepen of erop te klikken. De zip wordt in stukken geüpload (en hervat vanzelf na een haperende verbinding). Daarna haalt de track-computer hem automatisch op, zet hem om naar een REAPER-project en maakt de server er een oefenversie van voor de oefenspeler (6b). Per nummer zie je de status en de secties. Het label **op Mac mini** betekent dat de audio op de track-computer staat. Bij een fout kun je het **Opnieuw proberen**, en met **Verwijderen** haal je een nummer weg.

**Eigen opname toevoegen** — voor stems die je zelf hebt opgenomen, zonder MultiTracks-zip. Een wizard met drie stappen en daarna **Uploaden**:

- **Nummer** — naam en tempo (bpm)
- **Secties** — kies per sectie de soort (couplet, refrein, enzovoort) en vanaf welke maat die begint
- **Stems** — sleep de audiobestanden erheen of kies ze. Markeer een stem als **LIVE** als de band dit normaal zelf speelt; die staat dan standaard gemute.

**Schijfruimte op de track-computer** — de audio van nummers die in de laatste weken niet zijn gespeeld en niet op een komende setlist staan, wordt automatisch van de track-computer verwijderd (alleen de audio; project en mix blijven bestaan). Komt een nummer weer op een setlist, dan wordt de audio vanzelf teruggehaald. De setlist is meestal al op woensdag bekend. Nummers die je op "altijd houden" zet, blijven altijd staan. Het aantal weken stel je in bij 8.2.

### 6a.3 Podiumweergave

De link **Podiumweergave (telefoon/tablet)** opent een aparte pagina "Podium" zonder faders, bedoeld voor een tablet of telefoon op het podium: de setlist en de sectieknoppen staan groot in beeld en het scherm blijft aan. Met **Naar het dashboard** ga je terug.

---

## 6b. Oefenen — de oefenspeler voor bandleden

Met het tabblad **Oefenen** (recht `oefenen`; wie `tracks` heeft mag het ook gebruiken) oefenen bandleden thuis in de browser, zonder REAPER en zonder dat de track-computer hoeft te draaien. De pagina is ook rechtstreeks te openen als `/oefenen`; **Naar het dashboard** gaat terug.

- **Nummers** — links staan bovenaan de liederen van de eerstvolgende dienst en daaronder **Alle nummers**, met een zoekveld. Kies een nummer; het wordt gedownload ("laden…"). Reken op ongeveer 75 MB per nummer, gebruik dus bij voorkeur wifi. Een net geüpload nummer is pas na ongeveer twee minuten klaar.
- **Afspelen** — afspelen, pauze en stop (terug naar het begin), en zoeken in het nummer. Je ziet de toonsoort en het tempo.
- **Tempo** — met **Langzamer**, **Sneller** en **Terug naar 100%** pas je het tempo aan; de toonhoogte blijft gelijk. Zo kun je een lastig stuk rustig oefenen.
- **Sectie** — tik op een sectie om ernaartoe te springen, met dezelfde **Sprongmoment**-keuze en **Loop sectie** als bij Tracks (6a.1).
- **Mix** — per groep **Mute** en **Solo** en een fader; open een groep om de afzonderlijke stems te zien. Jouw mix wordt **per nummer op dit apparaat onthouden**; **Standaardmix** zet hem terug. Stems met **LIVE** zijn de delen die de band normaal zelf speelt.
- **Tekst** — is er een tekst aan het nummer gekoppeld (zie de knop **Tekst** bij 6a.1), dan loopt die mee met het arrangement. Anders staat er "Geen tekst gekoppeld aan dit nummer."

Op een telefoon is de mixer compact weergegeven.

---

## 7. Gebruikersbeheer (alleen Administrator)

Via Instellingen → Gebruikersbeheer.

> ℹ️ Dit scherm beheert alleen **lokale accounts** (zie hoofdstuk 1). Wie via **Team-login (SSO)** inlogt, staat hier niet in en hoeft hier ook niet aangemaakt te worden — die mensen worden vanuit de identity provider zelf beheerd; hun rol/rechten in deze app stel je in via de groep→rechten-koppeling bij Instellingen → SSO (zie 8.11).

**Rollen:**
- **Administrator** — krijgt automatisch alle zeven rechten, ongeacht wat is aangevinkt.
- **Operator** — moet minimaal één recht toegewezen krijgen uit: Stream Planner, Control Center, Live Monitor, Lichtregie, Tracks (REAPER), Oefenen (band), FreeShow Projecten.

**Een gebruiker aanmaken/bewerken:** gebruikersnaam (niet meer te wijzigen na aanmaken), wachtwoord (leeg laten bij bewerken = ongewijzigd), rol, en (bij Operator) de rechten-checkboxen.

**Verwijderen**: kan niet voor je eigen account, en de laatste Administrator kan niet verwijderd worden (zo blijft er altijd minstens één beheerder over).

> ⚠️ Zie hoofdstuk 10 voor belangrijke beveiligingsopmerkingen over wachtwoorden en het Google-account.

---

# Deel 2 — Technische bijlage (voor de beheerder)

## 8. Instellingen — volledig overzicht

Instellingen zijn alleen zichtbaar/bewerkbaar voor Administrators (het tandwiel-icoon wordt voor Operators niet eens getoond). Wijzigingen worden pas opgeslagen na het klikken op **"Wijzigingen Opslaan"** onderaan — dit geldt voor elk tabblad tegelijk.

> ⚠️ Elke keer dat je instellingen opslaat, herstart de server kort (ongeveer 1 seconde) om de configuratie opnieuw te laden. Dit gebeurt bij elke opslag, niet alleen bij het wijzigen van YouTube-inloggegevens — een korte onderbreking is dus normaal.

### 8.1 Algemeen

**YouTube/Google-koppeling** (bovenaan het tabblad) — toont of er een koppeling is (**● Verbonden** of **○ Niet verbonden**) met de knoppen **Inloggen met Google** / **Opnieuw inloggen** en **Loskoppelen**. "Verbonden" betekent alleen dat er een token is opgeslagen, niet dat het nog werkt. Blijven YouTube-acties mislukken (bijvoorbeeld met "Insufficient Permission" of een scope-fout in het Activiteitenlog), of heb je bij het inloggen in Google's toestemmingsscherm niet alles toegestaan, klik dan op **Loskoppelen**, daarna op **Inloggen met Google**, en sta alle gevraagde rechten toe (vooral het beheren van je YouTube-account). Deze knoppen staan hier ook voor het geval de Planner de inlogknop niet toont omdat er nog een onbruikbaar token is opgeslagen. Loskoppelen is alleen voor Administrators en wordt in het Activiteitenlog vastgelegd. Elke omgeving (bijvoorbeeld test en productie) heeft zijn eigen koppeling. Gebruiken ze dezelfde Google-projectgegevens (Client ID), dan delen ze ook dezelfde dagelijkse quota.

| Veld | Uitleg |
|---|---|
| Thumbnail Opslag Pad (NAS) | Map waar OBS/FreeShow de livestream-thumbnail kunnen ophalen |
| Standaard Stream Titel | Sjabloon voor nieuwe uitzendingstitels |
| Standaard YouTube Tags | Standaard trefwoorden bij een nieuwe uitzending |
| Standaard Beschrijving | Standaardtekst voor de videobeschrijving |
| WhatsApp Uitnodiging Template | Berichtsjabloon met plekhouders `{link}`, `{titel}`, `{datum}`, `{tijd}` |
| Thumbnail automatisch synchroniseren (elke 10 minuten) | Vinkje, standaard aan. Zet dit uit op een omgeving die de YouTube-koppeling niet gebruikt, bijvoorbeeld een testomgeving met een verlopen token. De achtergrondcontrole slaat dan over voordat er iets bij YouTube wordt opgevraagd: geen quota-verbruik en geen meldingen "YouTube-koppeling is verlopen" in het Activiteitenlog of per e-mail. De instelling werkt direct, zonder herstart. |

### 8.2 Verbindingen

- **OBS WebSocket** — IP, poort, wachtwoord (optioneel)
- **Bitfocus Companion** — IP, poort
- **Behringer X32 (OSC)** — IP, poort
- **Atem Mini Pro** — IP-adres. Wordt gebruikt om bij het opstarten van de OBS-PC te wachten tot de Atem online is vóórdat OBS zelf start (anders herkent OBS de Atem-video-invoer niet), en om de status op de Regie-tab te tonen.
- **Lichtregie (QLC+)** — aan/uit-schakelaar, IP, poort (standaard 7700)
  > ℹ️ QLC+ leest zijn werkbestand (scènes, fades, strobe-snelheid) alleen bij het opstarten van de `qlcplus`-container in. Een wijziging daarin, ook na een nieuwe uitrol van de app, werkt pas nadat die container is herstart.
- **Presentatie (FreeShow)** — FreeShow IP, poort (standaard 5505). Het media-pad stel je in bij het tabblad **FreeShow** (`freeshowMediaPath`, zie 8.8).
- **LED Paneel (BK-Light)** — aan/uit, doel-host (leeg = zelfde als FreeShow-host), SSH-gebruiker, Bluetooth MAC (optioneel, anders auto-detectie), tekst/kleur voor "actief" en "inactief", en het **YouTube-controle venster (alleen zondag)**: een begin- en eindtijd (standaard 10:00–12:30, Nederlandse tijd). Alleen op zondag binnen dit tijdvak vraagt de app elke minuut aan YouTube of je live bent; daarmee schakelt het LED-paneel vanzelf tussen ON AIR en OFFLINE, en kan de website een "we zijn nu live"-banner tonen (zie 9). Op andere dagen of tijden wordt YouTube hiervoor niet bevraagd, wat quota spaart.
- **Tracks (REAPER)** — aan/uit-schakelaar en het IP en de poort van de track-computer (standaard 8080; dit is de webinterface van REAPER, onder Settings → Control/OSC/web → Web browser interface). Verder staan er bij deze kaart nog vier instellingen:
- **Tracks: uitgangen van de track-computer** — *Automatisch* (8 uitgangen als het audio-apparaat die heeft, anders stereo), *8 kanalen* (elke groep een eigen uitgang, voor de X32), *2 kanalen* (uitgang 1: click + guide, uitgang 2: tracks in mono), *3 kanalen* (uitgang 1: click + guide, uitgang 2 + 3: tracks in stereo) of *Stereo* (alles samen, om via speakers te testen)
- **Tracks: audio op de track-computer bewaren van songs gespeeld in de laatste** 2 tot 52 weken (standaard 8), plus alles op komende setlists en songs die je op "altijd houden" zet (zie 6a.2)
- **Tracks: FreeShow-dia's eerder tonen** — van *Precies op de maat* tot *4 tellen eerder* (standaard 2)
- **Tracks: agent-token** met de knop **Nieuwe token** — de agent op de track-computer die geüploade MultiTracks ophaalt en omzet, heeft deze token nodig in zijn eigen configuratie. Maak je een nieuwe token, dan moet de agent die daarna ook krijgen.
  > ℹ️ Of het LED-paneel reageert op de YouTube-status of de OBS-status (`ledTriggerSource`) is nog niet in de interface in te stellen — dit staat standaard op "youtube" en kan alleen via het instellingenbestand op de server worden gewijzigd.

### 8.3 Slimme Stekkers (Tuya)

- **Tuya API Host IP** — waar de lokale Tuya-brug draait (leeg = lokaal/Docker)
- Per stekker: naam, unieke ID, IP-adres, Tuya Device ID, Local Key, gekoppelde host-IP, protocolversie (3.1/3.3/3.4/3.5), en bij een stekkerdoos met meerdere stopcontacten het **Kanaal** (zie hieronder). Het **?**-icoontje bij Kanaal toont een korte uitleg.
- **Dupliceer** — kopieert een stekker en laat alleen naam, unieke ID en kanaal leeg; IP, Device ID, Local Key en protocolversie blijven staan. De kopie komt direct onder het origineel. Handig bij 4 of 5 stopcontacten van dezelfde stekkerdoos.

**Een stekkerdoos met meerdere stopcontacten** (bijvoorbeeld een 4-voudige met USB-poort) is voor Tuya één apparaat — één IP, Device ID en Local Key — met een eigen schakelaar per stopcontact: kanaal 1 t/m 4, en de USB-poort is meestal kanaal 5. Maak per stopcontact een eigen stekker aan met dezelfde IP, Device ID en Local Key maar een ander **Kanaal**; gebruik **Dupliceer** om dat snel te doen. Een gewone losse stekker laat je op kanaal 1 staan.

Wil je alles in één keer kunnen schakelen, zoals met de "alles"-knop in de Tuya-app, maak dan nog één extra stekker en vink **Bedient alle kanalen tegelijk** aan. Het veld daaronder vult zich met `1,2,3,4,5`; pas dat aan (kommagescheiden) als je maar een deel wilt schakelen, bijvoorbeeld `1,3,5`. Laat je de lijst leeg, dan schakelt deze knop alleen de kanalen waarvoor je zelf al een eigen stekker hebt aangemaakt. Op de kaart van de "alles"-stekker betekent *aan*: minstens één kanaal staat aan.

Alle kaarten van dezelfde stekkerdoos tonen dezelfde spanning, stroom en vermogen, want die worden voor de hele doos gemeten. De status van een doos wordt per ronde maar één keer opgevraagd, hoeveel kaarten er ook bij horen.

**Een nieuwe stekker koppelen aan Tuya** — stap voor stap:

- **Stap 1 — koppelen in de app.** Voeg de stekker toe in de **Smart Life-app** (Tuya) onder het account dat je voor deze app gebruikt.
- **Stap 2 — Cloud-project (eenmalig).** Maak op iot.tuya.com een Cloud-project aan (Cloud → Create Cloud Project, Development Method *Smart Home*, Data Center *Central Europe*) met de dienst **IoT Core**. Dat is een gratis proefabonnement dat na ongeveer een halfjaar verlengd moet worden (**Extend Trial Period**).
- **Stap 3 — account koppelen.** Open in het project **Devices → Link Tuya App Account → Add App Account** en scan de QR-code met de Smart Life-app (Me → scan-icoon rechtsboven). Daarna staan de apparaten van dat account in het project.
- **Stap 4 — Device ID en Local Key.** Op het tabblad Overview van het project staan **Access ID** en **Access Secret**. Daarmee lees je de gegevens van de stekker uit: via het hulpscript `get_tuya_devices.py` (met `TUYA_API_KEY` en `TUYA_API_SECRET` als omgevingsvariabelen) of via Cloud → **API Explorer** met "Query Device Detail". Je krijgt de **Device ID** en de **Local Key** (`local_key`). Het IP-adres dat Tuya daarbij toont is het publieke adres van je internetverbinding en is niet bruikbaar.
- **Stap 5 — lokaal IP-adres.** Zoek het lokale IP-adres van de stekker in de DHCP-lijst van je router. Geef de stekker bij voorkeur een vast adres. Een stekker op een apart IoT-wifi/subnet is niet te vinden met een scan vanaf een ander subnet; scan dan vanaf een apparaat op dat IoT-netwerk. Als protocolversie werkt 3.4 vaak; probeer 3.3 of 3.5 als de stekker niet reageert.
- **Stap 6 — invullen.** Vul de gegevens in bij Instellingen → Slimme Stekkers en klik op **Wijzigingen Opslaan**.

> ℹ️ Een nieuw Cloud-project kan in het begin de foutmelding "No permission. The data center is suspended" geven, ook als alles in het dashboard op "In service" staat. Die verdwijnt vanzelf na enige tijd (in onze ervaring binnen een uur).
> ⚠️ Koppel je een stekker opnieuw in de Tuya-app, dan krijgt hij een nieuwe Local Key en werkt de oude niet meer. Zet de Access Secret nooit in een bestand dat in git terechtkomt.

### 8.4 Schema's

Automatische taken op basis van tijd/dag: naam, actief/uit, tijdstip, actie (Opstarten/Netjes Afsluiten/Stroom Verbreken), welke stekker (alle of één specifieke), en op welke dagen.

### 8.5 MIDI Bridge

- Aan/uit-schakelaar voor de rtpMIDI-sessie
- Sessienaam (zoals deze verschijnt in bijvoorbeeld "Audio MIDI Setup" op een Mac)
- Auto-Connect IP's (kommagescheiden) — apparaten waarmee automatisch verbonden wordt

### 8.6 Dashboard Knoppen

Hier stel je de configureerbare noodknoppen in het Control Center samen: naam, subtekst, icoon, kleur, welk recht nodig is om de knop te zien, en de koppeling met Companion (pagina/rij/kolom + inkomend MIDI-nummer) en/of uitgaand MIDI-signaal.

### 8.7 Gebruikersbeheer

Zie hoofdstuk 7.

### 8.8 FreeShow

**Paden:**

| Veld | Uitleg |
|---|---|
| FreeShow Hoofdmap | Zoals de server het pad ziet, bv. `/volume1/Beamer/FreeShow` |
| FreeShow Hoofdmap (client-pad) | Hetzelfde pad, maar zoals de FreeShow-afspeelcomputer het zelf ziet (bv. een netwerkschijfletter). Leeg laten als dat identiek is aan het serverpad. |
| Projecten Map | Waar `.project`-bestanden komen |
| Media Map | Waar geüploade/aangeleverde media komt (dit is het veld dat écht gebruikt wordt — niet het "Media Pad" veld op de Verbindingen-tab) |
| Prullenbak Map | Voor "verwijderde" shows (herstelbaar) |
| Standaard Sjabloon | Welk `.project`-bestand als basis dient bij het genereren van een nieuw project |
| Automatisch opslaan op NAS | Of gegenereerde projecten automatisch worden weggeschreven |
| Output-ID voor livestream-video-stijl | De (per machine lokale) FreeShow-output-ID die automatisch omgeschakeld wordt tussen de stijlen "Livestream Video fullscreen" (bij voorgrond-media) en "Livestream Liederen" (bij een lied/Bijbeltekst) — zie de uitleg in 5.2.1. Klik **"Automatisch opzoeken"** om deze op te halen via SSH van de machine die momenteel als FreeShow-host is ingesteld; kies daarna de juiste output uit de lijst. Omdat dit ID lokaal is aan die ene machine, moet dit opnieuw opgezocht worden als de FreeShow-host ooit verandert. |

**E-mailkoppeling — ontvangen (liturgie-mails inlezen):**

| Veld | Uitleg |
|---|---|
| IMAP Host / Poort | Mailserver, bv. `imap.gmail.com` / `993` |
| Gebruikersnaam / Wachtwoord | Inloggegevens van het postvak |
| Verplicht(e) woord(en) in onderwerp | Alleen ongelezen mail waarvan het onderwerp één van deze (kommagescheiden) woorden bevat wordt gelezen (standaard "Liturgie") — voorkomt dat andere mail in hetzelfde postvak wordt aangeraakt. Leeg laten controleert elke ongelezen mail. Naast Postvak IN wordt ook de Spam-map gecontroleerd. |

> Zonder ingevulde gebruikersnaam/wachtwoord doet de achtergrondcontrole helemaal niets — er wordt zelfs geen verbinding geprobeerd.

**📤 SMTP — uitgaande mail (setlists versturen naar het team, zie 5.1):**

| Veld | Uitleg |
|---|---|
| SMTP Host / Poort | Mailserver voor uitgaande mail, bv. `smtp.gmail.com` / `465` |
| Gebruikersnaam / Wachtwoord | Inloggegevens van het verzendaccount — hetzelfde account (met app-wachtwoord) als bij IMAP hierboven werkt meestal prima voor beide |
| Afzendernaam | Naam waarmee de mail wordt afgezonden, bv. "Ark Church Livestream Manager" |
| Afzenderadres (optioneel) | Als leeg: hetzelfde als de gebruikersnaam |

> Los van de IMAP-instellingen hierboven — IMAP is voor het *ontvangen* van liturgie-mails, SMTP voor het *versturen* van setlists. Zonder ingevulde SMTP-gegevens toont "Verstuur naar team" (5.1) een duidelijke foutmelding ("SMTP is niet geconfigureerd") in plaats van stil te falen. Of de verbinding versleuteld is (`smtpSecure`) staat nog niet in dit scherm — dat staat standaard aan en is alleen via het instellingenbestand op de server aan te passen (zie ook hoofdstuk 11).

**🖥️ Extra FreeShow Doelen (Sync):**

Naast de hoofd-Beamer-PC hierboven kun je hier extra machines toevoegen die dezelfde volledige catalogus (Shows, Media, Bibles, Templates) moeten ontvangen — bijvoorbeeld een systeem in de zondagsschool. Klik **"+ Doel Toevoegen"** en vul per doel in:

| Veld | Uitleg |
|---|---|
| Naam | Herkenbare naam, bv. "Zondagsschool PC" |
| Host / IP-adres | Netwerkadres van die machine |
| SSH Gebruiker | Leeg laten = zelfde gebruiker als het hoofd-doel |
| Actief | Zet een doel tijdelijk uit zonder de configuratie te verwijderen |

Deze extra doelen krijgen **geen** stroom-/opstart-automatisering en ook geen "Project nu klaarzetten" (zie 5.3.2) — dat blijft exclusief voor de hoofd-Beamer-PC. Ze syncen ook **nooit automatisch** mee (niet 's nachts, niet na het inplannen van een stream) — alleen wanneer je ze bij "Handmatige Sync Starten" (zie 5.3.2) zelf aanvinkt, aangezien zulke doelen meestal toch niet aanstaan. De sync naar een extra doel gaat bovendien maar één kant op (NAS → doel): een wijziging die iemand rechtstreeks op zo'n extra machine maakt, komt nooit terug in de hoofdcatalogus. Met **"Verwijderen"** haal je een doel weer weg.

### 8.9 Backup & Herstel

**Opslagdoel**: geen (alleen lokaal), FTP, of WebDAV — met bijbehorende verbindingsgegevens en een bestandsnaam-voorvoegsel (handig als je meerdere omgevingen, zoals test en productie, naar dezelfde opslag back-uppen).

**Nieuwe back-up maken**: kies wat wordt meegenomen (app-configuratie, QLC+, Companion, FreeShow-database — optioneel inclusief mediabestanden, wat groot kan worden) en klik **"Lokaal Downloaden"** of **"Verzenden naar Externe Opslag"**.

**Herstellen**: upload een eerder gemaakte back-up-zip, kies welke onderdelen teruggezet moeten worden, en klik **"Herstel Geselecteerde Onderdelen"**. Er wordt automatisch eerst een veiligheidskopie van de huidige staat gemaakt voordat er iets wordt overschreven.

De track-bibliotheek (`data/tracks`, de geüploade MultiTracks) zit niet in de app-back-up.

### 8.10 Activiteitenlog

Alleen zichtbaar voor beheerders. Overzicht van wat er is gebeurd: sync-runs (gestart/voltooid/fouten), stekkers aan/uit, LED-scherm-triggers, en instellingen-wijzigingen (met wie). Filterbaar op categorie, met een "Vernieuwen"-knop. Wordt automatisch beperkt tot de laatste ~5000 gebeurtenissen, zodat het geen onbeperkte schijfruimte inneemt.

**Foutmeldingen per e-mail** — bovenaan dit tabblad stel je het **E-mailadres voor foutmeldingen** in. Naar dat adres mailt de app zelf als er iets misgaat dat ook in het log verschijnt; dit geldt voor de hele app, niet alleen voor FreeShow. De mail gaat via de SMTP-gegevens van 8.8; zonder adres of zonder SMTP wordt er niets gemaild (het log blijft wel gevuld). Meldingen die per e-mail komen:

- **YouTube-koppeling verlopen** — de thumbnail-sync is gestopt en `thema.jpg` wordt niet bijgewerkt; log opnieuw in (zie 8.1)
- **Thumbnail-sync mislukt** — thumbnail ophalen bij YouTube, een YouTube API-fout, het NAS-pad niet schrijfbaar, of de sync naar de Beamer-PC kon niet starten
- **Sync overgeslagen** — de Beamer-PC was niet bereikbaar tijdens de sync
- **LED-paneel: YouTube-status niet op te halen** — na 3 mislukte controles op rij, met de echte foutreden in de melding
- **YouTube API-quota bijna op** — bij 80% van de geschatte daglimiet, met een lijst van welke onderdelen (LED-paneel, website-banner, Monitor, thumbnail-sync, enzovoort) het meeste hebben verbruikt

Dezelfde soort melding wordt per e-mail hoogstens eens per 6 uur verstuurd (de LED-melding eens per half uur), zodat een aanhoudend probleem je inbox niet volstuurt. In het Activiteitenlog komt elke gebeurtenis wel gewoon voor.

### 8.11 SSO (Team-login)

Hiermee koppel je de app aan de identity provider van je organisatie, zodat teamleden inloggen met hun bestaande account in plaats van een apart wachtwoord voor deze app te krijgen (zie ook hoofdstuk 1). Op de testomgeving is dit Authentik; op de Synology-productieomgeving is dit de NAS zelf via het SSO Server-pakket. Beide werken via hetzelfde, standaard OpenID Connect-protocol — het verschil zit alleen in de ingevulde waarden hieronder.

**Verbindingsinstellingen:**

| Veld | Uitleg |
|---|---|
| SSO inschakelen | Zet de Team-login-knop op het inlogscherm aan/uit (zie hoofdstuk 1) |
| Naam op de inlogknop | Bijvoorbeeld "Team-login" of "Inloggen met NAS-account" |
| Issuer-URL | Het basisadres van de identity provider, bijvoorbeeld `https://authentik.voorbeeld.nl/application/o/livestream-manager/` of `https://sso.voorbeeld.synology.me/webman/sso`. Endpoints worden hier automatisch bij opgezocht (via `<issuer>/.well-known/openid-configuration`). |
| Client ID / Client Secret | Krijg je van de identity provider zelf bij het aanmaken van de OAuth2/OIDC-applicatie/client daar |
| OAuth scope | Meestal leeg laten (standaard: `openid profile email`). Alleen invullen als groepslidmaatschap anders niet in het inlogtoken terechtkomt — bijvoorbeeld `openid email groups` bij Synology's SSO Server. |
| PKCE uitschakelen | Alleen aanzetten als inloggen faalt met een generieke serverfout bij het token-endpoint — geconstateerd bij Synology's SSO Server |
| Groepen-claim in het ID-token | De naam van het veld waarin de identity provider de groepslidmaatschap meestuurt (standaard: `groups`) |

> ⚠️ Plak je een Client ID/Secret of Issuer-URL vanuit de identity provider's eigen beheerscherm, controleer dan of er geen onzichtbaar spatie- of tab-teken is meegekomen — dit is bij zowel Authentik als Synology's SSO Server al eens voorgekomen en geeft dan een onduidelijke inlogfout. De app trimt dit sinds kort automatisch weg bij het opslaan, maar bij een oudere versie kan dit nog spelen.

**Rechten per groep:**

Een tabel groepsnaam → rol (Admin/Operator) → rechten (planner/control/monitor/lights/tracks/oefenen/freeshow), met "+ Groep toevoegen"/verwijder-knoppen per rij. De groepsnaam moet **exact** overeenkomen met de groepsnaam bij de identity provider (hoofdlettergevoelig). Een groep die hier niet in staat, krijgt geen enkele permissie — iemand kan dan nog wel inloggen, maar ziet nergens toegang toe (zie ook hoofdstuk 1).

**Teamcontacten automatisch synchroniseren:**

Los van wie er mag *inloggen*, kun je hier ook automatisch de contactenlijst voor "📤 Verstuur naar team" (zie 5.1/5.3.3) laten vullen vanuit een of meer groepen bij de identity provider — inclusief mensen die zelf nooit op de app inloggen (bijvoorbeeld de meeste bandleden). Dit loopt volledig los van de rechten-tabel hierboven: een groep kan in geen van beide voorkomen, in allebei, of alleen hier.

| Veld | Uitleg |
|---|---|
| Contactsync inschakelen | Zet de periodieke synchronisatie aan/uit |
| Groepen om te synchroniseren | Eén of meer groepsnamen (net als hierboven: exact, hoofdlettergevoelig); "+ Groep toevoegen" voor een volgende |
| Bron | Authentik (API), Synology (DSM-API), of Synology (LDAP) |
| Interval (minuten) | Hoe vaak de sync draait (standaard 360 = elke 6 uur) |
| API-token / DSM-gebruikersnaam + wachtwoord / DSM-adres | Afhankelijk van de gekozen bron — zie hieronder |

- **Authentik (API)** — vraagt alleen een API-token (Directory → Tokens and App passwords, aangemaakt door een echte Authentik-superuser — lidmaatschap van de app-groep "Administrator" is hiervoor niet genoeg).
- **Synology (DSM-API)** — vraagt het adres van de NAS (bijvoorbeeld `https://192.168.2.250:5001`), plus een gebruikersnaam/wachtwoord van een DSM-account. Maak hiervoor een apart, beperkt service-account aan: lid van de groep **administrators** (nodig, anders krijgt de app geen toegang tot de gebruikers-/groepeninformatie), maar via **Control Panel → Application Privileges** met alleen "DSM" toegestaan en al het overige (File Station, SMB, FTP, Synology Drive, etc.) expliciet geweigerd — zo kan dit account, mocht het wachtwoord ooit lekken, niets anders dan die gebruikers-/groepeninformatie uitlezen.
- **Synology (LDAP)** — bewust (nog) niet gebouwd: dit zou het Directory Server-pakket vereisen, een permanent draaiende dienst die extra geheugen kost op een NAS die daar al krap in zit.

Een mislukte sync (bijvoorbeeld een verkeerd wachtwoord, of een groep die niet bestaat) laat de bestaande contactenlijst gewoon ongemoeid — er wordt nooit stilzwijgend leeggemaakt. Handmatig toegevoegde contacten (Beheer → Team, zie 5.3.3) blijven bij elke sync altijd gewoon staan; alleen eerder gesynchroniseerde contacten die niet meer in een van de opgegeven groepen zitten, worden verwijderd.

---

## 9. Automatische achtergrondtaken

Een aantal dingen gebeurt zonder dat iemand hoeft te klikken:

- **E-mailcontrole** — elke 10 minuten, mits IMAP-gegevens zijn ingesteld (zie 8.8); zie 5.1 voor hoe je dit ook handmatig ("Check nu") en opnieuw (mail als ongelezen markeren) kunt laten uitvoeren.
- **Teamcontacten synchronisatie** — mits ingeschakeld (zie 8.11): op het ingestelde interval (standaard elke 6 uur) worden de leden van de opgegeven groep(en) bij de identity provider opgehaald en bijgewerkt in de contactenlijst voor "Verstuur naar team" (5.1/5.3.3) — ook voor mensen die zelf nooit inloggen. Draait ook eenmalig direct bij het opstarten van de server.
- **Opschonen van verstuurde setlist-mail-kopieën** — draait mee met dezelfde e-mailcontrole hierboven. Elke setlist-mail die via "Verstuur naar team" (5.1) wordt verstuurd, laat automatisch een kopie achter in hetzelfde postvak (nodig om de ontvangers via BCC te kunnen versturen zonder ieders adres aan elkaar te tonen) — die kopieën ouder dan 7 dagen worden automatisch definitief verwijderd, zodat je nog even kunt terugkijken wat er verstuurd is zonder dat de inbox blijft volstromen.
- **NAS/Beamer-PC synchronisatie & opschoning** — draait via een geplande taak op de Synology NAS (`sync_and_cleanup_freeshow.py`, standaard om 00:00 uur): schoont Bijbelteksten ouder dan 7 dagen op, synchroniseert Shows, Media, Bibles en Templates (inclusief submappen) tweerichtingsverkeer tussen NAS en Beamer-PC, en zet aan het eind de Beamer-PC + bijbehorende slimme stekker netjes uit als de PC voor deze taak is opgestart of al aanstond. Extra FreeShow-doelen (zie 8.8) doen hier standaard niet aan mee — die syncen alleen als je ze zelf handmatig aanvinkt (zie 5.3.2). Een ingebouwde veiligheidsgrens voorkomt dat de sync in één keer een ongewoon groot aantal bestanden verwijdert (bijvoorbeeld door een tijdelijk onbereikbare map) — in dat geval wordt er die run niets verwijderd en verschijnt een waarschuwing in het synclog, zodat dit niet stilzwijgend tot dataverlies leidt.
- **Sync na een nieuwe/gewijzigde thumbnail** — zodra er een nieuwe eerstvolgende livestream is (of de thumbnail daarvan verandert), wordt meteen een sync naar de Beamer-PC gestart (in plaats van te wachten tot 00:00 uur) — en de bijbehorende stekker gaat daarna, net als bij de nachtelijke sync, netjes uit.
- **Thumbnail-synchronisatie** — elke 10 minuten wordt gecontroleerd of er een nieuwe eerstvolgende livestream is, en zo ja, de thumbnail lokaal bijgewerkt (zie hierboven). Uit te zetten per omgeving, zie 8.1.
- **YouTube-livestatus voor het LED-paneel en de website** — alleen op zondag binnen het ingestelde tijdvak (8.2) vraagt de app elke minuut aan YouTube of er een uitzending live is. Het LED-paneel (zie 4) schakelt daarmee automatisch tussen ON AIR en OFFLINE. De website kan via een klein openbaar statusadres (`/api/public/live-status`, zonder inlog) een "we zijn nu live"-banner tonen; dat adres geeft alleen terug of er live is, de kijk-link en de titel, en onthoudt het antwoord 20 seconden. Buiten het tijdvak wordt YouTube hiervoor niet bevraagd.
- **YouTube-quota bijhouden** — de app telt (als schatting) hoeveel YouTube-API-units ze per dag gebruikt, per onderdeel uitgesplitst, in `data/youtube_quota.json`. Bij 80% van de standaard daglimiet (10.000 units, vernieuwd 's ochtends rond 9:00 uur Nederlandse tijd) volgt een melding in het Activiteitenlog en per e-mail (zie 8.10).
- **Track-bibliotheek en oefenversies** — na het uploaden van een MultiTracks-zip (6a.2) haalt de agent op de track-computer die automatisch op en zet hem om naar een REAPER-project, en bouwt de server een oefenversie voor de oefenspeler (6b), ongeveer 2 minuten per nummer. Audio van nummers die lang niet gespeeld zijn wordt van de track-computer opgeschoond (8.2).
- **Wachten op de Atem vóór OBS start** — als er een Atem-IP is ingesteld (zie 8.2), wacht het opstartproces van de OBS-PC tot de Atem online is (reageert op ping) vóórdat OBS zelf wordt gestart. Start OBS namelijk vóór de Atem, dan herkent OBS de video-invoer van de Atem niet.
- **Automatisch wegklikken van OBS' "niet netjes afgesloten"-melding** — als de OBS-PC ooit onverwacht is afgesloten (bijvoorbeeld een stroomonderbreking), toont OBS bij de volgende start een melding die vraagt om te kiezen tussen veilige en normale modus. Deze melding wordt automatisch weggeklikt (altijd "Starten in normale modus" — veilige modus zou de WebSocket-koppeling met deze app uitschakelen), zodat OBS niet blijft hangen wanneer niemand er fysiek bij zit.

---

## 10. Beveiliging — belangrijke aandachtspunten

- **Wachtwoorden en sleutels staan in platte tekst** in `data/settings.json` op de server — dit geldt voor OBS-, Tuya-, FTP-, WebDAV-, IMAP-wachtwoorden en de Google/Facebook API-sleutels. Alleen de wachtwoorden van app-gebruikers (Administrator/Operator-accounts) zijn wél versleuteld opgeslagen. Beperk dus wie fysieke/SSH-toegang tot de server/NAS heeft.
- **Wijzig de standaard-accounts** (`admin`/`arkadmin`, `operator`/`arkoperator`) direct na installatie.
- **Instellingen zijn alleen voor Administrators** zichtbaar — Operators kunnen dit scherm niet openen, ook niet per ongeluk.
- **Het Google-account waarmee YouTube gekoppeld wordt, geeft in de praktijk volledige Administrator-rechten** op elke aanvraag aan de app, los van het lokale rechtensysteem. Wees dus voorzichtig met wie toegang heeft tot dat Google-account.
- **Bij Team-login (SSO) geldt hetzelfde "geen groep = geen toegang"-principe** als bij lokale accounts: een groep die niet voorkomt in de rechten-tabel (8.11) krijgt automatisch geen enkele permissie. Controleer na een wijziging in de groepsindeling bij de identity provider dus ook of de rechten-tabel in deze app nog klopt.
- **Het lokale account blijft altijd bereikbaar als noodtoegang** zodra Team-login is ingeschakeld (zie hoofdstuk 1) — wijzig het wachtwoord hiervan dus net zo serieus als bij een normale installatie, ook al wordt het in de praktijk zelden gebruikt.
- **API-tokens en wachtwoorden voor de identity provider/contactsync (8.11) staan, net als de overige verbindingswachtwoorden, in platte tekst** in `data/settings.json` op de server (zie het eerste punt hierboven).
- **Het openbare livestatus-adres (`/api/public/live-status`) vraagt bewust geen inlog**, omdat de website het moet kunnen opvragen. Het geeft alleen terug of er live is, de publieke kijk-link en de titel.
- **De agent-token (8.2) geeft de track-computer toegang tot de track-bibliotheek** en staat, net als de overige sleutels, in platte tekst in `data/settings.json`. Maak met **Nieuwe token** een nieuwe aan als je denkt dat hij gelekt is, en zet hem daarna ook bij de agent.
- **Elke instellingen-opslag herstart de server kort** (zie 8, intro).

---

## 11. Bekende beperkingen (stand van zaken)

- `ledTriggerSource` (YouTube- vs. OBS-gestuurd LED-signaal), een `adminPin`-functie voor herstel-/back-up-routes, en `smtpSecure` (of de SMTP-verbinding versleuteld is, zie 8.8) bestaan in de instellingen-data, maar hebben nog geen scherm — alleen via handmatige bewerking van het instellingenbestand op de server.
- **Tracks (REAPER)** en **Oefenen** vragen een track-computer met REAPER, de bridge en de agent; de installatie daarvan valt buiten deze app en deze handleiding.
- De oefenspeler (6b) is nog niet uitgebreid getest op Safari (iPhone/iPad); gebruik bij problemen Chrome.
- De automatische YouTube-controle voor het LED-paneel en de website-banner werkt alleen op zondag binnen het ingestelde tijdvak (8.2). Op feestdagen, zoals kerstavond of Goede Vrijdag, gebruik je de testknoppen bij de Monitor (hoofdstuk 4).
- Facebook-livestreams worden niet automatisch ingepland; dit blijft een handmatige stap via Facebook's eigen Live Producer.
- Bij het inladen van een `.project`-bestand dat niet door deze app zelf is opgeslagen (native FreeShow, of via de e-mail-koppeling), wordt de playlist best-effort gereconstrueerd — controleer het resultaat voordat je verdergaat.
- Songtekst-herkenning uit e-mail volgt vaste regels (geen taalmodel); wijkt een aanlevering te veel af van het afgesproken formaat, dan wordt dat als "niet herkend" gemeld in plaats van geraden.
- WhatsApp-verzending vanuit de Setlist-modus (5.1) is bewust niet geautomatiseerd — de "WhatsApp-samenvatting"-knop opent altijd `wa.me` met kant-en-klare tekst, waarna een mens zelf de ontvanger kiest in de eigen WhatsApp-app.
- In de Setlist-modus (5.1) is de sectiekeuze beperkt tot de sjabloon-secties zelf (Start/Worship/Collecte/etc.); anders dan bij "Snel toevoegen" (5.2.2) kun je een item daar niet naast een specifiek los vast item (zoals "Welkom" of "Thema") plaatsen, alleen binnen een hele sectie.
- **Synology (LDAP)** als bron voor teamcontacten-synchronisatie (zie 8.11) is bewust niet gebouwd — dit zou het Directory Server-pakket vereisen, een permanent draaiende dienst die extra geheugen kost op een NAS die daar al krap in zit. Gebruik in plaats daarvan "Synology (DSM-API)".

---

*Einde van de handleiding.*
