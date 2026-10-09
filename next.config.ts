import type { NextConfig } from "next";

// The sign-in forms post to this server and are answered with a redirect to the identity provider (Google, the team login).
// Browsers let that pass, but embedded web views (the desktop app) cancel a redirect that leaves form-action 'self'.
// So only the sign-in routes may send a form on to any https address; everywhere else forms stay on this server.
const csp = (formAction: string) => [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "media-src 'self' https:",
  "connect-src 'self' ws: wss:",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  `form-action ${formAction}`,
].join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          { key: "Content-Security-Policy", value: csp("'self'") },
        ],
      },
      {
        // the same headers, with the sign-in redirect allowed (a later rule overrides the same header of the first)
        source: "/api/auth/:path*",
        headers: [{ key: "Content-Security-Policy", value: csp("'self' https:") }],
      },
    ];
  },
};

export default nextConfig;
