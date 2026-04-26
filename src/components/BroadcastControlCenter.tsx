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
  Square,
  Sun,
  Sparkles,
  Sunrise,
  Flame
} from "lucide-react";
import { motion } from "framer-motion";

interface ServiceStatus {
  name: string;
  status: 'UP' | 'DOWN' | 'READY';
  port: number;
}

interface BroadcastControlCenterProps {
  settings: any;
}

export default function BroadcastControlCenter({ settings }: BroadcastControlCenterProps) {
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [time, setTime] = useState(new Date());

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/services/status');
      const data = await res.json();
      setServices(data.services);
    } catch (err) {
      console.error("Failed to fetch service status", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const statusInterval = setInterval(fetchStatus, 5000);
    const clockInterval = setInterval(() => setTime(new Date()), 1000);
    return () => {
      clearInterval(statusInterval);
      clearInterval(clockInterval);
    };
  }, []);

  const handleLichtAction = async (sceneId: number, name: string) => {
    try {
      await fetch('/api/qlc/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sceneId }),
      });
      console.log(`Triggered Light Scene: ${name}`);
    } catch (error) {
      console.error('Failed to trigger light action:', error);
    }
  };

  const handleEmergencyAction = async (action: string, page: number, row: number, col: number) => {
    try {
      const response = await fetch('/api/broadcast/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page, row, col }),
      });
      
      const data = await response.json();
      if (data.success) {
        console.log(`Successfully triggered ${action}`);
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      console.error('Failed to trigger action:', error);
      alert(`Fout bij het uitvoeren van ${action}. Is Companion gestart?`);
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

  const getColorClass = (color: string) => {
    switch (color) {
      case 'green': return 'bg-green-600/20 border-green-500/30 text-green-400';
      case 'red': return 'bg-red-600/20 border-red-500/30 text-red-100';
      case 'amber': return 'bg-amber-600/20 border-amber-500/30 text-amber-400';
      case 'slate': return 'bg-slate-600/20 border-slate-500/30 text-slate-400';
      case 'blue': return 'bg-blue-600/20 border-blue-500/30 text-blue-400';
      case 'purple': return 'bg-purple-600/20 border-purple-500/30 text-purple-400';
      default: return 'bg-white/5 border-white/10 text-white';
    }
  };

  const actions = settings?.broadcastButtons || [];

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

        {/* Info Card */}
        <section className="glass-card flex flex-col justify-center">
            <div className="flex items-center gap-4 mb-4">
              <div className="p-3 bg-blue-500/10 rounded-lg">
                <ShieldAlert className="text-blue-400" size={24} />
              </div>
              <p className="text-sm leading-relaxed text-muted">
                Dit dashboard is het centrale zenuwstelsel van de uitzending. Beheer hier de livestream, audio, presentatie en verlichting op één plek.
              </p>
            </div>
            <div className="mt-auto pt-4 border-t border-white/5">
                <p className="text-[11px] text-muted flex items-center gap-1">
                    <Activity size={12} /> Real-time monitoring via Docker Network (Ark-Net)
                </p>
            </div>
        </section>
      </div>

      {/* Lighting Controls Section (Only if enabled) */}
      {settings.qlcEnabled && (
        <section className="glass-card">
          <h3 className="font-semibold flex items-center gap-2 mb-6">
            <Sun size={18} className="text-orange-400" /> Lichtregie (QLC+)
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '24px' }}>
            <button 
              onClick={() => handleLichtAction(1, "Warm Stage")}
              className="flex items-center gap-3 p-4 rounded-xl bg-orange-600/10 border border-orange-500/20 text-orange-400 hover:bg-orange-600/20 transition-all"
            >
              <Sun size={20} /> <span className="font-bold text-xs">WARM STAGE</span>
            </button>
            <button 
              onClick={() => handleLichtAction(2, "Worship Blue")}
              className="flex items-center gap-3 p-4 rounded-xl bg-blue-600/10 border border-blue-500/20 text-blue-400 hover:bg-blue-600/20 transition-all"
            >
              <Sparkles size={20} /> <span className="font-bold text-xs">WORSHIP BLUE</span>
            </button>
            <button 
              onClick={() => handleLichtAction(3, "Pre-Service")}
              className="flex items-center gap-3 p-4 rounded-xl bg-purple-600/10 border border-purple-500/20 text-purple-400 hover:bg-purple-600/20 transition-all"
            >
              <Sunrise size={20} /> <span className="font-bold text-xs">PRE-SERVICE</span>
            </button>
            <button 
              onClick={() => handleLichtAction(4, "Full House")}
              className="flex items-center gap-3 p-4 rounded-xl bg-white/10 border border-white/20 text-white hover:bg-white/20 transition-all"
            >
              <Zap size={20} /> <span className="font-bold text-xs">FULL HOUSE</span>
            </button>
          </div>

          <div className="border-t border-white/5 pt-6">
            <p className="text-[10px] text-muted font-bold uppercase tracking-widest mb-4">LED Bar Kleuren</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
              {[
                { id: 10, name: 'Red', color: '#ef4444' },
                { id: 11, name: 'Green', color: '#22c55e' },
                { id: 12, name: 'Blue', color: '#3b82f6' },
                { id: 13, name: 'Amber', color: '#f59e0b' },
                { id: 14, name: 'Magenta', color: '#d946ef' },
                { id: 15, name: 'Cyan', color: '#06b6d4' },
                { id: 16, name: 'UV', color: '#8b5cf6' },
                { id: 17, name: 'White', color: '#ffffff' }
              ].map(c => (
                <button 
                  key={c.id}
                  onClick={() => handleLichtAction(c.id, c.name)}
                  title={c.name}
                  style={{ 
                    width: '36px', 
                    height: '36px', 
                    borderRadius: '50%', 
                    backgroundColor: c.color, 
                    border: '3px solid rgba(0,0,0,0.3)',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                    cursor: 'pointer'
                  }}
                  className="hover:scale-110 active:scale-95 transition-transform"
                />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Emergency Buttons Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
        {actions.map((action: any) => (
          <motion.button 
            key={action.id}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => handleEmergencyAction(action.name, action.page, action.row, action.col)}
            className={`emergency-btn ${getColorClass(action.color)}`}
            style={{ 
              textAlign: 'left', 
              display: 'flex', 
              alignItems: 'center', 
              gap: '16px', 
              padding: '20px',
              width: '100%' 
            }}
          >
            <div style={{ flexShrink: 0 }}>{getIcon(action.icon)}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <span style={{ display: 'block', fontWeight: '800', fontSize: '1rem', lineHeight: '1.2' }}>{action.name}</span>
              <span style={{ display: 'block', fontSize: '0.7rem', opacity: 0.8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{action.sub}</span>
            </div>
          </motion.button>
        ))}
      </div>

      <style jsx>{`
        .emergency-btn {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 20px;
          border-radius: 16px;
          border: 1px solid;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          cursor: pointer;
        }
        .emergency-btn:hover {
          box-shadow: 0 0 20px rgba(0,0,0,0.4);
        }
      `}</style>
    </div>
  );
}
