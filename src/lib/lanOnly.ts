// "Alleen intern": de tabletpagina mag niet via internet bereikbaar zijn.
//
// Een bezoeker van buiten komt altijd via de reverse proxy (Synology op de NAS, BunkerWeb op de test): die zet de
// doorstuurkoppen (X-Real-IP, X-Forwarded-For, ...) en laat de publieke hostnaam als Host staan. Rechtstreeks verkeer op
// het interne adres (bijv. http://192.168.2.250:3005) heeft geen van beide. Een Next.js-route krijgt het IP van de bezoeker
// niet te zien (de proxy draait bovendien op dezelfde machine), dus de controle gaat op die twee kenmerken tegelijk.
const PROXY_HEADERS = [
  "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-port", "x-forwarded-by",
  "x-real-ip", "forwarded", "via", "cf-connecting-ip", "true-client-ip",
];

// IP-adres uit een privé-bereik, localhost, of een naam zonder punt of op .local/.lan (geen publieke domeinnaam)
const INTERNAL_HOST = /^(localhost|::1|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[^.:]+|.+\.(local|lan|home\.arpa))$/i;

export function isInternalRequest(get: (name: string) => string | null | undefined): boolean {
  for (const h of PROXY_HEADERS) if (get(h)) return false;
  const host = String(get("host") || "").toLowerCase().replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  return !!host && INTERNAL_HOST.test(host);
}
