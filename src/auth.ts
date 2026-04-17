import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Facebook from "next-auth/providers/facebook";
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
    Facebook({
      clientId: settings.facebookClientId || process.env.FACEBOOK_CLIENT_ID,
      clientSecret: settings.facebookClientSecret || process.env.FACEBOOK_CLIENT_SECRET,
      authorization: {
        params: {
          scope: "email,public_profile,publish_video,pages_manage_posts,pages_read_engagement,pages_show_list",
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
        if (account.provider === "facebook") {
          token.facebookToken = account.access_token;
          saveToken("facebook", account.access_token!);
        }
      }
      return token;
    },
    async session({ session, token }: any) {
      const storedTokens = getTokens();
      
      // Merge tokens into session
      session.youtubeToken = token.youtubeToken || storedTokens.google;
      session.facebookToken = token.facebookToken || storedTokens.facebook;
      
      return session;
    },
  },
  trustHost: true,
});
