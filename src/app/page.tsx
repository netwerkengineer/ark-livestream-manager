"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { signIn, signOut, useSession } from "next-auth/react";
import ThumbnailEditor from "@/components/ThumbnailEditor";
import StreamMonitor from "@/components/StreamMonitor";
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
  Monitor
} from "lucide-react";
import BroadcastControlCenter from "@/components/BroadcastControlCenter";
import LightsControl from "@/components/LightsControl";


export default function Dashboard() {
  const { data: session } = useSession();
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
  const [activeTab, setActiveTab] = useState<"planner" | "monitor" | "control" | "lights">("planner");

  // New UI states
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [settings, setSettings] = useState<any>(null);
  const [scheduledStreams, setScheduledStreams] = useState<any[]>([]);
  const [loadingStreams, setLoadingStreams] = useState(false);

  const [errorStreams, setErrorStreams] = useState<string | null>(null);

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

  useEffect(() => {
    // Always fetch settings to check isSetupComplete
    fetch("/api/settings")
      .then(res => res.json())
      .then(data => {
        if (!data.error) {
          setSettings(data);
          setTitle(data.defaultTitle);
          setDescription(data.defaultDescription);
          setPrivacyStatus(data.defaultPrivacy);
        }
      });

    if (session) {
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
  }, [session, settings?.defaultCategoryId]);

  useEffect(() => {
    if (settings) {
      setTags(settings.defaultTags || "");
      setSelectedCategoryId(settings.defaultCategoryId || "29");
    }
  }, [settings]);

  const isConnectedYoutube = !!(session as any)?.youtubeToken;

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
      const timeStr = new Date(stream.startTime).toISOString().slice(0, 16);
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

  // 1. Show setup wizard if not configured
  if (settings && !settings.isSetupComplete) {
    return (
      <SetupWizard settings={settings} onComplete={(newSettings) => {
        setSettings(newSettings);
        window.location.reload();
      }} />
    );
  }

  // 2. Show login screen if not connected (Only YouTube is strictly required!)
  if (!isConnectedYoutube) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '32px' }}>
        <div className="logo-container">
          <img src="/logo.png" alt="Ark Church Logo" />
          <h1 className="gradient-text">Livestream Manager</h1>
        </div>
        <div className="glass-card" style={{ padding: '40px', display: 'flex', flexDirection: 'column', gap: '20px', alignItems: 'center', width: '450px' }}>
          <p style={{ color: 'var(--muted)', textAlign: 'center' }}>Verbind je YouTube account om streams in te plannen</p>
          
          <button 
            className="btn-primary" 
            style={{ width: '100%' }} 
            onClick={() => signIn("google")}
          >
            <MonitorPlay size={20} />
            Verbind YouTube
          </button>
        </div>
      </div>
    );
  }

  // Selected page lookup removed

  return (
    <div className="dashboard-container">
      <div className="logo-container" style={{ marginBottom: '48px', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <img src="/logo.png" alt="Ark Church Logo" />
          <div>
            <h1 style={{ fontSize: '1.5rem', lineHeight: '1' }}>Ark Church</h1>
            <p style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>Livestream Manager</p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button onClick={() => setShowHelp(true)} className="btn-outline" style={{ padding: '10px' }} title="Help">
            <HelpCircle size={20} />
          </button>
          <button onClick={() => setShowSettings(true)} className="btn-outline" style={{ padding: '10px' }} title="Instellingen">
            <Settings size={20} />
          </button>
          <div style={{ borderLeft: '1px solid var(--card-border)', height: '24px', margin: '0 8px' }}></div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 600 }}>OPERATOR</p>
            <p style={{ fontSize: '0.9rem' }}>{session?.user?.name}</p>
          </div>
          <button onClick={() => signOut()} className="btn-outline" style={{ padding: '10px' }} title="Uitloggen">
            <User size={20} />
          </button>
        </div>
      </div>
      
      {/* Tab Navigation */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '32px' }}>
        <button 
          onClick={() => setActiveTab("planner")} 
          className={activeTab === "planner" ? "btn-primary" : "btn-outline"}
          style={{ padding: '8px 20px', borderRadius: '12px' }}
        >
          <LayoutDashboard size={18} /> Dashboard
        </button>
        <button 
          onClick={() => setActiveTab("monitor")} 
          className={activeTab === "monitor" ? "btn-primary" : "btn-outline"}
          style={{ padding: '8px 20px', borderRadius: '12px' }}
        >
          <Activity size={18} /> Live Monitor
        </button>
        <button 
          onClick={() => setActiveTab("control")} 
          className={activeTab === "control" ? "btn-primary" : "btn-outline"}
          style={{ padding: '8px 20px', borderRadius: '12px', border: activeTab === "control" ? 'none' : '1px solid rgba(248, 113, 113, 0.4)' }}
        >
          <ShieldAlert size={18} /> Control Center
        </button>
        <button 
          onClick={() => setActiveTab("lights")} 
          className={activeTab === "lights" ? "btn-primary" : "btn-outline"}
          style={{ padding: '8px 20px', borderRadius: '12px', border: activeTab === "lights" ? 'none' : '1px solid rgba(249, 115, 22, 0.4)' }}
        >
          <Sun size={18} /> Lichtregie
        </button>
      </div>

      <AnimatePresence mode="wait">
        {activeTab === "planner" ? (
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
          <BroadcastControlCenter settings={settings} />
        </motion.div>
      ) : (
        <motion.div
          key="lights"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
        >
          <LightsControl settings={settings} />
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
            <div className="glass-card" style={{ width: '100%', maxWidth: '1000px', padding: '40px', position: 'relative', height: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '40px' }}>
              <button onClick={() => setShowSettings(false)} style={{ position: 'absolute', top: '24px', right: '24px', background: 'rgba(255,255,255,0.05)', border: 'none', color: 'white', padding: '8px', borderRadius: '50%', cursor: 'pointer' }}>
                <X size={24} />
              </button>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <div style={{ background: 'rgba(248, 113, 113, 0.15)', padding: '12px', borderRadius: '16px' }}>
                  <Settings size={32} color="var(--primary)" />
                </div>
                <div>
                  <h2 style={{ fontSize: '2rem', marginBottom: '4px' }}>Systeem Configuratie</h2>
                  <p style={{ color: 'var(--muted)' }}>Beheer alle hardware verbindingen en dashboard instellingen.</p>
                </div>
              </div>

              {/* Sectie 1: Algemeen */}
              <section style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <h3 style={{ fontSize: '1.25rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '12px' }}>📝 Algemene Instellingen</h3>
                
                <div className="input-group">
                  <label className="input-label">Thumbnail Opslag Pad (NAS)</label>
                  <input className="input-field" value={settings.thumbnailSavePath} onChange={(e) => setSettings({...settings, thumbnailSavePath: e.target.value})} placeholder="/volume1/Beamer/FreeShow/Media" />
                  <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '8px' }}>Dit is de map op de NAS waar OBS de thumbnails ophaalt.</p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                  <div className="input-group">
                    <label className="input-label">Standaard Stream Titel</label>
                    <input className="input-field" value={settings.defaultTitle} onChange={(e) => setSettings({...settings, defaultTitle: e.target.value})} />
                  </div>
                  <div className="input-group">
                    <label className="input-label">Standaard YouTube Tags</label>
                    <input className="input-field" value={settings.defaultTags} onChange={(e) => setSettings({...settings, defaultTags: e.target.value})} placeholder="Ark Church, Kerkdienst, Live" />
                  </div>
                </div>

                <div className="input-group">
                  <label className="input-label">Standaard Beschrijving</label>
                  <textarea className="input-field" style={{ minHeight: '150px', lineHeight: '1.6' }} value={settings.defaultDescription} onChange={(e) => setSettings({...settings, defaultDescription: e.target.value})} />
                </div>

                <div className="input-group">
                  <label className="input-label">WhatsApp Uitnodiging Template</label>
                  <textarea 
                    className="input-field" 
                    style={{ minHeight: '100px', lineHeight: '1.6' }} 
                    value={settings.whatsappTemplate || ""} 
                    onChange={(e) => setSettings({...settings, whatsappTemplate: e.target.value})} 
                    placeholder="Hallo allemaal! Komende zondag zenden we weer live uit. U kunt de dienst volgen via deze link: {link}. Tot dan!"
                  />
                  <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginTop: '8px', lineHeight: '1.5' }}>
                    Pas hier het standaard WhatsApp-bericht aan. Je kunt de volgende variabelen gebruiken:
                    <br />
                    <code style={{ background: 'rgba(255,255,255,0.06)', padding: '2px 4px', borderRadius: '4px', marginRight: '6px', fontSize: '0.8rem' }}>{"{link}"}</code> (YouTube Link)
                    <code style={{ background: 'rgba(255,255,255,0.06)', padding: '2px 4px', borderRadius: '4px', marginRight: '6px', fontSize: '0.8rem' }}>{"{titel}"}</code> (Uitzending Titel)
                    <code style={{ background: 'rgba(255,255,255,0.06)', padding: '2px 4px', borderRadius: '4px', marginRight: '6px', fontSize: '0.8rem' }}>{"{datum}"}</code> (Bijv. 05 juni 2026)
                    <code style={{ background: 'rgba(255,255,255,0.06)', padding: '2px 4px', borderRadius: '4px', fontSize: '0.8rem' }}>{"{tijd}"}</code> (Bijv. 10:00)
                  </p>
                </div>
              </section>

              {/* Sectie 2: Hardware & Netwerk */}
              <section style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <h3 style={{ fontSize: '1.25rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '12px' }}>🌐 Hardware Verbindingen (IP's)</h3>
                
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
                  <div className="glass-card" style={{ padding: '20px', background: 'rgba(255,255,255,0.02)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}><MonitorPlay size={18} color="var(--primary)" /> <strong>OBS WebSocket</strong></div>
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
                      <input className="input-field" placeholder="IP Adres" value={settings.obsHost} onChange={(e) => setSettings({...settings, obsHost: e.target.value})} />
                      <input className="input-field" type="number" placeholder="Poort" value={settings.obsPort} onChange={(e) => setSettings({...settings, obsPort: parseInt(e.target.value)})} />
                    </div>
                    <input className="input-field" type="password" style={{ marginTop: '12px' }} placeholder="Wachtwoord (optioneel)" value={settings.obsPassword} onChange={(e) => setSettings({...settings, obsPassword: e.target.value})} />
                  </div>

                  <div className="glass-card" style={{ padding: '20px', background: 'rgba(255,255,255,0.02)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}><Activity size={18} color="var(--primary)" /> <strong>Bitfocus Companion</strong></div>
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
                      <input className="input-field" placeholder="IP Adres" value={settings.companionHost} onChange={(e) => setSettings({...settings, companionHost: e.target.value})} />
                      <input className="input-field" type="number" placeholder="Poort" value={settings.companionPort} onChange={(e) => setSettings({...settings, companionPort: parseInt(e.target.value)})} />
                    </div>
                  </div>

                  <div className="glass-card" style={{ padding: '20px', background: 'rgba(255,255,255,0.02)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}><ShieldAlert size={18} color="var(--primary)" /> <strong>Behringer X32 (OSC)</strong></div>
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
                      <input className="input-field" placeholder="IP Adres" value={settings.x32Host} onChange={(e) => setSettings({...settings, x32Host: e.target.value})} />
                      <input className="input-field" type="number" placeholder="Poort" value={settings.x32Port} onChange={(e) => setSettings({...settings, x32Port: parseInt(e.target.value)})} />
                    </div>
                  </div>

                  {/* QLC+ Configuration */}
                  <div className="glass-card" style={{ padding: '20px', background: 'rgba(255,255,255,0.02)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Sun size={18} color="#f97316" /> <strong>Lichtregie (QLC+)</strong></div>
                      <label className="switch" style={{ scale: '0.8' }}>
                        <input 
                          type="checkbox" 
                          checked={settings.qlcEnabled} 
                          onChange={(e) => setSettings({...settings, qlcEnabled: e.target.checked})}
                        />
                        <span className="slider round"></span>
                      </label>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', opacity: settings.qlcEnabled ? 1 : 0.5, pointerEvents: settings.qlcEnabled ? 'auto' : 'none' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '8px' }}>
                        <input className="input-field" placeholder="QLC+ IP" value={settings.qlcHost} onChange={(e) => setSettings({...settings, qlcHost: e.target.value})} />
                        <input className="input-field" type="number" placeholder="Poort" value={settings.qlcPort} onChange={(e) => setSettings({...settings, qlcPort: parseInt(e.target.value) || 7700})} />
                      </div>
                      <p className="text-[10px] text-muted">Standaard OSC poort voor QLC+ is 7700.</p>
                    </div>
                  </div>

                  {/* FreeShow Configuration */}
                  <div className="glass-card" style={{ padding: '20px', background: 'rgba(255,255,255,0.02)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}><Monitor size={18} color="#3b82f6" /> <strong>Presentatie (FreeShow)</strong></div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '8px' }}>
                        <input className="input-field" placeholder="FreeShow IP" value={settings.freeShowHost} onChange={(e) => setSettings({...settings, freeShowHost: e.target.value})} />
                        <input className="input-field" type="number" placeholder="Poort" value={settings.freeShowPort} onChange={(e) => setSettings({...settings, freeShowPort: parseInt(e.target.value) || 5505})} />
                      </div>
                      <input className="input-field" placeholder="Media Pad op NAS (bijv. /volume1/Media)" value={settings.mediaPath} onChange={(e) => setSettings({...settings, mediaPath: e.target.value})} />
                      <p className="text-[10px] text-muted">Dit pad wordt gebruikt om thumbnails van je beamer-presentaties te tonen.</p>
                    </div>
                  </div>
                </div>
              </section>
              
              {/* Sectie 2.5: MIDI Bridge */}
              <section style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <h3 style={{ fontSize: '1.25rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '12px' }}>🎹 MIDI Bridge (rtpMIDI)</h3>
                
                <div className="glass-card" style={{ padding: '24px', background: 'rgba(255,255,255,0.02)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{ background: settings.midiEnabled ? 'rgba(74, 222, 128, 0.1)' : 'rgba(248, 113, 113, 0.1)', padding: '10px', borderRadius: '12px' }}>
                        <Database size={24} color={settings.midiEnabled ? '#4ade80' : '#f87171'} />
                      </div>
                      <div>
                        <p style={{ fontWeight: 600 }}>rtpMIDI Sessie Status</p>
                        <p style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                          {settings.midiEnabled ? "Actief en zichtbaar op netwerk" : "Uitgeschakeld"}
                        </p>
                      </div>
                    </div>
                    <label className="switch" style={{ position: 'relative', display: 'inline-block', width: '50px', height: '26px' }}>
                      <input 
                        type="checkbox" 
                        checked={settings.midiEnabled} 
                        onChange={(e) => setSettings({...settings, midiEnabled: e.target.checked})}
                        style={{ opacity: 0, width: 0, height: 0 }}
                      />
                      <span style={{ 
                        position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0, 
                        backgroundColor: settings.midiEnabled ? 'var(--primary)' : '#444', 
                        transition: '.4s', borderRadius: '34px' 
                      }}>
                        <span style={{ 
                          position: 'absolute', content: '""', height: '18px', width: '18px', left: settings.midiEnabled ? '28px' : '4px', bottom: '4px', 
                          backgroundColor: 'white', transition: '.4s', borderRadius: '50%' 
                        }}></span>
                      </span>
                    </label>
                  </div>

                  {settings.midiEnabled && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '20px' }}>
                      <div className="input-group">
                        <label className="input-label">Sessie Naam (Apple MIDI)</label>
                        <input 
                          className="input-field" 
                          value={settings.midiSessionName} 
                          onChange={(e) => setSettings({...settings, midiSessionName: e.target.value})} 
                          placeholder="Ark-Church-App" 
                        />
                        <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '8px' }}>
                          Dit is de naam die verschijnt in de "Audio MIDI Setup" op je Playback Mac.
                        </p>
                      </div>

                      <div className="input-group">
                        <label className="input-label">rtpMIDI Auto-Connect IPs (Kommagescheiden)</label>
                        <input 
                          className="input-field" 
                          value={settings.midiAutoConnectIps || ""} 
                          onChange={(e) => setSettings({...settings, midiAutoConnectIps: e.target.value})} 
                          placeholder="Bijv: 192.168.2.109, 192.168.2.223" 
                        />
                        <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '8px' }}>
                          Voer hier de IP-adressen van je Mac of iPad in. De app zal automatisch verbinding zoeken op poort 5004.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </section>

              {/* Sectie 3: Dashboard Knoppen */}
              <section style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '12px' }}>
                  <h3 style={{ fontSize: '1.25rem' }}>🔘 Dashboard Knoppen (Control Center)</h3>
                  <button 
                    onClick={() => {
                      const newButton = { id: Math.random().toString(36).substr(2, 9), name: 'NIEUWE KNOP', sub: 'Beschrijving', icon: 'zap', color: 'blue', page: 1, row: 0, col: 0 };
                      setSettings({...settings, broadcastButtons: [...(settings.broadcastButtons || []), newButton]});
                    }}
                    className="btn-primary" 
                    style={{ padding: '8px 20px', fontSize: '0.9rem' }}
                  >
                    + Nieuwe Knop Toevoegen
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(450px, 1fr))', gap: '16px' }}>
                  {(settings.broadcastButtons || []).map((btn: any, idx: number) => (
                    <div key={btn.id} className="glass-card" style={{ padding: '24px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                      <div style={{ display: 'flex', gap: '16px', marginBottom: '20px' }}>
                        <div style={{ flex: 1 }}>
                          <label className="input-label" style={{ fontSize: '0.7rem' }}>KNOP TITEL</label>
                          <input className="input-field" style={{ fontWeight: 'bold', fontSize: '1.1rem' }} value={btn.name} onChange={(e) => {
                            const newBtns = [...settings.broadcastButtons];
                            newBtns[idx].name = e.target.value;
                            setSettings({...settings, broadcastButtons: newBtns});
                          }} />
                        </div>
                        <button onClick={() => {
                          const newBtns = settings.broadcastButtons.filter((_: any, i: number) => i !== idx);
                          setSettings({...settings, broadcastButtons: newBtns});
                        }} style={{ color: '#f87171', background: 'rgba(248, 113, 113, 0.1)', border: 'none', padding: '8px', borderRadius: '8px', cursor: 'pointer', height: 'fit-content', marginTop: '20px' }}><X size={20} /></button>
                      </div>
                      
                      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                        <div className="input-group">
                          <label className="input-label">Subtekst</label>
                          <input className="input-field" value={btn.sub} onChange={(e) => {
                            const newBtns = [...settings.broadcastButtons];
                            newBtns[idx].sub = e.target.value;
                            setSettings({...settings, broadcastButtons: newBtns});
                          }} />
                        </div>
                        <div className="input-group">
                          <label className="input-label">Icoon</label>
                          <select className="input-field" value={btn.icon} onChange={(e) => {
                            const newBtns = [...settings.broadcastButtons];
                            newBtns[idx].icon = e.target.value;
                            setSettings({...settings, broadcastButtons: newBtns});
                          }}>
                            <option value="play">Play</option><option value="square">Stop</option><option value="volume-x">Mute</option><option value="monitor-off">Off</option><option value="zap">Zap</option><option value="refresh-cw">Sync</option>
                          </select>
                        </div>
                        <div className="input-group">
                          <label className="input-label">Kleur</label>
                          <select className="input-field" value={btn.color} onChange={(e) => {
                            const newBtns = [...settings.broadcastButtons];
                            newBtns[idx].color = e.target.value;
                            setSettings({...settings, broadcastButtons: newBtns});
                          }}>
                            <option value="green">Groen</option><option value="red">Rood</option><option value="amber">Oranje</option><option value="blue">Blauw</option><option value="purple">Paars</option><option value="slate">Grijs</option>
                          </select>
                        </div>
                      </div>

                      <div style={{ background: 'rgba(0,0,0,0.2)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <p style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '12px', fontWeight: 'bold', textTransform: 'uppercase' }}>Companion Adres & MIDI Input</p>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '12px' }}>
                          <div className="input-group"><label className="input-label">Page</label><input type="number" className="input-field" value={btn.page} onChange={(e) => {
                            const newBtns = [...settings.broadcastButtons];
                            newBtns[idx].page = parseInt(e.target.value);
                            setSettings({...settings, broadcastButtons: newBtns});
                          }} /></div>
                          <div className="input-group"><label className="input-label">Row</label><input type="number" className="input-field" value={btn.row} onChange={(e) => {
                            const newBtns = [...settings.broadcastButtons];
                            newBtns[idx].row = parseInt(e.target.value);
                            setSettings({...settings, broadcastButtons: newBtns});
                          }} /></div>
                          <div className="input-group"><label className="input-label">Col</label><input type="number" className="input-field" value={btn.col} onChange={(e) => {
                            const newBtns = [...settings.broadcastButtons];
                            newBtns[idx].col = parseInt(e.target.value);
                            setSettings({...settings, broadcastButtons: newBtns});
                          }} /></div>
                          <div className="input-group">
                            <label className="input-label">MIDI In Note (Leeg = uit)</label>
                            <input 
                              type="text" 
                              className="input-field" 
                              placeholder="Bijv: 60" 
                              value={btn.midiNote !== undefined ? btn.midiNote : ""} 
                              onChange={(e) => {
                                const newBtns = [...settings.broadcastButtons];
                                newBtns[idx].midiNote = e.target.value !== "" ? parseInt(e.target.value) : undefined;
                                setSettings({...settings, broadcastButtons: newBtns});
                              }} 
                            />
                          </div>
                        </div>
                      </div>

                      <div style={{ background: 'rgba(0,0,0,0.2)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)', marginTop: '12px' }}>
                        <p style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '12px', fontWeight: 'bold', textTransform: 'uppercase' }}>MIDI Output (Sturen bij klik)</p>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                          <div className="input-group">
                            <label className="input-label">MIDI Out Note (Leeg = uit)</label>
                            <input 
                              type="text" 
                              className="input-field" 
                              placeholder="Bijv: 60" 
                              value={btn.midiOutNote !== undefined ? btn.midiOutNote : ""} 
                              onChange={(e) => {
                                const newBtns = [...settings.broadcastButtons];
                                newBtns[idx].midiOutNote = e.target.value !== "" ? parseInt(e.target.value) : undefined;
                                setSettings({...settings, broadcastButtons: newBtns});
                              }} 
                            />
                          </div>
                          <div className="input-group">
                            <label className="input-label">MIDI Out Channel</label>
                            <input 
                              type="number" 
                              min="1" 
                              max="16" 
                              className="input-field" 
                              value={btn.midiOutChannel !== undefined ? btn.midiOutChannel : 1} 
                              onChange={(e) => {
                                const newBtns = [...settings.broadcastButtons];
                                newBtns[idx].midiOutChannel = e.target.value !== "" ? parseInt(e.target.value) : 1;
                                setSettings({...settings, broadcastButtons: newBtns});
                              }} 
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '20px', paddingBottom: '20px' }}>
                <button 
                  className="btn-primary" 
                  style={{ width: '100%', padding: '20px', fontSize: '1.25rem', borderRadius: '16px', boxShadow: '0 10px 40px rgba(248, 113, 113, 0.2)' }}
                  onClick={async () => {
                    const res = await fetch("/api/settings", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(settings)
                    });
                    if (res.ok) {
                      setShowSettings(false);
                      setStatus({ type: 'success', message: "Alle instellingen zijn succesvol bijgewerkt!" });
                    }
                  }}
                >
                  <Save size={24} /> Wijzigingen Opslaan
                </button>
              </div>
            </div>
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
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '32px' }}>
                <HelpCircle size={32} color="var(--primary)" />
                <h1 style={{ fontSize: '1.75rem' }}>Hoe gebruik je de Manager?</h1>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '32px', color: 'rgba(255,255,255,0.8)', fontSize: '1rem', lineHeight: '1.6' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr', gap: '16px' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--primary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>1</div>
                  <div>
                    <h3 style={{ color: 'white', marginBottom: '4px' }}>Inloggen</h3>
                    <p>Log in met je YouTube account. Je ziet een groen vinkje als de verbinding actief is.</p>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr', gap: '16px' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--primary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>2</div>
                  <div>
                    <h3 style={{ color: 'white', marginBottom: '4px' }}>Thumbnail maken</h3>
                    <p>Klik op het thumbnail-vak of de "Open Editor" knop. Upload een foto, pas de tekst aan en klik op "Opslaan". De thumbnail wordt direct geupload naar YouTube en op de NAS opgeslagen voor OBS.</p>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr', gap: '16px' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--primary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>3</div>
                  <div>
                    <h3 style={{ color: 'white', marginBottom: '4px' }}>Stream Gegevens</h3>
                    <p>Vul de titel, beschrijving, datum en tijd in. De standaard waarden zijn al ingevuld op basis van de instellingen.</p>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr', gap: '16px' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--primary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>4</div>
                  <div>
                    <h3 style={{ color: 'white', marginBottom: '4px' }}>Inplannen</h3>
                    <p>Klik op "Plan Alles In". De manager maakt nu een evenement aan op YouTube. Vergeet niet om de stream handmatig op Facebook Live Producer in te plannen.</p>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: '40px', padding: '20px', background: 'rgba(56, 189, 248, 0.1)', borderRadius: '12px', border: '1px solid rgba(56, 189, 248, 0.2)' }}>
                <p style={{ fontSize: '0.9rem', color: 'var(--primary)', fontWeight: 600 }}>Tip voor OBS:</p>
                <p style={{ fontSize: '0.85rem' }}>In OBS kun je een 'Afbeelding' bron toevoegen die verwijst naar <code style={{ background: 'rgba(0,0,0,0.3)', padding: '2px 4px', borderRadius: '4px' }}>thema.jpg</code> in de geconfigureerde map. Deze wordt dan automatisch bijgewerkt!</p>
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

function SetupWizard({ settings: initialSettings, onComplete }: { settings: any, onComplete: (s: any) => void }) {
  const [step, setStep] = useState(1);
  const [settings, setSettings] = useState(initialSettings);
  const [loading, setLoading] = useState(false);

  const handleNext = () => setStep(s => s + 1);
  const handleBack = () => setStep(s => s - 1);

  const handleSave = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...settings, isSetupComplete: true })
      });
      if (res.ok) {
        onComplete(await res.json());
      } else {
        const errorData = await res.json();
        alert("Fout bij opslaan: " + (errorData.error || res.statusText));
      }
    } catch (err: any) {
      alert("Netwerkfout: " + err.message);
    }
    setLoading(false);
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: '#020617', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div className="glass-card" style={{ width: '100%', maxWidth: '600px', padding: '48px', display: 'flex', flexDirection: 'column', gap: '32px' }}>
        <div style={{ textAlign: 'center' }}>
          <img src="/logo.png" alt="Logo" style={{ width: '64px', margin: '0 auto 24px' }} />
          <h1 className="gradient-text" style={{ fontSize: '2rem' }}>Welkom bij Ark Church</h1>
          <p style={{ color: 'var(--muted)', marginTop: '8px' }}>Laten we de Livestream Manager configureren voor je NAS.</p>
        </div>

        {/* Steps Progress */}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
          {[1,2,3].map(s => (
            <div key={s} style={{ width: '40px', height: '4px', borderRadius: '2px', background: step >= s ? 'var(--primary)' : 'rgba(255,255,255,0.1)' }}></div>
          ))}
        </div>

        <div style={{ minHeight: '300px' }}>
          {step === 1 && (
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <Key size={24} color="var(--primary)" />
                <h2 style={{ fontSize: '1.25rem' }}>YouTube API Instellingen</h2>
              </div>
              <p style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>Voer de Google OAuth Client ID en Secret in van de Google Cloud Console.</p>
              <div className="input-group">
                <label className="input-label">Google Client ID</label>
                <input className="input-field" value={settings.googleClientId} onChange={e => setSettings({...settings, googleClientId: e.target.value})} placeholder="12345-abcde.apps.googleusercontent.com" />
              </div>
              <div className="input-group">
                <label className="input-label">Google Client Secret</label>
                <input className="input-field" type="password" value={settings.googleClientSecret} onChange={e => setSettings({...settings, googleClientSecret: e.target.value})} placeholder="GOCSPX-..." />
              </div>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <Database size={24} color="var(--primary)" />
                <h2 style={{ fontSize: '1.25rem' }}>NAS Bestandsopslag</h2>
              </div>
              <p style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>Waar moeten we de thumbnails voor OBS opslaan?</p>
              <div className="input-group">
                <label className="input-label">Bestandspad (NAS)</label>
                <input className="input-field" value={settings.thumbnailSavePath} onChange={e => setSettings({...settings, thumbnailSavePath: e.target.value})} placeholder="/volume1/Beamer/FreeShow/Media" />
                <p style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '8px' }}>Standaard: /volume1/Beamer/FreeShow/Media</p>
              </div>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <Link size={24} color="var(--primary)" />
                <h2 style={{ fontSize: '1.25rem' }}>Toegang via Internet</h2>
              </div>
              <p style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>Vul de URL in die je gebruikt om de app te bezoeken (nodig voor OAuth).</p>
              <div className="input-group">
                <label className="input-label">Website URL</label>
                <input className="input-field" value={settings.nextAuthUrl} onChange={e => setSettings({...settings, nextAuthUrl: e.target.value})} placeholder="http://192.168.2.250:3000" />
                <p style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '8px' }}>Bijv: http://192.168.2.250:3000 of https://live.arkchurch.nl</p>
              </div>
            </motion.div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px' }}>
          {step > 1 ? (
            <button onClick={handleBack} className="btn-outline">
              <ChevronLeft size={18} /> Terug
            </button>
          ) : <div></div>}
          
          {step < 3 ? (
            <button onClick={handleNext} className="btn-primary">
              Volgende <ChevronRight size={18} />
            </button>
          ) : (
            <button onClick={handleSave} className="btn-primary" disabled={loading}>
              {loading ? "Opslaan..." : <><CheckCircle2 size={18} /> Voltooien</>}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
