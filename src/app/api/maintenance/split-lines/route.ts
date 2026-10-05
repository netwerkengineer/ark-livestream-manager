export const dynamic = "force-dynamic";

import fs from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/authHelper";
import { getSettings } from "@/lib/settingsStore";
import { logActivity } from "@/lib/activityLog";
import { MAX_LINES_PER_SLIDE, MAX_CHARS_PER_LINE, slideLines, resplitGroup, maxRowsInGroup } from "@/lib/slideSplit";
import { rebuildArrangementsForShow } from "@/lib/trackArrangement";

// Splits slides of songs (category "song") that take more than
// MAX_LINES_PER_SLIDE rows on screen - the livestream lower third only fits
// two, and a line longer than MAX_CHARS_PER_LINE wraps into two rows.
// Only those groups are touched; songs with 1 or 2 lines per slide stay as
// they are. GET = preview, POST = convert (originals copied to
// data/backups/split-lines-<time>/ first). The regular FreeShow sync then
// takes the changed shows to the FreeShow computers.

interface Change {
  file: string;
  name: string;
  groups: number;
  maxLines: number;
}

function convertShow(show: any): { changed: boolean; groups: number; maxLines: number } {
  const slides = show.slides || {};
  const parents = new Set<string>();
  for (const layout of Object.values<any>(show.layouts || {})) {
    for (const entry of layout.slides || []) if (slides[entry.id]) parents.add(entry.id);
  }
  let groups = 0;
  let maxLines = 0;
  for (const id of parents) {
    const parent = slides[id];
    const children = (parent.children || []).filter((c: string) => slides[c]).map((c: string) => ({ id: c, slideObj: slides[c] }));
    const max = maxRowsInGroup(parent, children);
    maxLines = Math.max(maxLines, max);
    if (max <= MAX_LINES_PER_SLIDE) continue;
    const lines = [parent, ...children.map((c: { slideObj: unknown }) => c.slideObj)].flatMap(slideLines);
    const split = resplitGroup(parent, children, lines, "screen");
    slides[id] = split.parent;
    for (const c of children) if (!split.children.some(n => n.id === c.id)) delete slides[c.id];
    for (const c of split.children) slides[c.id] = c.slideObj;
    groups++;
  }
  return { changed: groups > 0, groups, maxLines };
}

async function scan(apply: boolean) {
  const settings = getSettings();
  if (!settings.freeshowPath) throw new Error("Geen FreeShow-map ingesteld");
  const showsDir = path.join(settings.freeshowPath, "Shows");
  const backupDir = path.join(process.cwd(), "data", "backups", `split-lines-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const changes: Change[] = [];

  for (const file of await fs.readdir(showsDir)) {
    if (!file.endsWith(".show") || file.startsWith("._")) continue;
    const full = path.join(showsDir, file);
    let raw: string;
    let parsed: any;
    try {
      raw = await fs.readFile(full, "utf-8");
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const show = Array.isArray(parsed) ? parsed[1] : parsed;
    if (show?.category !== "song") continue;
    const result = convertShow(show);
    if (!result.changed) continue;
    changes.push({ file, name: show.name || file.replace(/\.show$/, ""), groups: result.groups, maxLines: result.maxLines });
    if (apply) {
      await fs.mkdir(backupDir, { recursive: true });
      await fs.writeFile(path.join(backupDir, file), raw);
      show.timestamps = { ...(show.timestamps || {}), modified: Date.now() };
      // New file + rename: overwriting in place fails on the NAS share
      const tmp = `${full}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(parsed));
      await fs.rename(tmp, full);
    }
  }
  return { changes, backupDir: apply && changes.length ? backupDir : null };
}

export async function GET(req: NextRequest) {
  const authSession = await isAuthorized(req, undefined, "freeshow");
  if (!authSession) return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  try {
    const { changes } = await scan(false);
    return NextResponse.json({ success: true, maxLines: MAX_LINES_PER_SLIDE, maxChars: MAX_CHARS_PER_LINE, changes });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const authSession = await isAuthorized(req, undefined, "freeshow");
  if (!authSession) return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  try {
    const { changes, backupDir } = await scan(true);
    // Shows with a Tracks layout: slide numbers shifted, rebuild layout + cues
    const tracksNotes: string[] = [];
    for (const c of changes) {
      const { rebuilt, failed } = await rebuildArrangementsForShow(c.file);
      if (rebuilt) tracksNotes.push(`${c.name}: Tracks-layout bijgewerkt`);
      tracksNotes.push(...failed.map(f => `${c.name}: Tracks-layout niet bijgewerkt (${f}) - open "Tekst" en sla opnieuw op`));
    }
    if (changes.length) {
      logActivity("system", `${changes.length} lied(eren) opgesplitst naar max. ${MAX_LINES_PER_SLIDE} regels per dia door ${authSession.username} (backup: ${backupDir}).`);
    }
    return NextResponse.json({ success: true, changes, backupDir, tracksNotes });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
