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

  // Tuya Smart Plug Configuration
  tuyaDeviceId?: string;
  tuyaDeviceIp?: string;
  tuyaLocalKey?: string;
  tuyaVersion?: number;
  tuyaPlugs?: TuyaPlug[];
  schedules?: TuyaSchedule[];
  users?: LocalUser[];
}

export interface LocalUser {
  username: string;
  passwordHash: string;
  salt: string;
  role: "admin" | "operator";
}

export interface TuyaPlug {
  id: string;
  name: string;
  ip: string;
  deviceId: string;
  localKey: string;
  version: number;
  hostIp?: string;
}

export interface TuyaSchedule {
  id: string;
  name: string;
  time: string; // "HH:MM"
  days: number[]; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  action: "on" | "shutdown" | "off";
  plug: string; // "all" or specific plug ID
  enabled: boolean;
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

  // Tuya Smart Plug Defaults
  tuyaDeviceId: "REDACTED_TUYA_DEVICE_ID_1",
  tuyaDeviceIp: "192.168.40.60",
  tuyaLocalKey: "REDACTED_TUYA_LOCAL_KEY_1",
  tuyaVersion: 3.5,
  tuyaPlugs: [
    {
      id: "home_mac",
      name: "Thuis Mac Mini Plug",
      ip: "192.168.40.60",
      deviceId: "REDACTED_TUYA_DEVICE_ID_1",
      localKey: "REDACTED_TUYA_LOCAL_KEY_1",
      version: 3.5,
      hostIp: "192.168.2.20"
    }
  ],
  schedules: [],

  // Default Buttons
  broadcastButtons: [
    { id: '1', name: 'START SERVICE', sub: 'Worship Leader Start', icon: 'play', color: 'green', page: 1, row: 0, col: 0, midiNote: 60 },
    { id: '2', name: 'STOP SERVICE', sub: 'Einde uitzending', icon: 'square', color: 'red', page: 1, row: 0, col: 1, midiNote: 61 },
    { id: '3', name: 'CLEAR AUDIO', sub: 'Mute alle kanalen', icon: 'volume-x', color: 'amber', page: 2, row: 0, col: 0, midiNote: 62 },
    { id: '4', name: 'BLACKOUT', sub: 'Alles op zwart', icon: 'monitor-off', color: 'slate', page: 2, row: 0, col: 3, midiNote: 63 }
  ],
  users: []
};

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
}

export function getSettings(): AppSettings {
  let settings = DEFAULT_SETTINGS;
  const fileExists = fs.existsSync(SETTINGS_FILE);
  
  if (fileExists) {
    try {
      const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
      settings = { ...DEFAULT_SETTINGS, ...saved };
      
      // Self-healing: if the saved settings on disk are missing the new multi-plug array 
      // or scheduler properties, force write them back so they are persistent and visible 
      // to host python scripts.
      let needsWrite = !saved.tuyaPlugs || !saved.tuyaDeviceId || !saved.schedules;
      
      // Initialize default users if empty
      if (!settings.users || settings.users.length === 0) {
        const adminSalt = crypto.randomBytes(16).toString("hex");
        const operatorSalt = crypto.randomBytes(16).toString("hex");
        settings.users = [
          {
            username: "admin",
            salt: adminSalt,
            passwordHash: hashPassword("arkadmin", adminSalt),
            role: "admin"
          },
          {
            username: "operator",
            salt: operatorSalt,
            passwordHash: hashPassword("arkoperator", operatorSalt),
            role: "operator"
          }
        ];
        needsWrite = true;
      }
      
      if (needsWrite) {
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
      }
    } catch (e) {
      settings = DEFAULT_SETTINGS;
    }
  } else {
    // Write defaults to disk initially
    try {
      const adminSalt = crypto.randomBytes(16).toString("hex");
      const operatorSalt = crypto.randomBytes(16).toString("hex");
      DEFAULT_SETTINGS.users = [
        {
          username: "admin",
          salt: adminSalt,
          passwordHash: hashPassword("arkadmin", adminSalt),
          role: "admin"
        },
        {
          username: "operator",
          salt: operatorSalt,
          passwordHash: hashPassword("arkoperator", operatorSalt),
          role: "operator"
        }
      ];
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2));
      settings = DEFAULT_SETTINGS;
    } catch (e) {}
  }
  return settings;
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
