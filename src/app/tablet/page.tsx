import type { Metadata } from "next";
import { headers, cookies } from "next/headers";
import { notFound } from "next/navigation";
import { isInternalRequest } from "@/lib/lanOnly";
import { TABLET_COOKIE, tabletPin, isValidTabletCookie } from "@/lib/tabletAuth";
import TabletPanel from "@/components/TabletPanel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Regiekamer | Ark Church", robots: { index: false, follow: false } };

// Tabletpagina voor de regiekamer: alles op één scherm. Alleen bereikbaar op het interne adres (via internet: "niet gevonden"),
// en met een pincode (zie lib/lanOnly.ts en lib/tabletAuth.ts).
export default async function TabletPage() {
  const h = await headers();
  if (!isInternalRequest(name => h.get(name))) notFound();
  const c = await cookies();
  return <TabletPanel pinSet={!!tabletPin()} authed={isValidTabletCookie(c.get(TABLET_COOKIE)?.value)} />;
}
