# Handleiding — Ark Church Livestream Manager

*Versie van dit document: bij app-versie 2.31.4*

## Inleiding

Deze handleiding beschrijft alle onderdelen van de Ark Church Livestream Manager: het plannen en uitzenden van diensten op YouTube, de live-bediening tijdens een uitzending, het samenstellen van FreeShow-presentaties (inclusief de automatische e-mail-aanlevering), lichtregie, en het beheer van gebruikers en instellingen.

Het document bestaat uit twee delen:

- **Deel 1 — Voor operators & vrijwilligers**: alles wat je nodig hebt om de app te bedienen tijdens en rond een dienst.
- **Deel 2 — Technische bijlage**: voor de beheerder(s) — alle instellingen, serverconfiguratie, beveiliging en bekende beperkingen.

### De vijf hoofdonderdelen

Bovenin de app vind je (afhankelijk van je rechten) tot vijf tabbladen — de knoppen zelf zijn kort gelabeld, de volledige naam staat hieronder tussen haakjes:

| Tabblad | Rechtennaam | Waarvoor |
|---|---|---|
| 📅 Planner (Stream Planner) | `planner` | YouTube-uitzendingen inplannen |
| 🎛️ Regie (Control Center) | `control` | Live bediening: OBS, stroom, noodknoppen |
| 📺 Monitor (Live Monitor) | `monitor` | Live status, statistieken, OBS-detailbediening |
| 💡 Licht (Lichtregie) | `lights` | QLC+ lichtbediening |
| ⛪ FreeShow (FreeShow Projecten) | `freeshow` | Liederen, Bijbelteksten en media tot een dienst samenstellen |

Een **Administrator** ziet altijd alle vijf. Een **Operator** ziet alleen de tabbladen waarvoor hij/zij expliciet rechten heeft gekregen (zie hoofdstuk 1). Alleen een Administrator ziet het tandwiel-icoon rechtsboven naar Instellingen.

---

# Deel 1 — Voor operators & vrijwilligers

## 1. Inloggen en rollen

Er zijn twee soorten accounts:

- **Administrator** — volledige toegang tot alle vijf tabbladen én Instellingen/Gebruikersbeheer.
- **Operator** — alleen bediening; ziet alleen de tabbladen waarvoor een Administrator hem/haar rechten heeft gegeven (een combinatie van `planner`/`control`/`monitor`/`lights`/`freeshow`).

> ⚠️ **Belangrijk bij eerste installatie**: de app maakt bij de allereerste start automatisch twee standaard-accounts aan: `admin` / `arkadmin` en `operator` / `arkoperator`. Wijzig deze wachtwoorden **onmiddellijk** na installatie via Gebruikersbeheer (hoofdstuk 7) — dit zijn bekende, voorspelbare inloggegevens.

Rechtsboven in de balk vind je:
- **?** — helpvenster (korte uitleg + link naar deze handleiding)
- **⚙️** (alleen Administrator) — Instellingen
- Je rol en gebruikersnaam
- **Afmelden**

Er is ook een aparte "Inloggen met Google"-knop specifiek voor het koppelen van het YouTube-account (zie hoofdstuk 2) — dit is *geen* gewoon operator-account en geeft automatisch volledige (Administrator-)rechten op elke API-aanvraag. Zie de beveiligingsnotitie in hoofdstuk 10.

---

## 2. Stream Planner — uitzendingen inplannen

Voordat je hier iets kunt inplannen moet het YouTube-kanaal gekoppeld zijn. Is dat nog niet gebeurd (of is de koppeling verlopen), dan zie je een knop **"Inloggen met Google"** — dit start de standaard Google-inlogflow. Na een succesvolle koppeling verschijnt het planningsformulier.

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

Als er stekkers zijn ingesteld (Instellingen → Slimme Stekkers), zie je hier per stekker: naam, online/offline-status, aan/uit-status, en (indien online) spanning/stroom/vermogen. De status wordt elke 10 seconden automatisch ververst.

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

---

## 5. FreeShow Projecten

Dit is het grootste onderdeel van de app: hier stel je liederen, Bijbelteksten en media samen tot een compleet FreeShow-project voor de dienst, en beheer je de FreeShow-showbibliotheek zelf.

