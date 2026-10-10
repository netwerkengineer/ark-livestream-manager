export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/authHelper";
import { getSettings } from "@/lib/settingsStore";
import { saveRecordedTimings } from "@/lib/trackArrangement";
import { isDesktopBackend, playerState, sendCommand, checkCommand, deviceLabel } from "@/lib/desktopLink";
import {
  reaperRequest,
  parseReaperState,
  sendBridgeCommand,
  getBridgeState,
  getRecordedTaps,
  sendPadCommand,
  REAPER_COMMANDS,
  STATE_COMMANDS,
} from "@/lib/reaperControl";

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function GET(req: NextRequest) {
  const authSession = await isAuthorized(req, undefined, "tracks");
  if (!authSession) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }
  if (isDesktopBackend()) {
    const p = playerState();
    return p.online && p.state ? NextResponse.json(p.state) : NextResponse.json({ error: "Desktop-app niet verbonden" }, { status: 502 });
  }
  if (!getSettings().reaperEnabled) {
    return NextResponse.json({ error: "Tracks (REAPER) is uitgeschakeld" }, { status: 409 });
  }

  try {
    const state = parseReaperState(await reaperRequest(STATE_COMMANDS));
    // The song list is only needed by the setlist view (/api/reaper/setlist),
    // not on every poll.
    if (state.bridge) state.bridge.songs = [];
    return NextResponse.json(state);
  } catch (err) {
    return NextResponse.json({ error: `REAPER niet bereikbaar: ${errorMessage(err)}` }, { status: 502 });
  }
}

