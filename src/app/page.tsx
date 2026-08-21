"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { signIn, signOut, useSession } from "next-auth/react";
import ThumbnailEditor from "@/components/ThumbnailEditor";
import StreamMonitor from "@/components/StreamMonitor";
import FreeshowGenerator from "@/components/FreeshowGenerator";
import { 
  LayoutDashboard, 
  Video, 
  ImageIcon, 
  Calendar, 
  Globe, 
  MonitorPlay, 
  Send,
  Upload,
  Layers,
  Settings,
  User,
  HelpCircle,
  Save,
  X,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Key,
  Database,
  Link,
  Clock,
  RefreshCcw,
  Trash2,
  Activity,
  ShieldAlert,
  Sun,
  Monitor,
  FileText,
  Cpu,
  Sliders,
  Tv
} from "lucide-react";
import BroadcastControlCenter from "@/components/BroadcastControlCenter";
import LightsControl from "@/components/LightsControl";
import BackupRestoreSettings from "@/components/BackupRestoreSettings";
import SetupWizard from "@/components/SetupWizard";
import LoginScreen from "@/components/LoginScreen";
import DashboardHeader from "@/components/DashboardHeader";
import TabNavigation from "@/components/TabNavigation";
import SettingsPanel from "@/components/SettingsPanel";


