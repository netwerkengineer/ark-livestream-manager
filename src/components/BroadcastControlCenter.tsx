"use client";

import React, { useState, useEffect } from "react";
import { 
  AlertOctagon, 
  RefreshCw, 
  Zap, 
  VolumeX, 
  MonitorOff, 
  Activity,
  Clock,
  ShieldAlert,
  Play,
  Square
} from "lucide-react";
import { motion } from "framer-motion";

interface ServiceStatus {
  name: string;
  status: 'UP' | 'DOWN' | 'READY';
  port: number;
}

interface BroadcastControlCenterProps {
  settings: any;
  userRole?: string;
  userPermissions?: string[];
}

export default function BroadcastControlCenter({ settings, userRole, userPermissions = [] }: BroadcastControlCenterProps) {
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [midiPeers, setMidiPeers] = useState<string[]>([]);
  const [plugs, setPlugs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [plugsLoading, setPlugsLoading] = useState(true);
  const [time, setTime] = useState(new Date());
  const [activeButtons, setActiveButtons] = useState<Record<string, boolean>>({});

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/services/status');
      const data = await res.json();
      setServices(data.services);
      setMidiPeers(data.midiPeers || []);
    } catch (err) {
      console.error("Failed to fetch service status", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchPlugsStatus = async () => {
    try {
      const res = await fetch('/api/tuya/status');
      const data = await res.json();
      const fetchedPlugs = data.plugs || [];
      setPlugs(fetchedPlugs);
      
      // Sync activeButtons state with physical plug states
      if (fetchedPlugs.length > 0) {
        setActiveButtons(prev => {
          const updated = { ...prev };
          let changed = false;
          
          const obsPlug = fetchedPlugs.find((p: any) => p.id === "plug_obs");
          if (obsPlug && obsPlug.is_online) {
            const isObsOn = obsPlug.state === "on";
            if (updated["qww7gkpem"] !== isObsOn) { // "qww7gkpem" is "OBS PC Starten"
              updated["qww7gkpem"] = isObsOn;
              changed = true;
            }
          }
          
          const beamerPlug = fetchedPlugs.find((p: any) => p.id === "plug_beamer");
          if (beamerPlug && beamerPlug.is_online) {
            const isBeamerOn = beamerPlug.state === "on";
            if (updated["qj3e7j7tu"] !== isBeamerOn) { // "qj3e7j7tu" is "Beamer PC starten"
              updated["qj3e7j7tu"] = isBeamerOn;
              changed = true;
            }
          }
          
          if (changed) {
            localStorage.setItem("acoc_active_buttons", JSON.stringify(updated));
            return updated;
          }
          return prev;
        });
      }
    } catch (err) {
      console.error("Failed to fetch Tuya status", err);
    } finally {
      setPlugsLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    fetchPlugsStatus();
    
    // Load active buttons state
    const saved = localStorage.getItem("acoc_active_buttons");
    if (saved) {
      try {
        setActiveButtons(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse saved active buttons", e);
      }
    }

    const statusInterval = setInterval(fetchStatus, 5000);
    const plugsInterval = setInterval(fetchPlugsStatus, 10000); // Poll every 10s to avoid flooding plugs
    const clockInterval = setInterval(() => setTime(new Date()), 1000);
    return () => {
      clearInterval(statusInterval);
      clearInterval(plugsInterval);
      clearInterval(clockInterval);
    };
  }, []);




  const handleEmergencyAction = async (actionId: string, actionName: string, page: number, row: number, col: number) => {
    // Toggle de visuele status direct bij klikken (niet wachten op Companion response)
    setActiveButtons(prev => {
      const updated = { ...prev, [actionId]: !prev[actionId] };
      localStorage.setItem("acoc_active_buttons", JSON.stringify(updated));
      return updated;
    });

    try {
      const response = await fetch('/api/broadcast/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page, row, col }),
      });
      
      const data = await response.json();
      if (data.success) {
        console.log(`Successfully triggered ${actionName}`);
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      console.error('Failed to trigger action:', error);
      // Toon een melding maar laat de toggle-staat intact
      console.warn(`Companion niet bereikbaar voor ${actionName}. Knopstatus wel bijgewerkt.`);
    }
  };


  const getIcon = (iconName: string) => {
    switch (iconName) {
      case 'play': return <Play size={28} />;
      case 'square': return <Square size={28} />;
      case 'volume-x': return <VolumeX size={28} />;
      case 'monitor-off': return <MonitorOff size={28} />;
      case 'refresh-cw': return <RefreshCw size={28} />;
      case 'zap': return <Zap size={28} />;
      case 'alert-octagon': return <AlertOctagon size={28} />;
      default: return <Activity size={28} />;
    }
  };



  const allActions = settings?.broadcastButtons || [];
  const actions = allActions.filter((action: any) => {
    if (!action.requiredPermission) return true; // no restriction — visible to all with control access
    if (userRole === "admin") return true; // admins see everything
    return userPermissions.includes(action.requiredPermission);
  });

  return (
    <div className="flex flex-col gap-6">
      {/* Header with Clock */}
      <div className="glass-card flex items-center justify-between p-6">
        <div className="flex items-center gap-4">
          <Activity className="text-primary" size={32} />
          <div>
            <h2 className="text-xl font-bold">Broadcast Control Center</h2>
            <p className="text-muted text-sm">Centraal beheer van alle hardware & software</p>
          </div>
        </div>
        <div className="flex items-center gap-3 bg-black/40 px-6 py-2 rounded-xl border border-white/5">
          <Clock className="text-primary" size={20} />
          <span className="text-2xl font-mono tracking-wider">
            {time.toLocaleTimeString('nl-NL', { hour12: false })}
          </span>
        </div>
      </div>

      {/* Grid Layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Service Status List */}
        <section className="glass-card">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-semibold flex items-center gap-2">
              <Zap size={18} className="text-yellow-400" /> System Status
            </h3>
            <button onClick={fetchStatus} className="hover:rotate-180 transition-transform duration-500">
              <RefreshCw size={16} className="text-muted" />
            </button>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            {loading ? (
              <p className="col-span-2 text-center py-4 text-muted">Checking connections...</p>
            ) : (
              services.map((service) => (
                <div key={service.name} className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/5">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{service.name}</span>
                    <span className="text-[10px] text-muted uppercase tracking-tight">Port {service.port}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${service.status === 'UP' ? 'bg-green-500 shadow-[0_0_8px_#4ade80]' : service.status === 'READY' ? 'bg-blue-500 shadow-[0_0_8px_#3b82f6]' : 'bg-red-500 shadow-[0_0_8px_#f87171]'} transition-colors duration-500`} />
                    <span className="text-[10px] font-bold uppercase">{service.status}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Info Card / MIDI Connection Status */}
        <section className="glass-card flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-4 mb-4">
              <div className="p-3 bg-blue-500/10 rounded-lg">
                <ShieldAlert className="text-blue-400" size={24} />
              </div>
              <p className="text-sm leading-relaxed text-muted">
                Dit dashboard is het centrale zenuwstelsel van de uitzending. Beheer hier de livestream, audio, presentatie en verlichting op één plek.
              </p>
            </div>

            {/* rtpMIDI Peers list */}
            <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              <h4 style={{ fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '8px', color: 'var(--muted)' }}>
                🎛️ Actieve rtpMIDI Deelnemers ({midiPeers.length})
              </h4>
              {midiPeers.length === 0 ? (
                <p style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                  Geen apparaten verbonden (rtpMIDI)
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {midiPeers.map(peer => (
                    <div key={peer} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', borderRadius: '6px', backgroundColor: 'rgba(255,255,255,0.03)' }}>
                      <span style={{ height: '6px', width: '6px', borderRadius: '50%', backgroundColor: '#4ade80', boxShadow: '0 0 6px #4ade80' }}></span>
                      <span style={{ fontSize: '0.8rem', fontWeight: '500' }}>{peer}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <p className="text-[11px] text-muted flex items-center gap-1">
              <Activity size={12} /> Real-time monitoring via Docker Network (Ark-Net)
            </p>
          </div>
        </section>
      </div>

      {/* Tuya Smart Plugs & Power Monitoring */}
      {((settings?.tuyaPlugs && settings.tuyaPlugs.length > 0) || settings?.tuyaDeviceId) && (
        <section className="glass-card" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h3 style={{ fontWeight: '600', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Zap size={18} style={{ color: '#facc15' }} /> Slimme Stekkers & Stroomverbruik
            </h3>
            <button 
              type="button"
              onClick={fetchPlugsStatus} 
              style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              className="hover:rotate-180 transition-transform duration-500"
            >
              <RefreshCw size={16} style={{ color: 'var(--muted)' }} />
            </button>
          </div>
          
          {plugsLoading && plugs.length === 0 ? (
            <p style={{ textAlign: 'center', padding: '16px 0', color: 'var(--muted)', fontSize: '0.85rem' }}>Status laden...</p>
          ) : plugs.length === 0 ? (
            <p style={{ textAlign: 'center', padding: '16px 0', color: 'var(--muted)', fontSize: '0.85rem' }}>Geen slimme stekkers gedetecteerd of verbinding mislukt.</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
              {plugs.map((plug) => (
                <div 
                  key={plug.id} 
                  style={{ 
                    display: 'flex', 
                    flexDirection: 'column', 
                    gap: '12px', 
                    padding: '16px', 
                    borderRadius: '12px', 
                    backgroundColor: 'rgba(255,255,255,0.02)', 
                    border: '1px solid rgba(255,255,255,0.05)' 
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{plug.name}</span>
                      <span style={{ fontSize: '0.7rem', color: 'var(--muted)', fontFamily: 'monospace' }}>{plug.id}</span>
                    </div>
                    <div 
                      style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '6px', 
                        backgroundColor: 'rgba(0,0,0,0.3)', 
                        padding: '4px 10px', 
                        borderRadius: '20px', 
                        border: '1px solid rgba(255,255,255,0.05)' 
                      }}
                    >
                      <span 
                        style={{ 
                          height: '6px', 
                          width: '6px', 
                          borderRadius: '50%', 
                          backgroundColor: !plug.is_online ? '#ef4444' : plug.state === 'on' ? '#4ade80' : '#f59e0b',
                          boxShadow: !plug.is_online ? '0 0 6px #ef4444' : plug.state === 'on' ? '0 0 6px #4ade80' : '0 0 6px #f59e0b'
                        }} 
                      />
                      <span style={{ fontSize: '0.7rem', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        {!plug.is_online ? 'OFFLINE' : plug.state === 'on' ? 'AAN' : 'UIT'}
                      </span>
                    </div>
                  </div>

                  {plug.is_online && (
                    <div 
                      style={{ 
                        display: 'grid', 
                        gridTemplateColumns: 'repeat(3, 1fr)', 
                        gap: '8px', 
                        backgroundColor: 'rgba(0,0,0,0.2)', 
                        padding: '8px', 
                        borderRadius: '8px', 
                        border: '1px solid rgba(255,255,255,0.03)',
                        textAlign: 'center'
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>Spanning</div>
                        <div style={{ fontSize: '0.8rem', fontFamily: 'monospace', fontWeight: 'bold', color: '#60a5fa' }}>{plug.voltage_v} V</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>Stroom</div>
                        <div style={{ fontSize: '0.8rem', fontFamily: 'monospace', fontWeight: 'bold', color: '#c084fc' }}>{plug.current_a} A</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>Vermogen</div>
                        <div style={{ fontSize: '0.8rem', fontFamily: 'monospace', fontWeight: 'bold', color: '#facc15' }}>{plug.power_w} W</div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Emergency Buttons Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
        {actions.map((action: any) => {
          const isActive = !!activeButtons[action.id];
          return (
            <motion.button 
              key={action.id}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => handleEmergencyAction(action.id, action.name, action.page, action.row, action.col)}
              className={`emergency-btn ${action.color || 'default'} ${isActive ? 'active' : ''}`}
            >
              <div style={{ flexShrink: 0 }}>{getIcon(action.icon)}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span style={{ display: 'block', fontWeight: '800', fontSize: '1rem', lineHeight: '1.2' }}>{action.name}</span>
                <span style={{ display: 'block', fontSize: '0.7rem', opacity: 0.8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{action.sub}</span>
              </div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
