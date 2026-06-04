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
  whatsappTemplate: string;

  // Auth Configuration (NAS-Pro)
  googleClientId: string;
  googleClientSecret: string;
  facebookClientId: string;
  facebookClientSecret: string;
  nextAuthUrl: string;
  nextAuthSecret: string;
  
  // Setup flag
  isSetupComplete: boolean;

  // OBS Configuration
  obsHost: string;
  obsPort: number;
  obsPassword: string;

  // Broadcast Infrastructure
  companionHost: string;
  companionPort: number;
  x32Host: string;
  x32Port: number;
  qlcHost: string;
  qlcPort: number;
  freeShowHost: string;
  freeShowPort: number;
  
  // Custom Buttons
  broadcastButtons: BroadcastButton[];

  // MIDI Configuration
  midiEnabled: boolean;
  midiSessionName: string;
  midiAutoConnectIps: string;

  // QLC+ Configuration
  qlcEnabled: boolean;
}

export interface BroadcastButton {
  id: string;
  name: string;
  sub: string;
  icon: 'play' | 'square' | 'volume-x' | 'monitor-off' | 'refresh-cw' | 'zap' | 'alert-octagon';
  color: string;
  page: number;
  row: number;
  col: number;
  midiNote?: number;
  midiOutNote?: number;
  midiOutChannel?: number;
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
  whatsappTemplate: "Hallo allemaal! Komende zondag zenden we weer live uit. U kunt de dienst volgen via deze link: {link}. Tot dan!",
  
  googleClientId: "",
  googleClientSecret: "",
  facebookClientId: "",
  facebookClientSecret: "",
  nextAuthUrl: "http://192.168.2.250:3000",
  nextAuthSecret: crypto.randomBytes(32).toString("hex"),
  isSetupComplete: false,

  // OBS Defaults
  obsHost: "localhost",
  obsPort: 4455,
  obsPassword: "",

  // Broadcast Defaults
  companionHost: "127.0.0.1",
  companionPort: 8000,
  x32Host: "127.0.0.1",
  x32Port: 10023,
  qlcHost: "127.0.0.1",
  qlcPort: 7700,
  freeShowHost: "127.0.0.1",
  freeShowPort: 5505,

  // MIDI Defaults
  midiEnabled: true,
  midiSessionName: "livestream-Manager",
  midiAutoConnectIps: "",

  // QLC+ Defaults
  qlcEnabled: false,

  // Default Buttons
  broadcastButtons: [
    { id: '1', name: 'START SERVICE', sub: 'Worship Leader Start', icon: 'play', color: 'green', page: 1, row: 0, col: 0, midiNote: 60 },
    { id: '2', name: 'STOP SERVICE', sub: 'Einde uitzending', icon: 'square', color: 'red', page: 1, row: 0, col: 1, midiNote: 61 },
    { id: '3', name: 'CLEAR AUDIO', sub: 'Mute alle kanalen', icon: 'volume-x', color: 'amber', page: 2, row: 0, col: 0, midiNote: 62 },
    { id: '4', name: 'BLACKOUT', sub: 'Alles op zwart', icon: 'monitor-off', color: 'slate', page: 2, row: 0, col: 3, midiNote: 63 }
  ]
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
  if (updated.googleClientId && updated.googleClientSecret) {
    updated.isSetupComplete = true;
  }

  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2));
  return updated;
}