export default function Dashboard() {
  const { data: session } = useSession();
  const isConnectedYoutube = !!(session as any)?.youtubeToken;
  const [title, setTitle] = useState("[Spreker] | [Onderwerp] | Ark Church | [Datum]");
  const [description, setDescription] = useState(`Livestream van de Zondagsdienst van Ark Church.

Spreker: [naam spreker]
Thema: [onderwerp]
Website Ark Church         https://www.arkchurch.nl
Volg ons op Instagram  https://www.instagram.com/arkchurchnl
Volg ons op Facebook   https://www.facebook.com/egdeark

Donaties:
Voor giften en donaties https://www.arkchurch.nl/gift/


#arkchurch #ark #Amersfoort  #kerkdienst #Jezus #worship #churchonline #God #church`);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [privacyStatus, setPrivacyStatus] = useState("public");
  const [showEditor, setShowEditor] = useState(false);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  
  // Facebook states removed

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);

  const [categories, setCategories] = useState<any[]>([]);
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [selectedPlaylistId, setSelectedPlaylistId] = useState("");
  const [tags, setTags] = useState("");

  // Tabs
  const [activeTab, setActiveTab] = useState<"planner" | "monitor" | "control" | "lights" | "freeshow">("control");

  // New UI states
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"general" | "connections" | "plugs" | "scheduler" | "midi" | "buttons" | "users" | "freeshow" | "backup">("general");
  const [availableTemplates, setAvailableTemplates] = useState<string[]>([]);
  const [showHelp, setShowHelp] = useState(false);
  const [settings, setSettings] = useState<any>(null);
  const [scheduledStreams, setScheduledStreams] = useState<any[]>([]);
  const [loadingStreams, setLoadingStreams] = useState(false);
  const [errorStreams, setErrorStreams] = useState<string | null>(null);
  const [youtubeQuota, setYoutubeQuota] = useState<{ unitsUsed: number; estimatedLimit: number; percentUsed: number } | null>(null);

  // Local Auth States
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [isOperatorAuthenticated, setIsOperatorAuthenticated] = useState(false);
  const [userRole, setUserRole] = useState<"admin" | "operator" | null>(null);
  const [userPermissions, setUserPermissions] = useState<string[]>([]);
  const [currentUser, setCurrentUser] = useState<string | null>(null);

  // User Management States
  const [localUsers, setLocalUsers] = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "operator">("operator");
  const [newPermissions, setNewPermissions] = useState<string[]>([]);
  const [editingUsername, setEditingUsername] = useState<string | null>(null);
  const [userManagementError, setUserManagementError] = useState("");
  const [userManagementSuccess, setUserManagementSuccess] = useState("");

  const fetchScheduledStreams = async () => {
    setLoadingStreams(true);
    setErrorStreams(null);
    try {
      const res = await fetch(`/api/streams?t=${Date.now()}`);
      let data;
      try {
        data = await res.json();
      } catch (jsonErr) {
        throw new Error(`Server status ${res.status}: Kan antwoord van de server niet verwerken.`);
      }
      if (data.error) throw new Error(data.error);
      if (data.streams) setScheduledStreams(data.streams);
    } catch (err: any) {
      console.error("Fout bij ophalen streams:", err);
      setErrorStreams(err.message);
    }
    setLoadingStreams(false);
  };

  const fetchLocalUsers = async () => {
    setLoadingUsers(true);
    setUserManagementError("");
    try {
      const res = await fetch("/api/users");
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Kon gebruikers niet laden");
      }
      const data = await res.json();
      setLocalUsers(data.users || []);
    } catch (err: any) {
      setUserManagementError(err.message);
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    const checkAuthAndLoad = async () => {
      setIsCheckingAuth(true);
      try {
        const res = await fetch("/api/settings");
        if (res.status === 401) {
          setIsOperatorAuthenticated(false);
          setIsCheckingAuth(false);
          return;
        }
        
        const data = await res.json();
        if (data.error) {
          setIsOperatorAuthenticated(false);
          setIsCheckingAuth(false);
          return;
        }

        setSettings(data);
        if (!data.isSetupComplete) {
          setIsOperatorAuthenticated(true);
          setIsCheckingAuth(false);
          return;
        }

        setIsOperatorAuthenticated(true);
        setUserRole(data.userRole || "operator");
        const perms = data.userPermissions || [];
        setUserPermissions(perms);
        setCurrentUser(data.currentUser || "Operator");
        
        setTitle(data.defaultTitle || "");
        setDescription(data.defaultDescription || "");
        setPrivacyStatus(data.defaultPrivacy || "public");
        
        if (data.userRole === "operator") {
          if (perms.includes("control")) setActiveTab("control");
          else if (perms.includes("planner")) setActiveTab("planner");
          else if (perms.includes("monitor")) setActiveTab("monitor");
          else if (perms.includes("lights")) setActiveTab("lights");
          else if (perms.includes("freeshow")) setActiveTab("freeshow");
        }
      } catch (err) {
        console.error("Error fetching settings/auth status:", err);
      } finally {
        setIsCheckingAuth(false);
      }
    };
    
    checkAuthAndLoad();
  }, []);

  useEffect(() => {
    if (activeTab === "planner" && isConnectedYoutube) {
      fetchScheduledStreams();

      fetch("/api/youtube/categories")
        .then(res => res.json())
        .then(data => {
          if (data.categories) {
            setCategories(data.categories);
            if (!selectedCategoryId) setSelectedCategoryId(settings?.defaultCategoryId || "29");
          }
        });

      fetch("/api/youtube/playlists")
        .then(res => res.json())
        .then(data => {
          if (data.playlists) setPlaylists(data.playlists);
        });
    }
  }, [activeTab, isConnectedYoutube, settings?.defaultCategoryId]);

  // Estimated YouTube Data API quota usage - polled while the planner tab is
  // open so a medewerker sees it's getting close to the daily limit before
  // hitting a quotaExceeded error, instead of only finding out that way.
  useEffect(() => {
    if (activeTab !== "planner" || !isConnectedYoutube) return;
    const fetchQuota = () => {
      fetch("/api/youtube/quota")
        .then(res => res.json())
        .then(data => {
          if (typeof data.percentUsed === 'number') setYoutubeQuota(data);
        })
        .catch(() => {});
    };
    fetchQuota();
    const interval = setInterval(fetchQuota, 60000);
    return () => clearInterval(interval);
  }, [activeTab, isConnectedYoutube]);

  useEffect(() => {
    if (settings) {
      setTags(settings.defaultTags || "");
      setSelectedCategoryId(settings.defaultCategoryId || "29");
    }
  }, [settings]);

  useEffect(() => {
    if (settingsTab === "users" && userRole === "admin" && showSettings) {
      fetchLocalUsers();
    }
  }, [settingsTab, userRole, showSettings]);

  useEffect(() => {
    if (showSettings && settingsTab === "freeshow") {
      fetch("/api/projects")
        .then(res => res.json())
        .then(data => {
          if (data.success && data.projects) {
            setAvailableTemplates(data.projects);
          }
        })
        .catch(err => console.error("Error fetching projects for template list:", err));
    }
  }, [showSettings, settingsTab]);

  const handleOperatorLogout = async () => {
    try {
      await fetch("/api/auth/operator", { method: "DELETE" });
    } catch (err) {
      console.error("Error logging out:", err);
    }
    signOut({ callbackUrl: "/" });
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserManagementError("");
    setUserManagementSuccess("");
    if (!newUsername) {
      setUserManagementError("Gebruikersnaam is verplicht");
      return;
    }
    if (!editingUsername && !newPassword) {
      setUserManagementError("Wachtwoord is verplicht voor nieuwe gebruikers");
      return;
    }
    if (newRole === "operator" && newPermissions.length === 0) {
      setUserManagementError("Een operator moet minimaal één recht toegewezen krijgen");
      return;
    }
    
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: newUsername,
          password: newPassword || undefined,
          role: newRole,
          permissions: newRole === "operator" ? newPermissions : ["planner", "control", "monitor", "lights", "freeshow"]
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setUserManagementError(data.error || "Fout bij opslaan gebruiker");
        return;
      }
      
      setUserManagementSuccess(editingUsername ? "Gebruiker succesvol bijgewerkt" : "Gebruiker succesvol aangemaakt");
      setNewUsername("");
      setNewPassword("");
      setNewRole("operator");
      setNewPermissions([]);
      setEditingUsername(null);
      fetchLocalUsers();
    } catch (err: any) {
      setUserManagementError("Netwerkfout bij opslaan gebruiker");
    }
  };

  const handleDeleteUser = async (usernameToDelete: string) => {
    if (usernameToDelete.toLowerCase() === currentUser?.toLowerCase()) {
      alert("Je kunt je eigen account niet verwijderen.");
      return;
    }
    if (!confirm(`Weet je zeker dat je gebruiker '${usernameToDelete}' wilt verwijderen?`)) {
      return;
    }
    
    setUserManagementError("");
    setUserManagementSuccess("");
    try {
      const res = await fetch(`/api/users?username=${encodeURIComponent(usernameToDelete)}`, {
        method: "DELETE"
      });
      const data = await res.json();
      if (!res.ok) {
        setUserManagementError(data.error || "Fout bij verwijderen gebruiker");
        return;
      }
      
      setUserManagementSuccess("Gebruiker succesvol verwijderd");
      fetchLocalUsers();
    } catch (err) {
      setUserManagementError("Netwerkfout bij verwijderen gebruiker");
    }
  };

  const handleSchedule = async () => {
    if (!title || !description || !scheduleDate || !scheduleTime) {
      setStatus({ type: 'error', message: "Vul alle velden in." });
      return;
    }

    setLoading(true);
    setStatus(null);

    try {
      const dateTime = `${scheduleDate}T${scheduleTime}:00Z`;
      const res = await fetch("/api/streams/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          scheduleTime: dateTime,
          thumbnailUrl,
          privacyStatus,
          categoryId: selectedCategoryId,
          playlistId: selectedPlaylistId,
          tags
        })
      });

      let data;
      try {
        data = await res.json();
      } catch (jsonErr) {
        throw new Error(`Server status ${res.status}: Kan antwoord van de server niet verwerken.`);
      }
      if (data.error) throw new Error(data.error);

      setStatus({ type: 'success', message: "Succes! YouTube is succesvol ingepland en thumbnail is opgeslagen op de NAS. Vergeet niet de livestream ook handmatig in te plannen op Facebook Live Producer!" });
      fetchScheduledStreams(); // Update de lijst
    } catch (err: any) {
      setStatus({ type: 'error', message: `Fout: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteStream = async (id: string, provider: string) => {
    if (!confirm("Weet je zeker dat je deze uitzending wilt verwijderen? Dit geldt voor zowel de planning als de post.")) return;

    try {
      const res = await fetch(`/api/streams?id=${id}&provider=${provider}`, { method: 'DELETE' });
      if (res.ok) {
        fetchScheduledStreams(); // Update de lijst
      } else {
        const data = await res.json();
        alert("Fout bij verwijderen: " + data.error);
      }
    } catch (err) {
      alert("Netwerkfout bij verwijderen.");
    }
  };

  const handleDeleteGroup = async (platforms: { id: string, provider: string }[]) => {
    if (!confirm("Weet je zeker dat je deze uitzending wilt verwijderen van alle geplande platformen?")) return;
    
    try {
      let success = true;
      for (const p of platforms) {
        const res = await fetch(`/api/streams?id=${p.id}&provider=${p.provider}`, { method: 'DELETE' });
        if (!res.ok) {
          success = false;
          const data = await res.json();
          alert(`Fout bij verwijderen van ${p.provider}: ${data.error}`);
        }
      }
      if (success) {
        fetchScheduledStreams(); // Update de lijst
      }
    } catch (err) {
      alert("Netwerkfout bij verwijderen.");
    }
  };

  const getGroupedStreams = () => {
    const groups: any[] = [];
    scheduledStreams.forEach((stream: any) => {
      let timeStr = "";
      try {
        if (stream.startTime) {
          const date = new Date(stream.startTime);
          if (!isNaN(date.getTime())) {
            timeStr = date.toISOString().slice(0, 16);
          }
        }
      } catch (e) {
        console.error("Error parsing stream startTime:", stream.startTime, e);
      }
      if (!timeStr) {
        timeStr = "Onbekende tijd";
      }
      const key = `${stream.title}_${timeStr}`;
      const existing = groups.find((g: any) => g.key === key);
      
      if (existing) {
        existing.platforms.push(stream);
      } else {
        groups.push({
          key,
          title: stream.title,
          startTime: stream.startTime,
          platforms: [stream]
        });
      }
    });
    return groups;
  };

  const handleSaveThumbnail = (dataUrl: string) => {
    setThumbnailUrl(dataUrl);
    setShowEditor(false);
  };

  const handleSaveSettings = async () => {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings)
    });
    if (res.ok) {
      setShowSettings(false);
      setStatus({ type: 'success', message: "Alle instellingen zijn succesvol bijgewerkt!" });
    }
  };

  // 1. Show setup wizard if not configured
  if (settings && !settings.isSetupComplete) {
    return (
      <SetupWizard settings={settings} onComplete={(newSettings) => {
        setSettings(newSettings);
        window.location.reload();
      }} />
    );
  }

  // 2. Show authentication checking loader
  if (isCheckingAuth) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <div className="glass-card" style={{ padding: '40px', textAlign: 'center' }}>
          <RefreshCcw size={48} className="spin" color="var(--primary)" style={{ margin: '0 auto 20px' }} />
          <p style={{ color: 'var(--muted)' }}>Controleeren van autorisatie...</p>
        </div>
      </div>
    );
  }

  // 3. Show local operator login screen if not authenticated
  if (!isOperatorAuthenticated) {
    return <LoginScreen onLogin={() => window.location.reload()} />;
  }

  return (
    <div className="dashboard-container">
      <DashboardHeader
        userRole={userRole}
        currentUser={currentUser}
        onShowHelp={() => setShowHelp(true)}
        onShowSettings={() => setShowSettings(true)}
        onLogout={handleOperatorLogout}
      />

      <TabNavigation
        activeTab={activeTab}
        userRole={userRole}
        userPermissions={userPermissions}
        onTabChange={setActiveTab}
      />

      <AnimatePresence mode="wait">
        {activeTab === "planner" ? (
          !isConnectedYoutube ? (
            <motion.div 
              key="youtube-connect-prompt"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="glass-card" 
              style={{ padding: '40px', display: 'flex', flexDirection: 'column', gap: '20px', alignItems: 'center', maxWidth: '500px', margin: '40px auto' }}
            >
              <MonitorPlay size={48} color="var(--primary)" />
              <h2 style={{ fontSize: '1.5rem', fontWeight: 600 }}>Koppel YouTube Account</h2>
              <p style={{ color: 'var(--muted)', textAlign: 'center', fontSize: '0.95rem' }}>
                Om livestreams in te plannen en te beheren, moet deze app gekoppeld zijn met het Google/YouTube account van de kerk.
              </p>
              
              <button 
                className="btn-primary" 
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }} 
                onClick={() => signIn("google")}
              >
                <MonitorPlay size={20} />
                Inloggen met Google
              </button>
            </motion.div>
          ) : (
            <motion.div 
              key="planner"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '32px' }}
            >
            {/* Left Column */}
            <motion.section 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-card"
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '32px' }}>
                <LayoutDashboard size={24} color="var(--primary)" />
                <h2>Stream Inplannen</h2>
              </div>

          <div className="input-group">
            <label className="input-label">Uitzending Titel</label>
            <input 
              className="input-field" 
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="input-group">
            <label className="input-label">Beschrijving</label>
            <textarea 
              className="input-field" 
              style={{ minHeight: '200px' }}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div className="input-group">
              <label className="input-label">Datum</label>
              <input type="date" className="input-field" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} />
            </div>
            <div className="input-group">
              <label className="input-label">Tijd</label>
              <input type="time" className="input-field" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div className="input-group">
              <label className="input-label">YouTube Privacy</label>
              <select className="input-field" value={privacyStatus} onChange={(e) => setPrivacyStatus(e.target.value)}>
                <option value="public">Openbaar</option>
                <option value="unlisted">Verborgen</option>
                <option value="private">Privé</option>
              </select>
            </div>
            <div className="input-group">
              <label className="input-label">Facebook Live</label>
              <div className="input-field" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'rgba(255,255,255,0.5)', background: 'rgba(255,255,255,0.02)', fontSize: '0.85rem', height: '42px', padding: '0 12px' }}>
                <Globe size={16} color="#3b82f6" />
                <span>Handmatig inplannen op Live Producer</span>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginTop: '20px' }}>
            <div className="input-group">
              <label className="input-label">YouTube Categorie</label>
              <select className="input-field" value={selectedCategoryId} onChange={(e) => setSelectedCategoryId(e.target.value)}>
                {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.title}</option>)}
              </select>
            </div>
            <div className="input-group">
              <label className="input-label">YouTube Playlist</label>
              <select className="input-field" value={selectedPlaylistId} onChange={(e) => setSelectedPlaylistId(e.target.value)}>
                <option value="">Geen Playlist</option>
                {playlists.map(pl => <option key={pl.id} value={pl.id}>{pl.title}</option>)}
              </select>
            </div>
          </div>

          <div className="input-group" style={{ marginTop: '20px' }}>
            <label className="input-label">YouTube Tags (comma gescheiden)</label>
            <input 
              className="input-field" 
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="tag1, tag2, tag3"
            />
          </div>

          <button className="btn-primary" style={{ width: '100%', marginTop: '16px' }} onClick={handleSchedule} disabled={loading}>
            {loading ? "Actie uitvoeren..." : <><Send size={18} /> Plan Alles In</>}
          </button>
          
          {status && (
            <p style={{ marginTop: '16px', textAlign: 'center', color: status.type === 'success' ? '#4ade80' : '#f87171', fontSize: '0.9rem' }}>
              {status.message}
            </p>
          )}
        </motion.section>

        {/* Right Column (Actions & Streams List) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
          {/* Scheduled Streams Card */}
          <motion.section 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="glass-card"
            style={{ padding: '24px' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <Clock size={24} color="var(--primary)" />
                <h2>Geplande Streams</h2>
              </div>
              <button onClick={fetchScheduledStreams} disabled={loadingStreams} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer' }}>
                <RefreshCcw size={16} className={loadingStreams ? "spin" : ""} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '400px', overflowY: 'auto', paddingRight: '8px' }}>
              {errorStreams && (
                <div style={{ padding: '16px', borderRadius: '8px', background: 'rgba(248, 113, 113, 0.1)', border: '1px solid rgba(248, 113, 113, 0.2)', color: '#f87171', fontSize: '0.85rem' }}>
                  Fout bij ophalen: {errorStreams}
                </div>
              )}

              {scheduledStreams.length === 0 && !loadingStreams && !errorStreams && (
                <p style={{ color: 'var(--muted)', fontSize: '0.9rem', textAlign: 'center', padding: '20px' }}>Geen geplande uitzendingen gevonden.</p>
              )}

              {getGroupedStreams().map((group: any) => {
                const hasYoutube = group.platforms.some((p: any) => p.provider === 'youtube');
                const ytStream = group.platforms.find((p: any) => p.provider === 'youtube');
                
                return (
                  <div key={group.key} className="glass-card" style={{ padding: '16px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--card-border)', display: 'flex', alignItems: 'center', gap: '12px', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {hasYoutube && (
                          <div style={{ padding: '6px', borderRadius: '6px', background: 'rgba(239, 68, 68, 0.1)', display: 'flex', alignItems: 'center' }} title="YouTube">
                            <MonitorPlay size={16} color="#ef4444" />
                          </div>
                        )}
                      </div>
                      <div>
                        <p style={{ fontSize: '0.9rem', fontWeight: 600, maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group.title}</p>
                        <p style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                          {new Date(group.startTime).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                      {ytStream?.embedUrl && (
                        <>
                          <a href={ytStream.embedUrl} target="_blank" rel="noopener noreferrer" style={{ padding: '6px', borderRadius: '6px', color: 'rgba(239, 68, 68, 0.7)' }} className="hover-white" title="Bekijk op YouTube">
                            <Link size={16} />
                          </a>
                          <button
                            onClick={() => {
                              const link = ytStream.embedUrl;
                              const titleStr = group.title;
                              const dateStr = new Date(group.startTime).toLocaleDateString('nl-NL', { day: '2-digit', month: 'long', year: 'numeric' });
                              const timeStr = new Date(group.startTime).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
                              
                              let text = settings?.whatsappTemplate || "Hallo allemaal! Komende zondag zenden we weer live uit. U kunt de dienst volgen via deze link: {link}. Tot dan!";
                              text = text
                                .replace(/{link}/g, link)
                                .replace(/{titel}/g, titleStr)
                                .replace(/{datum}/g, dateStr)
                                .replace(/{tijd}/g, timeStr);
                              
                              const encodedText = encodeURIComponent(text);
                              window.open(`https://wa.me/?text=${encodedText}`, '_blank');
                            }}
                            style={{ 
                              padding: '6px', 
                              borderRadius: '6px', 
                              background: 'none', 
                              border: 'none', 
                              color: '#25d366', 
                              cursor: 'pointer', 
                              transition: 'background 0.2s, transform 0.2s',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              marginLeft: '2px'
                            }} 
                            className="hover-white"
                            title="Deel via WhatsApp"
                          >
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                              <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.246 8.477 3.513 2.262 2.268 3.507 5.28 3.505 8.484-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.502-5.717-1.456L0 24zm6.59-4.846c1.6.95 3.188 1.449 4.625 1.451 5.403.002 9.803-4.392 9.806-9.799.002-2.618-1.018-5.08-2.873-6.937C16.297 2.012 13.834 1 11.237 1 5.83 1 1.432 5.396 1.429 10.803c0 1.555.42 3.086 1.215 4.437l-.991 3.613 3.702-.97.001-.001-.001-.001zM17.5 15.65c-.29-.145-1.71-.845-1.975-.94-.266-.096-.46-.145-.652.145-.19.29-.74.94-.905 1.13-.167.19-.334.21-.624.066-1.053-.527-1.84-1.022-2.583-2.29-.196-.334.196-.31.56-.1.328.19.426.24.623.636.196.398.1.745-.05 1.036-.148.29-.652 1.566-.893 2.147-.234.568-.47.49-.652.482-.162-.008-.348-.01-.533-.01-.186 0-.49.07-.746.347-.256.278-.977.955-.977 2.33 0 1.374 1.002 2.7 1.14 2.885.14.185 1.97 3.01 4.777 4.223.667.29 1.19.462 1.6.59.67.213 1.28.183 1.76.11.536-.08 1.71-.7 1.954-1.377.243-.678.243-1.26.17-1.377-.07-.117-.26-.213-.556-.358z"/>
                            </svg>
                          </button>
                        </>
                      )}
                      <button 
                        onClick={() => handleDeleteGroup(group.platforms)} 
                        style={{ padding: '6px', borderRadius: '6px', background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', transition: 'background 0.2s', marginLeft: '4px' }} 
                        className="hover-red"
                        title="Verwijder uitzending van alle platformen"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.section>

          {/* Thumbnail Preview Card */}
          <motion.section 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
            className="glass-card"
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
              <ImageIcon size={24} color="var(--primary)" />
              <h2>Thumbnail</h2>
            </div>
            
            <div 
              onClick={() => setShowEditor(true)}
              style={{ 
                aspectRatio: '16/9', 
                background: thumbnailUrl ? `url(${thumbnailUrl}) center/cover no-repeat` : 'rgba(255,255,255,0.02)', 
                borderRadius: '8px', 
                border: '1px solid var(--card-border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer'
              }}
            >
              {!thumbnailUrl && <Upload size={32} color="var(--muted)" />}
            </div>

            <button onClick={() => setShowEditor(true)} className="btn-outline" style={{ width: '100%', marginTop: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              <Layers size={18} /> Open Editor
            </button>
          </motion.section>

          <motion.section 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="glass-card"
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
              <Settings size={24} color="var(--primary)" />
              <h2>Verbindingen</h2>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>YouTube Kanaal</span>
                <span style={{ color: '#4ade80', fontSize: '0.9rem' }}>Gekoppeld ✓</span>
              </div>
              {youtubeQuota && youtubeQuota.percentUsed >= 70 && (
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  background: youtubeQuota.percentUsed >= 90 ? 'rgba(239, 68, 68, 0.1)' : 'rgba(234, 179, 8, 0.1)',
                  border: `1px solid ${youtubeQuota.percentUsed >= 90 ? 'rgba(239, 68, 68, 0.3)' : 'rgba(234, 179, 8, 0.3)'}`,
                  borderRadius: '8px', padding: '8px 12px', fontSize: '0.8rem'
                }}>
                  <span style={{ color: youtubeQuota.percentUsed >= 90 ? '#f87171' : '#fcd34d' }}>
                    ⚠️ API-quota: {youtubeQuota.percentUsed}% gebruikt vandaag
                  </span>
                  <span style={{ color: 'var(--muted)', fontSize: '0.7rem' }} title="Schatting, gebaseerd op standaard Google-daglimiet">
                    (schatting)
                  </span>
                </div>
              )}
              <div style={{
                background: 'rgba(59, 130, 246, 0.08)', 
                border: '1px solid rgba(59, 130, 246, 0.2)', 
                borderRadius: '8px', 
                padding: '12px', 
                marginTop: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px'
              }}>
                <span style={{ color: '#60a5fa', fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Globe size={14} /> Facebook Info
                </span>
                <span style={{ color: 'var(--muted)', fontSize: '0.75rem', lineHeight: '1.4' }}>
                  Livestream dient handmatig te worden ingepland via de Facebook Live Producer pagina.
                </span>
              </div>
            </div>
            </motion.section>
          </div>
            </motion.div>
          )
        ) : activeTab === "monitor" ? (
        <motion.div
          key="monitor"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 20 }}
        >
          <StreamMonitor settings={settings} scheduledStreams={scheduledStreams} />
        </motion.div>
      ) : activeTab === "control" ? (
        <motion.div
          key="control"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
        >
          <BroadcastControlCenter settings={settings} userRole={userRole || undefined} userPermissions={userPermissions} />
        </motion.div>
      ) : activeTab === "lights" ? (
        <motion.div
          key="lights"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
        >
          <LightsControl settings={settings} />
        </motion.div>
      ) : (
        <motion.div
          key="freeshow"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
        >
          <FreeshowGenerator />
        </motion.div>
      )}
      </AnimatePresence>

      <AnimatePresence>
        {showSettings && settings && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(2, 6, 23, 0.98)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
          >
            <SettingsPanel
              settings={settings}
              settingsTab={settingsTab}
              userRole={userRole}
              localUsers={localUsers}
              availableTemplates={availableTemplates}
              loadingUsers={loadingUsers}
              newUsername={newUsername}
              newPassword={newPassword}
              newRole={newRole}
              newPermissions={newPermissions}
              editingUsername={editingUsername}
              userManagementError={userManagementError}
              userManagementSuccess={userManagementSuccess}
              currentUser={currentUser}
              onClose={() => setShowSettings(false)}
              onSettingsChange={setSettings}
              onTabChange={setSettingsTab}
              onSaveSettings={handleSaveSettings}
              onSaveUser={handleSaveUser}
              onDeleteUser={handleDeleteUser}
              setNewUsername={setNewUsername}
              setNewPassword={setNewPassword}
              setNewRole={setNewRole}
              setNewPermissions={setNewPermissions}
              setEditingUsername={setEditingUsername}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showEditor && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.9)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
          >
            <ThumbnailEditor onSave={handleSaveThumbnail} onClose={() => setShowEditor(false)} />
          </motion.div>
        )}


        {showHelp && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.9)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
          >
            <div className="glass-card" style={{ width: '100%', maxWidth: '700px', padding: '40px', position: 'relative' }}>
              <button onClick={() => setShowHelp(false)} style={{ position: 'absolute', top: '24px', right: '24px', background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer' }}>
                <X size={24} />
              </button>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
                <HelpCircle size={32} color="var(--primary)" />
                <h1 style={{ fontSize: '1.75rem' }}>Hoe gebruik je de Manager?</h1>
              </div>

              <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: '1rem', lineHeight: '1.6', marginBottom: '28px' }}>
                De Ark Church Livestream Manager helpt je bij alles rond een dienst: uitzendingen inplannen op YouTube, live bediening tijdens de uitzending, het samenstellen van FreeShow-presentaties, lichtregie, en (voor beheerders) alle instellingen. Bovenin vind je tot vijf tabbladen — welke je ziet hangt af van je rechten:
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', color: 'rgba(255,255,255,0.8)', fontSize: '1rem', lineHeight: '1.6' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr', gap: '16px' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--primary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem' }}>📅</div>
                  <div>
                    <h3 style={{ color: 'white', marginBottom: '4px' }}>Planner</h3>
                    <p>YouTube-uitzendingen inplannen: titel, beschrijving, tijdstip en thumbnail, en de lijst met geplande streams beheren.</p>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr', gap: '16px' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--primary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem' }}>🎛️</div>
                  <div>
                    <h3 style={{ color: 'white', marginBottom: '4px' }}>Regie</h3>
                    <p>Het centrale bedieningspaneel tijdens een dienst: systeemstatus van alle gekoppelde diensten, slimme stekkers, en configureerbare noodknoppen.</p>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr', gap: '16px' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--primary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem' }}>📺</div>
                  <div>
                    <h3 style={{ color: 'white', marginBottom: '4px' }}>Monitor</h3>
                    <p>Gedetailleerd inzicht in en bediening van OBS en de live YouTube-uitzending: statistieken, scènes, audiomixer en een configuratiecheck.</p>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr', gap: '16px' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--primary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem' }}>💡</div>
                  <div>
                    <h3 style={{ color: 'white', marginBottom: '4px' }}>Licht</h3>
                    <p>QLC+ lichtbediening: hoofdscènes, lichtshows, kleurgroepen, stroboscoop en dimmers.</p>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr', gap: '16px' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--primary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem' }}>⛪</div>
                  <div>
                    <h3 style={{ color: 'white', marginBottom: '4px' }}>FreeShow</h3>
                    <p>Liederen, Bijbelteksten en media samenstellen tot een compleet FreeShow-project voor de dienst — inclusief de automatische aanlevering per e-mail.</p>
                  </div>
                </div>
              </div>

              <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.85rem', marginTop: '20px' }}>
                Zie je niet alle vijf? Een Operator ziet alleen de tabbladen waarvoor een Administrator rechten heeft gegeven. Voor de details per onderdeel: zie de volledige handleiding hieronder.
              </p>

              <div style={{ marginTop: '40px', padding: '20px', background: 'rgba(56, 189, 248, 0.1)', borderRadius: '12px', border: '1px solid rgba(56, 189, 248, 0.2)' }}>
                <p style={{ fontSize: '0.9rem', color: 'var(--primary)', fontWeight: 600 }}>Tip voor OBS:</p>
                <p style={{ fontSize: '0.85rem' }}>In OBS kun je een 'Afbeelding' bron toevoegen die verwijst naar <code style={{ background: 'rgba(0,0,0,0.3)', padding: '2px 4px', borderRadius: '4px' }}>thema.jpg</code> in de geconfigureerde map. Deze wordt dan automatisch bijgewerkt!</p>
              </div>

              <div style={{ marginTop: '20px', padding: '20px', background: 'rgba(255,255,255,0.04)', borderRadius: '12px', border: '1px solid var(--card-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                  <p style={{ fontSize: '0.9rem', fontWeight: 600, margin: 0 }}>📄 Volledige handleiding</p>
                  <p style={{ fontSize: '0.8rem', opacity: 0.7, margin: '4px 0 0 0' }}>Alle onderdelen van de app, inclusief Instellingen en FreeShow Projecten. Klik op &quot;Afdrukken&quot; en kies &quot;Opslaan als PDF&quot; in je browser.</p>
                </div>
                <a
                  href="/manual/nl"
                  target="_blank"
                  className="button"
                  style={{ background: 'var(--primary)', color: '#020617', textDecoration: 'none', display: 'inline-block', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
                >
                  Open handleiding
                </a>
              </div>
            </div>
          </motion.div>
        )}

        {settings && !settings.isSetupComplete && (
          <SetupWizard settings={settings} onComplete={(newSettings) => {
            setSettings(newSettings);
            window.location.reload(); // Reload to apply OAuth keys to NextAuth
          }} />
        )}
      </AnimatePresence>
    </div>
  );
}
