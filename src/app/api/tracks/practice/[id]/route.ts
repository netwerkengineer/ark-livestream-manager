export const dynamic = "force-dynamic";

import fs from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/authHelper";
import { isPracticeAuthorized } from "@/lib/practiceAuth";
import { getTrack } from "@/lib/trackLibrary";
import { enqueuePractice, practiceDir, practiceState } from "@/lib/trackPractice";
import { practiceLyrics } from "@/lib/trackArrangement";

// Manifest of a practice version (stems, sections, tempo, segments) plus the
// lyrics timeline. "v" changes with every rebuild, the player puts it in the
// segment URLs so browsers may cache those forever.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isPracticeAuthorized(req))) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }
  const { id } = await params;
  const item = getTrack(id);
  const state = item && item.status !== "deleted" ? practiceState(id) : null;
  if (!item || !state) return NextResponse.json({ error: "Song niet gevonden" }, { status: 404 });
  if (state.status !== "ready") {
    return NextResponse.json({ error: "De oefenversie wordt nog gemaakt", status: state.status, message: state.message }, { status: 409 });
  }
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(practiceDir(id), "manifest.json"), "utf-8"));
    let lyrics = null;
    if (item.report?.rpp) {
      try {
        lyrics = await practiceLyrics(item.report.rpp, manifest.sections, manifest.tempo);
      } catch {
        // no show / unreadable - play without lyrics
      }
    }
    const v = Buffer.from(state.builtAt || "").toString("base64url").slice(-12);
    return NextResponse.json({ id, v, manifest, lyrics });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

// Make the practice version again (only for those who manage the tracks)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req, undefined, "tracks"))) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }
  const { id } = await params;
  const item = getTrack(id);
  if (!item || item.status === "deleted" || item.status === "uploading") {
    return NextResponse.json({ error: "Song niet gevonden" }, { status: 404 });
  }
  enqueuePractice(id);
  return NextResponse.json({ success: true });
}
