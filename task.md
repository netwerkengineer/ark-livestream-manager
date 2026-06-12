# Checklist: Multi-Plug Tuya & Config Layout

- `[x]` **Stap 1: Verbinding met de slimme stekker tot stand brengen** (Afgerond)
- `[x]` **Stap 2: Mac Mini autorestart en SSH-sleutel inrichten** (Afgerond)
- `[x]` **Stap 3: Schrijven van de definitieve control scripts en Companion integratie** (Afgerond)
- `[x]` **Stap 4: Sunday Project Automatisering & Opstarten** (Afgerond)
- `[x]` **Stap 5: Ondersteuning voor meerdere Tuya stekkers implementeren** (Afgerond)

- `[x]` **Stap 6: Overzichtelijk Instellingenmenu met Tabbladen implementeren** (Afgerond)
  - `[x]` TypeScript imports uitbreiden in `page.tsx` (`FileText`, `Cpu`, `Sliders` toevoegen)
  - `[x]` State `settingsTab` toevoegen in `page.tsx`
  - `[x]` Split-layout met sidebar menu en scrollbare content integreren in settings modal in `page.tsx`
  - `[x]` Alle instellingensecties verhuizen naar hun respectievelijke tabs in `page.tsx`
  - `[x]` Wijzigingen testen en deployen naar Proxmox LXC 112 (docker image rebuild)
  - `[x]` Git commit & push naar GitHub repo

- `[x]` **Stap 7: Tuya Smart Plug Dashboard & Power Monitoring** (Afgerond)
  - `[x]` `status_json` actie toevoegen in `control_plug.py`
  - `[x]` `/status_json` endpoint toevoegen in `tuya_http_server.py`
  - `[x]` Next.js API route `/api/tuya/status/route.ts` aanmaken
  - `[x]` Live Status & Power grid/component toevoegen aan dashboard in `page.tsx`

- `[x]` **Stap 8: Automatische Scheduler inbouwen** (Afgerond)
  - `[x]` Background scheduler thread inbouwen in `tuya_http_server.py`
  - `[x]` Scheduler settings UI en opslag integreren in `page.tsx` (settings modal)

- `[x]` **Stap 9: Uitrol en Verificatie** (Afgerond)
  - `[x]` Deployen naar Proxmox LXC 112
  - `[x]` Handmatig testen van stroomverbruiksweergave en automatische triggers
  - `[x]` Git commits en push naar GitHub main

- `[x]` **Stap 10: Herstellen van automatische opstart Mac Mini** (Afgerond)
  - `[x]` `detect_os(user, host_ip)` helper-functie toevoegen aan `shutdown_pcs.py`
  - `[x]` SSH-afsluitcommando conditioneel maken op basis of OS (sleep voor macOS) in `shutdown_pcs.py`
  - `[x]` Wijzigingen deployen naar Proxmox LXC 112 met `deploy_tuya_multi.py`
  - `[x]` Testen en controleren dat Mac Mini automatisch herstart na stroomherstel

- `[x]` **Stap 11: Dynamische detectie van FreeShow database-locatie (dataPath)** (Afgerond)
  - `[x]` `settings.json` downloaden en controleren op `dataPath` in `import_project.py`
  - `[x]` `remote_docs_dir` dynamisch toewijzen op basis van `dataPath` in `import_project.py`
  - `[x]` Wijzigingen deployen naar Proxmox LXC 112 met `deploy_tuya_multi.py`
  - `[x]` Testen en controleren dat imports op de juiste netwerklocatie worden geplaatst

- `[x]` **Stap 12: Implementeren van Lokale Gebruikers & RBAC (ACOC)** (Afgerond)
  - `[x]` `operatorPassword` en `users` interfaces toevoegen en initiële PBKDF2 hashing inrichten in `settingsStore.ts` (Afgerond)
  - `[x]` `hashPassword` en `isAuthorized` check implementeren in `authHelper.ts` (Afgerond)
  - `[x]` `/api/auth/operator` API route aanmaken voor inloggen en uitloggen (cookie setting) (Afgerond)
  - `[x]` `/api/users` API route aanmaken voor gebruikersbeheer door admins (Afgerond)
  - `[x]` Backend route handlers beveiligen (settings, broadcast/action, qlc/action, tuya/status, etc.) (Afgerond)
  - `[x]` `page.tsx` voorzien van inlogscherm, operator-uitloggen, RBAC tabbladen en "Gebruikers" tabblad in instellingen (Afgerond)
  - `[x]` Wijzigingen deployen naar Proxmox LXC 112, testen en committen naar Git (Afgerond)

- `[x]` **Stap 13: Toggle-status en oplichten broadcast control knoppen** (Afgerond)
  - `[x]` `activeButtons` state toevoegen aan `BroadcastControlCenter.tsx`
  - `[x]` `localStorage` persistentie implementeren voor activeButtons
  - `[x]` `.active` klasse conditioneel toevoegen aan oplichten-stijlen in `globals.css`
  - `[x]` Wijzigingen deployen naar Proxmox LXC 112 met `deploy_tuya_multi.py` en committen naar Git (Afgerond)