Als de FreeShow-paden nog niet zijn ingesteld (zie Instellingen → FreeShow, hoofdstuk 8), zie je een melding dat dit eerst geconfigureerd moet worden — dat kan alleen een Administrator doen.

### 5.1 De basis-werkwijze (4 stappen)

1. Zoek een lied, Bijbeltekst, media-bestand, YouTube-video, of maak een sectie aan via een van de tabbladen bovenin.
2. Het item verschijnt in de **Staging Area** (links) — controleer en bewerk het hier.
3. Kies waar het moet komen: bij welke sectie, en vóór of ná.
4. Voeg het toe aan de **Playlist** (rechts) om het onderdeel te maken van het uiteindelijke project.

### 5.2 Item toevoegen

Zeven tabbladen bovenaan het toevoegpaneel:

**🎵 Liederen** — zoek in de catalogus (typen filtert live), klik een resultaat om het direct te selecteren, of typ een titel (eventueel `Titel - Artiest`) en klik "Handmatig lied toevoegen" als het lied niet in de catalogus staat. Bestaat het lied al in de catalogus, dan wordt de originele lay-out hergebruikt; bestaat het nog niet, dan wordt automatisch geprobeerd de tekst via internet op te zoeken (zie ook 5.13 voor hoe dit via e-mail werkt). Zijn er meerdere categorieën, dan kun je met een rijtje aanvinkbare categorieën boven de zoekresultaten de zoekopdracht beperken tot bepaalde categorieën; het aantal resultaten staat erbij.

**📊 Presentaties** — zelfde als Liederen, maar toont alleen catalogusitems met categorie "Presentatie".

**📖 Bijbel** — kies vertaling, boek, hoofdstuk, begin- en eindvers, en klik "+ Voeg Bijbel Toe".

**📸 Media** — kies een afbeelding/video-bestand. Twee belangrijke keuzes:
- **Plaatsing**: "Bestand" (simpele directe plaatsing in de afspeellijst — geeft videobediening zoals bij een gewone FreeShow-mediaclip) of "Show" (media wordt in een FreeShow-show verpakt, nodig als je met lagen of automatische timers wilt werken).
- **Laag/Rol**: "Voorgrond" of "Achtergrond".

  Je kunt media ook koppelen aan een *bestaand* item in plaats van een nieuw item te maken: kies in de dropdown welk item, en gebruik dan "Koppelen" (vervangt de achtergrond van dat item) of "Voeg Slide Toe" (voegt een extra media-slide toe aan dat item, bijvoorbeeld voor een diashow). Items met gekoppelde media krijgen een 🎞️-icoontje in de Playlist.

**🎥 YouTube** — plak een YouTube-URL en klik "Download & Toevoegen". De video wordt gedownload en automatisch op de voorgrond ingevoegd als een echte, losstaande show met geluid aan — zie de uitleg over de livestream-stijl hieronder.

**📁 Sectie** — maak een nieuwe sectiekop aan met een titel en kleur. Secties worden direct aan de Playlist toegevoegd (gaan niet via de Staging Area).

**🗃️ Shows & Database** — zie 5.9–5.12 hieronder (bereikbaar via "Item type → Database": Shows Catalogus & Editor, Bouwer-sessie, Database Onderhoud, Concept-diensten).

> ℹ️ **Livestream-stijl schakelt automatisch mee.** Elk stuk media dat op de voorgrond wordt geplaatst (zowel via 📸 Media als 🎥 YouTube) krijgt automatisch een actie mee die, zodra het item afspeelt, de output voor de livestream omschakelt naar de stijl "Livestream Video fullscreen". Zodra daarna een lied of Bijbeltekst speelt, schakelt diezelfde output automatisch terug naar "Livestream Liederen" — dit gebeurt zowel bij nieuw gegenereerde projecten als bij elk bestaand lied in de catalogus, dat deze terugschakel-actie al standaard heeft. Je hoeft hier zelf niets voor te doen; dit werkt alleen als bij Instellingen → FreeShow het veld "Output-ID voor livestream-video-stijl" is ingevuld (zie 8.8) — zonder dat veld wordt het item gewoon aangemaakt, alleen zonder de automatische stijl-omschakeling.

