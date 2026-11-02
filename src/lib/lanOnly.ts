// "Alleen intern": de tabletpagina mag niet via internet bereikbaar zijn.
//
// Een bezoeker van buiten komt altijd via de reverse proxy (Synology op de NAS, BunkerWeb op de test): die zet X-Real-IP e.d.,
// stuurt het IP van de bezoeker mee in X-Forwarded-For en laat de publieke hostnaam als Host staan. Next.js vult zelf
// x-forwarded-host/-proto/-port en (als die ontbreekt) x-forwarded-for met het adres van de verbinding in, dus die koppen bewijzen
// niets over een proxy. Een route krijgt het socket-IP verder niet te zien en de proxy draait op dezelfde machine.
// Daarom moeten ALLE drie kloppen: (1) geen koppen die alleen een proxy zet, (2) x-forwarded-for is een intern adres
// (bij rechtstreeks verkeer is dat het echte bronadres), (3) Host is een intern adres of naam.
const PROXY_ONLY_HEADERS = ["x-real-ip", "forwarded", "via", "x-forwarded-by", "cf-connecting-ip", "true-client-ip", "x-client-ip"];

// IP-adres uit een privé-bereik, localhost, of een naam zonder punt of op .local/.lan (geen publieke domeinnaam)
const INTERNAL_HOST = /^(localhost|::1|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[^.:]+|.+\.(local|lan|home\.arpa))$/i;
const PRIVATE_IP = /^(::1|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|f[cd][0-9a-f]{2}:.*|fe80:.*)$/i;

function isPrivateIp(raw: string): boolean {
  const ip = raw.trim().replace(/^::ffff:/i, "");   // IPv4 over een dual-stack socket
  return PRIVATE_IP.test(ip);
}

export function isInternalRequest(get: (name: string) => string | null | undefined): boolean {
  for (const h of PROXY_ONLY_HEADERS) if (get(h)) return false;
  const forwardedFor = String(get("x-forwarded-for") || "").trim();
  if (forwardedFor && !forwardedFor.split(",").every(isPrivateIp)) return false;
  const host = String(get("host") || "").toLowerCase().replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  return !!host && INTERNAL_HOST.test(host);
}
