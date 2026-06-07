"use client";

import React, { useState, useEffect, useCallback } from "react";
import { 
  Activity, 
  ShieldCheck, 
  AlertTriangle, 
  RefreshCcw, 
  MonitorPlay, 
  Globe, 
  CheckCircle2, 
  XCircle,
  Zap,
  WifiOff
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface StreamMonitorProps {
  settings: any;
  scheduledStreams: any[];
}

export default function StreamMonitor({ settings, scheduledStreams }: StreamMonitorProps) {
  const [obsState, setObsState] = useState<{
    connected: boolean;
    obsStats: any | null;
    serviceSettings: any | null;
    error: string | null;
  }>({ connected: false, obsStats: null, serviceSettings: null, error: null });

  const [selectedStreamId, setSelectedStreamId] = useState<string>("");
  const [streamDetails, setStreamDetails] = useState<any>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Poll OBS status via server-side API (avoids browser wss:// mixed content issue)
  const fetchOBSStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/obs/status');
      if (res.ok) {
        const data = await res.json();
        setObsState(data);
        setFetchError(null);
      } else if (res.status !== 401) {
        setFetchError('Fout bij ophalen OBS status');
      }
    } catch (err) {
      console.error('Failed to fetch OBS status:', err);
    }
  }, []);

  useEffect(() => {
    fetchOBSStatus();
    const interval = setInterval(fetchOBSStatus, 2000);
    return () => clearInterval(interval);
  }, [fetchOBSStatus]);

  // Fetch stream details when a stream is selected
  useEffect(() => {
    if (!selectedStreamId) {
      setStreamDetails(null);
      return;
    }
    const stream = scheduledStreams.find(s => s.id === selectedStreamId);
    if (!stream) return;

    setLoadingDetails(true);
    fetch(`/api/streams/details?id=${stream.id}&provider=${stream.provider}`)
      .then(res => res.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        setStreamDetails(data);
      })
      .catch(err => {
        console.error("Error fetching stream details:", err);
        setFetchError("Fout bij ophalen streamgegevens: " + err.message);
      })
      .finally(() => setLoadingDetails(false));
  }, [selectedStreamId, scheduledStreams]);

  const handleReconnect = async () => {
    setReconnecting(true);
    try {
      await fetch('/api/obs/reconnect', { method: 'POST' });
      // Give server a moment to reconnect, then poll
      setTimeout(fetchOBSStatus, 1500);
    } catch (err) {
      console.error('Reconnect failed:', err);
    } finally {
      setTimeout(() => setReconnecting(false), 2000);
    }
  };

  const handleFixConfig = async () => {
    if (!streamDetails) return;
    setFixing(true);
    try {
      const isFacebook = streamDetails.provider === "facebook";
      const res = await fetch('/api/obs/fix-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          streamServiceType: "rtmp_custom",
          streamServiceSettings: {
            server: streamDetails.serverUrl || (isFacebook ? "rtmps://rtmp-api.facebook.com:443/rtmp/" : ""),
            key: streamDetails.streamKey,
            use_auth: false
          }
        })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      alert("OBS configuratie succesvol bijgewerkt!");
      fetchOBSStatus();
    } catch (err: any) {
      alert("Fout bij bijwerken OBS: " + err.message);
    } finally {
      setFixing(false);
    }
  };

  const isConfigCorrect = () => {
    if (!obsState.serviceSettings || !streamDetails) return null;
    const obsKey = obsState.serviceSettings.streamServiceSettings?.key;
    return obsKey === streamDetails.streamKey;
  };

  const obsStats = obsState.obsStats;
  const obsConnected = obsState.connected;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* OBS Connection Status Card */}
      <section className="glass-card" style={{ padding: '24px', borderLeft: `4px solid ${obsConnected ? '#4ade80' : '#f87171'}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ padding: '10px', borderRadius: '10px', background: obsConnected ? 'rgba(74, 222, 128, 0.1)' : 'rgba(248, 113, 113, 0.1)' }}>
              <MonitorPlay size={24} color={obsConnected ? '#4ade80' : '#f87171'} />
            </div>
            <div>
              <h3 style={{ margin: 0 }}>OBS Studio Status</h3>
              <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.9rem' }}>
                {obsConnected
                  ? `Verbonden via server · ${settings.obsHost}:${settings.obsPort}`
                  : obsState.error || 'Server verbindt opnieuw...'}
              </p>
            </div>
          </div>
          <button
            onClick={handleReconnect}
            disabled={reconnecting}
            className="btn-outline"
            style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <RefreshCcw size={16} className={reconnecting ? 'spin' : ''} />
            {reconnecting ? 'Verbinden...' : 'Opnieuw verbinden'}
          </button>
        </div>

        {!obsConnected && (
          <div style={{ marginTop: '12px', padding: '10px 14px', borderRadius: '8px', background: 'rgba(251, 191, 36, 0.08)', border: '1px solid rgba(251, 191, 36, 0.2)', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', color: '#fbbf24' }}>
            <WifiOff size={14} />
            De server verbindt via <strong>ws://</strong> op de achtergrond. OBS hoeft geen TLS te hebben.
            Controleer of OBS draait op <strong>{settings.obsHost}:{settings.obsPort}</strong>.
          </div>
        )}
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        {/* Live Stats Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <section className="glass-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
              <Activity size={20} color="var(--primary)" />
              <h2>Live Statistieken</h2>
            </div>

            {!obsConnected ? (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--muted)' }}>
                <MonitorPlay size={48} style={{ opacity: 0.2, marginBottom: '12px' }} />
                <p>Wachten op OBS verbinding...</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="stat-box">
                  <span className="stat-label">Status</span>
                  <span className="stat-value" style={{ color: obsStats?.outputActive ? '#4ade80' : 'var(--muted)' }}>
                    {obsStats?.outputActive ? 'STREAMING' : 'STANDBY'}
                  </span>
                </div>
                <div className="stat-box">
                  <span className="stat-label">Bitrate</span>
                  <span className="stat-value">{obsStats?.outputBitrate || 0} kbps</span>
                </div>
                <div className="stat-box">
                  <span className="stat-label">FPS</span>
                  <span className="stat-value">{obsStats?.outputFps?.toFixed(1) || 0}</span>
                </div>
                <div className="stat-box">
                  <span className="stat-label">Dropped Frames</span>
                  <span className="stat-value" style={{ color: (obsStats?.outputSkippedFrames > 0) ? '#fbbf24' : '#4ade80' }}>
                    {obsStats?.outputSkippedFrames || 0}
                  </span>
                </div>
              </div>
            )}
          </section>

          {obsConnected && obsStats?.outputActive && streamDetails && (
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-card"
              style={{ border: '1px solid rgba(56, 189, 248, 0.2)' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                <Globe size={20} color="var(--primary)" />
                <h2>Platform Health</h2>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {streamDetails.provider === 'youtube' ? <MonitorPlay size={18} color="#ef4444" /> : <Globe size={18} color="#3b82f6" />}
                  <span>{streamDetails.provider === 'youtube' ? 'YouTube' : 'Facebook'}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#4ade80' }}>
                  <CheckCircle2 size={16} />
                  <span>{streamDetails.health || streamDetails.status || 'Actief'}</span>
                </div>
              </div>
            </motion.section>
          )}
        </div>

        {/* Config Check Column */}
        <section className="glass-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
            <ShieldCheck size={20} color="var(--primary)" />
            <h2>Configuratie Check</h2>
          </div>

          <div className="input-group">
            <label className="input-label">Selecteer Uitzending om te controleren</label>
            <select
              className="input-field"
              value={selectedStreamId}
              onChange={(e) => setSelectedStreamId(e.target.value)}
            >
              <option value="">-- Kies een geplande stream --</option>
              {scheduledStreams.map(s => (
                <option key={s.id} value={s.id}>
                  {s.provider === 'youtube' ? '📺' : '🌐'} {s.title}
                </option>
              ))}
            </select>
          </div>

          <AnimatePresence mode="wait">
            {!selectedStreamId ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                style={{ textAlign: 'center', padding: '24px', color: 'var(--muted)', fontSize: '0.9rem' }}
              >
                Selecteer een stream om de OBS instellingen te valideren.
              </motion.div>
            ) : loadingDetails ? (
              <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ textAlign: 'center', padding: '24px' }}>
                <RefreshCcw size={24} className="spin" />
              </motion.div>
            ) : (
              <motion.div
                key="details"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '12px' }}
              >
                <div style={{ padding: '16px', borderRadius: '12px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--card-border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                    <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Stream Key (Ingest)</span>
                    {isConfigCorrect() === true ? (
                      <span style={{ color: '#4ade80', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <CheckCircle2 size={14} /> Komt overeen
                      </span>
                    ) : isConfigCorrect() === false ? (
                      <span style={{ color: '#f87171', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <XCircle size={14} /> Mismatch!
                      </span>
                    ) : null}
                  </div>
                  <code style={{ display: 'block', padding: '10px', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', fontSize: '0.8rem', overflowWrap: 'anywhere' }}>
                    {streamDetails?.streamKey
                      ? `${streamDetails.streamKey.substring(0, 8)}****${streamDetails.streamKey.substring(streamDetails.streamKey.length - 4)}`
                      : 'Onbekend'}
                  </code>
                </div>

                <div style={{ padding: '16px', borderRadius: '12px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--card-border)' }}>
                  <span style={{ display: 'block', fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '12px' }}>Huidige OBS Instelling</span>
                  <code style={{ display: 'block', padding: '10px', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', fontSize: '0.8rem', overflowWrap: 'anywhere' }}>
                    {obsState.serviceSettings?.streamServiceSettings?.key
                      ? (() => {
                          const k = obsState.serviceSettings.streamServiceSettings.key;
                          return `${k.substring(0, 8)}****${k.substring(k.length - 4)}`;
                        })()
                      : (obsConnected ? 'Geen sleutel ingesteld' : '— OBS niet verbonden —')}
                  </code>
                </div>

                {isConfigCorrect() === false && obsConnected && (
                  <motion.button
                    initial={{ scale: 0.95 }}
                    animate={{ scale: 1 }}
                    whileHover={{ scale: 1.02 }}
                    onClick={handleFixConfig}
                    className="btn-primary"
                    style={{ width: '100%', background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' }}
                    disabled={fixing}
                  >
                    <Zap size={18} /> {fixing ? 'Bijwerken...' : 'Corrigeer OBS Instellingen'}
                  </motion.button>
                )}

                {isConfigCorrect() === true && (
                  <div style={{ padding: '12px', borderRadius: '12px', background: 'rgba(74, 222, 128, 0.1)', color: '#4ade80', fontSize: '0.85rem', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                    <CheckCircle2 size={16} /> Configuratie is perfect in orde!
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </div>

      <style jsx>{`
        .stat-box {
          background: rgba(255,255,255,0.02);
          border: 1px solid var(--card-border);
          padding: 16px;
          border-radius: 12px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .stat-label {
          font-size: 0.75rem;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .stat-value {
          font-size: 1.25rem;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .spin {
          animation: spin 1s linear infinite;
        }
      `}</style>
    </div>
  );
}