### 5.3 Plaatsing: sectie + vóór/ná

Onder elk toevoegtabblad (behalve wanneer een item al in bewerking is) staat "📍 Plaatsing in sectie:" — kies bij welke sectie het nieuwe item moet komen, en of het er vóór of ná moet. Dit werkt zowel met sjabloon-secties (als je een template gebruikt) als met je eigen handmatig aangemaakte secties.

### 5.4 Staging Area

Na het toevoegen van een lied/Bijbeltekst/media/YouTube-item verschijnt het in de Staging Area, waar je:
- de tekst kunt nalezen/aanpassen (bij liederen en Bijbelteksten),
- de sectie/plaatsing nog kunt wijzigen,
- en kiest wat er met het item gebeurt:
  - **👉 Playlist** — direct toevoegen aan de planning
  - **🛠️+ Bouwer** — toevoegen aan de Bouwer om te combineren met andere slides tot één samengestelde presentatie (zie 5.5)
  - **💾 Alleen opslaan in bibliotheek** — slaat het lied/Bijbeltekst op in de FreeShow-catalogus zonder het aan de huidige planning of Bouwer toe te voegen
  - **Annuleren**

### 5.5 Bouwer — eigen presentaties samenstellen

Bouw een presentatie van meerdere slides (bijvoorbeeld tekst + een paar foto's achter elkaar) door items vanuit de Staging Area hierheen te sturen ("🛠️+ Bouwer"). Zodra er minstens één slide is toegevoegd, verschijnt links het tabblad "🛠️ Bouwer-sessie" (met het aantal slides erbij) om verder te werken; geef de show een naam en klik "Maak Show & Voeg Toe" om de complete presentatie als één item aan de Playlist toe te voegen.

### 5.6 Project genereren

Onder "2. Project Genereren":
- **"Template gebruiken (Playlist)"** — aan: de vaste onderdelen/secties van het gekozen sjabloon blijven staan en jouw items worden erin ingevoegd op de gekozen plek. Uit: alleen jouw eigen items, geen sjabloon.
- **Project Naam** (optioneel)
- **Download** — laadt het `.project`-bestand naar je eigen computer
- **Stuur naar server** — slaat het project direct op in de FreeShow-projectenmap op de NAS

### 5.7 Bestaand project inladen

Onder "📂 Bestaand Project Inladen" zie je alle opgeslagen projecten op de server, of je kunt een `.project`-bestand vanaf je eigen computer uploaden. Klik "Inladen" om het terug te halen in de Bouwer.

Dit werkt voor **elk** `.project`-bestand — of het nu handmatig via deze app is gemaakt, automatisch via de e-mail-koppeling, of rechtstreeks in FreeShow zelf is aangemaakt. Als het project geen "eigen" opslagformaat van deze app heeft, reconstrueert de app een zo goed mogelijke playlist rechtstreeks uit de projectgegevens — je krijgt dan een melding met hoeveel items zijn teruggehaald en of er items zijn overgeslagen (bijvoorbeeld type media die deze app zelf niet kan aanmaken). Controleer in dat geval de ingeladen lijst even voordat je verdergaat.

### 5.8 Playlist beheren

Rechts zie je de complete, samengevoegde afspeellijst. Per item:
- Pijl-omhoog / Pijl-omlaag om te verplaatsen
- ✏️ om terug naar de Staging Area te gaan en het item te bewerken
- ✕ om te verwijderen (bij sjabloon-items: verbergt het item in plaats van het echt te verwijderen)

Meerdere items selecteren (vinkjes) en dan "🗑️ Wis" verwijdert ze in één keer; "🗑️ Alles wissen" leegt de hele lijst.

### 5.9 Catalogus

Doorzoek, filter (op categorie, met het aantal shows per categorie erbij — categorieën zonder shows worden niet getoond) en sorteer (naam / laatst gewijzigd) alle FreeShow-shows. Per show:
- **📝 Bewerken** — opent de show-editor (zie hieronder)
- **👁️ Preview** — bekijk de slides, met optioneel een ander sjabloon eroverheen om te zien hoe het er dan uitziet
- **👯 Dupliceren** — maakt een kopie onder een nieuwe naam
- **🗑️ Verwijderen** — verplaatst naar de prullenbak op de NAS (niet direct definitief)

**Show-editor**: kies tussen een **Visuele editor** (per slide tekst aanpassen, slides toevoegen/verwijderen/herordenen, type wisselen tussen tekst/media) of de **Raw JSON Editor** (de volledige showdata direct als tekst bewerken — alleen voor gevorderde gebruikers).

In de Visuele editor staat de knop **"📋 Plak volledige tekst"**: plak hier de complete songtekst in één keer (lege regel = nieuwe slide, `[Refrein]` of `Couplet 1` wordt automatisch als groepslabel herkend) en klik "Toepassen" om alle bestaande slides in deze show in één keer te vervangen — handig om een lied snel over te typen/plakken in plaats van slide voor slide te bewerken. Had de show al slides, dan vraagt de app eerst om bevestiging, want dit is niet ongedaan te maken.

### 5.10 Onderhoud

**Duplicaten** — "Start Scan" zoekt shows met (vrijwel) dezelfde naam/inhoud. Per gevonden paar: "Vergelijk" opent een scherm waarin je de twee versies naast elkaar ziet (inclusief gekoppelde achtergrondmedia) en met één klik kiest welke bewaard blijft; het andere wordt verwijderd.

**Bibliotheek** — "Optimaliseer Media" corrigeert/herstelt mediaverwijzingen in shows; "Back-up" downloadt een kopie van de hele showbibliotheek; hier kun je ook los een show uit de bibliotheek verwijderen.

**Prullenbak** — verwijderde shows staan hier tijdelijk; "Herstellen" haalt ze terug, "Prullenbak Leegmaken" verwijdert ze definitief (kan niet ongedaan gemaakt worden).

**Systeemacties**:
- **Handmatige Sync Starten** — synchroniseert Shows, Media, Bibles én Templates (inclusief submappen) tussen de NAS en de Beamer-PC en/of elk extra geconfigureerd doel (zie 8.8) — gebeurt voor de Beamer-PC normaal ook automatisch elke nacht, zie hoofdstuk 9. Vóór de knop staat per doel een aanvinkvakje (Beamer-PC staat standaard aan; extra doelen staan standaard uit, omdat die meestal toch niet aanstaan) — alleen aangevinkte doelen worden meegenomen in die run. Terwijl de sync loopt zie je per doel een statusregel (⏳ bezig, ✅ klaar, ❌ fout, ⏭️ overgeslagen); bij afronding verschijnt bovenin een melding ("✅ Sync voltooid." of "❌ Sync mislukt: ..."). Deze voortgang wordt ook getoond als een sync die al liep (bijvoorbeeld de automatische nachtelijke sync) nog bezig is wanneer je dit scherm opent.
- **Project nu klaarzetten** — stuurt het laatst gegenereerde project direct naar de Beamer-PC en zet het klaar in FreeShow, zonder te wachten op het nachtelijke schema. Handig als de PC al aanstaat en je niet tot 's nachts wilt wachten. De status (✅/❌) verschijnt direct onder de knop.
- **Wis Alle Bijbelteksten** (rode, destructieve actie) — verwijdert in één keer alle Bijbeltekst-shows van zowel de NAS als de Beamer-PC. Let op: dit kan niet ongedaan worden gemaakt.

### 5.11 Diensten — automatisch aangeleverd via e-mail

Onder "📬 Concept-diensten (mail)" zie je per herkende dienstdatum wat er tot nu toe via e-mail is aangeleverd. Klik **"🔄 Check nu"** om direct te controleren op nieuwe mail (dit gebeurt anders automatisch elke 10 minuten op de achtergrond).

Per dienst zie je:
- Liederen (met 📝-icoon als er ook tekst is meegestuurd), Bijbeltekst, Media — elk met een label van de sectie waar het naartoe gaat, en een 🗑️-icoontje om dat ene item te verwijderen zonder de rest van de dienst kwijt te raken (bijvoorbeeld bij een verkeerd doorgegeven lied of vers)
- **Niet herkende regels** (geel) — tekst in de mail die niet volgens het verwachte formaat was en dus met de hand nagekeken moet worden
- **Opmerkingen bij het genereren** (blauw) — bijvoorbeeld dat een nieuw lied is aangemaakt, of in welke categorie
- Een knop **"Project aanmaken"** of **"Project bijwerken"** — genereert/actualiseert het FreeShow-project voor die dienst automatisch

> ⚠️ Als iemand het gegenereerde project rechtstreeks in FreeShow heeft aangepast sinds de laatste update, waarschuwt de app hiervoor in plaats van die wijziging stil te overschrijven — je moet dan expliciet op "Toch overschrijven" klikken.

Onderaan, als aanwezig: **"Niet toegewezen mails"** — mail die niet aan een dienstdatum gekoppeld kon worden (bijvoorbeeld omdat de datumregel ontbreekt of niet goed leesbaar was), zodat je dit handmatig kunt oppakken. Met het 🗑️-icoon per mail haal je 'm uit dit lijstje (met bevestiging) — de mail zelf blijft gewoon in de mailbox staan, alleen de vermelding hier verdwijnt.

> ℹ️ Een concept-dienst blijft hier staan totdat je 'm zelf verwijdert met het 🗑️-icoon naast de datum (met bevestiging) — er is geen automatische opschoning na de dienstdatum. Verwijderen raakt alleen de aanlevering in deze reviewtab; een al gegenereerd FreeShow-project op de NAS blijft gewoon staan.

### 5.12 Nieuwe liederen automatisch aanmaken

Staat een aangeleverd lied nog niet in de catalogus, dan maakt de app automatisch een nieuwe show aan:
- **Categorie**: de categorie uit de mail (`Liederen (categorie: X):`) wordt gematcht tegen je echte FreeShow-categorieën. Geen match? Dan komt het lied in de standaardcategorie "Lied" terecht, met een duidelijke melding erbij.
- **Inhoud**: de aangeleverde tekst (zie 5.13) als die er is; anders wordt automatisch op internet gezocht; is ook dat niet gelukt, dan komt er een duidelijke placeholder-slide ("Tekst nog toevoegen") in te staan.

### 5.13 Bijlage: het e-mailformaat voor dienstaanlevering

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
  Wordt een boeknaam of vertaling nergens herkend, dan verschijnt dat als "niet herkend" in de reviewtab in plaats van geraden te worden.

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
- Vergeet je een `[/Tekst]` af te sluiten, dan sluit de app het blok automatisch af zodra de volgende herkenbare regel begint (een nieuw lied, sectie, Bijbeltekst of media-blok) — je krijgt hier een opmerking over in de reviewtab, maar de rest van de mail wordt niet overgeslagen.
- Een normale **e-mailhandtekening** (alles na een regel die begint met `-- `) wordt automatisch herkend en genegeerd, ook als de `--` per ongeluk aan het einde van de voorgaande regel is blijven plakken.
- Zowel platte-tekst- als opgemaakte (HTML/rich-text) mails worden ondersteund, en een doorgestuurde mail met `>`-aanhalingstekens ervoor wordt ook herkend.
- Alles wat niet herkend wordt, verschijnt zichtbaar als "niet herkende regel" in de reviewtab — er wordt nooit stilzwijgend geraden.

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
- Is er geen match gevonden, dan verschijnt dat als opmerking bij de dienst in de reviewtab in plaats van dat er iets fout gaat — er wordt nooit per ongeluk het verkeerde item verwijderd of stilzwijgend niets gedaan. Hetzelfde kan ook los, met het 🗑️-icoontje naast elk lied/tekst/media-item in de reviewtab zelf, zonder een e-mail te hoeven sturen.

---

## 6. Lichtregie (QLC+)

(Alleen zichtbaar als QLC+ is ingeschakeld bij Instellingen → Verbindingen.)

- **BLACKOUT (ALL OFF)** — zet in één keer alles uit
- **Hoofdscènes**: Warm Stage, Worship Blue, Pre-Service, Full House
- **Lichtshows**: Color Chase (Alle), Rainbow Wave
- **Kleurgroepen** — per lichtgroep (bijvoorbeeld LED-bars, SlimPARs, KLS-200-spots) een kleur kiezen, met een instelbare overgangstijd (fade)
- **Stroboscoop** — kleur + snelheid, met een aparte "STROBE UIT"-knop
- **Fresnel Dimmers** — vier losse dimmers plus een hoofdregelaar

---

## 7. Gebruikersbeheer (alleen Administrator)

Via Instellingen → Gebruikersbeheer.

**Rollen:**
- **Administrator** — krijgt automatisch alle vijf rechten, ongeacht wat is aangevinkt.
- **Operator** — moet minimaal één recht toegewezen krijgen uit: Stream Planner, Control Center, Live Monitor, Lichtregie, FreeShow Projecten.

**Een gebruiker aanmaken/bewerken:** gebruikersnaam (niet meer te wijzigen na aanmaken), wachtwoord (leeg laten bij bewerken = ongewijzigd), rol, en (bij Operator) de rechten-checkboxen.

**Verwijderen**: kan niet voor je eigen account, en de laatste Administrator kan niet verwijderd worden (zo blijft er altijd minstens één beheerder over).

> ⚠️ Zie hoofdstuk 10 voor belangrijke beveiligingsopmerkingen over wachtwoorden en het Google-account.

---

# Deel 2 — Technische bijlage (voor de beheerder)

## 8. Instellingen — volledig overzicht

Instellingen zijn alleen zichtbaar/bewerkbaar voor Administrators (het tandwiel-icoon wordt voor Operators niet eens getoond). Wijzigingen worden pas opgeslagen na het klikken op **"Wijzigingen Opslaan"** onderaan — dit geldt voor elk tabblad tegelijk.

> ⚠️ Elke keer dat je instellingen opslaat, herstart de server kort (ongeveer 1 seconde) om de configuratie opnieuw te laden. Dit gebeurt bij elke opslag, niet alleen bij het wijzigen van YouTube-inloggegevens — een korte onderbreking is dus normaal.

### 8.1 Algemeen

| Veld | Uitleg |
|---|---|
| Thumbnail Opslag Pad (NAS) | Map waar OBS/FreeShow de livestream-thumbnail kunnen ophalen |
| Standaard Stream Titel | Sjabloon voor nieuwe uitzendingstitels |
| Standaard YouTube Tags | Standaard trefwoorden bij een nieuwe uitzending |
| Standaard Beschrijving | Standaardtekst voor de videobeschrijving |
| WhatsApp Uitnodiging Template | Berichtsjabloon met plekhouders `{link}`, `{titel}`, `{datum}`, `{tijd}` |

### 8.2 Verbindingen

- **OBS WebSocket** — IP, poort, wachtwoord (optioneel)
- **Bitfocus Companion** — IP, poort
- **Behringer X32 (OSC)** — IP, poort
- **Atem Mini Pro** — IP-adres. Wordt gebruikt om bij het opstarten van de OBS-PC te wachten tot de Atem online is vóórdat OBS zelf start (anders herkent OBS de Atem-video-invoer niet), en om de status op de Regie-tab te tonen.
- **Lichtregie (QLC+)** — aan/uit-schakelaar, IP, poort (standaard 7700)
- **Presentatie (FreeShow)** — FreeShow IP, poort (standaard 5505). Het media-pad stel je in bij het tabblad **FreeShow** (`freeshowMediaPath`, zie 8.8).
- **LED Paneel (BK-Light)** — aan/uit, doel-host (leeg = zelfde als FreeShow-host), SSH-gebruiker, Bluetooth MAC (optioneel, anders auto-detectie), tekst/kleur voor "actief" en "inactief"
  > ℹ️ Of het LED-paneel reageert op de YouTube-status of de OBS-status (`ledTriggerSource`) is nog niet in de interface in te stellen — dit staat standaard op "youtube" en kan alleen via het instellingenbestand op de server worden gewijzigd.

### 8.3 Slimme Stekkers (Tuya)

- **Tuya API Host IP** — waar de lokale Tuya-brug draait (leeg = lokaal/Docker)
- Per stekker: naam, unieke ID, IP-adres, Tuya Device ID, Local Key, gekoppelde host-IP, protocolversie (3.1/3.3/3.4/3.5)

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
| Output-ID voor livestream-video-stijl | De (per machine lokale) FreeShow-output-ID die automatisch omgeschakeld wordt tussen de stijlen "Livestream Video fullscreen" (bij voorgrond-media) en "Livestream Liederen" (bij een lied/Bijbeltekst) — zie de uitleg in 5.2. Klik **"Automatisch opzoeken"** om deze op te halen via SSH van de machine die momenteel als FreeShow-host is ingesteld; kies daarna de juiste output uit de lijst. Omdat dit ID lokaal is aan die ene machine, moet dit opnieuw opgezocht worden als de FreeShow-host ooit verandert. |

**E-mailkoppeling (concept-diensten):**

| Veld | Uitleg |
|---|---|
| IMAP Host / Poort | Mailserver, bv. `imap.gmail.com` / `993` |
| Gebruikersnaam / Wachtwoord | Inloggegevens van het postvak |
| Verplicht(e) woord(en) in onderwerp | Alleen ongelezen mail waarvan het onderwerp één van deze (kommagescheiden) woorden bevat wordt gelezen (standaard "Liturgie") — voorkomt dat andere mail in hetzelfde postvak wordt aangeraakt. Leeg laten controleert elke ongelezen mail. Naast Postvak IN wordt ook de Spam-map gecontroleerd. |

> Zonder ingevulde gebruikersnaam/wachtwoord doet de achtergrondcontrole helemaal niets — er wordt zelfs geen verbinding geprobeerd.

**🖥️ Extra FreeShow Doelen (Sync):**

Naast de hoofd-Beamer-PC hierboven kun je hier extra machines toevoegen die dezelfde volledige catalogus (Shows, Media, Bibles, Templates) moeten ontvangen — bijvoorbeeld een systeem in de zondagsschool. Klik **"+ Doel Toevoegen"** en vul per doel in:

| Veld | Uitleg |
|---|---|
| Naam | Herkenbare naam, bv. "Zondagsschool PC" |
| Host / IP-adres | Netwerkadres van die machine |
| SSH Gebruiker | Leeg laten = zelfde gebruiker als het hoofd-doel |
| Actief | Zet een doel tijdelijk uit zonder de configuratie te verwijderen |

Deze extra doelen krijgen **geen** stroom-/opstart-automatisering en ook geen "Project nu klaarzetten" (zie 5.10) — dat blijft exclusief voor de hoofd-Beamer-PC. Ze syncen ook **nooit automatisch** mee (niet 's nachts, niet na het inplannen van een stream) — alleen wanneer je ze bij "Handmatige Sync Starten" (zie 5.10) zelf aanvinkt, aangezien zulke doelen meestal toch niet aanstaan. De sync naar een extra doel gaat bovendien maar één kant op (NAS → doel): een wijziging die iemand rechtstreeks op zo'n extra machine maakt, komt nooit terug in de hoofdcatalogus. Met **"Verwijderen"** haal je een doel weer weg.

### 8.9 Backup & Herstel

**Opslagdoel**: geen (alleen lokaal), FTP, of WebDAV — met bijbehorende verbindingsgegevens en een bestandsnaam-voorvoegsel (handig als je meerdere omgevingen, zoals test en productie, naar dezelfde opslag back-uppen).

**Nieuwe back-up maken**: kies wat wordt meegenomen (app-configuratie, QLC+, Companion, FreeShow-database — optioneel inclusief mediabestanden, wat groot kan worden) en klik **"Lokaal Downloaden"** of **"Verzenden naar Externe Opslag"**.

**Herstellen**: upload een eerder gemaakte back-up-zip, kies welke onderdelen teruggezet moeten worden, en klik **"Herstel Geselecteerde Onderdelen"**. Er wordt automatisch eerst een veiligheidskopie van de huidige staat gemaakt voordat er iets wordt overschreven.

---

## 9. Automatische achtergrondtaken

Een aantal dingen gebeurt zonder dat iemand hoeft te klikken:

- **E-mailcontrole** — elke 10 minuten, mits IMAP-gegevens zijn ingesteld (zie 8.8).
- **NAS/Beamer-PC synchronisatie & opschoning** — draait via een geplande taak op de Synology NAS (`sync_and_cleanup_freeshow.py`, standaard om 00:00 uur): schoont Bijbelteksten ouder dan 7 dagen op, synchroniseert Shows, Media, Bibles en Templates (inclusief submappen) tweerichtingsverkeer tussen NAS en Beamer-PC, en zet aan het eind de Beamer-PC + bijbehorende slimme stekker netjes uit als de PC voor deze taak is opgestart of al aanstond. Extra FreeShow-doelen (zie 8.8) doen hier standaard niet aan mee — die syncen alleen als je ze zelf handmatig aanvinkt (zie 5.10). Een ingebouwde veiligheidsgrens voorkomt dat de sync in één keer een ongewoon groot aantal bestanden verwijdert (bijvoorbeeld door een tijdelijk onbereikbare map) — in dat geval wordt er die run niets verwijderd en verschijnt een waarschuwing in het synclog, zodat dit niet stilzwijgend tot dataverlies leidt.
- **Sync na een nieuwe/gewijzigde thumbnail** — zodra er een nieuwe eerstvolgende livestream is (of de thumbnail daarvan verandert), wordt meteen een sync naar de Beamer-PC gestart (in plaats van te wachten tot 00:00 uur) — en de bijbehorende stekker gaat daarna, net als bij de nachtelijke sync, netjes uit.
- **Thumbnail-synchronisatie** — elke 10 minuten wordt gecontroleerd of er een nieuwe eerstvolgende livestream is, en zo ja, de thumbnail lokaal bijgewerkt (zie hierboven).
- **Wachten op de Atem vóór OBS start** — als er een Atem-IP is ingesteld (zie 8.2), wacht het opstartproces van de OBS-PC tot de Atem online is (reageert op ping) vóórdat OBS zelf wordt gestart. Start OBS namelijk vóór de Atem, dan herkent OBS de video-invoer van de Atem niet.
- **Automatisch wegklikken van OBS' "niet netjes afgesloten"-melding** — als de OBS-PC ooit onverwacht is afgesloten (bijvoorbeeld een stroomonderbreking), toont OBS bij de volgende start een melding die vraagt om te kiezen tussen veilige en normale modus. Deze melding wordt automatisch weggeklikt (altijd "Starten in normale modus" — veilige modus zou de WebSocket-koppeling met deze app uitschakelen), zodat OBS niet blijft hangen wanneer niemand er fysiek bij zit.

---

## 10. Beveiliging — belangrijke aandachtspunten

- **Wachtwoorden en sleutels staan in platte tekst** in `data/settings.json` op de server — dit geldt voor OBS-, Tuya-, FTP-, WebDAV-, IMAP-wachtwoorden en de Google/Facebook API-sleutels. Alleen de wachtwoorden van app-gebruikers (Administrator/Operator-accounts) zijn wél versleuteld opgeslagen. Beperk dus wie fysieke/SSH-toegang tot de server/NAS heeft.
- **Wijzig de standaard-accounts** (`admin`/`arkadmin`, `operator`/`arkoperator`) direct na installatie.
- **Instellingen zijn alleen voor Administrators** zichtbaar — Operators kunnen dit scherm niet openen, ook niet per ongeluk.
- **Het Google-account waarmee YouTube gekoppeld wordt, geeft in de praktijk volledige Administrator-rechten** op elke aanvraag aan de app, los van het lokale rechtensysteem. Wees dus voorzichtig met wie toegang heeft tot dat Google-account.
- **Elke instellingen-opslag herstart de server kort** (zie 8, intro).

---

## 11. Bekende beperkingen (stand van zaken)

- `ledTriggerSource` (YouTube- vs. OBS-gestuurd LED-signaal) en een `adminPin`-functie voor herstel-/back-up-routes bestaan in de instellingen-data, maar hebben nog geen scherm — alleen via handmatige bewerking van het instellingenbestand op de server.
- Facebook-livestreams worden niet automatisch ingepland; dit blijft een handmatige stap via Facebook's eigen Live Producer.
- Bij het inladen van een `.project`-bestand dat niet door deze app zelf is opgeslagen (native FreeShow, of via de e-mail-koppeling), wordt de playlist best-effort gereconstrueerd — controleer het resultaat voordat je verdergaat.
- Songtekst-herkenning uit e-mail volgt vaste regels (geen taalmodel); wijkt een aanlevering te veel af van het afgesproken formaat, dan wordt dat als "niet herkend" gemeld in plaats van geraden.

---

*Einde van de handleiding.*