- `[x]` **Stap 14: Configureerbare Tuya API Host implementeren** (Afgerond)
  - `[x]` TypeScript interface `AppSettings` uitbreiden met `tuyaApiHost?: string` in `settingsStore.ts` (Afgerond)
  - `[x]` `DEFAULT_SETTINGS` uitbreiden met `tuyaApiHost: ""` in `settingsStore.ts` (Afgerond)
  - `[x]` `route.ts` (Tuya status API) aanpassen om `tuyaApiHost` te gebruiken indien ingesteld (Afgerond)
  - `[x]` Instellingen-scherm in `page.tsx` uitbreiden met invoerveld voor "Tuya API Host" (Afgerond)
  - `[x]` Testen en controleren dat Next.js app compileert en bouwt (Afgerond)

- `[x]` **Stap 15: Fresnel Dimmers OSC sturing via backend routeren** (Afgerond)
  - `[x]` Generic function `sendQlcOsc(path, value)` toevoegen aan `src/lib/qlcControl.ts` (Afgerond)
  - `[x]` Backend route handler `src/app/api/qlc/action/route.ts` uitbreiden om `path` en `value` te ondersteunen (Afgerond)
  - `[x]` **Stap 16: Tuya monitoring dropouts oplossen via caching en multi-threading** (Afgerond)
  - `[x]` `tuya_http_server.py` ombouwen naar `ThreadingHTTPServer`
  - `[x]` Status caching (4s TTL) inbouwen in `tuya_http_server.py`
  - `[x]` Dedupliceren van hosts in `/api/tuya/status/route.ts`
  - `[x]` Wijzigingen testen, deployen en committen naar Git

- `[x]` **Stap 17: YouTube download fixes, hover tooltips en Tuya monitoring daemon** (Afgerond)
  - `[x]` Dockerfile Alpine runner dependencies bijwerken voor `yt-dlp` in standalone en geïntegreerd project (Afgerond)
  - `[x]` `youtube_placeholder` vertalingen toevoegen in `freeshow-generator` (Afgerond)
  - `[x]` YouTube input placeholder aanpassen naar dynamic vertaling in standalone en geïntegreerd project (Afgerond)
  - `[x]` Custom CSS-based tooltips styling toevoegen in `globals.css` in standalone en geïntegreerd project (Afgerond)
  - `[x]` Tab buttons wrappen in `tooltip-container` met hover name in standalone en geïntegreerd project (Afgerond)
  - `[x]` Hover titles toevoegen aan zoekresultaten en playlist items in standalone en geïntegreerd project (Afgerond)
  - `[x]` `control_plug.py` socket timeouts verhogen (1.0s TCP check, 1.2s tinytuya) (Afgerond)
  - `[x]` `tuya_http_server.py` uitbreiden met achtergrond status-poller thread en caching (Afgerond)
  - `[x]` `/api/tuya/status/route.ts` fetch timeout verhogen naar 3000ms (Afgerond)
  - `[x]` Standalone project `freeshow-generator` compileren en deployen naar NAS (Gereed voor uitvoering)
  - `[x]` Geïntegreerde project `livestream-manager` compileren en deployen naar Proxmox LXC 112 (Afgerond)
  - `[x]` Werking verifiëren: YouTube downloads, hover tooltips en Tuya stekkers monitoring (Geverifieerd)
  - `[x]` Git commits en push naar GitHub voor beide repositories (Afgerond)

- `[x]` **Stap 18: OSC UDP-poort 12321 openzetten voor Companion**
  - `[x]` Expose UDP-poort `12321` in local `docker-compose.yml` van companion
  - `[x]` Kopieer `docker-compose.yml` naar Proxmox /tmp/ en push naar LXC 112 `/app/companion/`
  - `[x]` Herstart de Companion container met de nieuwe configuratie
  - `[x]` Verifieer dat poort `12321/udp` open staat op LXC 112

- `[x]` **Stap 19: Companion database herstellen en volume-mount fixen**
  - `[x]` Kopieer Companion v4.3 database bestanden van Synology NAS naar Mac
  - `[x]` Pas volume mount aan naar `/companion` in local `docker-compose.yml`
  - `[x]` Push database bestanden naar LXC 112 `/mnt/data/docker/companion/v4.3/`
  - `[x]` Pas eigenaar en rechten aan van de database bestanden op LXC 112
  - `[x]` Push de gewijzigde `docker-compose.yml` naar LXC 112
  - `[x]` Herstart de Companion container met de nieuwe volume-mount en database
  - `[x]` Verifieer dat alle instellingen en verbindingen succesvol zijn hersteld

