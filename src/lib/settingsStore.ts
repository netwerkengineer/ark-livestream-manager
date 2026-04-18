import fs from "fs";
import path from "path";
import crypto from "crypto";

const DATA_DIR = path.join(process.cwd(), "data");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

export interface AppSettings {
  // Application settings
  thumbnailSavePath: string;
  defaultTitle: string;
  defaultDescription: string;
  defaultFacebookPageId: string;
  defaultPrivacy: "public" | "unlisted" | "private";
  defaultCategoryId: string;
  defaultTags: string;

  // Auth Configuration (NAS-Pro)
  googleClientId: string;
  googleClientSecret: string;
  facebookClientId: string;
  facebookClientSecret: string;
  nextAuthUrl: string;
  nextAuthSecret: string;
  
  // Setup flag
  isSetupComplete: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  thumbnailSavePath: "/volume1/Beamer/FreeShow/Media",
  defaultTitle: "[Spreker] | [Onderwerp] | Ark Church | [Datum]",
  defaultDescription: `Livestream van de Zondagsdienst van Ark Church.

Spreker: [naam spreker]
Thema: [onderwerp]
Website Ark Church         https://www.arkchurch.nl
Volg ons op Instagram  https://www.instagram.com/arkchurchnl
Volg ons op Facebook   https://www.facebook.com/egdeark

Donaties:
Voor giften en donaties https://www.arkchurch.nl/gift/


#arkchurch #ark #Amersfoort  #kerkdienst #Jezus #worship #churchonline #God #church`,
  defaultFacebookPageId: "",
  defaultPrivacy: "public",
  defaultCategoryId: "29", // Nonprofits & Activism
  defaultTags: "egdeark,Amersfoort,Nanny Benjamins,Ark,livestream,worship,De Ark,Kerk,evangelie,praise,Fabian Benjamins,Arkchurch",
  
  googleClientId: "",
  googleClientSecret: "",
  facebookClientId: "",
  facebookClientSecret: "",
  nextAuthUrl: "http://192.168.2.250:3000",
  nextAuthSecret: crypto.randomBytes(32).toString("hex"),
  isSetupComplete: false
};

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function getSettings(): AppSettings {
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
      return { ...DEFAULT_SETTINGS, ...saved };
    } catch (e) {
      return DEFAULT_SETTINGS;
    }
  }
  return DEFAULT_SETTINGS;
}

export function saveSettings(settings: Partial<AppSettings>) {
  const current = getSettings();
  const updated = { ...current, ...settings };
  
  // When keys are provided, we consider setup potentially complete
  if (updated.googleClientId && updated.googleClientSecret && updated.facebookClientId && updated.facebookClientSecret) {
    updated.isSetupComplete = true;
  }

  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2));
  return updated;
}
