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

const YoutubeIcon = ({ size = 20, color = "currentColor", style = {} }: { size?: number, color?: string, style?: React.CSSProperties }) => (
  <svg 
    viewBox="0 0 24 24" 
    fill="currentColor" 
    style={{ width: size, height: size, color: color, ...style }}
  >
    <path d="M23.498 6.163a3.003 3.003 0 0 0-2.11-2.11C19.517 3.545 12 3.545 12 3.545s-7.516 0-9.387.507a3.003 3.003 0 0 0-2.11 2.11C0 8.033 0 12 0 12s0 3.967.502 5.837a3.003 3.003 0 0 0 2.11 2.11c1.871.507 9.388.507 9.388.507s7.517 0 9.388-.507a3.003 3.003 0 0 0 2.11-2.11C24 15.967 24 12 24 12s0-3.967-.502-5.837zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
  </svg>
);

export default function StreamMonitor({ settings, scheduledStreams }: StreamMonitorProps) {
  const [obsState, setObsState] = useState<any>({ connected: false, obsStats: null, serviceSettings: null, error: null });

  const [selectedStreamId, setSelectedStreamId] = useState<string>("");
  const [streamDetails, setStreamDetails] = useState<any>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [ledTestMsg, setLedTestMsg] = useState<string | null>(null);
  const [screenshotData, setScreenshotData] = useState<string | null>(null);

  const [ytStats, setYtStats] = useState<{
    active: boolean;
    broadcastStatus: string;
    title: string;
    concurrentViewers: number;
    likeCount: number;
    viewCount: number;
    videoId: string;
    error?: string;
  } | null>(null);

  // Poll YouTube statistics
  const fetchYoutubeStats = useCallback(async () => {
    try {
      const selectedStream = scheduledStreams.find(s => s.id === selectedStreamId);
      const isYoutube = selectedStream ? selectedStream.provider === 'youtube' : false;
      const url = isYoutube
        ? `/api/streams/youtube-stats?videoId=${encodeURIComponent(selectedStreamId)}`
        : '/api/streams/youtube-stats';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setYtStats(data);
      } else if (res.status === 401) {
        setYtStats({
          active: false,
          broadcastStatus: "offline",
          title: "",
          concurrentViewers: 0,
          likeCount: 0,
          viewCount: 0,
          videoId: "",
          error: "YouTube verbinding verlopen of niet gekoppeld."
        });
      }
    } catch (err) {
      console.error('Failed to fetch YouTube stats:', err);
    }
  }, [selectedStreamId, scheduledStreams]);

  useEffect(() => {
    fetchYoutubeStats();
    // Poll every 10 seconds
    const interval = setInterval(fetchYoutubeStats, 10000);
    return () => clearInterval(interval);
  }, [fetchYoutubeStats]);

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

  const fetchOBSScreenshot = useCallback(async () => {
    if (!obsState.connected) return;
    try {
      const res = await fetch('/api/obs/screenshot');
      if (res.ok) {
        const data = await res.json();
        if (data.imageData) {
          setScreenshotData(data.imageData);
        }
      }
    } catch (err) {}
  }, [obsState.connected]);

  useEffect(() => {
    fetchOBSStatus();
    const interval = setInterval(fetchOBSStatus, 2000);
    return () => clearInterval(interval);
  }, [fetchOBSStatus]);

  useEffect(() => {
    fetchOBSScreenshot();
    const interval = setInterval(fetchOBSScreenshot, 3000);
    return () => clearInterval(interval);
  }, [fetchOBSScreenshot]);

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

  const handleLEDTrigger = async (status: 'active' | 'inactive') => {
    setLedTestMsg("Signaal verzenden...");
    try {
      const res = await fetch(`/api/led/trigger?status=${status}`);
      const data = await res.json();
      if (data.success) {
        setLedTestMsg(data.message);
      } else {
        setLedTestMsg(`Fout: ${data.error}`);
      }
    } catch (err: any) {
      setLedTestMsg(`Fout bij verbinding: ${err.message}`);
    }
  };

  const isConfigCorrect = () => {
    if (!obsState.serviceSettings || !streamDetails) return null;
    const obsKey = obsState.serviceSettings.streamServiceSettings?.key;
    return obsKey === streamDetails.streamKey;
  };

  const executeObsAction = async (action: string, payload?: any) => {
    try {
      const res = await fetch('/api/obs/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, payload })
      });
      if (res.ok) {
        fetchOBSStatus(); // trigger refresh immediately
      }
    } catch (err) {
      console.error("OBS Action failed", err);
    }
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
                  <span className="stat-value">{obsState.bitrateKbps || 0} kbps</span>
                </div>
                <div className="stat-box">
                  <span className="stat-label">FPS</span>
                  <span className="stat-value">{obsState.fps?.toFixed(1) || 0}</span>
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

          {obsConnected && (
            <section className="glass-card" style={{ padding: '16px' }}>
              <h2 style={{ fontSize: '1.1rem', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}><MonitorPlay size={18} /> Program Output</h2>
              {screenshotData ? (
                <div style={{ borderRadius: '8px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
                  <img src={screenshotData} alt="OBS Program Output" style={{ width: '100%', display: 'block' }} />
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)', background: 'rgba(255,255,255,0.02)', borderRadius: '8px' }}>
                  Wachten op beelden...
                </div>
              )}
            </section>
          )}

          {obsConnected && (
            <section className="glass-card" style={{ padding: '16px' }}>
              <h2 style={{ fontSize: '1.1rem', marginBottom: '12px' }}>OBS Controls</h2>
              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  onClick={() => executeObsAction('ToggleStream')}
                  style={{
                    flex: 1, padding: '12px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 'bold',
                    background: obsStats?.outputActive ? 'rgba(239, 68, 68, 0.2)' : 'rgba(74, 222, 128, 0.2)',
                    color: obsStats?.outputActive ? '#ef4444' : '#4ade80',
                    borderLeft: `4px solid ${obsStats?.outputActive ? '#ef4444' : '#4ade80'}`
                  }}
                >
                  {obsStats?.outputActive ? 'Stop Streaming' : 'Start Streaming'}
                </button>
                <button
                  onClick={() => executeObsAction('ToggleRecord')}
                  style={{
                    flex: 1, padding: '12px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 'bold',
                    background: obsState.recordStatus?.outputActive ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.1)',
                    color: obsState.recordStatus?.outputActive ? '#ef4444' : '#fff',
                    borderLeft: `4px solid ${obsState.recordStatus?.outputActive ? '#ef4444' : '#fff'}`
                  }}
                >
                  {obsState.recordStatus?.outputActive ? 'Stop Recording' : 'Start Recording'}
                </button>
              </div>
            </section>
          )}

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

          {/* YouTube Stats Card */}
          <section className="glass-card" style={{ border: '1px solid rgba(239, 68, 68, 0.15)', padding: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ padding: '8px', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <YoutubeIcon size={20} color="#ef4444" />
                </div>
                <h2 style={{ margin: 0, fontSize: '1.2rem' }}>YouTube Live Uitzending</h2>
              </div>
              {ytStats?.active ? (
                <span className="badge-live" style={{ background: '#ef4444', color: '#fff', padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 'bold', letterSpacing: '0.05em' }}>LIVE</span>
              ) : (
                <span style={{ color: 'var(--muted)', fontSize: '0.8rem', background: 'rgba(255,255,255,0.04)', padding: '3px 8px', borderRadius: '6px' }}>STANDBY</span>
              )}
            </div>

            {ytStats?.error ? (
              <div style={{ color: '#f87171', fontSize: '0.85rem', padding: '12px', background: 'rgba(248, 113, 113, 0.05)', borderRadius: '8px', border: '1px solid rgba(248, 113, 113, 0.1)' }}>
                {ytStats.error}
              </div>
            ) : !ytStats ? (
              <div style={{ textAlign: 'center', padding: '20px', color: 'var(--muted)' }}>
                <RefreshCcw size={20} className="spin" style={{ margin: '0 auto 8px' }} />
                <span>Statistieken laden...</span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {ytStats.title && (
                  <div style={{ fontSize: '0.9rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '12px' }}>
                    <span style={{ color: 'var(--muted)', display: 'block', fontSize: '0.75rem', textTransform: 'uppercase', marginBottom: '2px', letterSpacing: '0.05em' }}>Titel</span>
                    <strong style={{ display: 'block', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                      {ytStats.title}
                    </strong>
                  </div>
                )}
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                  <div className="stat-box" style={{ padding: '12px' }}>
                    <span className="stat-label" style={{ fontSize: '0.7rem' }}>Kijkers</span>
                    <span className="stat-value" style={{ fontSize: '1.2rem', color: ytStats.active ? '#ef4444' : 'var(--muted)' }}>
                      {ytStats.concurrentViewers}
                    </span>
                  </div>
                  <div className="stat-box" style={{ padding: '12px' }}>
                    <span className="stat-label" style={{ fontSize: '0.7rem' }}>Likes</span>
                    <span className="stat-value" style={{ fontSize: '1.2rem' }}>
                      {ytStats.likeCount}
                    </span>
                  </div>
                  <div className="stat-box" style={{ padding: '12px' }}>
                    <span className="stat-label" style={{ fontSize: '0.7rem' }}>Weergaven</span>
                    <span className="stat-value" style={{ fontSize: '1.2rem' }}>
                      {ytStats.viewCount}
                    </span>
                  </div>
                </div>

                {ytStats.videoId && (
                  <a 
                    href={`https://youtube.com/watch?v=${ytStats.videoId}`} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="btn-outline" 
                    style={{ textAlign: 'center', display: 'block', padding: '10px', fontSize: '0.85rem', borderRadius: '8px', textDecoration: 'none', marginTop: '4px' }}
                  >
                    Open YouTube Stream
                  </a>
                )}
              </div>
            )}
          </section>
        </div>

        {/* Config Check Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {obsConnected && (
            <section className="glass-card" style={{ padding: '16px' }}>
              <h2 style={{ fontSize: '1.1rem', marginBottom: '12px' }}>Scènes & Bronnen</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                {obsState.scenes?.map((scene: any) => (
                  <div key={scene.sceneName} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.05)', padding: '8px 12px', borderRadius: '6px' }}>
                    <span style={{ fontWeight: obsState.currentProgramScene === scene.sceneName ? 'bold' : 'normal', color: obsState.currentProgramScene === scene.sceneName ? '#4ade80' : '#fff' }}>
                      {scene.sceneName}
                    </span>
                    <button
                      onClick={() => executeObsAction('SetCurrentProgramScene', { sceneName: scene.sceneName })}
                      disabled={obsState.currentProgramScene === scene.sceneName}
                      style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.2)', background: 'transparent', color: '#fff', cursor: obsState.currentProgramScene === scene.sceneName ? 'default' : 'pointer', opacity: obsState.currentProgramScene === scene.sceneName ? 0.3 : 1 }}
                    >
                      Zet Live
                    </button>
                  </div>
                ))}
              </div>
              {obsState.programSceneItems && obsState.programSceneItems.length > 0 && (
                <div>
                  <h3 style={{ fontSize: '0.9rem', color: 'var(--muted)', marginBottom: '8px' }}>Bronnen (Huidige Scène)</h3>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {obsState.programSceneItems.map((item: any) => (
                      <button
                        key={item.sceneItemId}
                        onClick={() => executeObsAction('SetSceneItemEnabled', { sceneName: obsState.currentProgramScene, sceneItemId: item.sceneItemId, sceneItemEnabled: !item.sceneItemEnabled })}
                        style={{ padding: '4px 8px', fontSize: '0.8rem', borderRadius: '4px', border: 'none', background: item.sceneItemEnabled ? 'rgba(74, 222, 128, 0.2)' : 'rgba(255,255,255,0.1)', color: item.sceneItemEnabled ? '#4ade80' : 'var(--muted)', cursor: 'pointer' }}
                      >
                        {item.sceneItemEnabled ? '👁 ' : '⊘ '}
                        {item.sourceName}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {obsConnected && obsState.audioInputs && obsState.audioInputs.length > 0 && (
            <section className="glass-card" style={{ padding: '16px' }}>
              <h2 style={{ fontSize: '1.1rem', marginBottom: '12px' }}>Audio Mixer</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {obsState.audioInputs.map((input: any) => (
                  <div key={input.inputName} style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(255,255,255,0.05)', padding: '12px', borderRadius: '6px' }}>
                    <div style={{ flex: 1, minWidth: '100px', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                      {input.inputName}
                    </div>
                    <div style={{ width: '100px', display: 'flex', alignItems: 'center' }}>
                      <input 
                        type="range" 
                        min="-100" max="0" step="0.5" 
                        value={input.volumeDb} 
                        onChange={(e) => executeObsAction('SetInputVolume', { inputName: input.inputName, inputVolumeDb: parseFloat(e.target.value) })}
                        style={{ width: '100%' }}
                      />
                    </div>
                    <div style={{ width: '50px', textAlign: 'right', fontSize: '0.8rem', color: 'var(--muted)' }}>
                      {input.volumeDb.toFixed(1)} dB
                    </div>
                    <button
                      onClick={() => executeObsAction('ToggleInputMute', { inputName: input.inputName })}
                      style={{ padding: '6px', borderRadius: '4px', border: 'none', background: input.inputMuted ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255,255,255,0.1)', color: input.inputMuted ? '#ef4444' : '#fff', cursor: 'pointer' }}
                      title={input.inputMuted ? "Unmute" : "Mute"}
                    >
                      {input.inputMuted ? '🔇' : '🔊'}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

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

           {settings.ledPanelEnabled && (
             <section className="glass-card" style={{ border: '1px solid rgba(236, 72, 153, 0.15)', padding: '24px' }}>
               <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
                 <div style={{ padding: '8px', borderRadius: '8px', background: 'rgba(236, 72, 153, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                   <Zap size={20} color="#ec4899" />
                 </div>
                 <h2 style={{ margin: 0, fontSize: '1.2rem' }}>LED Sign Board Test</h2>
               </div>
               <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginTop: 0, marginBottom: '16px' }}>
                 Stuur handmatige signalen naar het LED-scherm via <strong>{settings.freeShowHost || '192.168.2.20'}</strong>.
               </p>
               <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                 <button
                   onClick={() => handleLEDTrigger('active')}
                   className="btn-primary"
                   style={{ background: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '10px', fontSize: '0.85rem', cursor: 'pointer', border: 'none', borderRadius: '8px', color: '#fff', fontWeight: 'bold' }}
                 >
                   ON AIR (Rood)
                 </button>
                 <button
                   onClick={() => handleLEDTrigger('inactive')}
                   className="btn-primary"
                   style={{ background: 'linear-gradient(135deg, #10b981 0%, #047857 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '10px', fontSize: '0.85rem', cursor: 'pointer', border: 'none', borderRadius: '8px', color: '#fff', fontWeight: 'bold' }}
                 >
                   OFFLINE (Groen)
                 </button>
               </div>
               {ledTestMsg && (
                 <div style={{ marginTop: '12px', padding: '10px', borderRadius: '8px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--card-border)', fontSize: '0.82rem', textAlign: 'center', color: ledTestMsg.includes('Fout') || ledTestMsg.includes('niet') ? '#f87171' : '#4ade80' }}>
                   {ledTestMsg}
                 </div>
               )}
             </section>
           )}
         </div>
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
