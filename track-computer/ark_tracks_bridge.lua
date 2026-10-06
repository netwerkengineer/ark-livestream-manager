-- Ark Tracks bridge
-- Draait continu in REAPER (gestart via Scripts/__startup.lua) en voert uit wat de
-- REAPER-webinterface zelf niet kan: songs uit ~/Tracks/Songs tonen, een setlist als
-- projecttabs klaarzetten, van song wisselen en muzikaal naar een sectie (region) springen.
--
-- Communicatie (via de webinterface, poort 8080):
--   app -> REAPER: SET/EXTSTATE/ArkTracks/cmd/<id \t opdracht \t arg...>   (urlencoded)
--   REAPER -> app: GET/EXTSTATE/ArkTracks/state  -> JSON
-- Opdrachten:
--   scan                       songmap opnieuw inlezen
--   setlist \t pad1 \t pad2..  songs openen in projecttabs (niet tijdens afspelen)
--   song \t pad                stoppen en naar die song (tab) wisselen, naar het begin
--   jump \t regionId \t modus  modus: end (einde sectie), bar (volgende maat), now (direct)
--   loop \t on|off             huidige sectie herhalen
--   mode \t end|bar|now        standaard sprongmodus (gedeeld door alle schermen)
--   reload                     nieuwe versie van dit script laden
--   sections \t pad            secties (regions) van een song -> ExtState ArkTracks/sections
--   cues \t pad \t tabel       FreeShow-cuetabel van een song opslaan (zie FreeShow-cues)
--   output \t modus            uitgangen: auto | multi | 2ch | 3ch | stereo (zie uitgangen)
--   lead \t tellen             FreeShow-dia's zoveel tellen eerder tonen (0-4)
--   freeshow \t host \t poort  FreeShow REST-API voor de cues (leeg = MIDI)
-- Lange opdrachten mogen in delen komen, zie handlePart.

local SECTION = "ArkTracks"
local SONGS_DIR = (os.getenv("HOME") or "") .. "/Tracks/Songs"
local CMD_NEW_TAB = 40859

local st = {
  v = 1,
  songs = {},
  setlist = {},
  mode = "end",
  loop = nil,      -- region id die herhaald wordt
  pending = nil,   -- region id waar naartoe gesprongen gaat worden
  lastCmd = "",
  error = nil,
}

local smoothSeekCmd = nil
local lastStateWrite = 0
local lastScan = 0

---------------------------------------------------------------- JSON
local function esc(s)
  return (s:gsub('[%c"\\]', function(c)
    if c == '"' then return '\\"' elseif c == "\\" then return "\\\\"
    elseif c == "\n" then return "\\n" elseif c == "\t" then return "\\t"
    else return string.format("\\u%04x", c:byte()) end
  end))
end

