import crypto from "crypto";
import { getSettings } from "./settingsStore";

// Pincode voor de tabletpagina (/tablet). Op het interne netwerk hangt ook gast-wifi, dus alleen "intern" is niet genoeg.
// De pincode staat in de instellingen; zonder pincode is de pagina dicht. Het tablet onthoudt de inlog in een cookie die
// aan de pincode is gebonden: een andere pincode maakt alle oude cookies ongeldig.
export const TABLET_COOKIE = "tablet_session";
export const TABLET_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function tabletPin(): string {
  return String(getSettings().tabletPin || "").trim();
}

function expectedToken(pin: string): string {
  const secret = String(getSettings().nextAuthSecret || "");
  return crypto.createHmac("sha256", secret).update("tablet:" + pin).digest("hex");
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function tabletToken(): string | null {
  const pin = tabletPin();
  return pin ? expectedToken(pin) : null;
}

export function isValidTabletCookie(value?: string | null): boolean {
  const pin = tabletPin();
  return !!pin && !!value && same(value, expectedToken(pin));
}

export function pinMatches(input: string): boolean {
  const pin = tabletPin();
  return !!pin && same(crypto.createHash("sha256").update(String(input)).digest("hex"), crypto.createHash("sha256").update(pin).digest("hex"));
}

// Pincode raden afremmen: na 5 foute pogingen is invoeren 5 minuten dicht (geldt voor het invoeren, niet voor een tablet dat al is ingelogd).
const MAX_FAILURES = 5;
const LOCK_MS = 5 * 60_000;
let failures: number[] = [];

export function loginLocked(): boolean {
  const now = Date.now();
  failures = failures.filter(t => now - t < LOCK_MS);
  return failures.length >= MAX_FAILURES;
}

export function registerLoginFailure() {
  failures.push(Date.now());
}

export function clearLoginFailures() {
  failures = [];
}

// Alleen deze API's mogen vanaf het tablet (zonder gewone inlog) worden gebruikt
export const TABLET_API_ALLOWLIST = [
  "/api/tuya/status",
  "/api/tuya/power",
  "/api/lights/auto",
  "/api/qlc/action",
  "/api/qlc/stream",
  "/api/tablet/sfeer",
  "/api/obs/status",
];

// Via /api/qlc/action mag het tablet van de losse OSC-paden alleen de vier Fresnel-schuiven bedienen (hoger/lager), verder niets
export const TABLET_OSC_PATHS = ["/ark/light/fresnel/1", "/ark/light/fresnel/2", "/ark/light/fresnel/3", "/ark/light/fresnel/4"];