// Only a fixed set of actions is passed through - never raw REAPER
// commands from the client.
export async function POST(req: NextRequest) {
  const authSession = await isAuthorized(req, undefined, "tracks");
  if (!authSession) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }
  if (isDesktopBackend()) {
    // the desktop app plays: the command goes to the app (a fixed set only; it expires if the app does not carry it out in time)
    try {
      const body = await req.json();
      const bad = checkCommand("reaper", body);
      if (bad) return NextResponse.json({ error: bad }, { status: 400 });
      await sendCommand("reaper", body, authSession.username, deviceLabel(req.headers.get("user-agent")));
      return NextResponse.json({ success: true });
    } catch (err) {
      return NextResponse.json({ error: errorMessage(err) }, { status: 502 });
    }
  }
  if (!getSettings().reaperEnabled) {
    return NextResponse.json({ error: "Tracks (REAPER) is uitgeschakeld" }, { status: 409 });
  }

  try {
    const body = await req.json();
    const { action, track, value, final, region, mode, path, pos } = body;

    if (typeof action === "string" && Object.hasOwn(REAPER_COMMANDS, action)) {
      await reaperRequest([String(REAPER_COMMANDS[action as keyof typeof REAPER_COMMANDS])]);
    } else if (action === "volume" || action === "mute" || action === "solo") {
      const index = Number(track);
      if (!Number.isInteger(index) || index < 1 || index > 1024) {
        return NextResponse.json({ error: "Ongeldig tracknummer" }, { status: 400 });
      }
      if (action === "volume") {
        const vol = Number(value);
        if (!Number.isFinite(vol) || vol < 0 || vol > 4) {
          return NextResponse.json({ error: "Ongeldig volume" }, { status: 400 });
        }
        // Trailing "g" ignores ganging; an "e" near the end ends REAPER's
        // touch state when the fader is released.
        await reaperRequest([`SET/TRACK/${index}/VOL/${vol.toFixed(6)}${final ? "e" : ""}g`]);
      } else {
        const v = value === undefined ? -1 : (value ? 1 : 0);
        await reaperRequest([`SET/TRACK/${index}/${action === "mute" ? "MUTE" : "SOLO"}/${v}`]);
      }
    } else if (action === "recordStart" || action === "recordCancel") {
      await sendBridgeCommand("record", [action === "recordStart" ? "start" : "cancel"]);
    } else if (action === "tap") {
      // pos: REAPER's play position as the browser estimated it at the tap
      // (network delay), so the moment is recorded where it was tapped
      const p = Number(pos);
      await sendBridgeCommand("tap", Number.isFinite(p) && p >= 0 ? [p.toFixed(3)] : []);
    } else if (action === "recordSave") {
      await sendBridgeCommand("record", ["save"]);
      const taps = await getRecordedTaps();
      if (!taps.path) throw new Error("Geen song actief");
      if (!Object.keys(taps.sections).length) return NextResponse.json({ success: true, sections: [] });
      const result = await saveRecordedTimings(taps.path, taps.sections, authSession.username);
      await sendBridgeCommand("cues", [taps.path, result.cues]);
      return NextResponse.json({ success: true, sections: result.sections });
    } else if (action === "pad") {
      // value: { op: "play" | "stop" | "volume", set, layer, key, fade, volume }
      const { op, set, layer, key, fade } = value || {};
      const clean = (s: unknown) => (typeof s === "string" && /^[\w .()-]{1,60}$/.test(s) ? s : null);
      const fadeSec = Number.isFinite(Number(fade)) ? String(Math.max(0, Math.min(20, Number(fade)))) : "4";
      if (op === "play") {
        const k = clean(key), s = clean(set), l = clean(layer);
        if (!k || !s || !l || !PAD_KEYS.includes(k)) return NextResponse.json({ error: "Ongeldige pad" }, { status: 400 });
        await sendPadCommand("play", [s, l, k, fadeSec]);
      } else if (op === "stop") {
        await sendPadCommand("stop", [fadeSec]);
      } else if (op === "volume") {
        const v = Number(value?.volume);
        if (!Number.isFinite(v) || v < 0 || v > 1) return NextResponse.json({ error: "Ongeldig volume" }, { status: 400 });
        await sendPadCommand("volume", [v.toFixed(3)]);
      } else {
        return NextResponse.json({ error: "Onbekende pad-actie" }, { status: 400 });
      }
    } else if (action === "unmuteAll") {
      // Every muted bus and stem, including the [LIVE] ones, in one request. Except the
      // click choice: with our own click (1/4, 1/8, 1/16) the original click and the
      // subdivisions stay as they are, otherwise everything clicks at once
      const state = parseReaperState(await reaperRequest(["TRACK"]));
      const muted = state.busses.flatMap(b => {
        const ownClick = b.stems.some(s => CLICK_LAYER.test(s.name));
        return [b.track, ...b.stems.filter(s => !(ownClick && /^click/i.test(s.name)))];
      }).filter(t => t.muted);
      if (muted.length) await reaperRequest(muted.map(t => `SET/TRACK/${t.index}/MUTE/0`));
    } else if (action === "master") {
      // master volume (linear 0-2) and/or master mute for all busses together
      const vol = value === undefined ? NaN : Number(value);
      if (value !== undefined && (!Number.isFinite(vol) || vol < 0 || vol > 2)) return NextResponse.json({ error: "Ongeldig volume" }, { status: 400 });
      await sendBridgeCommand("master", [Number.isFinite(vol) ? vol.toFixed(4) : "", body.mute === undefined ? "" : body.mute ? "1" : "0"]);
    } else if (action === "seek") {
      // timing screen: listen from a moment (seconds in the active project)
      const to = Number(pos);
      if (!Number.isFinite(to) || to < 0 || to > 36000) return NextResponse.json({ error: "Ongeldige positie" }, { status: 400 });
      await reaperRequest([`SET/POS/${to.toFixed(3)}`]);
    } else if (action === "jump") {
      const id = Number(region);
      if (!Number.isInteger(id) || id < 0) {
        return NextResponse.json({ error: "Ongeldige sectie" }, { status: 400 });
      }
      await sendBridgeCommand("jump", [String(id), ...(isJumpMode(mode) ? [mode] : [])]);
    } else if (action === "mode") {
      if (!isJumpMode(mode)) return NextResponse.json({ error: "Ongeldige modus" }, { status: 400 });
      await sendBridgeCommand("mode", [mode]);
    } else if (action === "loop") {
      await sendBridgeCommand("loop", [value ? "on" : "off"]);
    } else if (action === "song") {
      // Only projects the bridge itself listed from the songs folder
      const bridge = await getBridgeState();
      if (!bridge) return NextResponse.json({ error: "REAPER-bridge draait niet" }, { status: 502 });
      if (typeof path !== "string" || !bridge.songs.some(s => s.path === path)) {
        return NextResponse.json({ error: "Onbekende song" }, { status: 400 });
      }
      // With a jump mode while playing: transition at that musical moment
      await sendBridgeCommand("song", [path, ...(isJumpMode(mode) ? [mode] : [])], 15000);
    } else if (action === "songCancel") {
      await sendBridgeCommand("songcancel");
    } else {
      return NextResponse.json({ error: "Onbekende actie" }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 502 });
  }
}

// Click stems generated by mt2reaper next to the MultiTracks click
const CLICK_LAYER = /^click 1\/(4|8|16)$/i;

const PAD_KEYS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

function isJumpMode(mode: unknown): mode is "end" | "bar" | "now" {
  return mode === "end" || mode === "bar" || mode === "now";
}
