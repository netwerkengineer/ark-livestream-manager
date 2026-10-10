import type { Metadata, Viewport } from "next";

// The stage view can be put on a tablet's home screen as an app of its own (full screen, without the browser's bars):
// a manifest for this route only (start and scope /tracks), and the Apple tags that iPadOS looks at.
export const metadata: Metadata = {
  title: "Podium",
  manifest: "/tracks.webmanifest",
  icons: { icon: "/logo.png?v=2", apple: "/logo.png?v=2" },
  appleWebApp: { capable: true, title: "Podium", statusBarStyle: "black-translucent" },
};

// viewport-fit=cover: the page uses the whole screen; the stage view keeps clear of the notch and the bars with the safe-area padding
export const viewport: Viewport = { viewportFit: "cover", themeColor: "#0b1222" };

export default function TracksLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
