"use client";

import React, { useState, useEffect, useRef } from "react";
import { 
  Sun, 
  Sparkles, 
  Sunrise, 
  Zap, 
  Flame,
  Sliders,
  Palette,
  Activity
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface LightsControlProps {
  settings: any;
}

export default function LightsControl({ settings }: LightsControlProps) {
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  // States for Fresnel faders
  const [fresnel1, setFresnel1] = useState(0);
  const [fresnel2, setFresnel2] = useState(0);
  const [fresnel3, setFresnel3] = useState(0);
  const [fresnel4, setFresnel4] = useState(0);
  const [fresnelMaster, setFresnelMaster] = useState(0);
  const [activeColors, setActiveColors] = useState<{[sceneId: number]: boolean}>({});
  const [activeScene, setActiveScene] = useState<number | null>(null);
  const [activeChase, setActiveChase] = useState<number | null>(null);
  const [activeFade, setActiveFade] = useState<number>(0);

  const isWsConnected = useRef(false);
  const useFallbackHost = useRef(false);
  const lastFaderChangeTime = useRef<{[faderId: number]: number}>({});
  const lastWidgetClickTime = useRef<{[widgetId: number]: number}>({});
  const lastActionTime = useRef<number>(0);

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

  // WebSocket synchronization with QLC+ Virtual Console states
  useEffect(() => {
    if (!settings || !settings.qlcEnabled) return;

    let ws: WebSocket | null = null;
    let reconnectTimeout: NodeJS.Timeout;
    let isMounted = true;

    const WIDGET_IDS = [
      // Main Scenes
      1, 2, 3, 4,
      // Chases
      20, 24,
      // Faders
      81, 82, 83, 84, 85,
      // Colors
      ...[10, 30, 40, 50, 60, 100, 110, 120, 130].flatMap(startId => 
        Array.from({ length: 8 }, (_, i) => startId + i)
      )
    ];

    const connect = () => {
      try {
        const host = settings.qlcHost;
        let wsHost = host;
        if (!wsHost || wsHost === '127.0.0.1' || wsHost === 'localhost' || useFallbackHost.current) {
          wsHost = window.location.hostname;
        }
        const wsUrl = `ws://${wsHost}:9999/qlcplusWS`;
        
        console.log(`[QLC+ WebSocket Components] Connecting to ${wsUrl} (fallback: ${useFallbackHost.current})...`);
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          console.log("[QLC+ WebSocket Components] Connected successfully!");
          isWsConnected.current = true;
          // Query status of all widgets to initialize state
          if (ws && ws.readyState === WebSocket.OPEN) {
            WIDGET_IDS.forEach(id => {
              ws!.send(`QLC+API|getWidgetStatus|${id}`);
            });
          }
        };

        ws.onmessage = (event) => {
          if (!isMounted) return;
          const data = event.data;
          const parts = data.split('|');
          if (parts[0] === 'QLC+API' && parts[1] === 'getWidgetStatus') {
            const widgetId = parseInt(parts[2]);
            const value = parseInt(parts[3]);
            const isActive = value === 255;
            const now = Date.now();

            // 1. Fresnel Faders (81 - 85) with fighting prevention
            const lastChange = lastFaderChangeTime.current[widgetId] || 0;
            if (now - lastChange > 1200) { // 1.2s threshold
              if (widgetId === 81) setFresnel1(value);
              else if (widgetId === 82) setFresnel2(value);
              else if (widgetId === 83) setFresnel3(value);
              else if (widgetId === 84) setFresnel4(value);
              else if (widgetId === 85) setFresnelMaster(value);
            }
            
            // 2. Main Scenes (1 - 4)
            if ([1, 2, 3, 4].includes(widgetId)) {
              const lastClick = lastWidgetClickTime.current[widgetId] || 0;
              if (now - lastClick > 1000) { // 1.0s threshold
                if (isActive) {
                  setActiveScene(widgetId);
                } else {
                  setActiveScene(prev => prev === widgetId ? null : prev);
                }
              }
            }
            
            // 3. Chases (20, 24)
            else if ([20, 24].includes(widgetId)) {
              const lastClick = lastWidgetClickTime.current[widgetId] || 0;
              if (now - lastClick > 1000) {
                if (isActive) {
                  setActiveChase(widgetId);
                } else {
                  setActiveChase(prev => prev === widgetId ? null : prev);
                }
              }
            }
            
            // 4. Color Pickers (10 - 140)
            else if (widgetId >= 10 && widgetId <= 140) {
              const lastClick = lastWidgetClickTime.current[widgetId] || 0;
              if (now - lastClick > 1000) {
                setActiveColors(prev => ({ ...prev, [widgetId]: isActive }));
              }
            }
          }
        };

        ws.onclose = () => {
          isWsConnected.current = false;
          console.log("[QLC+ WebSocket Components] Connection closed, reconnecting in 5s...");
          if (isMounted) {
            reconnectTimeout = setTimeout(connect, 5000);
          }
        };

        ws.onerror = (err) => {
          isWsConnected.current = false;
          console.error("[QLC+ WebSocket Components] Error occurred:", err);
          // Try fallback to window.location.hostname next time
          if (!useFallbackHost.current && host && host !== '127.0.0.1' && host !== 'localhost') {
            console.log("[QLC+ WebSocket Components] Switching to fallback host (localhost/hostname)");
            useFallbackHost.current = true;
          }
        };
      } catch (err) {
        console.error("[QLC+ WebSocket Components] Setup failed:", err);
        if (isMounted) {
          reconnectTimeout = setTimeout(connect, 5000);
        }
      }
    };

    connect();

    return () => {
      isMounted = false;
      if (ws) {
        ws.close();
      }
      clearTimeout(reconnectTimeout);
    };
  }, [settings]);

  // Ref to hold pending timeouts for debouncing OSC requests
  const debounceTimers = useRef<{ [path: string]: NodeJS.Timeout }>({});

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
    const faderId = faderNum === "master" ? 85 : (80 + faderNum);
    lastFaderChangeTime.current[faderId] = Date.now();
    
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
    const now = Date.now();
    if (now - lastActionTime.current < 400) return;
    lastActionTime.current = now;

    const isActive = activeScene === sceneId;
    
    // Optimistic UI update
    if (isActive) {
      setActiveScene(null);
    } else {
      setActiveScene(sceneId);
      setActiveChase(null);
      setActiveColors({});
    }

    lastWidgetClickTime.current[sceneId] = now;

    try {
      const res = await fetch("/api/qlc/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneId }),
      });
      if (res.ok) {
        showStatus("success", isActive ? `Scène uitgeschakeld: ${name}` : `Scène gestart: ${name}`);
      } else {
        throw new Error("Trigger failed");
      }
    } catch (error) {
      console.error("Failed to trigger scene action:", error);
      showStatus("error", `Fout bij aanpassen scène: ${name}`);
    }
  };

  const handleChaseClick = async (sceneId: number, name: string) => {
    const now = Date.now();
    if (now - lastActionTime.current < 400) return;
    lastActionTime.current = now;

    const isActive = activeChase === sceneId;
    
    // Optimistic UI update
    if (isActive) {
      setActiveChase(null);
    } else {
      setActiveChase(sceneId);
      setActiveScene(null);
      setActiveColors({});
    }

    lastWidgetClickTime.current[sceneId] = now;

    try {
      const res = await fetch("/api/qlc/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneId }),
      });
      if (res.ok) {
        showStatus("success", isActive ? `Lichtshow uitgeschakeld: ${name}` : `Lichtshow gestart: ${name}`);
      } else {
        throw new Error("Trigger failed");
      }
    } catch (error) {
      console.error("Failed to trigger chase action:", error);
      showStatus("error", `Fout bij aanpassen lichtshow: ${name}`);
    }
  };

  const sendOscValueImmediate = async (path: string, value: number) => {
    try {
      await fetch("/api/qlc/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, value }),
      });
    } catch (err) {
      console.error(`Failed to send QLC OSC immediate value for ${path}:`, err);
    }
  };

  const handleBlackout = async () => {
    const now = Date.now();
    if (now - lastActionTime.current < 400) return;
    lastActionTime.current = now;

    const activeColorIds = Object.keys(activeColors)
      .map(Number)
      .filter(id => activeColors[id]);

    // Optimistic UI update
    setActiveScene(null);
    setActiveChase(null);
    setActiveColors({});
    setFresnel1(0);
    setFresnel2(0);
    setFresnel3(0);
    setFresnel4(0);
    setFresnelMaster(0);

    if (activeScene !== null) lastWidgetClickTime.current[activeScene] = now;
    if (activeChase !== null) lastWidgetClickTime.current[activeChase] = now;
    activeColorIds.forEach(id => {
      lastWidgetClickTime.current[id] = now;
    });

    const faderIds = [81, 82, 83, 84, 85];
    faderIds.forEach(id => {
      lastFaderChangeTime.current[id] = now;
    });

    try {
      if (activeScene !== null) {
        await fetch("/api/qlc/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sceneId: activeScene }),
        });
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      if (activeChase !== null) {
        await fetch("/api/qlc/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sceneId: activeChase }),
        });
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      for (const id of activeColorIds) {
        await fetch("/api/qlc/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sceneId: id }),
        });
        await new Promise(resolve => setTimeout(resolve, 30));
      }

      const paths = [
        "/ark/light/fresnel/1",
        "/ark/light/fresnel/2",
        "/ark/light/fresnel/3",
        "/ark/light/fresnel/4",
        "/ark/light/fresnel/master"
      ];

      for (const path of paths) {
        await sendOscValueImmediate(path, 0);
        await new Promise(resolve => setTimeout(resolve, 30));
      }

      showStatus("success", "BLACKOUT: Alle lichten uitgeschakeld.");
    } catch (error) {
      console.error("Failed to perform blackout:", error);
      showStatus("error", "Fout bij uitvoeren blackout");
    }
  };

  const handleColorClick = async (groupTitle: string, sceneId: number, name: string) => {
    const now = Date.now();
    if (now - lastActionTime.current < 400) return;
    lastActionTime.current = now;

    const isActive = !!activeColors[sceneId];

    // Optimistic UI update
    setActiveColors(prev => ({ ...prev, [sceneId]: !isActive }));
    setActiveScene(null);
    setActiveChase(null);

    lastWidgetClickTime.current[sceneId] = now;

    try {
      const res = await fetch("/api/qlc/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneId }),
      });
      if (res.ok) {
        showStatus("success", isActive ? `Kleur uitgeschakeld: ${name}` : `Kleur ingeschakeld: ${name}`);
      } else {
        throw new Error("Trigger failed");
      }
    } catch (error) {
      console.error("Failed to trigger light action:", error);
      showStatus("error", `Fout bij aanpassen kleur: ${name}`);
    }
  };

  const handleGroupOff = async (groupTitle: string, startId: number) => {
    const now = Date.now();
    if (now - lastActionTime.current < 400) return;
    lastActionTime.current = now;

    const activeIds: number[] = [];
    for (let i = 0; i < 8; i++) {
      const sceneId = startId + i;
      if (activeColors[sceneId]) {
        activeIds.push(sceneId);
      }
    }

    if (activeIds.length > 0) {
      // Optimistic UI update
      setActiveColors(prev => {
        const next = { ...prev };
        activeIds.forEach(id => {
          next[id] = false;
          lastWidgetClickTime.current[id] = now;
        });
        return next;
      });

      try {
        for (const id of activeIds) {
          await fetch("/api/qlc/action", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sceneId: id }),
          });
          await new Promise(resolve => setTimeout(resolve, 30));
        }
        showStatus("success", `Groep ${groupTitle} uitgeschakeld.`);
      } catch (error) {
        console.error("Failed to turn group off:", error);
        showStatus("error", `Fout bij uitschakelen groep ${groupTitle}`);
      }
    } else {
      showStatus("error", `Geen actieve kleur bekend voor ${groupTitle}.`);
    }
  };

  const handleGroupWhite = async (groupTitle: string, startId: number) => {
    const now = Date.now();
    if (now - lastActionTime.current < 400) return;
    lastActionTime.current = now;

    const whiteSceneId = startId + 7;
    const activeIdsToTurnOff: number[] = [];
    for (let i = 0; i < 7; i++) {
      const sceneId = startId + i;
      if (activeColors[sceneId]) {
        activeIdsToTurnOff.push(sceneId);
      }
    }

    const isWhiteActive = !!activeColors[whiteSceneId];
    if (isWhiteActive && activeIdsToTurnOff.length === 0) return;

    // Optimistic UI update
    setActiveColors(prev => {
      const next = { ...prev };
      activeIdsToTurnOff.forEach(id => {
        next[id] = false;
        lastWidgetClickTime.current[id] = now;
      });
      if (!isWhiteActive) {
        next[whiteSceneId] = true;
        lastWidgetClickTime.current[whiteSceneId] = now;
      }
      return next;
    });

    setActiveScene(null);
    setActiveChase(null);

    try {
      for (const id of activeIdsToTurnOff) {
        await fetch("/api/qlc/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sceneId: id }),
        });
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      if (!isWhiteActive) {
        await fetch("/api/qlc/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sceneId: whiteSceneId }),
        });
      }
      showStatus("success", `Groep ${groupTitle} op Wit gezet.`);
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

  const isQlcEnabled = settings?.qlcEnabled;

  if (!isQlcEnabled) {
    return (
      <div className="glass-card" style={{ padding: "40px", textAlign: "center", display: "flex", flexDirection: "column", gap: "16px", alignItems: "center" }}>
        <Sun size={48} className="text-orange" style={{ opacity: 0.5 }} />
        <h3 style={{ fontSize: "1.25rem", fontWeight: "bold" }}>Lichtregie Uitgeschakeld</h3>
        <p style={{ color: "var(--muted)", maxWidth: "500px", fontSize: "0.9rem", lineHeight: "1.6" }}>
          QLC+ lichtregie is momenteel uitgeschakeld in de systeeminstellingen. Schakel dit in bij "Instellingen" om het bedieningspaneel te activeren.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* Main Grid Content */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "32px" }}>
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
                      const isActive = !!activeColors[sceneId];
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
      `}</style>
    </div>
  );
}
