export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/authHelper";
import { readFixtures } from "@/lib/qlcWorkspace";
import { searchLibrary } from "@/lib/qlcFixtureLib";
import { addFixtures, updateFixture, deleteFixture, usageOfFixture, freeAddress } from "@/lib/qlcFixtureEdit";
import { reloadQlc } from "@/lib/qlcFunctions";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

// GET -> the lamps of the workspace; ?q= also searches the QLC+ library; ?usage=<id> says what a removal would touch;
// ?free=<universe>&channels=<n> gives the first free address
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req, undefined, "lights"))) return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  try {
    const q = req.nextUrl.searchParams;
    if (q.get("usage") !== null) return NextResponse.json(usageOfFixture(Number(q.get("usage"))));
    if (q.get("free") !== null) return NextResponse.json({ address: freeAddress(Number(q.get("free")) || 0, Math.max(1, Number(q.get("channels")) || 1)) });
    return NextResponse.json({ fixtures: readFixtures(), library: q.get("q") ? searchLibrary(q.get("q") || "") : [] });
  } catch (err) {
    return NextResponse.json({ error: message(err) }, { status: 500 });
  }
}

// POST {action: "add" | "update" | "delete", ...} -> change the workspace and have QLC+ load it again
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req, undefined, "lights"))) return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  try {
    const body = await req.json();
    let extra: Record<string, unknown> = {};
    if (body.action === "add") extra = { ids: addFixtures(body) };
    else if (body.action === "update") updateFixture(body);
    else if (body.action === "delete") extra = deleteFixture(Number(body.id));
    else return NextResponse.json({ error: "Onbekende actie" }, { status: 400 });
    const reload = await reloadQlc();
    return NextResponse.json({ ...extra, reload, fixtures: readFixtures() });
  } catch (err) {
    return NextResponse.json({ error: message(err) }, { status: 400 });
  }
}