local function json(v)
  local t = type(v)
  if t == "nil" then return "null"
  elseif t == "boolean" then return v and "true" or "false"
  elseif t == "number" then return (v ~= v or v == math.huge or v == -math.huge) and "null" or string.format("%.14g", v)
  elseif t == "string" then return '"' .. esc(v) .. '"'
  elseif t == "table" then
    if #v > 0 or next(v) == nil then
      local out = {}
      for i = 1, #v do out[i] = json(v[i]) end
      return "[" .. table.concat(out, ",") .. "]"
    end
    local out = {}
    for k, val in pairs(v) do out[#out + 1] = json(tostring(k)) .. ":" .. json(val) end
    return "{" .. table.concat(out, ",") .. "}"
  end
  return "null"
end

---------------------------------------------------------------- helpers
local function split(s, sep)
  local out = {}
  for part in (s .. sep):gmatch("(.-)" .. sep) do out[#out + 1] = part end
  return out
end

local function basename(path)
  return (path:match("([^/]+)$") or path):gsub("%.[Rr][Pp][Pp]$", "")
end

local function scanSongs()
  local songs = {}
  local function walk(dir, depth)
    if depth > 4 then return end
    local i = 0
    while true do
      local f = reaper.EnumerateFiles(dir, i)
      if not f then break end
      if f:match("%.[Rr][Pp][Pp]$") and not f:upper():find("TEST") then
        songs[#songs + 1] = { name = basename(f), path = dir .. "/" .. f }
      end
      i = i + 1
    end
    i = 0
    while true do
      local d = reaper.EnumerateSubdirectories(dir, i)
      if not d then break end
      walk(dir .. "/" .. d, depth + 1)
      i = i + 1
    end
  end
  reaper.EnumerateFiles(SONGS_DIR, -1) -- bestandscache verversen
  walk(SONGS_DIR, 0)
  table.sort(songs, function(a, b) return a.name:lower() < b.name:lower() end)
  st.songs = songs
  lastScan = reaper.time_precise()
end

local function openProjects()
  local list, i = {}, 0
  while true do
    local proj, fn = reaper.EnumProjects(i)
    if not proj then break end
    list[#list + 1] = { proj = proj, path = fn or "" }
    i = i + 1
  end
  return list
end

local function findOpen(path)
  for _, p in ipairs(openProjects()) do
    if p.path == path then return p.proj end
  end
end

local function isEmptyProject(proj)
  local _, fn = reaper.EnumProjects(-1)
  return (fn == nil or fn == "") and reaper.CountTracks(proj) == 0
end

local function findOrOpen(path)
  local proj = findOpen(path)
  if proj then return proj end
  if not reaper.file_exists(path) then error("Song niet gevonden: " .. path) end
  local cur = reaper.EnumProjects(-1)
  if not isEmptyProject(cur) then reaper.Main_OnCommand(CMD_NEW_TAB, 0) end
  reaper.Main_openProject("noprompt:" .. path)
  return reaper.EnumProjects(-1)
end

local function isPlaying()
  return reaper.GetPlayState() & 1 == 1
end

local function findRegion(id)
  local i = 0
  while true do
    local ret, isrgn, pos, rgnend, name, idx = reaper.EnumProjectMarkers3(0, i)
    if ret == 0 then return nil end
    if isrgn and idx == id then return { id = idx, pos = pos, finish = rgnend, name = name } end
    i = i + 1
  end
end

local function currentRegion()
  local pos = isPlaying() and reaper.GetPlayPosition() or reaper.GetCursorPosition()
  local _, regionIdx = reaper.GetLastMarkerAndCurRegion(0, pos)
  if regionIdx < 0 then return nil end
  local _, _, rpos, rend, name, id = reaper.EnumProjectMarkers3(0, regionIdx)
  return { id = id, pos = rpos, finish = rend, name = name }
end

local function findSmoothSeekCmd()
  local section = reaper.SectionFromUniqueID(0)
  local i = 0
  while true do
    local id, name = reaper.kbd_enumerateActions(section, i)
    if not id or id <= 0 then break end
    if name and name:find("Toggle smooth seek", 1, true) then return id end
    i = i + 1
  end
end

local function setSmoothSeek(on)
  if not smoothSeekCmd then return end
  local cur = reaper.GetToggleCommandState(smoothSeekCmd) == 1
  if cur ~= on then reaper.Main_OnCommand(smoothSeekCmd, 0) end
end

local onLoopStopped = function() end -- wordt hieronder door de dynamische guide ingevuld

local function stopLoop()
  if st.loop then
    reaper.GetSetRepeat(0)
    st.loop = nil
    onLoopStopped()
  end
end

---------------------------------------------------------------- dynamische guide
-- De gesproken cues in de Guide-track ("Verse 2", "Chorus") volgen de originele
-- volgorde. Bij een sprong of loop wordt de guide daarom in de laatste 2 maten voor
-- het sprongmoment gedempt en speelt REAPER daar de 2 maten guide die origineel vóór
-- de doelsectie staan: dezelfde stem, op de tijdlijn en dus sample-nauwkeurig.
-- Daarna wordt alles teruggezet.
local GUIDE_QN = 8   -- 2 maten 4/4
local SAFETY = 0.3   -- seconden marge voor de afspeelbuffer van REAPER
local guide = nil    -- { track, cue, muted = {items}, keep }

local function findGuideTrack()
  for i = 0, reaper.CountTracks(0) - 1 do
    local tr = reaper.GetTrack(0, i)
    local _, name = reaper.GetTrackName(tr)
    if name:lower():match("^guide") and not name:find("->", 1, true) then return tr end
  end
end

local function itemAt(track, t)
  for i = 0, reaper.CountTrackMediaItems(track) - 1 do
    local it = reaper.GetTrackMediaItem(track, i)
    if not (guide and it == guide.cue) then
      local pos = reaper.GetMediaItemInfo_Value(it, "D_POSITION")
      local len = reaper.GetMediaItemInfo_Value(it, "D_LENGTH")
      if t >= pos and t < pos + len then return it, pos end
    end
  end
end

local function noFades(it)
  for _, k in ipairs({ "D_FADEINLEN", "D_FADEOUTLEN", "D_FADEINLEN_AUTO", "D_FADEOUTLEN_AUTO" }) do
    reaper.SetMediaItemInfo_Value(it, k, 0)
  end
end

-- Splitsen op dezelfde bron is naadloos; de stukken blijven daarna gewoon staan.
local function splitAt(track, t)
  local it, pos = itemAt(track, t)
  if not it or math.abs(t - pos) < 0.0005 then return end
  local right = reaper.SplitMediaItem(it, t)
  if right then noFades(it); noFades(right) end
end

local function restoreGuide()
  if not guide then return end
  if reaper.ValidatePtr2(0, guide.track, "MediaTrack*") then
    if guide.cue and reaper.ValidatePtr2(0, guide.cue, "MediaItem*") then
      reaper.DeleteTrackMediaItem(guide.track, guide.cue)
    end
    for _, it in ipairs(guide.muted) do
      if reaper.ValidatePtr2(0, it, "MediaItem*") then reaper.SetMediaItemInfo_Value(it, "B_MUTE", 0) end
    end
  end
  guide = nil
  reaper.UpdateArrange()
end

-- boundary: tijdstip waarop de nieuwe sectie gaat klinken
-- target:   de region die dan begint (zijn originele aankondiging wordt gebruikt)
local function prepareGuide(boundary, target, keep)
  restoreGuide()
  local track = findGuideTrack()
  if not track then return end
  local now = isPlaying() and reaper.GetPlayPosition() or reaper.GetCursorPosition()
  local ws = reaper.TimeMap2_QNToTime(0, reaper.TimeMap2_timeToQN(0, boundary) - GUIDE_QN)
  if ws < now + SAFETY then
    -- te laat voor de hele cue: vanaf de eerstvolgende tel
    ws = reaper.TimeMap2_QNToTime(0, math.ceil(reaper.TimeMap2_timeToQN(0, now + SAFETY)))
  end
  if ws >= boundary - 0.01 then return end
  local len = boundary - ws
  guide = { track = track, muted = {}, keep = keep }

  -- origineel dempen in [ws, boundary]
  splitAt(track, ws)
  splitAt(track, boundary)
  for i = 0, reaper.CountTrackMediaItems(track) - 1 do
    local it = reaper.GetTrackMediaItem(track, i)
    local pos = reaper.GetMediaItemInfo_Value(it, "D_POSITION")
    if pos >= ws - 0.0005 and pos < boundary - 0.0005 and reaper.GetMediaItemInfo_Value(it, "B_MUTE") == 0 then
      reaper.SetMediaItemInfo_Value(it, "B_MUTE", 1)
      guide.muted[#guide.muted + 1] = it
    end
  end

  -- de originele aankondiging van de doelsectie ervoor in de plaats (minstens 1 tel,
  -- anders alleen dempen: liever even stil dan een halve of verkeerde cue)
  local beat = reaper.TimeMap2_QNToTime(0, reaper.TimeMap2_timeToQN(0, boundary)) -
               reaper.TimeMap2_QNToTime(0, reaper.TimeMap2_timeToQN(0, boundary) - 1)
  local srcStart = target.pos - len
  local src, srcPos = itemAt(track, srcStart)
  if len >= beat * 0.9 and srcStart >= 0 and src then
    local take = reaper.GetActiveTake(src)
    local file = reaper.GetMediaSourceFileName(reaper.GetMediaItemTake_Source(take), "")
    local cue = reaper.AddMediaItemToTrack(track)
    local cueTake = reaper.AddTakeToMediaItem(cue)
    reaper.SetMediaItemTake_Source(cueTake, reaper.PCM_Source_CreateFromFile(file))
    reaper.SetMediaItemTakeInfo_Value(cueTake, "D_STARTOFFS", reaper.GetMediaItemTakeInfo_Value(take, "D_STARTOFFS") + (srcStart - srcPos))
    reaper.SetMediaItemTakeInfo_Value(cueTake, "D_VOL", reaper.GetMediaItemTakeInfo_Value(take, "D_VOL"))
    reaper.SetMediaItemInfo_Value(cue, "D_POSITION", ws)
    reaper.SetMediaItemInfo_Value(cue, "D_LENGTH", len)
    reaper.SetMediaItemInfo_Value(cue, "D_VOL", reaper.GetMediaItemInfo_Value(src, "D_VOL"))
    noFades(cue)
    guide.cue = cue
  end
  reaper.UpdateArrange()
end

onLoopStopped = restoreGuide

---------------------------------------------------------------- uitgangen
-- De projecten sturen elke bus naar een eigen uitgang (Out 1-8 -> X32). De gekozen
-- uitgangsmodus (instelling in de app, hier onthouden) bepaalt wat er echt gebeurt:
--   multi  : elke bus naar zijn eigen uitgang (X32, 8 kanalen)
--   2ch    : Click + Guide mono naar uitgang 1, alle andere bussen mono naar uitgang 2
--   3ch    : Click + Guide mono naar uitgang 1, de tracks in stereo naar uitgang 2 + 3
--   (2ch en 3ch: Click + Guide 3 dB zachter, anders pieken ze samen bijna op 0 dBFS)
--   stereo : alles naar de stereo-master (testen via speakers)
--   auto   : multi als het audioapparaat genoeg uitgangen heeft, anders stereo
-- Dit wordt bij elke song- en apparaatwissel opnieuw gezet, dus het klopt ook als een
-- project in een andere stand is opgeslagen.
local OUTPUT_MODES = { auto = true, multi = true, ["2ch"] = true, ["3ch"] = true, stereo = true }
local outputMode = reaper.GetExtState(SECTION, "outputMode")
if not OUTPUT_MODES[outputMode] then outputMode = "auto" end
local routing = { proj = nil, applied = nil, outs = nil, checked = 0, force = false }

local function busTracks()
  local list, maxOut = {}, 0
  for i = 0, reaper.CountTracks(0) - 1 do
    local tr = reaper.GetTrack(0, i)
    local _, name = reaper.GetTrackName(tr)
    local out = tonumber(name:match("%->%s*Out%s*(%d+)%s*$"))
    if out then
      list[#list + 1] = { track = tr, out = out, monitor = name:upper():match("^%s*CLICK") or name:upper():match("^%s*GUIDE") }
      if out > maxOut then maxOut = out end
    end
  end
  return list, maxOut
end

local function applyRouting()
  local now = reaper.time_precise()
  local proj = reaper.EnumProjects(-1)
  local outs = reaper.GetNumAudioOutputs()
  if not routing.force and proj == routing.proj and outs == routing.outs and now - routing.checked < 2 then return end
  routing.checked = now
  -- Zonder draaiende audio meldt REAPER 0 uitgangen: dan niets veranderen
  if outs <= 0 or reaper.Audio_IsRunning() == 0 then return end
  local busses, maxOut = busTracks()
  if #busses == 0 then routing.proj, routing.outs, routing.applied = proj, outs, nil return end
  local how = outputMode
  if how == "auto" then how = outs < maxOut and "stereo" or "multi" end
  if how == "3ch" and outs < 3 then how = outs >= 2 and "2ch" or "stereo" end
  if how == "2ch" and outs < 2 then how = "stereo" end
  if not routing.force and proj == routing.proj and outs == routing.outs and how == routing.applied then return end
  for _, b in ipairs(busses) do
    reaper.SetMediaTrackInfo_Value(b.track, "B_MAINSEND", how == "stereo" and 1 or 0)
    local dst, flag = b.out - 1, 1024 -- 1024 = mono, zonder = stereopaar
    if how == "2ch" then dst = b.monitor and 0 or 1 end
    if how == "3ch" then
      if b.monitor then dst = 0 else dst, flag = 1, 0 end
    end
    local vol = (b.monitor and (how == "2ch" or how == "3ch")) and 0.7079 or 1 -- -3 dB
    for s = 0, reaper.GetTrackNumSends(b.track, 1) - 1 do
      reaper.SetTrackSendInfo_Value(b.track, 1, s, "B_MUTE", how == "stereo" and 1 or 0)
      reaper.SetTrackSendInfo_Value(b.track, 1, s, "I_DSTCHAN", flag + dst)
      reaper.SetTrackSendInfo_Value(b.track, 1, s, "D_VOL", vol)
    end
  end
  reaper.SetMediaTrackInfo_Value(reaper.GetMasterTrack(0), "B_MUTE", how == "stereo" and 0 or 1)
  routing.proj, routing.outs, routing.applied, routing.force = proj, outs, how, false
end

---------------------------------------------------------------- FreeShow-cues
-- Per song maakt de app een cuetabel (naast het project: <song>.RPP.cues): per region de
-- dia's van de "Tracks"-layout in FreeShow. Daaruit maakt de bridge in de track
-- "FreeShow cues" een leeg blok per dia, met het dianummer en de eerste regel tekst erop.
-- Die blokken zijn de bron: schuif ze in REAPER naar het juiste moment en sla het project
-- op. Tijdens het afspelen stuurt de bridge zelf de MIDI-cues (uitgang, kanaal en noot
-- zoals de FreeShow MIDI-track, die zelf gedempt is). Bij een sprong of loop komt de
-- eerste dia van waar het naartoe gaat. Nieuwe blokken worden alleen gemaakt als de
-- cuetabel verandert (tekst opnieuw gekoppeld of aangepast) - dat overschrijft het
-- handmatige schuiven voor dat nummer.
--
-- cuetabel: regel "regionId dia@gewicht[@tel][#tekst] ...": gewicht = tekstlengte
-- (voor de schatting), tel = opgenomen moment in kwartnoten vanaf het sectiebegin,
-- tekst = eerste regel van de dia (spatie = +, %XX voor , ; # % + en spatie-achtigen).
local CUES_VERSION = "ark-cues 4"
-- Geschatte dia's zoveel tellen eerder (instelling in de app, hier onthouden)
local LEAD_QN = tonumber(reaper.GetExtState(SECTION, "leadBeats")) or 2
local CUE_TRACK = "FreeShow cues"
local cues = { path = false, regions = nil, sum = nil, target = nil, sent = nil, timeline = nil, hash = nil }

-- FreeShow REST-API (Instellingen in FreeShow: REST Listener, standaard poort 5506). Met
-- een show-ID per cue toont FreeShow altijd de dia van het juiste nummer, ook als er een
-- ander nummer open staat (overslaan, herhalen). Zonder REST: MIDI zoals voorheen.
local freeshow = { host = reaper.GetExtState(SECTION, "fsHost"), port = tonumber(reaper.GetExtState(SECTION, "fsPort")) }

local function freeshowCall(action, data)
  if not freeshow.host or freeshow.host == "" or not freeshow.port then return false end
  local url = string.format("http://%s:%d/", freeshow.host, freeshow.port)
  -- op de achtergrond, zodat REAPER niet wacht op het netwerk
  os.execute(string.format("curl -s -m 2 -G %q --data-urlencode %q --data-urlencode %q >/dev/null 2>&1 &",
    url, "action=" .. action, "data=" .. data))
  return true
end

local function decodeText(s)
  return (s:gsub("%+", " "):gsub("%%(%x%x)", function(h) return string.char(tonumber(h, 16)) end))
end

local function checksum(s)
  local a, b = 1, 0
  for i = 1, #s do
    a = (a + s:byte(i)) % 65521
    b = (b + a) % 65521
  end
  return tostring(b * 65536 + a)
end

local function readCues(path)
  local f = io.open(path .. ".cues", "r")
  if not f then return nil end
  local content = f:read("a")
  f:close()
  local version = content:match("^([^\n]*)")
  if not version:match("^ark%-cues [1234]$") then return nil end
  local regions, show = {}, nil
  for line in content:gmatch("[^\n]+") do
    local sid, lid = line:match("^show%s+(%S+)%s*(%S*)")
    if sid then show = { id = sid, layout = lid ~= "" and lid or nil } end
    local id, rest = line:match("^(%d+)%s*(.*)$")
    if id then
      local list = {}
      for token in rest:gmatch("%S+") do
        local n, w, q, text = token:match("^(%d+)@?(%d*)@?([%d%.]*)#?(.*)$")
        if n then
          list[#list + 1] = { n = tonumber(n), w = math.max(1, tonumber(w) or 1), q = tonumber(q), text = decodeText(text or "") }
        end
      end
      regions[tonumber(id)] = list
    end
  end
  -- De showregel telt niet mee: die verandert de dia's in REAPER niet (zo blijven
  -- verschoven blokken staan als alleen de showregel erbij komt)
  return regions, checksum((content:gsub("\nshow [^\n]*", ""))), show
end

-- MIDI-uitgang van de FreeShow MIDI-track (I_MIDIHWOUT = apparaat*32 + kanaal) en
-- kanaal/noot van de eerste noot in die track.
local function cueTarget()
  for i = 0, reaper.CountTracks(0) - 1 do
    local tr = reaper.GetTrack(0, i)
    local _, name = reaper.GetTrackName(tr)
    if name == "FreeShow MIDI" then
      local hw = math.floor(reaper.GetMediaTrackInfo_Value(tr, "I_MIDIHWOUT"))
      if hw < 0 then return nil end
      local target = { track = tr, device = hw >> 5, channel = 4, note = 0 }
      local item = reaper.GetTrackMediaItem(tr, 0)
      local take = item and reaper.GetActiveTake(item)
      if take and reaper.TakeIsMIDI(take) then
        target.take = take
        local ok, _, _, _, _, chan, pitch = reaper.MIDI_GetNote(take, 0)
        if ok then target.channel, target.note = chan, pitch end
      end
      return target
    end
  end
end

local function regionAt(pos)
  local _, regionIdx = reaper.GetLastMarkerAndCurRegion(0, pos)
  if regionIdx < 0 then return nil end
  local _, _, rs, re, _, id = reaper.EnumProjectMarkers3(0, regionIdx)
  return id, rs, re
end

local function leadSeconds(pos)
  return pos - reaper.TimeMap2_QNToTime(0, reaper.TimeMap2_timeToQN(0, pos) - LEAD_QN)
end

-- De track met de dia-blokken (wordt aangemaakt onder de FreeShow MIDI-track)
local function cueTrack(create)
  for i = 0, reaper.CountTracks(0) - 1 do
    local tr = reaper.GetTrack(0, i)
    local _, name = reaper.GetTrackName(tr)
    if name == CUE_TRACK then return tr end
  end
  if not create then return nil end
  local idx = cues.target and math.floor(reaper.GetMediaTrackInfo_Value(cues.target.track, "IP_TRACKNUMBER")) or 0
  reaper.InsertTrackAtIndex(idx, false)
  local tr = reaper.GetTrack(0, idx)
  reaper.GetSetMediaTrackInfo_String(tr, "P_NAME", CUE_TRACK, true)
  reaper.SetMediaTrackInfo_Value(tr, "I_CUSTOMCOLOR", reaper.ColorToNative(234, 179, 8) | 0x1000000)
  reaper.SetMediaTrackInfo_Value(tr, "I_HEIGHTOVERRIDE", 60)
  return tr
end

-- Elk blok loopt tot het volgende, zodat je de tekst ziet staan zolang de dia in beeld is
local function fixLengths(tr)
  local items = {}
  for i = 0, reaper.CountTrackMediaItems(tr) - 1 do items[#items + 1] = reaper.GetTrackMediaItem(tr, i) end
  table.sort(items, function(a, b) return reaper.GetMediaItemInfo_Value(a, "D_POSITION") < reaper.GetMediaItemInfo_Value(b, "D_POSITION") end)
  for k, it in ipairs(items) do
    local pos = reaper.GetMediaItemInfo_Value(it, "D_POSITION")
    local nextPos = items[k + 1] and reaper.GetMediaItemInfo_Value(items[k + 1], "D_POSITION") or pos + 4
    reaper.SetMediaItemInfo_Value(it, "D_LENGTH", math.max(0.1, nextPos - pos))
  end
end

-- Blokken maken uit de cuetabel: de eerste dia van een sectie LEAD_QN tellen voor het
-- begin, de rest op het opgenomen moment of naar verhouding van de tekstlengte.
local function generateCueItems()
  -- Oude noten/teksten van een eerdere versie uit de FreeShow MIDI-track halen
  local take = cues.target and cues.target.take
  if take and reaper.ValidatePtr2(0, take, "MediaItem_Take*") then
    local _, notes, _, texts = reaper.MIDI_CountEvts(take)
    for i = notes - 1, 0, -1 do reaper.MIDI_DeleteNote(take, i) end
    for i = texts - 1, 0, -1 do reaper.MIDI_DeleteTextSysexEvt(take, i) end
  end
  local tr = cueTrack(true)
  for i = reaper.CountTrackMediaItems(tr) - 1, 0, -1 do
    reaper.DeleteTrackMediaItem(tr, reaper.GetTrackMediaItem(tr, i))
  end
  local i = 0
  while true do
    local ret, isrgn, rs, re, _, id = reaper.EnumProjectMarkers3(0, i)
    if ret == 0 then break end
    local list = isrgn and cues.regions[id]
    if list and #list > 0 then
      local qs = reaper.TimeMap2_timeToQN(0, rs)
      local len = reaper.TimeMap2_timeToQN(0, re) - qs
      local total = 0
      for _, s in ipairs(list) do total = total + s.w end
      -- Opgenomen momenten alleen gebruiken als ze kloppen: oplopend en binnen de sectie
      local useRecorded, last = true, 0
      for k = 2, #list do
        local q = list[k].q
        if q then
          if q <= last or q >= len - 0.25 then useRecorded = false end
          last = q
        end
      end
      local acc, prev = 0, nil
      for k, s in ipairs(list) do
        local qn
        if k == 1 then qn = qs - LEAD_QN
        elseif s.q and useRecorded then qn = qs + s.q
        else qn = qs + math.floor(acc / total * len + 0.5) - LEAD_QN end
        -- altijd in volgorde, ook als een opname dat niet was
        if prev and qn < prev + 0.25 then qn = math.min(prev + 0.5, qs + len - 0.25) end
        prev = qn
        acc = acc + s.w
        local it = reaper.AddMediaItemToTrack(tr)
        reaper.SetMediaItemInfo_Value(it, "D_POSITION", reaper.TimeMap2_QNToTime(0, math.max(0, qn)))
        reaper.SetMediaItemInfo_Value(it, "D_LENGTH", 1)
        reaper.GetSetMediaItemInfo_String(it, "P_NOTES", s.n .. "  " .. (s.text ~= "" and s.text or "(leeg)"), true)
        reaper.GetSetMediaItemInfo_String(it, "P_EXT:arkslide", tostring(s.n), true)
      end
    end
    i = i + 1
  end
  fixLengths(tr)
  reaper.GetSetMediaTrackInfo_String(tr, "P_EXT:arkcues", cues.sum, true)
  reaper.UpdateArrange()
end

-- Tijdlijn uit de blokken (tijd, dia, blok), opnieuw gelezen als ze verschoven zijn
local function readTimeline()
  local tr = cueTrack(false)
  if not tr then cues.timeline = nil return end
  local n = reaper.CountTrackMediaItems(tr)
  local sig = tostring(n)
  for i = 0, n - 1 do sig = sig .. ":" .. reaper.GetMediaItemInfo_Value(reaper.GetTrackMediaItem(tr, i), "D_POSITION") end
  if sig == cues.hash and cues.timeline then return end
  cues.hash = sig
  local list = {}
  for i = 0, n - 1 do
    local it = reaper.GetTrackMediaItem(tr, i)
    local _, ext = reaper.GetSetMediaItemInfo_String(it, "P_EXT:arkslide", "", false)
    local _, notes = reaper.GetSetMediaItemInfo_String(it, "P_NOTES", "", false)
    local slide = tonumber(ext) or tonumber(notes:match("^%s*(%d+)"))
    if slide and reaper.GetMediaItemInfo_Value(it, "B_MUTE") == 0 then
      list[#list + 1] = { t = reaper.GetMediaItemInfo_Value(it, "D_POSITION"), n = slide, item = it }
    end
  end
  table.sort(list, function(a, b) return a.t < b.t end)
  cues.timeline = list
end

local function slideAtTime(pos)
  local pick
  for _, e in ipairs(cues.timeline or {}) do
    if e.t <= pos + 0.001 then pick = e.n else break end
  end
  return pick
end

-- Noten van een sectie: vanaf LEAD_QN voor het begin tot het einde
local function regionNotes(id)
  local r = id and findRegion(id)
  if not r then return {} end
  local from = r.pos - leadSeconds(r.pos) - 0.05
  local out = {}
  for _, e in ipairs(cues.timeline or {}) do
    if e.t >= from and e.t < r.finish then out[#out + 1] = e end
  end
  return out, r
end

local function firstSlideOf(id)
  local notes = regionNotes(id)
  if notes[1] then return notes[1].n end
  local list = cues.regions[id]
  return list and list[1] and list[1].n or nil
end

-- Timing opnemen: de dia's binnen een sectie gaan alleen verder op een tik; elke tik
-- verschuift de noot van die dia naar het getikte moment. Het begin gaat vanzelf.
local rec = nil -- { region = id, idx = n, taps = { [regionId] = { [idx] = tel } } }

local function recordedSlide(id)
  local notes = regionNotes(id)
  if not notes[1] then return nil end
  if rec.region ~= id then rec.region, rec.idx = id, 1 end
  return notes[math.min(rec.idx, #notes)].n
end

local function slideAt(pos, playing)
  if not playing then return slideAtTime(pos) end
  local id, _, re = regionAt(pos)
  local look = reaper.TimeMap2_QNToTime(0, reaper.TimeMap2_timeToQN(0, pos) + LEAD_QN)
  local target
  if st.pending and st.pendingAt and look >= st.pendingAt then
    target = st.pending
  elseif id and st.loop == id and look >= re then
    target = id
  end
  if rec then return recordedSlide(target or regionAt(look)) end
  if target then return firstSlideOf(target) end
  return slideAtTime(pos)
end

local function updateCues()
  local _, path = reaper.EnumProjects(-1)
  path = path or ""
  if path ~= cues.path then
    cues.path = path
    cues.regions, cues.sum, cues.show = nil, nil, nil
    if path ~= "" then cues.regions, cues.sum, cues.show = readCues(path) end
    cues.target = cueTarget()
    cues.sent, cues.timeline, cues.hash = nil, nil, nil
    if cues.target then
      local mute = cues.regions and 1 or 0
      if reaper.GetMediaTrackInfo_Value(cues.target.track, "B_MUTE") ~= mute then
        reaper.SetMediaTrackInfo_Value(cues.target.track, "B_MUTE", mute)
      end
      -- Ander nummer: in FreeShow meteen de show van dit nummer openen
      if cues.show then freeshowCall("id_select_show", string.format('{"id":"%s"}', cues.show.id)) end
      -- Nieuwe of gewijzigde cuetabel: blokken opnieuw maken
      if cues.regions then
        local tr = cueTrack(false)
        local stored = ""
        if tr then _, stored = reaper.GetSetMediaTrackInfo_String(tr, "P_EXT:arkcues", "", false) end
        if stored ~= cues.sum then generateCueItems() end
      end
    end
  end
  if not cues.regions or not cues.target then return end
  readTimeline()
  local playing = isPlaying()
  -- Bij starten altijd de juiste dia opnieuw sturen (iemand kan in FreeShow geklikt
  -- hebben). Stilstaand alleen na een eigen keuze (song, sectie), niet wanneer REAPER
  -- bij stoppen terugspringt naar waar het begon.
  if playing ~= cues.wasPlaying then
    cues.wasPlaying = playing
    if playing then cues.sent = nil end
  end
  if not playing and not st.cueWhenStopped then return end
  local slide = slideAt(playing and reaper.GetPlayPosition() or reaper.GetCursorPosition(), playing)
  if slide and slide ~= cues.sent and slide >= 1 then
    local sentRest = cues.show and freeshowCall("index_select_slide", string.format(
      '{"showId":"%s",%s"index":%d}', cues.show.id, cues.show.layout and ('"layoutId":"' .. cues.show.layout .. '",') or "", slide))
    if not sentRest and slide <= 127 then
      local t = cues.target
      reaper.StuffMIDIMessage(16 + t.device, 0x90 + t.channel, t.note, slide)
      reaper.StuffMIDIMessage(16 + t.device, 0x80 + t.channel, t.note, 0)
    end
    cues.sent = slide
  end
  if not playing and slide then st.cueWhenStopped = false end
end

-- Regions uit een projectbestand lezen zonder het te openen
local function readSections(path)
  local f = io.open(path, "r")
  if not f then error("Project niet gevonden: " .. path) end
  local byId, list = {}, {}
  for line in f:lines() do
    local id, pos, q, name, flags = line:match("^%s*MARKER%s+(%d+)%s+([%-%d%.]+)%s+([\"'])(.-)%3%s+(%d+)")
    if id and (tonumber(flags) & 1) == 1 then
      id = tonumber(id)
      if name ~= "" and not byId[id] then
        byId[id] = { id = id, name = name, start = tonumber(pos) }
        list[#list + 1] = byId[id]
      elseif name == "" and byId[id] then
        byId[id].finish = tonumber(pos)
      end
    end
  end
  f:close()
  table.sort(list, function(a, b) return a.start < b.start end)
  return list
end

---------------------------------------------------------------- commands
local handlers = {}

-- Uitgangsmodus (auto | multi | 2ch | 3ch | stereo), blijft bewaard na een herstart
function handlers.output(mode)
  if not OUTPUT_MODES[mode] then error("Onbekende uitgangsmodus") end
  outputMode = mode
  reaper.SetExtState(SECTION, "outputMode", mode, true)
  routing.force = true
end

-- Timing opnemen: start | save | cancel. "save" zet de tikken per sectienaam in
-- ExtState ArkTracks/taps (de app slaat ze op en maakt de cuetabel opnieuw).
function handlers.record(action)
  if action == "start" then
    rec = { region = nil, idx = 1, taps = {} }
    cues.sent = nil
  elseif action == "save" then
    if not rec then error("Er wordt geen timing opgenomen") end
    local sections = {}
    for regionId, taps in pairs(rec.taps) do
      local r = findRegion(regionId)
      if r then
        local list = {}
        for idx, q in pairs(taps) do list[#list + 1] = { idx, q } end
        sections[r.name] = list
      end
    end
    reaper.SetExtState(SECTION, "taps", json({ path = cues.path or "", sections = sections }), false)
    reaper.Main_SaveProject(0, false) -- verschoven blokken bewaren
    rec = nil
    cues.sent = nil
  else
    rec = nil
    cues.sent = nil
  end
end

-- Tik tijdens het opnemen: volgende dia van de sectie, moment vastleggen. pos = de
-- afspeelpositie zoals de app die schatte op het moment van tikken (netwerkvertraging).
function handlers.tap(pos)
  if not rec then error("Er wordt geen timing opgenomen") end
  local p = tonumber(pos) or reaper.GetPlayPosition()
  -- De tik hoort bij de sectie waarvan de dia nu in beeld is (die kan al de volgende
  -- zijn: het begin van een sectie komt een paar tellen eerder)
  local id = rec.region or regionAt(p)
  local notes, r = regionNotes(id)
  if #notes == 0 or not r then return end
  if rec.idx >= #notes then return end
  local qs = reaper.TimeMap2_timeToQN(0, r.pos)
  local len = reaper.TimeMap2_timeToQN(0, r.finish) - qs
  local q = math.floor((reaper.TimeMap2_timeToQN(0, p) - qs) * 4 + 0.5) / 4
  local prevQ = rec.taps[id] and rec.taps[id][rec.idx]
  q = math.max(q, (prevQ or 0) + 0.5, 0.25)
  q = math.min(q, len - 0.5)
  rec.idx = rec.idx + 1
  local rs = r.pos
  rec.taps[id] = rec.taps[id] or {}
  rec.taps[id][rec.idx] = q
  -- het blok van deze dia naar het getikte moment
  local note = notes[rec.idx]
  reaper.SetMediaItemInfo_Value(note.item, "D_POSITION", reaper.TimeMap2_QNToTime(0, reaper.TimeMap2_timeToQN(0, rs) + q))
  fixLengths(cueTrack(false))
  reaper.UpdateArrange()
  cues.hash = nil
end

-- Dia-blokken van de actieve song opnieuw maken uit de cuetabel (zet handmatig
-- verschoven blokken terug naar de schatting/opname)
function handlers.regen()
  if not cues.regions then error("Geen cuetabel voor deze song") end
  generateCueItems()
  cues.hash = nil
end

-- De dia-blokken van de actieve song -> ExtState ArkTracks/notes (tijd, dia)
function handlers.notes()
  readTimeline()
  local out = {}
  for _, e in ipairs(cues.timeline or {}) do out[#out + 1] = { t = e.t, n = e.n } end
  reaper.SetExtState(SECTION, "notes", json({ path = cues.path or "", notes = out }), false)
end

-- FreeShow REST-adres (host, poort), blijft bewaard na een herstart; leeg = alleen MIDI
function handlers.freeshow(host, port)
  freeshow.host, freeshow.port = host or "", tonumber(port)
  reaper.SetExtState(SECTION, "fsHost", freeshow.host, true)
  reaper.SetExtState(SECTION, "fsPort", tostring(port or ""), true)
end

-- Hoeveel tellen dia's eerder komen (0-4), blijft bewaard na een herstart
function handlers.lead(beats)
  local n = tonumber(beats)
  if not n or n < 0 or n > 4 then error("Ongeldige voorlooptijd") end
  LEAD_QN = n
  reaper.SetExtState(SECTION, "leadBeats", tostring(n), true)
end

-- Secties van een song (ook als hij niet open is) -> ExtState ArkTracks/sections
function handlers.sections(path)
  reaper.SetExtState(SECTION, "sections", json({ path = path, sections = readSections(path) }), false)
end

-- Cuetabel opslaan: "regionId:dia,dia;regionId:dia;..." (leeg = cues uit voor deze song)
function handlers.cues(path, data)
  if not path:match("%.[Rr][Pp][Pp]$") or not reaper.file_exists(path) then error("Project niet gevonden") end
  if (data or "") == "" then
    os.remove(path .. ".cues")
  else
    local f = assert(io.open(path .. ".cues", "w"))
    f:write(CUES_VERSION, "\n")
    for entry in data:gmatch("[^;]+") do
      local sid, lid = entry:match("^show:([%w]+)@?([%w]*)$")
      if sid then f:write("show ", sid, " ", lid, "\n") end
      local id, slides = entry:match("^(%d+):([^%s;]*)$")
      if id then f:write(id, " ", (slides:gsub(",", " ")), "\n") end
    end
    f:close()
  end
  if path == cues.path then cues.path = false end -- opnieuw inlezen
end

function handlers.songcancel()
  local p = st.pendingSong
  st.pendingSong = nil
  if p and p.saved then
    for _, s in ipairs(p.saved) do
      if reaper.ValidatePtr2(0, s.track, "MediaTrack*") then reaper.SetMediaTrackInfo_Value(s.track, "D_VOL", s.vol) end
    end
  end
end

function handlers.scan() scanSongs() end

-- Nieuwe versie van dit script laden zonder REAPER te herstarten
local reloadRequested = false
function handlers.reload()
  restoreGuide()
  reloadRequested = true
end

function handlers.mode(m)
  if m == "end" or m == "bar" or m == "now" then st.mode = m end
end

function handlers.setlist(...)
  if isPlaying() then error("Setlist laden kan niet tijdens afspelen") end
  restoreGuide()
  local active = reaper.EnumProjects(-1)
  local paths = { ... }
  for _, path in ipairs(paths) do
    if path ~= "" then findOrOpen(path) end
  end
  st.setlist = paths
  reaper.SetExtState(SECTION, "setlist", table.concat(paths, "\n"), true)
  -- Terug naar de song die al actief was als die in de setlist staat, anders de eerste
  local keep = false
  for _, path in ipairs(paths) do
    if findOpen(path) == active then keep = true end
  end
  if keep then reaper.SelectProjectInstance(active)
  elseif paths[1] then reaper.SelectProjectInstance(findOpen(paths[1])) end
end

-- Een opnieuw gemaakt project opnieuw inladen (in zijn eigen tab), zonder vragen
function handlers.reopen(path)
  local proj = findOpen(path)
  if not proj then return end
  restoreGuide()
  reaper.OnStopButtonEx(proj)
  reaper.SelectProjectInstance(proj)
  reaper.Main_openProject("noprompt:" .. path)
  cues.path = false
end

-- Ander nummer kiezen. Speelt er iets en is er een modus (end | bar | now), dan wordt
-- er op dat muzikale moment overgegaan: het huidige nummer fadet kort uit (REAPER kan
-- niet sample-nauwkeurig tussen projecten wisselen) en het nieuwe start vanaf zijn
-- Count Off. Zonder modus of als er niets speelt: stoppen en klaarzetten.
function handlers.song(path, mode)
  local _, current = reaper.EnumProjects(-1)
  if isPlaying() and mode and mode ~= "" and path ~= current then
    if not findOpen(path) then error("Dit nummer staat nog niet klaar in REAPER (setlist klaarzetten)") end
    local pos = reaper.GetPlayPosition()
    local at
    if mode == "end" then
      local cur = currentRegion()
      at = cur and cur.finish or pos + 0.3
      stopLoop() -- anders komt het einde van de sectie nooit
    elseif mode == "bar" then
      local _, measure = reaper.TimeMap2_timeToBeats(0, pos)
      at = reaper.TimeMap2_beatsToTime(0, 0, measure + 1)
    else
      at = pos + 0.35
    end
    -- uitfaden over (maximaal) één tel voor het overgangsmoment
    local beat = reaper.TimeMap2_QNToTime(0, reaper.TimeMap2_timeToQN(0, at)) - reaper.TimeMap2_QNToTime(0, reaper.TimeMap2_timeToQN(0, at) - 1)
    local fade = math.min(beat, mode == "now" and 0.3 or 0.6)
    st.pendingSong = { path = path, at = at, fadeFrom = math.max(pos, at - fade) }
    return
  end
  st.pendingSong = nil
  reaper.OnStopButtonEx(0)
  stopLoop()
  restoreGuide()
  st.pending = nil
  local proj = findOrOpen(path)
  reaper.SelectProjectInstance(proj)
  reaper.SetEditCurPos2(proj, 0, true, false)
  st.cueWhenStopped = true
end

function handlers.jump(id, mode)
  local region = findRegion(tonumber(id))
  if not region then error("Sectie niet gevonden") end
  mode = mode or st.mode
  stopLoop()
  restoreGuide()
  st.jumpFrom = (currentRegion() or {}).id
  if not isPlaying() or mode == "now" then
    local was = smoothSeekCmd and reaper.GetToggleCommandState(smoothSeekCmd) == 1
    setSmoothSeek(false)
    reaper.SetEditCurPos(region.pos, true, true)
    if was then setSmoothSeek(true) end
    st.pending = nil
    st.cueWhenStopped = true
  elseif mode == "bar" then
    setSmoothSeek(true)
    local _, measure = reaper.TimeMap2_timeToBeats(0, reaper.GetPlayPosition())
    st.pendingAt = reaper.TimeMap2_beatsToTime(0, 0, measure + 1)
    prepareGuide(st.pendingAt, region, false)
    reaper.SetEditCurPos(region.pos, true, true)
    st.pending = region.id
  else
    local cur = currentRegion()
    st.pendingAt = cur and cur.finish or nil
    if cur then prepareGuide(cur.finish, region, false) end
    reaper.GoToRegion(0, region.id, false)
    st.pending = region.id
  end
end

function handlers.loop(onoff)
  if onoff == "on" then
    local region = currentRegion()
    if not region then error("Geen sectie op de huidige positie") end
    reaper.GetSet_LoopTimeRange2(0, true, true, region.pos, region.finish, false)
    reaper.GetSetRepeat(1)
    st.loop = region.id
    prepareGuide(region.finish, region, true)
  else
    stopLoop()
  end
end

-- Lange opdrachten komen in delen (de webinterface kapt een waarde rond 1000 tekens af):
-- "<id>.<i>\t__part\t<i>\t<aantal>\t<stuk>"; als alles binnen is, wordt de opdracht
-- uitgevoerd alsof hij in één keer kwam.
local partBuffers = {}
local handleCommand

local function handlePart(raw)
  local partId, i, n, chunk = raw:match("^([^\t]*)\t__part\t(%d+)\t(%d+)\t(.*)$")
  if not partId then return false end
  st.lastCmd = partId
  local base = partId:match("^(.*)%.%d+$") or partId
  local buf = partBuffers[base] or {}
  partBuffers[base] = buf
  buf[tonumber(i)] = chunk
  n = tonumber(n)
  for k = 1, n do if not buf[k] then return true end end
  partBuffers[base] = nil
  handleCommand(table.concat(buf, "", 1, n))
  return true
end

handleCommand = function(raw)
  if handlePart(raw) then return end
  local parts = split(raw, "\t")
  local id, name = parts[1], parts[2]
  st.lastCmd = id
  local fn = handlers[name or ""]
  if not fn then st.error = "Onbekende opdracht: " .. tostring(name) return end
  local ok, err = pcall(fn, table.unpack(parts, 3))
  st.error = (not ok) and tostring(err):gsub("^.-:%d+: ", "") or nil
end

---------------------------------------------------------------- einde nummer
-- Is het laatste stuk van een nummer uit, dan stopt REAPER en staat het volgende nummer
-- uit de setlist klaar (begin, FreeShow op de lege startdia). Starten doet de
-- worshipleader zelf: er zit vaak gebed of een overgang tussen.
local songEnded = false

local function nextInSetlist()
  local _, path = reaper.EnumProjects(-1)
  for i, p in ipairs(st.setlist or {}) do
    if p == path then
      for j = i + 1, #st.setlist do
        if st.setlist[j] ~= "" then return st.setlist[j] end
      end
      return nil
    end
  end
end

local function songEnd()
  local last = 0
  local i = 0
  while true do
    local ret, isrgn, _, rgnend = reaper.EnumProjectMarkers3(0, i)
    if ret == 0 then break end
    if isrgn and rgnend > last then last = rgnend end
    i = i + 1
  end
  return last
end

-- Overgang naar een ander nummer (zie handlers.song): uitfaden, wisselen, starten
local function checkSongTransition()
  local p = st.pendingSong
  if not p then return end
  if not isPlaying() then handlers.songcancel() return end
  local pos = reaper.GetPlayPosition()
  if pos >= p.fadeFrom and not p.saved then
    p.saved = {}
    for _, b in ipairs((busTracks())) do
      p.saved[#p.saved + 1] = { track = b.track, vol = reaper.GetMediaTrackInfo_Value(b.track, "D_VOL") }
    end
  end
  if p.saved and pos < p.at - 0.02 then
    local g = math.max(0, math.min(1, (p.at - pos) / math.max(0.05, p.at - p.fadeFrom)))
    for _, s in ipairs(p.saved) do reaper.SetMediaTrackInfo_Value(s.track, "D_VOL", s.vol * g) end
    return
  end
  if pos < p.at - 0.02 then return end
  -- wisselen
  local old = reaper.EnumProjects(-1)
  reaper.OnStopButtonEx(old)
  for _, s in ipairs(p.saved or {}) do reaper.SetMediaTrackInfo_Value(s.track, "D_VOL", s.vol) end -- mix terug
  stopLoop()
  restoreGuide()
  st.pendingSong, st.pending = nil, nil
  local proj = findOpen(p.path)
  if not proj then return end
  reaper.SelectProjectInstance(proj)
  reaper.SetEditCurPos2(proj, 0, true, false)
  reaper.OnPlayButtonEx(proj)
end

local function checkSongEnd()
  if not isPlaying() then songEnded = false return end
  if songEnded or st.loop or st.pendingSong then return end
  local finish = songEnd()
  if finish > 0 and reaper.GetPlayPosition() >= finish - 0.05 then
    songEnded = true
    local nextPath = nextInSetlist()
    reaper.OnStopButtonEx(0)
    if nextPath then
      local ok, err = pcall(handlers.song, nextPath)
      if not ok then st.error = tostring(err) end
    end
  end
end

---------------------------------------------------------------- state
local function writeState()
  local tabs = {}
  local active = reaper.EnumProjects(-1)
  for _, p in ipairs(openProjects()) do
    tabs[#tabs + 1] = { name = p.path ~= "" and basename(p.path) or "(leeg)", path = p.path, active = (p.proj == active) }
  end
  local region = currentRegion()
  if st.pending and region and region.id == st.pending and region.id ~= st.jumpFrom then st.pending = nil end
  if not isPlaying() then st.pending = nil end
  if st.loop and reaper.GetSetRepeat(-1) == 0 then stopLoop() end
  local out = {
    v = st.v,
    songs = st.songs,
    setlist = st.setlist,
    tabs = tabs,
    mode = st.mode,
    loop = st.loop,
    guideCue = guide ~= nil,
    outputMode = outputMode,
    leadBeats = LEAD_QN,
    freeshow = (freeshow.host ~= "" and freeshow.port) and (freeshow.host .. ":" .. freeshow.port) or nil,
    hasCues = cues.regions ~= nil,
    recording = rec ~= nil,
    recSlide = rec and rec.idx or nil,
    recSlides = rec and rec.region and cues.regions and cues.regions[rec.region] and #cues.regions[rec.region] or nil,
    output = routing.applied,
    outputs = routing.outs,
    pending = st.pending,
    region = region and region.id or nil,
    smoothSeek = smoothSeekCmd ~= nil,
    lastCmd = st.lastCmd,
    error = st.error,
    nextSong = nextInSetlist(),
    pendingSong = st.pendingSong and st.pendingSong.path or nil,
  }
  reaper.SetExtState(SECTION, "state", json(out), false)
end

-- Een sprong naar dezelfde sectie herken je niet aan de region: kijk of de
-- afspeelpositie verspringt.
local lastPos, lastTime = 0, 0
local function detectSeek()
  local now = reaper.time_precise()
  if isPlaying() then
    local pos = reaper.GetPlayPosition()
    if lastTime > 0 and math.abs(pos - (lastPos + (now - lastTime))) > 0.3 then
      st.pending = nil
    end
    lastPos, lastTime = pos, now
  else
    lastTime = 0
  end
  -- Sprong gebeurd of gestopt: de guide terug naar origineel (loop-cue blijft staan)
  if guide and not guide.keep and (not isPlaying() or st.pending == nil) then restoreGuide() end
end

local function loop()
  detectSeek()
  checkSongTransition()
  checkSongEnd()
  applyRouting()
  updateCues()
  local raw = reaper.GetExtState(SECTION, "cmd")
  if raw ~= "" then
    reaper.DeleteExtState(SECTION, "cmd", false)
    handleCommand(raw)
    lastStateWrite = 0
  end
  local now = reaper.time_precise()
  if now - lastScan > 30 then scanSongs() end
  if now - lastStateWrite > 0.2 then
    writeState()
    lastStateWrite = now
  end
  if reloadRequested then
    dofile(reaper.GetResourcePath() .. "/Scripts/ark_tracks_bridge.lua")
    return -- deze instantie stopt; de nieuwe draait zijn eigen lus
  end
  reaper.defer(loop)
end

smoothSeekCmd = findSmoothSeekCmd()
-- setlist van de vorige keer (blijft bewaard na een herstart van REAPER)
do
  local saved = reaper.GetExtState(SECTION, "setlist")
  if saved ~= "" then st.setlist = split(saved, "\n") end
end
scanSongs()
reaper.SetExtState(SECTION, "running", "1", false)
loop()
