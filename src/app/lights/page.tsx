"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useSession, signIn } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  ChevronLeft, 
  Sun, 
  Sparkles, 
  Sunrise, 
  Zap, 
  Flame,
  Sliders,
  Palette,
  Activity,
  AlertTriangle
} from "lucide-react";

export default function LightsPage() {
  const { data: session, status: sessionStatus } = useSession();
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  // States for Fresnel faders
  const [fresnel1, setFresnel1] = useState(0);
  const [fresnel2, setFresnel2] = useState(0);
  const [fresnel3, setFresnel3] = useState(0);
  const [fresnel4, setFresnel4] = useState(0);
  const [fresnelMaster, setFresnelMaster] = useState(0);
  const [activeColors, setActiveColors] = useState<{[groupTitle: string]: number | null}>({});
  const [activeScene, setActiveScene] = useState<number | null>(null);
  const [activeChase, setActiveChase] = useState<number | null>(null);
  const [activeFade, setActiveFade] = useState<number>(0);

  const handleFadeChange = async (value: number) => {
    setActiveFade(value);
    try {
      await fetch("/api/qlc/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "/ark/light/speed/fade", value }),
      });
      showStatus("success", `Overgangstijd aangepast.`);
    } catch (err) {
      console.error("Failed to set fade speed:", err);
      showStatus("error", "Fout bij instellen overgangstijd");
    }
  };

  // Ref to hold pending timeouts for debouncing OSC requests
  const debounceTimers = useRef<{ [path: string]: NodeJS.Timeout }>({});

  useEffect(() => {
    // Fetch settings to check if QLC+ is enabled and retrieve IP/ports
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        if (!data.error) {
          setSettings(data);
        }
      })
      .catch((err) => console.error("Error fetching settings:", err))
      .finally(() => setLoading(false));
  }, []);

  // Debounced sender function for range faders
  const sendOscValue = (path: string, value: number) => {
    if (debounceTimers.current[path]) {
      clearTimeout(debounceTimers.current[path]);
    }

    debounceTimers.current[path] = setTimeout(async () => {
      try {
        await fetch("/api/qlc/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path, value }),
        });
      } catch (err) {
        console.error(`Failed to send QLC OSC value for ${path}:`, err);
      }
    }, 50); // 50ms debounce window
  };

  const handleFaderChange = (faderNum: number | "master", valueStr: string) => {
    const val = parseInt(valueStr) || 0;
    
    if (faderNum === "master") {
      setFresnelMaster(val);
      sendOscValue("/ark/light/fresnel/master", val);
    } else if (faderNum === 1) {
      setFresnel1(val);
      sendOscValue("/ark/light/fresnel/1", val);
    } else if (faderNum === 2) {
      setFresnel2(val);
      sendOscValue("/ark/light/fresnel/2", val);
    } else if (faderNum === 3) {
      setFresnel3(val);
      sendOscValue("/ark/light/fresnel/3", val);
    } else if (faderNum === 4) {
      setFresnel4(val);
      sendOscValue("/ark/light/fresnel/4", val);
    }
  };

  const handleSceneClick = async (sceneId: number, name: string) => {
    const isActive = activeScene === sceneId;
    try {
      const res = await fetch("/api/qlc/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneId }),
      });
      if (res.ok) {
        if (isActive) {
          setActiveScene(null);
          showStatus("success", `Scène uitgeschakeld: ${name}`);
        } else {
          setActiveScene(sceneId);
          setActiveColors({});
          showStatus("success", `Scène gestart: ${name}`);
        }
      } else {
        throw new Error("Trigger failed");
      }
    } catch (error) {
      console.error("Failed to trigger scene action:", error);
      showStatus("error", `Fout bij aanpassen scène: ${name}`);
    }
  };

  const handleChaseClick = async (sceneId: number, name: string) => {
    const isActive = activeChase === sceneId;
    try {
      const res = await fetch("/api/qlc/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneId }),
      });
      if (res.ok) {
        if (isActive) {
          setActiveChase(null);
          showStatus("success", `Lichtshow uitgeschakeld: ${name}`);
        } else {
          setActiveChase(sceneId);
          setActiveColors({});
          showStatus("success", `Lichtshow gestart: ${name}`);
        }
      } else {
        throw new Error("Trigger failed");
      }
    } catch (error) {
      console.error("Failed to trigger chase action:", error);
      showStatus("error", `Fout bij aanpassen lichtshow: ${name}`);
    }
  };

  const handleBlackout = async () => {
    // 1. Turn off active scene if any
    if (activeScene !== null) {
      await fetch("/api/qlc/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneId: activeScene }),
      });
    }
    // 2. Turn off active chase if any
    if (activeChase !== null) {
      await fetch("/api/qlc/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneId: activeChase }),
      });
    }
    // 3. Turn off any active individual color groups
    for (const groupTitle of Object.keys(activeColors)) {
      const activeId = activeColors[groupTitle];
      if (activeId !== null && activeId !== undefined) {
        await fetch("/api/qlc/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sceneId: activeId }),
        });
      }
    }
    // 4. Reset Fresnel faders to 0
    setFresnel1(0);
    sendOscValue("/ark/light/fresnel/1", 0);
    setFresnel2(0);
    sendOscValue("/ark/light/fresnel/2", 0);
    setFresnel3(0);
    sendOscValue("/ark/light/fresnel/3", 0);
    setFresnel4(0);
    sendOscValue("/ark/light/fresnel/4", 0);
    setFresnelMaster(0);
    sendOscValue("/ark/light/fresnel/master", 0);

    // 5. Reset all states in UI
    setActiveScene(null);
    setActiveChase(null);
    setActiveColors({});
    showStatus("success", "BLACKOUT: Alle lichten uitgeschakeld.");
  };

  const handleColorClick = async (groupTitle: string, sceneId: number, name: string) => {
    const isActive = activeColors[groupTitle] === sceneId;
    try {
      const res = await fetch("/api/qlc/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneId }),
      });
      if (res.ok) {
        if (isActive) {
          setActiveColors(prev => ({ ...prev, [groupTitle]: null }));
          showStatus("success", `Kleur uitgeschakeld: ${name}`);
        } else {
          setActiveColors(prev => ({ ...prev, [groupTitle]: sceneId }));
          showStatus("success", `Kleur ingeschakeld: ${name}`);
          // Clear active main scenes since we are now custom mixing colors
          setActiveScene(null);
          setActiveChase(null);
        }
      } else {
        throw new Error("Trigger failed");
      }
    } catch (error) {
      console.error("Failed to trigger light action:", error);
      showStatus("error", `Fout bij aanpassen kleur: ${name}`);
    }
  };

  const handleGroupOff = async (groupTitle: string, startId: number) => {
    const activeId = activeColors[groupTitle];
    if (activeId !== undefined && activeId !== null) {
      try {
        const res = await fetch("/api/qlc/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sceneId: activeId }),
        });
        if (res.ok) {
          setActiveColors(prev => ({ ...prev, [groupTitle]: null }));
          showStatus("success", `Groep ${groupTitle} uitgeschakeld.`);
        }
      } catch (error) {
        console.error("Failed to turn group off:", error);
        showStatus("error", `Fout bij uitschakelen groep ${groupTitle}`);
      }
    } else {
      showStatus("error", `Geen actieve kleur bekend voor ${groupTitle}. Klik op een kleur om deze uit te zetten.`);
    }
  };

  const handleGroupWhite = async (groupTitle: string, startId: number) => {
    const whiteSceneId = startId + 7; // White is offset 7
    const isActive = activeColors[groupTitle] === whiteSceneId;
    if (isActive) return;
    
    try {
      const res = await fetch("/api/qlc/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneId: whiteSceneId }),
      });
      if (res.ok) {
        setActiveColors(prev => ({ ...prev, [groupTitle]: whiteSceneId }));
        // Clear active main scenes since we are now custom mixing colors
        setActiveScene(null);
        setActiveChase(null);
        showStatus("success", `Groep ${groupTitle} op Wit gezet.`);
      }
    } catch (error) {
      console.error("Failed to set group to white:", error);
      showStatus("error", `Fout bij instellen Wit voor ${groupTitle}`);
    }
  };

  const showStatus = (type: 'success' | 'error', text: string) => {
    setStatusMessage({ type, text });
    setTimeout(() => {
      setStatusMessage(null);
    }, 3000);
  };

  if (sessionStatus === "loading" || loading) {
    return (
      <div className="flex-center" style={{ height: "100vh", flexDirection: "column", gap: "20px" }}>
        <div className="spinner"></div>
        <p style={{ color: "var(--muted)" }}>Lichtregie laden...</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex-center" style={{ height: "100vh", flexDirection: "column", gap: "32px", maxWidth: "400px", margin: "0 auto", padding: "20px" }}>
        <div style={{ textAlign: "center" }}>
          <h2 style={{ fontSize: "2rem", marginBottom: "8px" }}>Toegang Geweigerd</h2>
          <p style={{ color: "var(--muted)" }}>Je moet ingelogd zijn om de lichtregie te openen.</p>
        </div>
        <button className="btn-primary" style={{ width: "100%" }} onClick={() => signIn("google")}>
          Verbind met Google
        </button>
      </div>
    );
  }

  // Check if QLC+ is enabled in settings
  const isQlcEnabled = settings?.qlcEnabled;

  return (
    <div className="dashboard-container" style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Header bar */}
      <header className="glass-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "24px", marginBottom: "32px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <Link href="/" className="btn-outline" style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 16px", borderRadius: "8px" }}>
            <ChevronLeft size={18} />
            <span>Dashboard</span>
          </Link>
          <div style={{ borderLeft: "1px solid var(--card-border)", height: "24px" }} />
          <div>
            <h1 className="gradient-text" style={{ fontSize: "1.6rem", lineHeight: "1.2" }}>Lichtregie</h1>
            <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
              Headless QLC+ control panel • {settings?.qlcHost || "127.0.0.1"}:{settings?.qlcPort || 7700}
            </p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {isQlcEnabled ? (
            <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.8rem", background: "rgba(74, 222, 128, 0.1)", border: "1px solid rgba(74, 222, 128, 0.2)", color: "#4ade80", padding: "6px 12px", borderRadius: "20px" }}>
              <span className="dot bg-green" /> Verbonden met QLC+
            </span>
          ) : (
            <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.8rem", background: "rgba(248, 113, 113, 0.1)", border: "1px solid rgba(248, 113, 113, 0.2)", color: "#f87171", padding: "6px 12px", borderRadius: "20px" }}>
              <span className="dot bg-red" /> QLC+ Uitgeschakeld in Instellingen
            </span>
          )}
        </div>
      </header>

      {/* Main Grid Content */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "32px", flexGrow: 1 }}>
        {/* Left Side: Color Pickers & Scenes */}
        <div style={{ display: "flex", flexDirection: "column", gap: "32px" }}>
          
          {/* Main Scenes & Chases Card */}
          <section className="glass-card">
            <div className="color-group-header" style={{ marginBottom: "20px" }}>
              <h3 className="section-title" style={{ margin: 0 }}><Sun size={18} className="text-orange" /> Hoofdscènes & Lichtshows</h3>
              <button 
                onClick={handleBlackout} 
                className="btn-group-action off"
                style={{ padding: '6px 12px', fontSize: '0.75rem', borderColor: 'rgba(239, 68, 68, 0.4)', color: '#fca5a5' }}
              >
                BLACKOUT (ALL OFF)
              </button>
            </div>
            
            <p className="group-label">Hoofdscènes</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", marginBottom: "24px" }}>
              {[
                { id: 1, name: "WARM STAGE", icon: Sun, color: "#f97316", class: "bg-orange" },
                { id: 2, name: "WORSHIP BLUE", icon: Sparkles, color: "#3b82f6", class: "bg-blue" },
                { id: 3, name: "PRE-SERVICE", icon: Sunrise, color: "#a855f7", class: "bg-purple" },
                { id: 4, name: "FULL HOUSE", icon: Zap, color: "#ffffff", class: "bg-white" }
              ].map(s => {
                const isActive = activeScene === s.id;
                const Icon = s.icon;
                return (
                  <button 
                    key={s.id}
                    onClick={() => handleSceneClick(s.id, s.name)} 
                    className={`scene-btn ${s.class} ${isActive ? 'active' : ''}`}
                    style={isActive ? {
                      boxShadow: `0 0 16px ${s.color}60`,
                      borderColor: s.color,
                      borderWidth: '2px',
                      transform: 'scale(1.03)',
                      fontWeight: 'bold'
                    } : {}}
                  >
                    <Icon size={20} /> <span>{s.name}</span>
                  </button>
                );
              })}
            </div>

            <p className="group-label">Lichtshows / Chases</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}>
              {[
                { id: 20, name: "COLOR CHASE (ALL)", icon: Flame, color: "#22c55e", class: "bg-green" },
                { id: 24, name: "RAINBOW WAVE", icon: Sparkles, color: "#06b6d4", class: "bg-cyan" }
              ].map(s => {
                const isActive = activeChase === s.id;
                const Icon = s.icon;
                return (
                  <button 
                    key={s.id}
                    onClick={() => handleChaseClick(s.id, s.name)} 
                    className={`scene-btn ${s.class} ${isActive ? 'active' : ''}`}
                    style={isActive ? {
                      boxShadow: `0 0 16px ${s.color}60`,
                      borderColor: s.color,
                      borderWidth: '2px',
                      transform: 'scale(1.03)',
                      fontWeight: 'bold'
                    } : {}}
                  >
                    <Icon size={20} /> <span>{s.name}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Color Pickers Card */}
          <section className="glass-card">
            <h3 className="section-title"><Palette size={18} className="text-cyan" /> Kleurgroepen</h3>
            
            {/* Fade Speed Presets selector */}
            <div style={{ marginBottom: "24px", padding: "16px", background: "rgba(0,0,0,0.15)", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.03)" }}>
              <p className="group-label" style={{ marginBottom: "12px", color: "var(--muted)" }}>Overgangstijd (Fade)</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {[
                  { label: "Direct (0s)", value: 0 },
                  { label: "0.5s", value: 13 },
                  { label: "1s", value: 25 },
                  { label: "2s", value: 51 },
                  { label: "3s", value: 76 },
                  { label: "5s", value: 127 }
                ].map(p => (
                  <button
                    key={p.value}
                    onClick={() => handleFadeChange(p.value)}
                    className="btn-group-action"
                    style={{
                      padding: "8px 16px",
                      fontSize: "0.75rem",
                      borderColor: activeFade === p.value ? "var(--primary)" : "rgba(255,255,255,0.05)",
                      color: activeFade === p.value ? "#fff" : "var(--muted)",
                      background: activeFade === p.value ? "rgba(56, 189, 248, 0.2)" : "rgba(255, 255, 255, 0.03)",
                      fontWeight: activeFade === p.value ? "bold" : "normal"
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="color-groups-grid">
              {[
                { title: "Alle Lampen (Master)", startId: 10 },
                { title: "ADJ LED Bars", startId: 30 },
                { title: "lightmaXX LED Bars", startId: 40 },
                { title: "Chauvet SlimPARs", startId: 50 },
                { title: "Eurolite KLS-200 (All)", startId: 60 },
                { title: "KLS-200 - Spot 1", startId: 100 },
                { title: "KLS-200 - Spot 2", startId: 110 },
                { title: "KLS-200 - Spot 3", startId: 120 },
                { title: "KLS-200 - Spot 4", startId: 130 }
              ].map(group => (
                <div key={group.title} className="color-group-box">
                  <div className="color-group-header">
                    <p className="color-group-title">{group.title}</p>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button 
                        onClick={() => handleGroupWhite(group.title, group.startId)}
                        className="btn-group-action white"
                        title="Zet deze groep op Wit"
                      >
                        Wit
                      </button>
                      <button 
                        onClick={() => handleGroupOff(group.title, group.startId)}
                        className="btn-group-action off"
                        title="Zet deze groep uit"
                      >
                        Uit
                      </button>
                    </div>
                  </div>
                  <div className="colors-row">
                    {[
                      { offset: 0, name: "Red", color: "#ef4444" },
                      { offset: 1, name: "Green", color: "#22c55e" },
                      { offset: 2, name: "Blue", color: "#3b82f6" },
                      { offset: 3, name: "Amber", color: "#f59e0b" },
                      { offset: 4, name: "Magenta", color: "#d946ef" },
                      { offset: 5, name: "Cyan", color: "#06b6d4" },
                      { offset: 6, name: "UV", color: "#8b5cf6" },
                      { offset: 7, name: "White", color: "#ffffff" }
                    ].map(c => {
                      const sceneId = group.startId + c.offset;
                      const isActive = activeColors[group.title] === sceneId;
                      return (
                        <button 
                          key={c.offset}
                          onClick={() => handleColorClick(group.title, sceneId, `${group.title} - ${c.name}`)}
                          title={`${group.title} - ${c.name}`}
                          style={{ 
                            backgroundColor: c.color,
                            boxShadow: isActive ? `0 0 14px ${c.color}` : 'none',
                            border: isActive ? '3px solid #fff' : '2px solid rgba(0,0,0,0.3)',
                            transform: isActive ? 'scale(1.15)' : 'scale(1)',
                            zIndex: isActive ? 2 : 1
                          }}
                          className={`color-dot-btn ${isActive ? 'active' : ''}`}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Right Side: Fresnel Dimmer Control (Vertical Sliders) */}
        <div>
          <section className="glass-card" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
            <h3 className="section-title" style={{ marginBottom: "20px" }}>
              <Sliders size={18} className="text-primary" /> Fresnel Dimmers
            </h3>
            <p style={{ color: "var(--muted)", fontSize: "0.8rem", marginBottom: "32px", lineHeight: "1.4" }}>
              Bedien de Fresnel dimmers individueel of schaal ze allemaal tegelijk via de Master Submaster.
            </p>

            {/* Vertical Faders Rack */}
            <div className="faders-rack">
              {/* Fresnel 1 */}
              <div className="fader-column">
                <span className="fader-value">{fresnel1}</span>
                <div className="fader-track">
                  <input 
                    type="range" 
                    min="0" 
                    max="255" 
                    value={fresnel1} 
                    onChange={(e) => handleFaderChange(1, e.target.value)}
                    className="fader-input"
                  />
                </div>
                <span className="fader-label">F1</span>
              </div>

              {/* Fresnel 2 */}
              <div className="fader-column">
                <span className="fader-value">{fresnel2}</span>
                <div className="fader-track">
                  <input 
                    type="range" 
                    min="0" 
                    max="255" 
                    value={fresnel2} 
                    onChange={(e) => handleFaderChange(2, e.target.value)}
                    className="fader-input"
                  />
                </div>
                <span className="fader-label">F2</span>
              </div>

              {/* Fresnel 3 */}
              <div className="fader-column">
                <span className="fader-value">{fresnel3}</span>
                <div className="fader-track">
                  <input 
                    type="range" 
                    min="0" 
                    max="255" 
                    value={fresnel3} 
                    onChange={(e) => handleFaderChange(3, e.target.value)}
                    className="fader-input"
                  />
                </div>
                <span className="fader-label">F3</span>
              </div>

              {/* Fresnel 4 */}
              <div className="fader-column">
                <span className="fader-value">{fresnel4}</span>
                <div className="fader-track">
                  <input 
                    type="range" 
                    min="0" 
                    max="255" 
                    value={fresnel4} 
                    onChange={(e) => handleFaderChange(4, e.target.value)}
                    className="fader-input"
                  />
                </div>
                <span className="fader-label">F4</span>
              </div>

              {/* Spacer Line */}
              <div style={{ width: "1px", background: "var(--card-border)", height: "200px", alignSelf: "center", margin: "0 8px" }} />

              {/* Master Submaster */}
              <div className="fader-column master-column">
                <span className="fader-value" style={{ color: "var(--primary)", fontWeight: "bold" }}>{fresnelMaster}</span>
                <div className="fader-track">
                  <input 
                    type="range" 
                    min="0" 
                    max="255" 
                    value={fresnelMaster} 
                    onChange={(e) => handleFaderChange("master", e.target.value)}
                    className="fader-input master"
                  />
                </div>
                <span className="fader-label" style={{ color: "var(--primary)", fontWeight: "bold" }}>MSTR</span>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* Floating Status Notification */}
      <AnimatePresence>
        {statusMessage && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className={`status-toast ${statusMessage.type}`}
          >
            <Activity size={16} />
            <span>{statusMessage.text}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <style jsx>{`
        .flex-center {
          display: flex;
          justify-content: center;
          align-items: center;
        }
        
        .spinner {
          width: 40px;
          height: 40px;
          border: 4px solid rgba(56, 189, 248, 0.1);
          border-left: 4px solid var(--primary);
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        .dot {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }
        .dot.bg-green { background: #4ade80; box-shadow: 0 0 8px #4ade80; }
        .dot.bg-red { background: #f87171; box-shadow: 0 0 8px #f87171; }

        .section-title {
          font-size: 1.15rem;
          margin-bottom: 24px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .text-orange { color: #f97316; }
        .text-cyan { color: #06b6d4; }
        .text-primary { color: var(--primary); }

        .group-label {
          font-size: 0.65rem;
          color: var(--muted);
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          margin-bottom: 8px;
        }

        .scene-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 16px;
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.05);
          cursor: pointer;
          font-weight: 600;
          font-size: 0.75rem;
          transition: all 0.2s ease;
          background: rgba(255, 255, 255, 0.03);
          color: var(--foreground);
        }
        .scene-btn:hover {
          background: rgba(255, 255, 255, 0.08);
          transform: translateY(-1px);
        }
        
        .scene-btn.bg-orange { border-color: rgba(249, 115, 22, 0.2); color: #fdba74; }
        .scene-btn.bg-orange:hover { background: rgba(249, 115, 22, 0.15); }
        
        .scene-btn.bg-blue { border-color: rgba(59, 130, 246, 0.2); color: #93c5fd; }
        .scene-btn.bg-blue:hover { background: rgba(59, 130, 246, 0.15); }
        
        .scene-btn.bg-purple { border-color: rgba(168, 85, 247, 0.2); color: #d8b4fe; }
        .scene-btn.bg-purple:hover { background: rgba(168, 85, 247, 0.15); }
        
        .scene-btn.bg-white { border-color: rgba(255, 255, 255, 0.2); color: #f1f5f9; }
        .scene-btn.bg-white:hover { background: rgba(255, 255, 255, 0.1); }
        
        .scene-btn.bg-green { border-color: rgba(34, 197, 94, 0.2); color: #86efac; }
        .scene-btn.bg-green:hover { background: rgba(34, 197, 94, 0.15); }
        
        .scene-btn.bg-cyan { border-color: rgba(6, 182, 212, 0.2); color: #67e8f9; }
        .scene-btn.bg-cyan:hover { background: rgba(6, 182, 212, 0.15); }

        .color-groups-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 16px;
        }

        .color-group-box {
          background: rgba(0, 0, 0, 0.15);
          border: 1px solid rgba(255, 255, 255, 0.03);
          border-radius: 8px;
          padding: 16px;
        }

        .color-group-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }

        .color-group-title {
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--muted);
          margin: 0;
        }

        .btn-group-action {
          font-size: 0.65rem;
          font-weight: 700;
          text-transform: uppercase;
          padding: 4px 8px;
          border-radius: 4px;
          border: 1px solid rgba(255, 255, 255, 0.05);
          cursor: pointer;
          transition: all 0.2s ease;
          background: rgba(255, 255, 255, 0.03);
          color: var(--foreground);
        }
        
        .btn-group-action:hover {
          background: rgba(255, 255, 255, 0.15);
        }
        
        .btn-group-action.off {
          border-color: rgba(239, 68, 68, 0.2);
          color: #fca5a5;
        }
        .btn-group-action.off:hover {
          background: rgba(239, 68, 68, 0.1);
        }
        
        .btn-group-action.white {
          border-color: rgba(255, 255, 255, 0.15);
          color: #e2e8f0;
        }
        .btn-group-action.white:hover {
          background: rgba(255, 255, 255, 0.1);
        }

        .colors-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .color-dot-btn {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: 2px solid rgba(0, 0, 0, 0.3);
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .color-dot-btn:hover {
          transform: scale(1.15);
        }
        .color-dot-btn:active {
          transform: scale(0.95);
        }

        .faders-rack {
          display: flex;
          justify-content: space-between;
          align-items: stretch;
          flex-grow: 1;
          padding: 10px 0;
        }

        .fader-column {
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 50px;
          gap: 12px;
        }
        
        .fader-column.master-column {
          width: 60px;
        }

        .fader-value {
          font-size: 0.75rem;
          font-family: monospace;
          color: var(--muted);
          background: rgba(255, 255, 255, 0.02);
          padding: 2px 6px;
          border-radius: 4px;
          border: 1px solid rgba(255, 255, 255, 0.03);
          min-width: 32px;
          text-align: center;
        }

        .fader-track {
          height: 220px;
          display: flex;
          justify-content: center;
          align-items: center;
          position: relative;
        }

        .fader-input {
          writing-mode: vertical-lr;
          direction: rtl;
          width: 8px;
          height: 200px;
          -webkit-appearance: none;
          background: #1e293b;
          border-radius: 4px;
          outline: none;
          cursor: pointer;
        }

        .fader-input::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 24px;
          height: 16px;
          border-radius: 4px;
          background: var(--muted);
          cursor: pointer;
          transition: all 0.1s ease;
          border: 1px solid rgba(255, 255, 255, 0.2);
        }
        .fader-input::-webkit-slider-thumb:hover {
          background: #fff;
          box-shadow: 0 0 8px rgba(255, 255, 255, 0.5);
        }
        
        .fader-input.master::-webkit-slider-thumb {
          background: var(--primary);
          border: 1px solid rgba(56, 189, 248, 0.4);
        }
        .fader-input.master::-webkit-slider-thumb:hover {
          background: var(--primary-hover);
          box-shadow: 0 0 10px var(--primary);
        }

        .fader-label {
          font-size: 0.75rem;
          font-weight: bold;
          color: var(--muted);
        }

        .status-toast {
          position: fixed;
          bottom: 24px;
          right: 24px;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 20px;
          border-radius: 8px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
          font-size: 0.85rem;
          font-weight: 600;
          z-index: 100;
        }
        .status-toast.success {
          background: rgba(74, 222, 128, 0.95);
          color: #020617;
        }
        .status-toast.error {
          background: rgba(248, 113, 113, 0.95);
          color: #020617;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
