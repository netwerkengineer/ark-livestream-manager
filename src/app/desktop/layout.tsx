import React from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

// /desktop is only for the desktop app (its window identifies itself in the user agent); in a normal
// browser the page doesn't exist. This only hides the page: who may do what is still decided by the
// login and the permissions of the API.
export const dynamic = "force-dynamic";

export default async function DesktopLayout({ children }: { children: React.ReactNode }) {
  const userAgent = (await headers()).get("user-agent") || "";
  if (!userAgent.includes("ArkTracksDesktop")) notFound();
  return <>{children}</>;
}
