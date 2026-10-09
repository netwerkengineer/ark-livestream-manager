import React from "react";
import { headers, cookies } from "next/headers";
import { notFound } from "next/navigation";
import { hasDesktopAccess, DESKTOP_COOKIE } from "@/lib/desktopAccess";

// /desktop is only for the desktop app (its window identifies itself in the user agent and, when a key is set
// in the settings, with a cookie only the app sets); anywhere else the page doesn't exist. This only hides the page: who may do what is still decided by the
// login and the permissions of the API.
export const dynamic = "force-dynamic";

export default async function DesktopLayout({ children }: { children: React.ReactNode }) {
  const userAgent = (await headers()).get("user-agent");
  const key = (await cookies()).get(DESKTOP_COOKIE)?.value;
  if (!hasDesktopAccess(userAgent, key)) notFound();
  return <>{children}</>;
}
