import type { NextRequest } from "next/server";
import { isAuthorized } from "./authHelper";

// The practice player: band members ("oefenen") and everyone who may run the
// tracks on the track computer anyway ("tracks").
export async function isPracticeAuthorized(req: NextRequest) {
  return (await isAuthorized(req, undefined, "oefenen")) || (await isAuthorized(req, undefined, "tracks"));
}
