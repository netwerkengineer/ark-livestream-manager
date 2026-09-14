import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { saveToken, getTokens } from "./lib/tokenStore";
import { getSettings } from "./lib/settingsStore";
import { resolveSsoPermissions } from "./lib/ssoPermissions";
import { upsertContactFromSso } from "./lib/contactsStore";

export const { handlers, auth, signIn, signOut } = NextAuth((req) => {
  const settings = getSettings();

  // FORCE HTTPS in production/NAS mode to satisfy Google's security policy
  if (settings.nextAuthUrl) {
    process.env.NEXTAUTH_URL = settings.nextAuthUrl;
    process.env.AUTH_URL = settings.nextAuthUrl; // for Auth.js v5
  }

  const providers: any[] = [
    Google({
      clientId: settings.googleClientId || process.env.GOOGLE_CLIENT_ID,
      clientSecret: settings.googleClientSecret || process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          scope: "openid email profile https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/youtube.upload",
          prompt: "consent select_account",
          access_type: "offline",
          response_type: "code",
        },
      },
    }),
  ];

  // Team login via an external identity provider - Authentik on the
  // Proxmox test environment, Synology SSO Server in production. Just a
  // generic OIDC client: Auth.js resolves authorize/token/userinfo
  // endpoints itself from <issuer>/.well-known/openid-configuration, so
  // switching environments is a settings change (issuer/client id/secret),
  // never a code change. Only registered when actually configured, so an
  // empty issuer doesn't break NextAuth's provider validation.
  if (settings.ssoEnabled && settings.ssoIssuerUrl && settings.ssoClientId) {
    providers.push({
      id: "sso",
      name: settings.ssoProviderName || "Team-login",
      type: "oidc",
      issuer: settings.ssoIssuerUrl,
      clientId: settings.ssoClientId,
      clientSecret: settings.ssoClientSecret,
      // Only overridden when settings.ssoScope is actually set, so this
      // never changes behavior for an already-working provider (e.g.
      // Authentik on Proxmox, which gets groups back with Auth.js's default
      // scope already) - a provider that needs an explicit scope to include
      // groups (observed on Synology SSO Server) sets this per-environment
      // in its own settings.json instead of here.
      ...(settings.ssoScope ? { authorization: { params: { scope: settings.ssoScope } } } : {}),
    });
  }

  return {
    providers,
    secret: settings.nextAuthSecret || process.env.NEXTAUTH_SECRET,
    session: {
      strategy: "jwt",
      maxAge: 30 * 24 * 60 * 60, // 30 dagen behouden
    },
    callbacks: {
      async jwt({ token, account, profile }) {
        if (account) {
          token.provider = account.provider;
          if (account.provider === "google") {
            token.youtubeToken = account.access_token;
            saveToken("google", account.access_token!);
            if (account.refresh_token) {
              saveToken("google_refresh", account.refresh_token);
            }
          }
          if (account.provider === "sso" && profile) {
            const groupClaim = settings.ssoGroupClaim || "groups";
            const groups = (profile as any)[groupClaim];
            token.ssoGroups = Array.isArray(groups) ? groups : [];
            token.ssoName = profile.name;
            token.ssoEmail = profile.email;
            // Best-effort: getting this person into contacts.json shouldn't
            // ever block them logging in - the periodic sync in
            // teamDirectorySync.ts is the reliable path, this just means
            // they don't have to wait for the next scheduled run.
            if (profile.email) {
              try {
                upsertContactFromSso({
                  name: (profile.name as string) || (profile.email as string),
                  email: profile.email as string,
                  groups: token.ssoGroups as string[],
                  externalId: (profile.sub as string) || (profile.email as string)
                });
              } catch {
                // non-fatal
              }
            }
          }
        }
        return token;
      },
      async session({ session, token }: any) {
        const storedTokens = getTokens();

        // Merge tokens into session
        session.youtubeToken = token.youtubeToken || storedTokens.google;

        session.provider = token.provider;
        if (token.provider === "sso") {
          const resolved = resolveSsoPermissions((token.ssoGroups as string[]) || []);
          session.role = resolved.role;
          session.permissions = resolved.permissions;
        }

        return session;
      },
    },
    trustHost: true,
  };
});

