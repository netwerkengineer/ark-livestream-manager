import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { saveToken, getTokens } from "./lib/tokenStore";
import { getSettings } from "./lib/settingsStore";

const settings = getSettings();

// FORCE HTTPS in production/NAS mode to satisfy Google's security policy
if (settings.nextAuthUrl) {
  process.env.NEXTAUTH_URL = settings.nextAuthUrl;
  process.env.AUTH_URL = settings.nextAuthUrl; // for Auth.js v5
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
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
  ],
  secret: settings.nextAuthSecret || process.env.NEXTAUTH_SECRET,
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 dagen behouden
  },
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        if (account.provider === "google") {
          token.youtubeToken = account.access_token;
          saveToken("google", account.access_token!);
        }
      }
      return token;
    },
    async session({ session, token }: any) {
      const storedTokens = getTokens();
      
      // Merge tokens into session
      session.youtubeToken = token.youtubeToken || storedTokens.google;
      
      return session;
    },
  },
  trustHost: true,
});

