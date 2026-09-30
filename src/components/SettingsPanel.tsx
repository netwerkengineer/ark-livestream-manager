"use client";

import { useState } from "react";
import {
  Settings,
  X,
  Save,
  FileText,
  Globe,
  Sun,
  Clock,
  Database,
  Sliders,
  User,
  Layers,
  MonitorPlay,
  Activity,
  ScrollText,
  ShieldAlert,
  Monitor,
  Cpu,
  Tv
} from "lucide-react";
import BackupRestoreSettings from "@/components/BackupRestoreSettings";
import ActivityLogPanel from "@/components/ActivityLogPanel";

interface SettingsPanelProps {
  settings: any;
  settingsTab: "general" | "connections" | "plugs" | "scheduler" | "midi" | "buttons" | "users" | "freeshow" | "sso" | "backup" | "activityLog";
  userRole: "admin" | "operator" | null;
  localUsers: any[];
  availableTemplates: string[];
  loadingUsers: boolean;
  newUsername: string;
  newPassword: string;
  newRole: "admin" | "operator";
  newPermissions: string[];
  editingUsername: string | null;
  userManagementError: string;
  userManagementSuccess: string;
  currentUser: string | null;
  isConnectedYoutube: boolean;
  onConnectYoutube: () => void;
  onDisconnectYoutube: () => void;
  onClose: () => void;
  onSettingsChange: (settings: any) => void;
  onTabChange: (tab: "general" | "connections" | "plugs" | "scheduler" | "midi" | "buttons" | "users" | "freeshow" | "sso" | "backup" | "activityLog") => void;
  onSaveSettings: () => void;
  onSaveUser: (e: React.FormEvent) => void;
  onDeleteUser: (username: string) => void;
  setNewUsername: (value: string) => void;
  setNewPassword: (value: string) => void;
  setNewRole: (value: "admin" | "operator") => void;
  setNewPermissions: (value: string[]) => void;
  setEditingUsername: (value: string | null) => void;
}

export default function SettingsPanel({
  settings,
  settingsTab,
  userRole,
  localUsers,
  availableTemplates,
  loadingUsers,
  newUsername,
  newPassword,
  newRole,
  newPermissions,
  editingUsername,
  userManagementError,
  userManagementSuccess,
  currentUser,
  isConnectedYoutube,
  onConnectYoutube,
  onDisconnectYoutube,
  onClose,
  onSettingsChange,
  onTabChange,
  onSaveSettings,
  onSaveUser,
  onDeleteUser,
  setNewUsername,
  setNewPassword,
  setNewRole,
  setNewPermissions,
  setEditingUsername
}: SettingsPanelProps) {
  const [detectingOutputs, setDetectingOutputs] = useState(false);
  const [detectedOutputs, setDetectedOutputs] = useState<{ id: string; name: string }[] | null>(null);
  const [detectError, setDetectError] = useState('');

  const detectLivestreamOutputs = async () => {
    setDetectingOutputs(true);
    setDetectError('');
    setDetectedOutputs(null);
    try {
      const res = await fetch('/api/maintenance/detect-livestream-output', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setDetectedOutputs(data.outputs || []);
      } else {
        setDetectError(data.error || 'Onbekende fout');
      }
    } catch (e: any) {
      setDetectError(e.message);
    } finally {
      setDetectingOutputs(false);
    }
  };

  return (
    <div className="glass-card settings-modal-card" style={{ position: 'relative' }}>
      <button onClick={onClose} style={{ position: 'absolute', top: '24px', right: '24px', background: 'rgba(255,255,255,0.05)', border: 'none', color: 'white', padding: '8px', borderRadius: '50%', cursor: 'pointer', zIndex: 10 }}>
        <X size={24} />
      </button>

      <div className="settings-header" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <div style={{ background: 'rgba(248, 113, 113, 0.15)', padding: '12px', borderRadius: '16px' }}>
          <Settings size={32} color="var(--primary)" />
        </div>
        <div>
          <h2 className="settings-title" style={{ fontSize: '2rem', marginBottom: '4px' }}>Systeem Instellingen</h2>
          <p style={{ color: 'var(--muted)' }}>Configureer livestreaming, verbindingen en apparaten.</p>
        </div>
      </div>

      <div className="settings-body">
        <div className="settings-sidebar">
          <button
            type="button"
            onClick={() => onTabChange("general")}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '12px 16px',
              borderRadius: '10px',
              border: 'none',
              background: settingsTab === "general" ? 'rgba(248, 113, 113, 0.15)' : 'transparent',
              color: settingsTab === "general" ? 'var(--primary)' : 'rgba(255,255,255,0.7)',
              fontWeight: settingsTab === "general" ? 600 : 500,
              textAlign: 'left',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            <FileText size={18} />
            <span>Algemeen</span>
          </button>

          <button
            type="button"
            onClick={() => onTabChange("connections")}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '12px 16px',
              borderRadius: '10px',
              border: 'none',
              background: settingsTab === "connections" ? 'rgba(248, 113, 113, 0.15)' : 'transparent',
              color: settingsTab === "connections" ? 'var(--primary)' : 'rgba(255,255,255,0.7)',
              fontWeight: settingsTab === "connections" ? 600 : 500,
              textAlign: 'left',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            <Globe size={18} />
            <span>Verbindingen</span>
          </button>

          <button
            type="button"
            onClick={() => onTabChange("plugs")}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '12px 16px',
              borderRadius: '10px',
              border: 'none',
              background: settingsTab === "plugs" ? 'rgba(248, 113, 113, 0.15)' : 'transparent',
              color: settingsTab === "plugs" ? 'var(--primary)' : 'rgba(255,255,255,0.7)',
              fontWeight: settingsTab === "plugs" ? 600 : 500,
              textAlign: 'left',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            <Sun size={18} />
            <span>Slimme Stekkers</span>
          </button>

          <button
            type="button"
            onClick={() => onTabChange("scheduler")}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '12px 16px',
              borderRadius: '10px',
              border: 'none',
              background: settingsTab === "scheduler" ? 'rgba(248, 113, 113, 0.15)' : 'transparent',
              color: settingsTab === "scheduler" ? 'var(--primary)' : 'rgba(255,255,255,0.7)',
              fontWeight: settingsTab === "scheduler" ? 600 : 500,
              textAlign: 'left',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            <Clock size={18} />
            <span>Schema's (Scheduler)</span>
          </button>

          <button
            type="button"
            onClick={() => onTabChange("midi")}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '12px 16px',
              borderRadius: '10px',
              border: 'none',
              background: settingsTab === "midi" ? 'rgba(248, 113, 113, 0.15)' : 'transparent',
              color: settingsTab === "midi" ? 'var(--primary)' : 'rgba(255,255,255,0.7)',
              fontWeight: settingsTab === "midi" ? 600 : 500,
              textAlign: 'left',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            <Database size={18} />
            <span>MIDI Bridge</span>
          </button>

          <button
            type="button"
            onClick={() => onTabChange("buttons")}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '12px 16px',
              borderRadius: '10px',
              border: 'none',
              background: settingsTab === "buttons" ? 'rgba(248, 113, 113, 0.15)' : 'transparent',
              color: settingsTab === "buttons" ? 'var(--primary)' : 'rgba(255,255,255,0.7)',
              fontWeight: settingsTab === "buttons" ? 600 : 500,
              textAlign: 'left',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            <Sliders size={18} />
            <span>Dashboard Knoppen</span>
          </button>

          {userRole === "admin" && (
            <button
              type="button"
              onClick={() => onTabChange("users")}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px 16px',
                borderRadius: '10px',
                border: 'none',
                background: settingsTab === "users" ? 'rgba(248, 113, 113, 0.15)' : 'transparent',
                color: settingsTab === "users" ? 'var(--primary)' : 'rgba(255,255,255,0.7)',
                fontWeight: settingsTab === "users" ? 600 : 500,
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              <User size={18} />
              <span>Gebruikersbeheer</span>
            </button>
          )}
          {userRole === "admin" && (
            <button
              type="button"
              onClick={() => onTabChange("sso")}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px 16px',
                borderRadius: '10px',
                border: 'none',
                background: settingsTab === "sso" ? 'rgba(248, 113, 113, 0.15)' : 'transparent',
                color: settingsTab === "sso" ? 'var(--primary)' : 'rgba(255,255,255,0.7)',
                fontWeight: settingsTab === "sso" ? 600 : 500,
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              <User size={18} />
              <span>Team-login (SSO)</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => onTabChange("freeshow")}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '12px 16px',
              borderRadius: '10px',
              border: 'none',
              background: settingsTab === "freeshow" ? 'rgba(248, 113, 113, 0.15)' : 'transparent',
              color: settingsTab === "freeshow" ? 'var(--primary)' : 'rgba(255,255,255,0.7)',
              fontWeight: settingsTab === "freeshow" ? 600 : 500,
              textAlign: 'left',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            <Layers size={18} />
            <span>FreeShow</span>
          </button>

          <button
            type="button"
            onClick={() => onTabChange("backup")}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '12px 16px',
              borderRadius: '10px',
              border: 'none',
              background: settingsTab === "backup" ? 'rgba(248, 113, 113, 0.15)' : 'transparent',
              color: settingsTab === "backup" ? 'var(--primary)' : 'rgba(255,255,255,0.7)',
              fontWeight: settingsTab === "backup" ? 600 : 500,
              textAlign: 'left',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            <Save size={18} />
            <span>Backup & Herstel</span>
          </button>

          {userRole === "admin" && (
            <button
              type="button"
              onClick={() => onTabChange("activityLog")}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px 16px',
                borderRadius: '10px',
                border: 'none',
                background: settingsTab === "activityLog" ? 'rgba(248, 113, 113, 0.15)' : 'transparent',
                color: settingsTab === "activityLog" ? 'var(--primary)' : 'rgba(255,255,255,0.7)',
                fontWeight: settingsTab === "activityLog" ? 600 : 500,
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              <ScrollText size={18} />
              <span>Activiteitenlog</span>
            </button>
          )}
        </div>

        <div className="settings-content">

          {settingsTab === "general" && (
            <section style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <h3 style={{ fontSize: '1.25rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '12px' }}>📝 Algemene Instellingen</h3>

              <div className="glass-card" style={{ padding: '20px', background: 'rgba(255,255,255,0.02)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <MonitorPlay size={18} color="var(--primary)" />
                    <strong>YouTube/Google-koppeling</strong>
                    <span style={{ fontSize: '0.8rem', color: isConnectedYoutube ? '#4ade80' : 'var(--muted)' }}>
                      {isConnectedYoutube ? '● Verbonden' : '○ Niet verbonden'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="button" className="btn-outline" onClick={onConnectYoutube}>
                      {isConnectedYoutube ? 'Opnieuw inloggen' : 'Inloggen met Google'}
                    </button>
                    {isConnectedYoutube && (
                      <button type="button" className="btn-danger" onClick={onDisconnectYoutube}>
                        Loskoppelen
                      </button>
                    )}
                  </div>
                </div>
                <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '12px' }}>
                  Dit is de Google/YouTube-koppeling waarmee de app livestreams beheert (Planner) en thumbnails synct. &quot;Verbonden&quot; betekent alleen dat er een token is opgeslagen — als YouTube-acties toch blijven mislukken (bv. &quot;Insufficient Permission&quot;/scope-fouten in het Activiteitenlog), klik dan op &quot;Loskoppelen&quot; en daarna opnieuw op &quot;Inloggen met Google&quot;, en zorg dat je bij Google's toestemmingsscherm alle gevraagde rechten toestaat (met name YouTube-beheer).
                </p>
              </div>

              <div className="input-group">
                <label className="input-label">Thumbnail Opslag Pad (NAS)</label>
                <input className="input-field" value={settings.thumbnailSavePath} onChange={(e) => onSettingsChange({...settings, thumbnailSavePath: e.target.value})} placeholder="/volume1/Beamer/FreeShow/Media" />
                <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '8px' }}>Dit is de map op de NAS waar OBS de thumbnails ophaalt.</p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                <div className="input-group">
                  <label className="input-label">Standaard Stream Titel</label>
                  <input className="input-field" value={settings.defaultTitle} onChange={(e) => onSettingsChange({...settings, defaultTitle: e.target.value})} />
                </div>
                <div className="input-group">
                  <label className="input-label">Standaard YouTube Tags</label>
                  <input className="input-field" value={settings.defaultTags} onChange={(e) => onSettingsChange({...settings, defaultTags: e.target.value})} placeholder="Ark Church, Kerkdienst, Live" />
                </div>
              </div>

              <div className="input-group">
                <label className="input-label">Standaard Beschrijving</label>
                <textarea className="input-field" style={{ minHeight: '150px', lineHeight: '1.6' }} value={settings.defaultDescription} onChange={(e) => onSettingsChange({...settings, defaultDescription: e.target.value})} />
              </div>

              <div className="input-group">
                <label className="input-label">WhatsApp Uitnodiging Template</label>
                <textarea
                  className="input-field"
                  style={{ minHeight: '100px', lineHeight: '1.6' }}
                  value={settings.whatsappTemplate || ""}
                  onChange={(e) => onSettingsChange({...settings, whatsappTemplate: e.target.value})}
                  placeholder="Hallo allemaal! Komende zondag zenden we weer live uit. U kunt de dienst volgen via deze link: {link}. Tot dan!"
                />
                <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginTop: '8px', lineHeight: '1.5' }}>
                  Pas hier het standaard WhatsApp-bericht aan. Je kunt de volgende variabelen gebruiken:
                  <br />
                  <code style={{ background: 'rgba(255,255,255,0.06)', padding: '2px 4px', borderRadius: '4px', marginRight: '6px', fontSize: '0.8rem' }}>{"{link}"}</code> (YouTube Link)
                  <br />
                  <code style={{ background: 'rgba(255,255,255,0.06)', padding: '2px 4px', borderRadius: '4px', marginRight: '6px', fontSize: '0.8rem' }}>{"{titel}"}</code> (Uitzending Titel)
                  <br />
                  <code style={{ background: 'rgba(255,255,255,0.06)', padding: '2px 4px', borderRadius: '4px', marginRight: '6px', fontSize: '0.8rem' }}>{"{datum}"}</code> (Bijv. 05 juni 2026)
                  <br />
                  <code style={{ background: 'rgba(255,255,255,0.06)', padding: '2px 4px', borderRadius: '4px', fontSize: '0.8rem' }}>{"{tijd}"}</code> (Bijv. 10:00)
                </p>
              </div>
            </section>
          )}

          {settingsTab === "connections" && (
            <section style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <h3 style={{ fontSize: '1.25rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '12px' }}>🌐 Hardware Verbindingen (IP's)</h3>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
                <div className="glass-card" style={{ padding: '20px', background: 'rgba(255,255,255,0.02)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}><MonitorPlay size={18} color="var(--primary)" /> <strong>OBS WebSocket</strong></div>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
                    <input className="input-field" placeholder="IP Adres" value={settings.obsHost} onChange={(e) => onSettingsChange({...settings, obsHost: e.target.value})} />
                    <input className="input-field" type="number" placeholder="Poort" value={settings.obsPort} onChange={(e) => onSettingsChange({...settings, obsPort: parseInt(e.target.value)})} />
                  </div>
                  <input className="input-field" type="password" style={{ marginTop: '12px' }} placeholder="Wachtwoord (optioneel)" value={settings.obsPassword} onChange={(e) => onSettingsChange({...settings, obsPassword: e.target.value})} />
                </div>

                <div className="glass-card" style={{ padding: '20px', background: 'rgba(255,255,255,0.02)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}><Activity size={18} color="var(--primary)" /> <strong>Bitfocus Companion</strong></div>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
                    <input className="input-field" placeholder="IP Adres" value={settings.companionHost} onChange={(e) => onSettingsChange({...settings, companionHost: e.target.value})} />
                    <input className="input-field" type="number" placeholder="Poort" value={settings.companionPort} onChange={(e) => onSettingsChange({...settings, companionPort: parseInt(e.target.value)})} />
                  </div>
                </div>

                <div className="glass-card" style={{ padding: '20px', background: 'rgba(255,255,255,0.02)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}><ShieldAlert size={18} color="var(--primary)" /> <strong>Behringer X32 (OSC)</strong></div>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
                    <input className="input-field" placeholder="IP Adres" value={settings.x32Host} onChange={(e) => onSettingsChange({...settings, x32Host: e.target.value})} />
                    <input className="input-field" type="number" placeholder="Poort" value={settings.x32Port} onChange={(e) => onSettingsChange({...settings, x32Port: parseInt(e.target.value)})} />
                  </div>
                </div>

                <div className="glass-card" style={{ padding: '20px', background: 'rgba(255,255,255,0.02)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}><ShieldAlert size={18} color="var(--primary)" /> <strong>Atem Mini Pro</strong></div>
                  <input className="input-field" placeholder="IP Adres" value={settings.atemHost || ""} onChange={(e) => onSettingsChange({...settings, atemHost: e.target.value})} />
                  <p className="text-[10px] text-muted" style={{ marginTop: '8px' }}>Wordt gebruikt om bij het opstarten van de OBS PC te wachten tot de Atem online is, vóórdat OBS start (anders herkent OBS de Atem-video-invoer niet).</p>
                </div>

                <div className="glass-card" style={{ padding: '20px', background: 'rgba(255,255,255,0.02)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Sun size={18} color="#f97316" /> <strong>Lichtregie (QLC+)</strong></div>
                    <label className="switch" style={{ scale: '0.8' }}>
                      <input
                        type="checkbox"
                        checked={settings.qlcEnabled}
                        onChange={(e) => onSettingsChange({...settings, qlcEnabled: e.target.checked})}
                      />
                      <span className="slider round"></span>
                    </label>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', opacity: settings.qlcEnabled ? 1 : 0.5, pointerEvents: settings.qlcEnabled ? 'auto' : 'none' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '8px' }}>
                      <input className="input-field" placeholder="QLC+ IP" value={settings.qlcHost} onChange={(e) => onSettingsChange({...settings, qlcHost: e.target.value})} />
                      <input className="input-field" type="number" placeholder="Poort" value={settings.qlcPort} onChange={(e) => onSettingsChange({...settings, qlcPort: parseInt(e.target.value) || 7700})} />
                    </div>
                    <p className="text-[10px] text-muted">Standaard OSC poort voor QLC+ is 7700.</p>
                  </div>
                </div>

                <div className="glass-card" style={{ padding: '20px', background: 'rgba(255,255,255,0.02)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}><Monitor size={18} color="#3b82f6" /> <strong>Presentatie (FreeShow)</strong></div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '8px' }}>
                      <input className="input-field" placeholder="FreeShow IP" value={settings.freeShowHost} onChange={(e) => onSettingsChange({...settings, freeShowHost: e.target.value})} />
                      <input className="input-field" type="number" placeholder="Poort" value={settings.freeShowPort} onChange={(e) => onSettingsChange({...settings, freeShowPort: parseInt(e.target.value) || 5505})} />
                    </div>
                    <p className="text-[10px] text-muted">Het media-pad voor FreeShow stel je in bij het tabblad &quot;FreeShow&quot; (Media Map).</p>
                  </div>
                </div>

                <div className="glass-card" style={{ padding: '20px', background: 'rgba(255,255,255,0.02)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Tv size={18} color="#ef4444" /> <strong>LED Paneel (BK-Light)</strong></div>
                    <label className="switch" style={{ scale: '0.8' }}>
                      <input
                        type="checkbox"
                        checked={settings.ledPanelEnabled || false}
                        onChange={(e) => onSettingsChange({...settings, ledPanelEnabled: e.target.checked})}
                      />
                      <span className="slider round"></span>
                    </label>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', opacity: settings.ledPanelEnabled ? 1 : 0.5, pointerEvents: settings.ledPanelEnabled ? 'auto' : 'none' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '8px' }}>
                      <input className="input-field" placeholder="Doel PC IP / Host (bijv. OBS PC)" value={settings.ledHost || ""} onChange={(e) => onSettingsChange({...settings, ledHost: e.target.value})} />
                      <input className="input-field" placeholder="SSH Gebruiker" value={settings.sshUser || ""} onChange={(e) => onSettingsChange({...settings, sshUser: e.target.value})} />
                    </div>
                    <p className="text-[10px] text-muted">De PC die het dichtst bij het LED paneel staat en Bluetooth verbinding heeft. Laat leeg om de FreeShow IP te gebruiken.</p>

                    <input className="input-field" placeholder="Bluetooth MAC Adres (optioneel)" value={settings.ledPanelMac || ""} onChange={(e) => onSettingsChange({...settings, ledPanelMac: e.target.value})} />
                    <p className="text-[10px] text-muted">Laat leeg voor automatische detectie van het LED paneel (advertised als BK_LIGHT, LED_BLE_* of BJ_LED).</p>

                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '12px', marginTop: '4px' }}>
                      <label className="text-[11px] text-muted" style={{ display: 'block', marginBottom: '6px' }}>Uitzending Actief (ON AIR):</label>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '12px', alignItems: 'center' }}>
                        <input className="input-field" placeholder="Scroll Tekst Actief" value={settings.ledActiveText || ""} onChange={(e) => onSettingsChange({...settings, ledActiveText: e.target.value})} />
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span className="text-[11px] text-muted">Kleur:</span>
                          <input type="color" style={{ width: '40px', height: '32px', border: 'none', borderRadius: '4px', background: 'none', cursor: 'pointer', padding: 0 }} value={settings.ledActiveColor || "#ff0000"} onChange={(e) => onSettingsChange({...settings, ledActiveColor: e.target.value})} />
                        </div>
                      </div>
                    </div>

                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '12px' }}>
                      <label className="text-[11px] text-muted" style={{ display: 'block', marginBottom: '6px' }}>Uitzending Inactief (OFFLINE):</label>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '12px', alignItems: 'center' }}>
                        <input className="input-field" placeholder="Scroll Tekst Inactief" value={settings.ledInactiveText || ""} onChange={(e) => onSettingsChange({...settings, ledInactiveText: e.target.value})} />
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span className="text-[11px] text-muted">Kleur:</span>
                          <input type="color" style={{ width: '40px', height: '32px', border: 'none', borderRadius: '4px', background: 'none', cursor: 'pointer', padding: 0 }} value={settings.ledInactiveColor || "#00ff00"} onChange={(e) => onSettingsChange({...settings, ledInactiveColor: e.target.value})} />
                        </div>
                      </div>
                    </div>

                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '12px' }}>
                      <label className="text-[11px] text-muted" style={{ display: 'block', marginBottom: '6px' }}>YouTube-controle venster (alleen zondag):</label>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                        <input
                          className="input-field"
                          type="time"
                          value={settings.ledYoutubePollStartTime || "10:00"}
                          onChange={(e) => onSettingsChange({ ...settings, ledYoutubePollStartTime: e.target.value })}
                        />
                        <input
                          className="input-field"
                          type="time"
                          value={settings.ledYoutubePollEndTime || "12:30"}
                          onChange={(e) => onSettingsChange({ ...settings, ledYoutubePollEndTime: e.target.value })}
                        />
                      </div>
                      <p className="text-[10px] text-muted" style={{ marginTop: '6px' }}>
                        Alleen op zondag binnen dit tijdvak checkt de app automatisch de YouTube-livestatus — voor het LED-paneel én voor de "we zijn nu live"-banner op de website (bespaart API-quota). Op een andere dag (bv. Kerstavond) werkt de test-knop op de Monitor-pagina nog gewoon, en toont de website geen automatische banner.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {settingsTab === "plugs" && (
            <section style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '12px' }}>
                <h3 style={{ fontSize: '1.25rem' }}>🔌 Slimme Stekkers (Tuya)</h3>
                <button
                  type="button"
                  className="btn-primary"
                  style={{ padding: '8px 16px', fontSize: '0.85rem', borderRadius: '8px' }}
                  onClick={() => {
                    const plugs = settings.tuyaPlugs || [];
                    const newPlug = {
                      id: `plug_${Date.now()}`,
                      name: "Nieuwe Stekker",
                      ip: "",
                      deviceId: "",
                      localKey: "",
                      version: 3.5,
                      hostIp: ""
                    };
                    onSettingsChange({ ...settings, tuyaPlugs: [...plugs, newPlug] });
                  }}
                >
                  + Stekker Toevoegen
                </button>
              </div>

              <div className="glass-card" style={{ padding: '20px', background: 'rgba(255,255,255,0.02)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}><Cpu size={18} color="#3b82f6" /> <strong>Tuya Control API Host</strong></div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <input
                    className="input-field"
                    placeholder="Tuya API Host IP (bijv. 10.8.0.1 of 192.168.2.250)"
                    value={settings.tuyaApiHost || ""}
                    onChange={(e) => onSettingsChange({...settings, tuyaApiHost: e.target.value.trim()})}
                  />
                  <p className="text-[10px] text-muted">
                    Het IP-adres van de host waar de Tuya HTTP server (poort 8088) op draait. Laat dit leeg om lokaal via localhost/Docker gateway te verbinden.
                  </p>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {(!settings.tuyaPlugs || settings.tuyaPlugs.length === 0) && (
                  <p style={{ color: 'var(--muted)', fontSize: '0.85rem', fontStyle: 'italic', textAlign: 'center', padding: '20px 10px', background: 'rgba(255,255,255,0.01)', borderRadius: '12px' }}>
                    Geen slimme stekkers geconfigureerd. Voeg er een toe om te beginnen.
                  </p>
                )}

                {(settings.tuyaPlugs || []).map((plug: any, idx: number) => (
                  <div
                    // Not plug.id: that field is itself editable below, and
                    // using it as the key remounted this whole row (killing
                    // focus) on every keystroke while typing a new ID.
                    key={idx}
                    className="glass-card"
                    style={{
                      padding: '16px',
                      background: 'rgba(255,255,255,0.01)',
                      border: '1px solid rgba(255,255,255,0.05)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '16px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
                      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flex: 1, minWidth: '280px' }}>
                        <input
                          className="input-field"
                          style={{ fontWeight: 'bold', fontSize: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', background: 'transparent', padding: '4px 8px', flex: 2 }}
                          placeholder="Stekker Naam (bijv. OBS PC)"
                          value={plug.name || ""}
                          onChange={(e) => {
                            const updatedPlugs = [...settings.tuyaPlugs];
                            updatedPlugs[idx] = { ...plug, name: e.target.value };
                            onSettingsChange({ ...settings, tuyaPlugs: updatedPlugs });
                          }}
                        />
                        <input
                          className="input-field"
                          style={{ fontSize: '0.8rem', flex: 1, fontFamily: 'monospace' }}
                          placeholder="Unieke ID (obs_pc)"
                          value={plug.id || ""}
                          onChange={(e) => {
                            const updatedPlugs = [...settings.tuyaPlugs];
                            updatedPlugs[idx] = { ...plug, id: e.target.value.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase() };
                            onSettingsChange({ ...settings, tuyaPlugs: updatedPlugs });
                          }}
                        />
                      </div>
                      <button
                        type="button"
                        className="btn-danger"
                        style={{
                          padding: '6px 12px',
                          fontSize: '0.8rem',
                          borderRadius: '8px',
                          background: 'rgba(239, 68, 68, 0.15)',
                          border: '1px solid rgba(239, 68, 68, 0.35)',
                          color: '#ef4444',
                          cursor: 'pointer'
                        }}
                        onClick={() => {
                          const updatedPlugs = settings.tuyaPlugs.filter((_: any, i: number) => i !== idx);
                          onSettingsChange({ ...settings, tuyaPlugs: updatedPlugs });
                        }}
                      >
                        Verwijderen
                      </button>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
                      <div>
                        <label style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block', marginBottom: '6px' }}>IP-adres</label>
                        <input
                          className="input-field"
                          placeholder="Bijv. 192.168.40.60"
                          value={plug.ip || ""}
                          onChange={(e) => {
                            const updatedPlugs = [...settings.tuyaPlugs];
                            updatedPlugs[idx] = { ...plug, ip: e.target.value.trim() };
                            onSettingsChange({ ...settings, tuyaPlugs: updatedPlugs });
                          }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block', marginBottom: '6px' }}>Device ID</label>
                        <input
                          className="input-field"
                          placeholder="Tuya Device ID"
                          value={plug.deviceId || ""}
                          onChange={(e) => {
                            const updatedPlugs = [...settings.tuyaPlugs];
                            updatedPlugs[idx] = { ...plug, deviceId: e.target.value.trim() };
                            onSettingsChange({ ...settings, tuyaPlugs: updatedPlugs });
                          }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block', marginBottom: '6px' }}>Local Key</label>
                        <input
                          className="input-field"
                          type="password"
                          placeholder="Tuya Local Key"
                          value={plug.localKey || ""}
                          onChange={(e) => {
                            const updatedPlugs = [...settings.tuyaPlugs];
                            updatedPlugs[idx] = { ...plug, localKey: e.target.value.trim() };
                            onSettingsChange({ ...settings, tuyaPlugs: updatedPlugs });
                          }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block', marginBottom: '6px' }}>Gekoppelde Host IP</label>
                        <input
                          className="input-field"
                          placeholder="Bijv. 192.168.2.20"
                          value={plug.hostIp || ""}
                          onChange={(e) => {
                            const updatedPlugs = [...settings.tuyaPlugs];
                            updatedPlugs[idx] = { ...plug, hostIp: e.target.value.trim() };
                            onSettingsChange({ ...settings, tuyaPlugs: updatedPlugs });
                          }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block', marginBottom: '6px' }}>Protocol Versie</label>
                        <select
                          className="input-field"
                          value={plug.version || 3.5}
                          onChange={(e) => {
                            const updatedPlugs = [...settings.tuyaPlugs];
                            updatedPlugs[idx] = { ...plug, version: parseFloat(e.target.value) || 3.5 };
                            onSettingsChange({ ...settings, tuyaPlugs: updatedPlugs });
                          }}
                        >
                          <option value="3.1">3.1</option>
                          <option value="3.3">3.3</option>
                          <option value="3.4">3.4</option>
                          <option value="3.5">3.5</option>
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block', marginBottom: '6px' }}>Kanaal (bij stekkerdoos met meerdere stopcontacten)</label>
                        <input
                          className="input-field"
                          type="number"
                          min={1}
                          placeholder="1"
                          disabled={plug.switchIndex === "all"}
                          style={plug.switchIndex === "all" ? { opacity: 0.4 } : undefined}
                          value={plug.switchIndex === "all" ? "" : (plug.switchIndex || 1)}
                          onChange={(e) => {
                            const updatedPlugs = [...settings.tuyaPlugs];
                            updatedPlugs[idx] = { ...plug, switchIndex: parseInt(e.target.value, 10) || 1 };
                            onSettingsChange({ ...settings, tuyaPlugs: updatedPlugs });
                          }}
                        />
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px', fontSize: '0.75rem', color: 'var(--muted)', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={plug.switchIndex === "all"}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              const updatedPlugs = [...settings.tuyaPlugs];
                              updatedPlugs[idx] = {
                                ...plug,
                                switchIndex: checked ? "all" : 1,
                                // Sensible starting default (a common 4-outlet
                                // + USB strip) rather than leaving it blank -
                                // edit down to e.g. "1,3,5" for a subset.
                                allChannels: checked ? (plug.allChannels || "1,2,3,4,5") : plug.allChannels,
                              };
                              onSettingsChange({ ...settings, tuyaPlugs: updatedPlugs });
                            }}
                          />
                          Bedient alle kanalen tegelijk
                        </label>
                        {plug.switchIndex === "all" && (
                          <input
                            className="input-field"
                            style={{ marginTop: '8px' }}
                            placeholder="Kanalen, bv. 1,2,3,4"
                            // Kept as the raw typed string, not parsed into
                            // numbers on every keystroke - re-deriving the
                            // displayed value from a parsed-then-rejoined
                            // array stripped trailing/in-progress commas
                            // (e.g. typing "1," immediately snapped back to
                            // "1"), making it impossible to type a list at
                            // all. control_plug.py parses this string.
                            value={plug.allChannels || ""}
                            onChange={(e) => {
                              const updatedPlugs = [...settings.tuyaPlugs];
                              updatedPlugs[idx] = { ...plug, allChannels: e.target.value };
                              onSettingsChange({ ...settings, tuyaPlugs: updatedPlugs });
                            }}
                          />
                        )}
                      </div>
                    </div>
                    <p style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: '6px', marginBottom: 0 }}>
                      Alleen relevant bij een stekkerdoos met meerdere los schakelbare stopcontacten: maak voor elk stopcontact een aparte stekker aan met dezelfde IP/Device ID/Local Key, en geef elke een ander kanaalnummer (1, 2, 3, ...). Een gewone losse stekker laat je gewoon op 1 staan. Voeg optioneel nog één extra stekker-entry toe met dezelfde IP/Device ID/Local Key en vink daar "Bedient alle kanalen tegelijk" aan om alle stopcontacten in één keer aan/uit te zetten — dat vult de kanalenlijst standaard met "1,2,3,4,5"; pas die aan naar bv. "1,3,5" om alleen die specifieke kanalen te triggeren.
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {settingsTab === "scheduler" && (
            <section style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '12px' }}>
                <h3 style={{ fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Clock size={20} /> Automatische Schema's (Scheduler)
                </h3>
                <button
                  type="button"
                  className="btn-primary"
                  style={{ padding: '8px 16px', fontSize: '0.85rem', borderRadius: '8px' }}
                  onClick={() => {
                    const schedules = settings.schedules || [];
                    const newSched = {
                      id: `sched_${Date.now()}`,
                      name: "Nieuwe Taak",
                      time: "09:00",
                      days: [0], // Zondag standaard
                      action: "on",
                      plug: "all",
                      enabled: true
                    };
                    onSettingsChange({ ...settings, schedules: [...schedules, newSched] });
                  }}
                >
                  + Schema Toevoegen
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {(!settings.schedules || settings.schedules.length === 0) && (
                  <p style={{ color: 'var(--muted)', fontSize: '0.85rem', fontStyle: 'italic', textAlign: 'center', padding: '20px 10px', background: 'rgba(255,255,255,0.01)', borderRadius: '12px' }}>
                    Geen automatische schema's geconfigureerd. Voeg een schema toe om taken in te plannen.
                  </p>
                )}

                {(settings.schedules || []).map((sched: any, idx: number) => {
                  const weekdays = ["Zo", "Ma", "Di", "Wo", "Do", "Vr", "Za"];
                  return (
                    <div
                      key={sched.id || idx}
                      className="glass-card"
                      style={{
                        padding: '16px',
                        background: 'rgba(255,255,255,0.01)',
                        border: '1px solid rgba(255,255,255,0.05)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '16px'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
                        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flex: 1, minWidth: '280px' }}>
                          <input
                            className="input-field"
                            style={{ fontWeight: 'bold', fontSize: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', background: 'transparent', padding: '4px 8px', flex: 2 }}
                            placeholder="Naam (bijv. Zondag Opstart)"
                            value={sched.name || ""}
                            onChange={(e) => {
                              const updated = [...settings.schedules];
                              updated[idx] = { ...sched, name: e.target.value };
                              onSettingsChange({ ...settings, schedules: updated });
                            }}
                          />
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <input
                              type="checkbox"
                              id={`sched_enable_${sched.id}`}
                              checked={sched.enabled !== false}
                              onChange={(e) => {
                                const updated = [...settings.schedules];
                                updated[idx] = { ...sched, enabled: e.target.checked };
                                onSettingsChange({ ...settings, schedules: updated });
                              }}
                            />
                            <label htmlFor={`sched_enable_${sched.id}`} style={{ fontSize: '0.8rem', color: sched.enabled !== false ? '#4ade80' : 'var(--muted)', cursor: 'pointer' }}>
                              {sched.enabled !== false ? "Actief" : "Uit"}
                            </label>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn-danger"
                          style={{
                            padding: '6px 12px',
                            fontSize: '0.8rem',
                            borderRadius: '8px',
                            background: 'rgba(239, 68, 68, 0.15)',
                            border: '1px solid rgba(239, 68, 68, 0.35)',
                            color: '#ef4444',
                            cursor: 'pointer'
                          }}
                          onClick={() => {
                            const updated = settings.schedules.filter((_: any, i: number) => i !== idx);
                            onSettingsChange({ ...settings, schedules: updated });
                          }}
                        >
                          Verwijderen
                        </button>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
                        <div>
                          <label style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block', marginBottom: '6px' }}>Tijd (HH:MM)</label>
                          <input
                            className="input-field"
                            type="time"
                            value={sched.time || "09:00"}
                            onChange={(e) => {
                              const updated = [...settings.schedules];
                              updated[idx] = { ...sched, time: e.target.value };
                              onSettingsChange({ ...settings, schedules: updated });
                            }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block', marginBottom: '6px' }}>Actie</label>
                          <select
                            className="input-field"
                            value={sched.action || "on"}
                            onChange={(e) => {
                              const updated = [...settings.schedules];
                              updated[idx] = { ...sched, action: e.target.value };
                              onSettingsChange({ ...settings, schedules: updated });
                            }}
                          >
                            <option value="on">Opstarten (AAN)</option>
                            <option value="shutdown">Netjes Afsluiten</option>
                            <option value="off">Stroom Verbreken (UIT)</option>
                          </select>
                        </div>
                        <div>
                          <label style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block', marginBottom: '6px' }}>Slimme Stekker</label>
                          <select
                            className="input-field"
                            value={sched.plug || "all"}
                            onChange={(e) => {
                              const updated = [...settings.schedules];
                              updated[idx] = { ...sched, plug: e.target.value };
                              onSettingsChange({ ...settings, schedules: updated });
                            }}
                          >
                            <option value="all">Alle slimme stekkers</option>
                            {(settings.tuyaPlugs || []).map((p: any) => (
                              <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div>
                        <label style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block', marginBottom: '6px' }}>Herhalen op dagen</label>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          {weekdays.map((dayName, dayIdx) => {
                            const isSelected = sched.days.includes(dayIdx);
                            return (
                              <button
                                key={dayIdx}
                                type="button"
                                onClick={() => {
                                  const currentDays = [...sched.days];
                                  let updatedDays;
                                  if (isSelected) {
                                    updatedDays = currentDays.filter(d => d !== dayIdx);
                                  } else {
                                    updatedDays = [...currentDays, dayIdx].sort();
                                  }
                                  const updated = [...settings.schedules];
                                  updated[idx] = { ...sched, days: updatedDays };
                                  onSettingsChange({ ...settings, schedules: updated });
                                }}
                                style={{
                                  padding: '6px 12px',
                                  fontSize: '0.75rem',
                                  borderRadius: '8px',
                                  border: isSelected ? '1px solid var(--primary)' : '1px solid rgba(255,255,255,0.08)',
                                  background: isSelected ? 'rgba(248, 113, 113, 0.15)' : 'rgba(255,255,255,0.02)',
                                  color: isSelected ? 'var(--primary)' : 'rgba(255,255,255,0.7)',
                                  cursor: 'pointer',
                                  fontWeight: isSelected ? 'bold' : 'normal',
                                  transition: 'all 0.15s'
                                }}
                              >
                                {dayName}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {settingsTab === "midi" && (
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
                      onChange={(e) => onSettingsChange({...settings, midiEnabled: e.target.checked})}
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
                        onChange={(e) => onSettingsChange({...settings, midiSessionName: e.target.value})}
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
                        onChange={(e) => onSettingsChange({...settings, midiAutoConnectIps: e.target.value})}
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
          )}

          {settingsTab === "buttons" && (
            <section style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '12px' }}>
                <h3 style={{ fontSize: '1.25rem' }}>🔘 Dashboard Knoppen (Control Center)</h3>
                <button
                  onClick={() => {
                    const newButton = { id: Math.random().toString(36).substr(2, 9), name: 'NIEUWE KNOP', sub: 'Beschrijving', icon: 'zap', color: 'blue', page: 1, row: 0, col: 0 };
                    onSettingsChange({...settings, broadcastButtons: [...(settings.broadcastButtons || []), newButton]});
                  }}
                  className="btn-primary"
                  style={{ padding: '8px 20px', fontSize: '0.9rem' }}
                >
                  + Nieuwe Knop Toevoegen
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
                {(settings.broadcastButtons || []).map((btn: any, idx: number) => (
                  <div key={btn.id} className="glass-card" style={{ padding: '20px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div style={{ display: 'flex', gap: '16px', justifyContent: 'space-between' }}>
                      <div style={{ flex: 1 }}>
                        <label className="input-label" style={{ fontSize: '0.7rem' }}>KNOP TITEL</label>
                        <input className="input-field" style={{ fontWeight: 'bold', fontSize: '1.05rem' }} value={btn.name} onChange={(e) => {
                          const newBtns = [...settings.broadcastButtons];
                          newBtns[idx].name = e.target.value;
                          onSettingsChange({...settings, broadcastButtons: newBtns});
                        }} />
                      </div>
                      <button onClick={() => {
                        const newBtns = settings.broadcastButtons.filter((_: any, i: number) => i !== idx);
                        onSettingsChange({...settings, broadcastButtons: newBtns});
                      }} style={{ color: '#f87171', background: 'rgba(248, 113, 113, 0.1)', border: 'none', padding: '6px', borderRadius: '8px', cursor: 'pointer', height: 'fit-content', marginTop: '22px' }}><X size={18} /></button>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: '10px' }}>
                      <div className="input-group">
                        <label className="input-label" style={{ fontSize: '0.7rem' }}>Subtekst</label>
                        <input className="input-field" value={btn.sub} onChange={(e) => {
                          const newBtns = [...settings.broadcastButtons];
                          newBtns[idx].sub = e.target.value;
                          onSettingsChange({...settings, broadcastButtons: newBtns});
                        }} />
                      </div>
                      <div className="input-group">
                        <label className="input-label" style={{ fontSize: '0.7rem' }}>Icoon</label>
                        <select className="input-field" value={btn.icon} onChange={(e) => {
                          const newBtns = [...settings.broadcastButtons];
                          newBtns[idx].icon = e.target.value;
                          onSettingsChange({...settings, broadcastButtons: newBtns});
                        }}>
                          <option value="play">Play</option>
                          <option value="square">Stop</option>
                          <option value="volume-x">Mute</option>
                          <option value="monitor-off">Off</option>
                          <option value="zap">Zap</option>
                          <option value="refresh-cw">Sync</option>
                        </select>
                      </div>
                      <div className="input-group">
                        <label className="input-label" style={{ fontSize: '0.7rem' }}>Kleur</label>
                        <select className="input-field" value={btn.color} onChange={(e) => {
                          const newBtns = [...settings.broadcastButtons];
                          newBtns[idx].color = e.target.value;
                          onSettingsChange({...settings, broadcastButtons: newBtns});
                        }}>
                          <option value="green">Groen</option>
                          <option value="red">Rood</option>
                          <option value="amber">Oranje</option>
                          <option value="blue">Blauw</option>
                          <option value="purple">Paars</option>
                          <option value="slate">Grijs</option>
                        </select>
                      </div>
                    </div>

                    <div className="input-group" style={{ marginTop: '4px' }}>
                      <label className="input-label" style={{ fontSize: '0.7rem' }}>🔒 Vereiste Machtiging (Wie mag deze knop zien?)</label>
                      <select className="input-field" value={btn.requiredPermission || ''} onChange={(e) => {
                        const newBtns = [...settings.broadcastButtons];
                        newBtns[idx].requiredPermission = e.target.value || undefined;
                        onSettingsChange({...settings, broadcastButtons: newBtns});
                      }}>
                        <option value="">Geen restrictie (iedereen met Control Center)</option>
                        <option value="planner">Stream Planner</option>
                        <option value="control">Control Center</option>
                        <option value="monitor">Live Monitor</option>
                        <option value="lights">Lichtregie</option>
                        <option value="freeshow">FreeShow Projecten</option>
                      </select>
                    </div>

                    <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.04)' }}>
                      <p style={{ fontSize: '0.7rem', color: 'var(--muted)', marginBottom: '8px', fontWeight: 'bold', textTransform: 'uppercase' }}>Companion Adres & MIDI Input</p>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                        <div className="input-group"><label className="input-label" style={{ fontSize: '0.65rem' }}>Page</label><input type="number" className="input-field" style={{ padding: '6px' }} value={btn.page} onChange={(e) => {
                          const newBtns = [...settings.broadcastButtons];
                          newBtns[idx].page = parseInt(e.target.value) || 1;
                          onSettingsChange({...settings, broadcastButtons: newBtns});
                        }} /></div>
                        <div className="input-group"><label className="input-label" style={{ fontSize: '0.65rem' }}>Row</label><input type="number" className="input-field" style={{ padding: '6px' }} value={btn.row} onChange={(e) => {
                          const newBtns = [...settings.broadcastButtons];
                          newBtns[idx].row = parseInt(e.target.value) || 0;
                          onSettingsChange({...settings, broadcastButtons: newBtns});
                        }} /></div>
                        <div className="input-group"><label className="input-label" style={{ fontSize: '0.65rem' }}>Col</label><input type="number" className="input-field" style={{ padding: '6px' }} value={btn.col} onChange={(e) => {
                          const newBtns = [...settings.broadcastButtons];
                          newBtns[idx].col = parseInt(e.target.value) || 0;
                          onSettingsChange({...settings, broadcastButtons: newBtns});
                        }} /></div>
                        <div className="input-group">
                          <label className="input-label" style={{ fontSize: '0.65rem' }}>MIDI Note</label>
                          <input
                            type="text"
                            className="input-field"
                            style={{ padding: '6px' }}
                            placeholder="60"
                            value={btn.midiNote !== undefined ? btn.midiNote : ""}
                            onChange={(e) => {
                              const newBtns = [...settings.broadcastButtons];
                              newBtns[idx].midiNote = e.target.value !== "" ? parseInt(e.target.value) : undefined;
                              onSettingsChange({...settings, broadcastButtons: newBtns});
                            }}
                          />
                        </div>
                      </div>
                    </div>

                    <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.04)', marginTop: '8px' }}>
                      <p style={{ fontSize: '0.7rem', color: 'var(--muted)', marginBottom: '8px', fontWeight: 'bold', textTransform: 'uppercase' }}>MIDI Output (Sturen bij klik)</p>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                        <div className="input-group">
                          <label className="input-label" style={{ fontSize: '0.65rem' }}>MIDI Note</label>
                          <input
                            type="text"
                            className="input-field"
                            style={{ padding: '6px' }}
                            placeholder="60"
                            value={btn.midiOutNote !== undefined ? btn.midiOutNote : ""}
                            onChange={(e) => {
                              const newBtns = [...settings.broadcastButtons];
                              newBtns[idx].midiOutNote = e.target.value !== "" ? parseInt(e.target.value) : undefined;
                              onSettingsChange({...settings, broadcastButtons: newBtns});
                            }}
                          />
                        </div>
                        <div className="input-group">
                          <label className="input-label" style={{ fontSize: '0.65rem' }}>MIDI Channel</label>
                          <input
                            type="number"
                            min="1"
                            max="16"
                            className="input-field"
                            style={{ padding: '6px' }}
                            value={btn.midiOutChannel !== undefined ? btn.midiOutChannel : 1}
                            onChange={(e) => {
                              const newBtns = [...settings.broadcastButtons];
                              newBtns[idx].midiOutChannel = e.target.value !== "" ? parseInt(e.target.value) : 1;
                              onSettingsChange({...settings, broadcastButtons: newBtns});
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {settingsTab === "users" && userRole === "admin" && (
            <section style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <h3 style={{ fontSize: '1.25rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '12px' }}>👥 Gebruikersbeheer (RBAC)</h3>

              {/* Form to create/edit user */}
              <form onSubmit={onSaveUser} className="glass-card" style={{ padding: '20px', background: 'rgba(255,255,255,0.02)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <h4 style={{ fontSize: '1rem', fontWeight: 600 }}>{editingUsername ? `Gebruiker bewerken: ${editingUsername}` : "Nieuwe Gebruiker Toevoegen"}</h4>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                  <div className="input-group">
                    <label className="input-label">Gebruikersnaam</label>
                    <input
                      type="text"
                      className="input-field"
                      value={newUsername}
                      disabled={!!editingUsername}
                      onChange={e => setNewUsername(e.target.value)}
                      placeholder="bijv. karel123"
                    />
                  </div>
                  <div className="input-group">
                    <label className="input-label">Wachtwoord {editingUsername && "(Leeglaten om niet te wijzigen)"}</label>
                    <input
                      type="password"
                      className="input-field"
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      placeholder={editingUsername ? "••••••••" : "Minimaal 6 tekens"}
                    />
                  </div>
                  <div className="input-group">
                    <label className="input-label">Rol</label>
                    <select
                      className="input-field"
                      value={newRole}
                      onChange={e => setNewRole(e.target.value as "admin" | "operator")}
                    >
                      <option value="operator">Operator (Alleen bediening)</option>
                      <option value="admin">Administrator (Volledige toegang)</option>
                    </select>
                  </div>
                </div>

                {newRole === "operator" && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '16px' }}>
                    <label className="input-label" style={{ fontWeight: 600 }}>Machtigingen (minimaal één verplicht):</label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginTop: '4px' }}>
                      {[
                        { id: "planner", name: "Stream Planner" },
                        { id: "control", name: "Control Center" },
                        { id: "monitor", name: "Live Monitor" },
                        { id: "lights", name: "Lichtregie" },
                        { id: "freeshow", name: "FreeShow Projecten" }
                      ].map(perm => (
                        <label key={perm.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={newPermissions.includes(perm.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setNewPermissions([...newPermissions, perm.id]);
                              } else {
                                setNewPermissions(newPermissions.filter(p => p !== perm.id));
                              }
                            }}
                            style={{ width: '16px', height: '16px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.2)', background: 'transparent', cursor: 'pointer' }}
                          />
                          <span>{perm.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {userManagementError && <p style={{ color: '#f87171', fontSize: '0.85rem' }}>{userManagementError}</p>}
                {userManagementSuccess && <p style={{ color: '#4ade80', fontSize: '0.85rem' }}>{userManagementSuccess}</p>}

                <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                  <button type="submit" className="btn-primary" style={{ padding: '8px 20px', fontSize: '0.9rem' }}>
                    {editingUsername ? "Bijwerken" : "Gebruiker Toevoegen"}
                  </button>
                  {editingUsername && (
                    <button
                      type="button"
                      className="btn-outline"
                      style={{ padding: '8px 20px', fontSize: '0.9rem' }}
                      onClick={() => {
                        setEditingUsername(null);
                        setNewUsername("");
                        setNewPassword("");
                        setNewRole("operator");
                        setNewPermissions([]);
                      }}
                    >
                      Annuleren
                    </button>
                  )}
                </div>
              </form>

              {/* List of existing users */}
              <div className="glass-card" style={{ padding: '20px', background: 'rgba(255,255,255,0.02)' }}>
                <h4 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px' }}>Bestaande Gebruikers</h4>

                {loadingUsers ? (
                  <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>Gebruikers laden...</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {localUsers.map((u: any) => (
                      <div
                        key={u.username}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '12px 16px',
                          background: 'rgba(255,255,255,0.01)',
                          border: '1px solid rgba(255,255,255,0.05)',
                          borderRadius: '8px'
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{u.username}</span>
                            <span style={{
                              padding: '2px 8px',
                              borderRadius: '12px',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              background: u.role === "admin" ? 'rgba(248, 113, 113, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                              color: u.role === "admin" ? 'var(--primary)' : '#60a5fa'
                            }}>
                              {u.role === "admin" ? "Admin" : "Operator"}
                            </span>
                          </div>
                          {u.role === "operator" && (
                            <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '6px' }}>
                              <strong>Rechten:</strong> {u.permissions && u.permissions.length > 0
                                ? u.permissions.map((p: string) => {
                                    const mapping: Record<string, string> = {
                                      planner: "Stream Planner",
                                      control: "Control Center",
                                      monitor: "Live Monitor",
                                      lights: "Lichtregie",
                                      freeshow: "FreeShow Projecten"
                                    };
                                    return mapping[p] || p;
                                  }).join(", ")
                                : "Geen"}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            type="button"
                            className="btn-outline"
                            style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                            onClick={() => {
                              setEditingUsername(u.username);
                              setNewUsername(u.username);
                              setNewPassword("");
                              setNewRole(u.role);
                              setNewPermissions(u.permissions || []);
                            }}
                          >
                            Bewerken
                          </button>
                          <button
                            type="button"
                            className="btn-danger"
                            disabled={u.username.toLowerCase() === currentUser?.toLowerCase()}
                            style={{
                              padding: '6px 12px',
                              fontSize: '0.8rem',
                              background: 'rgba(239, 68, 68, 0.15)',
                              border: '1px solid rgba(239, 68, 68, 0.35)',
                              color: '#ef4444',
                              cursor: u.username.toLowerCase() === currentUser?.toLowerCase() ? 'not-allowed' : 'pointer',
                              opacity: u.username.toLowerCase() === currentUser?.toLowerCase() ? 0.5 : 1
                            }}
                            onClick={() => onDeleteUser(u.username)}
                          >
                            Verwijderen
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          {settingsTab === "freeshow" && (
            <section style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <h3 style={{ fontSize: '1.25rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '12px' }}>⛪ FreeShow Instellingen</h3>

              <div className="input-group">
                <label className="input-label">FreeShow Hoofdmap</label>
                <input
                  type="text"
                  className="input-field"
                  value={settings.freeshowPath || ""}
                  onChange={(e) => onSettingsChange({ ...settings, freeshowPath: e.target.value })}
                  placeholder="/volume1/Beamer/FreeShow"
                />
              </div>

              <div className="input-group">
                <label className="input-label">FreeShow Hoofdmap, zoals de FreeShow-computer 'm zelf ziet</label>
                <input
                  type="text"
                  className="input-field"
                  value={settings.freeshowClientPath || ""}
                  onChange={(e) => onSettingsChange({ ...settings, freeshowClientPath: e.target.value })}
                  placeholder="/Volumes/Projects/Beamer/FreeShow"
                />
                <p style={{ fontSize: '0.75rem', opacity: 0.5, marginTop: '4px' }}>
                  Dezelfde map als hierboven, maar dan het pad zoals de computer waar FreeShow op draait 'm ziet (bv. een Mac-volume of Windows-netwerkschijf). Nodig zodat media-bestanden die deze app aanmaakt (uploads, e-mailbijlagen) correct verwijzen in het gegenereerde project — leeg laten als het exact hetzelfde pad is.
                </p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="input-group">
                  <label className="input-label">Projecten Map</label>
                  <input
                    type="text"
                    className="input-field"
                    value={settings.freeshowProjectPath || ""}
                    onChange={(e) => onSettingsChange({ ...settings, freeshowProjectPath: e.target.value })}
                    placeholder="/volume1/Beamer/FreeShow/projects"
                  />
                </div>
                <div className="input-group">
                  <label className="input-label">Media Map</label>
                  <input
                    type="text"
                    className="input-field"
                    value={settings.freeshowMediaPath || ""}
                    onChange={(e) => onSettingsChange({ ...settings, freeshowMediaPath: e.target.value })}
                    placeholder="/volume1/Beamer/FreeShow/media"
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="input-group">
                  <label className="input-label">Prullenbak Map (.trash)</label>
                  <input
                    type="text"
                    className="input-field"
                    value={settings.freeshowTrashPath || ""}
                    onChange={(e) => onSettingsChange({ ...settings, freeshowTrashPath: e.target.value })}
                    placeholder="/volume1/Beamer/FreeShow/.trash"
                  />
                </div>
                <div className="input-group">
                  <label className="input-label">Standaard Sjabloon (Template)</label>
                  <select
                    className="input-field"
                    style={{ width: '100%' }}
                    value={settings.defaultTemplate || ""}
                    onChange={(e) => onSettingsChange({ ...settings, defaultTemplate: e.target.value })}
                  >
                    <option value="">-- Geen template (Leeg project) --</option>
                    <option value="template.project">template.project (Ingebouwde Fallback)</option>
                    {availableTemplates.map((tmpl) => (
                      tmpl !== 'template.project' && (
                        <option key={tmpl} value={tmpl}>{tmpl}</option>
                      )
                    ))}
                  </select>
                </div>
              </div>

              <div className="input-group" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <input
                  type="checkbox"
                  id="autoSaveToNas"
                  checked={!!settings.autoSaveToNas}
                  onChange={(e) => onSettingsChange({ ...settings, autoSaveToNas: e.target.checked })}
                  style={{ width: '20px', height: '20px', cursor: 'pointer' }}
                />
                <label htmlFor="autoSaveToNas" className="input-label" style={{ margin: 0, cursor: 'pointer', textTransform: 'none' }}>
                  Gegenereerde projecten automatisch opslaan op de NAS
                </label>
              </div>

              <div className="input-group">
                <label className="input-label">Output-ID voor livestream-video-stijl</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    className="input-field"
                    style={{ margin: 0, flex: 1 }}
                    value={settings.livestreamStyleOutputId || ""}
                    onChange={(e) => onSettingsChange({ ...settings, livestreamStyleOutputId: e.target.value })}
                    placeholder="bijv. eee96674a23"
                  />
                  <button
                    type="button"
                    className="button"
                    disabled={detectingOutputs}
                    onClick={detectLivestreamOutputs}
                    style={{ padding: '0.5rem 0.9rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                  >
                    {detectingOutputs ? 'Bezig...' : 'Automatisch opzoeken'}
                  </button>
                </div>
                <p style={{ fontSize: '0.75rem', opacity: 0.5, marginTop: '4px' }}>
                  Het ID van de "Livestream"-output in FreeShow zelf - dit ID staat nergens in FreeShow's eigen scherm, maar de knop hierboven haalt 'm rechtstreeks op via SSH bij de machine die nu als FreeShow-host is ingesteld. Dit ID is lokaal aan die machine (de Beamer PC in productie) — <strong>niet</strong> hetzelfde als op een andere omgeving, en verandert niet vanzelf; alleen opnieuw opzoeken als de output ooit verwijderd/opnieuw aangemaakt is. Gebruikt om automatisch een YouTube-video bij het genereren van een project op deze output naar de stijl "Livestream Video fullscreen" te laten schakelen.
                </p>
                {detectError && (
                  <p style={{ fontSize: '0.75rem', color: '#ef4444', marginTop: '6px' }}>❌ {detectError}</p>
                )}
                {detectedOutputs && (
                  <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {detectedOutputs.length === 0 ? (
                      <p style={{ fontSize: '0.75rem', opacity: 0.6 }}>Geen outputs gevonden op die machine.</p>
                    ) : detectedOutputs.map(o => (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => onSettingsChange({ ...settings, livestreamStyleOutputId: o.id })}
                        style={{
                          textAlign: 'left', padding: '0.4rem 0.7rem', fontSize: '0.78rem', borderRadius: '6px',
                          border: '1px solid rgba(255,255,255,0.1)',
                          background: settings.livestreamStyleOutputId === o.id ? 'rgba(248,113,113,0.15)' : 'rgba(255,255,255,0.03)',
                          color: 'inherit', cursor: 'pointer'
                        }}
                      >
                        <strong>{o.name}</strong> <span style={{ opacity: 0.5 }}>({o.id})</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '12px' }}>
                  <h3 style={{ fontSize: '1.1rem' }}>🖥️ Extra FreeShow Doelen (Sync)</h3>
                  <button
                    type="button"
                    className="btn-primary"
                    style={{ padding: '8px 16px', fontSize: '0.85rem', borderRadius: '8px' }}
                    onClick={() => {
                      const targets = settings.freeshowAdditionalTargets || [];
                      const newTarget = {
                        id: `target_${Date.now()}`,
                        name: "Nieuw Doel",
                        host: "",
                        sshUser: "",
                        enabled: true
                      };
                      onSettingsChange({ ...settings, freeshowAdditionalTargets: [...targets, newTarget] });
                    }}
                  >
                    + Doel Toevoegen
                  </button>
                </div>
                <p style={{ fontSize: '0.8rem', opacity: 0.6, marginTop: '-8px' }}>
                  Deze doelen ontvangen dezelfde volledige catalogus (Shows, Media, Bibles, Templates) als de hoofd-Beamer PC hierboven, bijvoorbeeld voor een zondagsschool-systeem. Ze krijgen géén stroom-/opstart-automatisering en geen "Project nu klaarzetten" — dat blijft exclusief voor de hoofd-Beamer PC.
                </p>

                {(!settings.freeshowAdditionalTargets || settings.freeshowAdditionalTargets.length === 0) && (
                  <p style={{ color: 'var(--muted)', fontSize: '0.85rem', fontStyle: 'italic', textAlign: 'center', padding: '20px 10px', background: 'rgba(255,255,255,0.01)', borderRadius: '12px' }}>
                    Geen extra FreeShow-doelen geconfigureerd.
                  </p>
                )}

                {(settings.freeshowAdditionalTargets || []).map((target: any, idx: number) => (
                  <div
                    key={target.id || idx}
                    className="glass-card"
                    style={{
                      padding: '16px',
                      background: 'rgba(255,255,255,0.01)',
                      border: '1px solid rgba(255,255,255,0.05)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '16px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
                      <input
                        className="input-field"
                        style={{ fontWeight: 'bold', fontSize: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', background: 'transparent', padding: '4px 8px', flex: 1, minWidth: '200px' }}
                        placeholder="Doel Naam (bijv. Zondagsschool PC)"
                        value={target.name || ""}
                        onChange={(e) => {
                          const updated = [...settings.freeshowAdditionalTargets];
                          updated[idx] = { ...target, name: e.target.value };
                          onSettingsChange({ ...settings, freeshowAdditionalTargets: updated });
                        }}
                      />
                      <button
                        type="button"
                        className="btn-danger"
                        style={{
                          padding: '6px 12px',
                          fontSize: '0.8rem',
                          borderRadius: '8px',
                          background: 'rgba(239, 68, 68, 0.15)',
                          border: '1px solid rgba(239, 68, 68, 0.35)',
                          color: '#ef4444',
                          cursor: 'pointer'
                        }}
                        onClick={() => {
                          const updated = settings.freeshowAdditionalTargets.filter((_: any, i: number) => i !== idx);
                          onSettingsChange({ ...settings, freeshowAdditionalTargets: updated });
                        }}
                      >
                        Verwijderen
                      </button>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
                      <div>
                        <label style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block', marginBottom: '6px' }}>Host / IP-adres</label>
                        <input
                          className="input-field"
                          placeholder="Bijv. 192.168.2.130"
                          value={target.host || ""}
                          onChange={(e) => {
                            const updated = [...settings.freeshowAdditionalTargets];
                            updated[idx] = { ...target, host: e.target.value.trim() };
                            onSettingsChange({ ...settings, freeshowAdditionalTargets: updated });
                          }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block', marginBottom: '6px' }}>SSH Gebruiker</label>
                        <input
                          className="input-field"
                          placeholder="Leeg = zelfde als hoofd-doel"
                          value={target.sshUser || ""}
                          onChange={(e) => {
                            const updated = [...settings.freeshowAdditionalTargets];
                            updated[idx] = { ...target, sshUser: e.target.value.trim() };
                            onSettingsChange({ ...settings, freeshowAdditionalTargets: updated });
                          }}
                        />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                          type="checkbox"
                          id={`target-enabled-${target.id || idx}`}
                          checked={target.enabled !== false}
                          onChange={(e) => {
                            const updated = [...settings.freeshowAdditionalTargets];
                            updated[idx] = { ...target, enabled: e.target.checked };
                            onSettingsChange({ ...settings, freeshowAdditionalTargets: updated });
                          }}
                          style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                        />
                        <label htmlFor={`target-enabled-${target.id || idx}`} style={{ fontSize: '0.8rem', cursor: 'pointer' }}>Actief</label>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <h3 style={{ fontSize: '1.1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '12px', marginTop: '12px' }}>📬 E-mail koppeling (concept-diensten)</h3>
              <p style={{ fontSize: '0.8rem', opacity: 0.6, marginTop: '-12px' }}>
                IMAP-postvak dat gecontroleerd wordt op liturgie-aanleveringen van worship leaders.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px' }}>
                <div className="input-group">
                  <label className="input-label">IMAP Host</label>
                  <input
                    type="text"
                    className="input-field"
                    value={settings.imapHost || ""}
                    onChange={(e) => onSettingsChange({ ...settings, imapHost: e.target.value })}
                    placeholder="imap.gmail.com"
                  />
                </div>
                <div className="input-group">
                  <label className="input-label">Poort</label>
                  <input
                    type="number"
                    className="input-field"
                    value={settings.imapPort || 993}
                    onChange={(e) => onSettingsChange({ ...settings, imapPort: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="input-group">
                  <label className="input-label">Gebruikersnaam</label>
                  <input
                    type="text"
                    className="input-field"
                    value={settings.imapUser || ""}
                    onChange={(e) => onSettingsChange({ ...settings, imapUser: e.target.value })}
                    placeholder="liturgie@arkchurch.nl"
                  />
                </div>
                <div className="input-group">
                  <label className="input-label">Wachtwoord</label>
                  <input
                    type="password"
                    className="input-field"
                    value={settings.imapPass || ""}
                    onChange={(e) => onSettingsChange({ ...settings, imapPass: e.target.value })}
                    placeholder="••••••••"
                  />
                </div>
              </div>

              <div className="input-group">
                <label className="input-label">Verplicht(e) woord(en) in onderwerp</label>
                <input
                  type="text"
                  className="input-field"
                  value={settings.emailSubjectKeyword ?? "Liturgie,Zondagsdienst"}
                  onChange={(e) => onSettingsChange({ ...settings, emailSubjectKeyword: e.target.value })}
                  placeholder="Liturgie,Zondagsdienst"
                />
                <p style={{ fontSize: '0.75rem', opacity: 0.5, marginTop: '4px' }}>
                  Alleen ongelezen mails waarvan het onderwerp één van deze woorden bevat (komma-gescheiden) worden opgehaald en gemarkeerd als gelezen — andere mail in dit postvak wordt niet aangeraakt. Leeg laten om elke ongelezen mail te controleren. Naast Postvak IN wordt ook de Spam-map van dit account gecontroleerd, als vangnet voor mails die daar per ongeluk in belanden.
                </p>
              </div>

              <h3 style={{ fontSize: '1.1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '12px', marginTop: '12px' }}>📤 SMTP (uitgaande mail voor setlists)</h3>
              <p style={{ fontSize: '0.8rem', opacity: 0.6, marginTop: '-12px' }}>
                Los van de IMAP-instellingen hierboven — dit is voor het versturen van setlists naar het team. Hetzelfde Gmail-account met app-wachtwoord werkt meestal voor beide.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px' }}>
                <div className="input-group">
                  <label className="input-label">SMTP Host</label>
                  <input
                    type="text"
                    className="input-field"
                    value={settings.smtpHost || ""}
                    onChange={(e) => onSettingsChange({ ...settings, smtpHost: e.target.value })}
                    placeholder="smtp.gmail.com"
                  />
                </div>
                <div className="input-group">
                  <label className="input-label">Poort</label>
                  <input
                    type="number"
                    className="input-field"
                    value={settings.smtpPort || 465}
                    onChange={(e) => onSettingsChange({ ...settings, smtpPort: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="input-group">
                  <label className="input-label">Gebruikersnaam</label>
                  <input
                    type="text"
                    className="input-field"
                    value={settings.smtpUser || ""}
                    onChange={(e) => onSettingsChange({ ...settings, smtpUser: e.target.value })}
                    placeholder="liturgie@arkchurch.nl"
                  />
                </div>
                <div className="input-group">
                  <label className="input-label">Wachtwoord</label>
                  <input
                    type="password"
                    className="input-field"
                    value={settings.smtpPass || ""}
                    onChange={(e) => onSettingsChange({ ...settings, smtpPass: e.target.value })}
                    placeholder="••••••••"
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="input-group">
                  <label className="input-label">Afzendernaam</label>
                  <input
                    type="text"
                    className="input-field"
                    value={settings.smtpFromName || ""}
                    onChange={(e) => onSettingsChange({ ...settings, smtpFromName: e.target.value })}
                    placeholder="Ark Church Livestream Manager"
                  />
                </div>
                <div className="input-group">
                  <label className="input-label">Afzenderadres (optioneel, anders gebruikersnaam)</label>
                  <input
                    type="text"
                    className="input-field"
                    value={settings.smtpFromEmail || ""}
                    onChange={(e) => onSettingsChange({ ...settings, smtpFromEmail: e.target.value })}
                    placeholder="liturgie@arkchurch.nl"
                  />
                </div>
              </div>

            </section>
          )}

          {settingsTab === "sso" && userRole === "admin" && (
            <section style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <h3 style={{ fontSize: '1.1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '12px' }}>🔑 Team-login via SSO</h3>
              <p style={{ fontSize: '0.8rem', opacity: 0.6, marginTop: '-8px' }}>
                Laat teamleden inloggen met hun bestaande account bij Authentik (test) of de Synology NAS (productie), in plaats van een los wachtwoord in deze app. Het gewone gebruikersnaam/wachtwoord-inloggen (Gebruikersbeheer) blijft daarnaast werken als noodtoegang.
              </p>

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
                <input
                  type="checkbox"
                  checked={!!settings.ssoEnabled}
                  onChange={(e) => onSettingsChange({ ...settings, ssoEnabled: e.target.checked })}
                />
                SSO-login inschakelen
              </label>

              {settings.ssoEnabled && (
                <>
                  <div className="input-group">
                    <label className="input-label">Knoptekst op het inlogscherm</label>
                    <input
                      type="text"
                      className="input-field"
                      value={settings.ssoProviderName || ""}
                      onChange={(e) => onSettingsChange({ ...settings, ssoProviderName: e.target.value })}
                      placeholder="Inloggen met Authentik"
                    />
                  </div>

                  <div className="input-group">
                    <label className="input-label">Issuer-URL (OpenID Connect)</label>
                    <input
                      type="text"
                      className="input-field"
                      value={settings.ssoIssuerUrl || ""}
                      onChange={(e) => onSettingsChange({ ...settings, ssoIssuerUrl: e.target.value })}
                      placeholder="https://authentik.voorbeeld.nl/application/o/livestream-manager/"
                    />
                    <p style={{ fontSize: '0.75rem', opacity: 0.5, marginTop: '4px' }}>
                      Endpoints worden automatisch opgehaald via {'<issuer>/.well-known/openid-configuration'} — werkt zo voor zowel Authentik als Synology's SSO Server-pakket.
                    </p>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <div className="input-group">
                      <label className="input-label">Client ID</label>
                      <input
                        type="text"
                        className="input-field"
                        value={settings.ssoClientId || ""}
                        onChange={(e) => onSettingsChange({ ...settings, ssoClientId: e.target.value })}
                      />
                    </div>
                    <div className="input-group">
                      <label className="input-label">Client Secret</label>
                      <input
                        type="password"
                        className="input-field"
                        value={settings.ssoClientSecret || ""}
                        onChange={(e) => onSettingsChange({ ...settings, ssoClientSecret: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="input-group">
                    <label className="input-label">OAuth scope (optioneel)</label>
                    <input
                      type="text"
                      className="input-field"
                      value={settings.ssoScope || ""}
                      onChange={(e) => onSettingsChange({ ...settings, ssoScope: e.target.value })}
                      placeholder="Leeg = standaard (openid profile email)"
                    />
                    <p style={{ fontSize: '0.75rem', opacity: 0.5, marginTop: '4px' }}>
                      Alleen invullen als de groepen anders niet in het ID-token terechtkomen — bijvoorbeeld <code>openid profile email groups</code> bij Synology's SSO Server.
                    </p>
                  </div>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
                    <input
                      type="checkbox"
                      checked={!!settings.ssoDisablePkce}
                      onChange={(e) => onSettingsChange({ ...settings, ssoDisablePkce: e.target.checked })}
                    />
                    PKCE uitschakelen
                  </label>
                  <p style={{ fontSize: '0.75rem', opacity: 0.5, marginTop: '-8px' }}>
                    Alleen aanzetten als inloggen faalt met een generieke serverfout bij het token-endpoint — geconstateerd bij Synology's SSO Server.
                  </p>

                  <div className="input-group">
                    <label className="input-label">Groepen-claim in het ID-token</label>
                    <input
                      type="text"
                      className="input-field"
                      style={{ maxWidth: '220px' }}
                      value={settings.ssoGroupClaim || "groups"}
                      onChange={(e) => onSettingsChange({ ...settings, ssoGroupClaim: e.target.value })}
                    />
                  </div>

                  <h4 style={{ fontSize: '0.95rem', marginTop: '8px', marginBottom: 0 }}>Rechten per groep</h4>
                  <p style={{ fontSize: '0.75rem', opacity: 0.5, marginTop: '-8px' }}>
                    Een groep die hier niet in staat krijgt geen enkele permissie — iemand kan dan wel inloggen, maar ziet nergens toegang tot.
                  </p>
                  {(Object.entries(settings.ssoGroupPermissions || {}) as [string, { role?: "admin" | "operator"; permissions?: string[] }][]).map(([groupName, entry], i) => (
                    <div key={i} className="glass-card" style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px', background: 'rgba(255,255,255,0.03)' }}>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <input
                          type="text"
                          className="input-field"
                          style={{ flex: 1 }}
                          value={groupName}
                          placeholder="Groepsnaam (exact zoals in Authentik/Synology)"
                          onChange={(e) => {
                            const map = { ...(settings.ssoGroupPermissions || {}) };
                            const value = map[groupName];
                            delete map[groupName];
                            map[e.target.value] = value;
                            onSettingsChange({ ...settings, ssoGroupPermissions: map });
                          }}
                        />
                        <select
                          className="input-field"
                          style={{ width: '140px' }}
                          value={entry.role || "operator"}
                          onChange={(e) => {
                            const map = { ...(settings.ssoGroupPermissions || {}) };
                            map[groupName] = { ...entry, role: e.target.value as "admin" | "operator" };
                            onSettingsChange({ ...settings, ssoGroupPermissions: map });
                          }}
                        >
                          <option value="operator">Operator</option>
                          <option value="admin">Admin</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            const map = { ...(settings.ssoGroupPermissions || {}) };
                            delete map[groupName];
                            onSettingsChange({ ...settings, ssoGroupPermissions: map });
                          }}
                          style={{ background: 'rgba(255,0,0,0.15)', color: '#ef4444', border: 'none', borderRadius: '6px', padding: '8px 10px', cursor: 'pointer' }}
                        >
                          🗑️
                        </button>
                      </div>
                      {entry.role !== "admin" && (
                        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '0.8rem' }}>
                          {["freeshow", "control", "planner", "lights", "monitor"].map(perm => (
                            <label key={perm} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <input
                                type="checkbox"
                                checked={(entry.permissions || []).includes(perm)}
                                onChange={(e) => {
                                  const map = { ...(settings.ssoGroupPermissions || {}) };
                                  const current = new Set(entry.permissions || []);
                                  if (e.target.checked) current.add(perm); else current.delete(perm);
                                  map[groupName] = { ...entry, permissions: Array.from(current) };
                                  onSettingsChange({ ...settings, ssoGroupPermissions: map });
                                }}
                              />
                              {perm}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      const map = { ...(settings.ssoGroupPermissions || {}) };
                      let name = "Nieuwe groep";
                      let n = 2;
                      while (map[name]) { name = `Nieuwe groep ${n++}`; }
                      map[name] = { role: "operator", permissions: [] };
                      onSettingsChange({ ...settings, ssoGroupPermissions: map });
                    }}
                    style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '8px', padding: '8px 12px', cursor: 'pointer', fontSize: '0.85rem', alignSelf: 'flex-start' }}
                  >
                    + Groep toevoegen
                  </button>

                  <h3 style={{ fontSize: '1.1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '12px', marginTop: '12px' }}>👥 Teamcontacten automatisch synchroniseren</h3>
                  <p style={{ fontSize: '0.8rem', opacity: 0.6, marginTop: '-8px' }}>
                    Haalt periodiek de leden van een groep op (naam + e-mail) voor de setlist-mail — ook mensen die zelf nooit op de app inloggen. Handmatig toegevoegde contacten (Beheer → Team) blijven altijd gewoon staan.
                  </p>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
                    <input
                      type="checkbox"
                      checked={!!settings.ssoContactSyncEnabled}
                      onChange={(e) => onSettingsChange({ ...settings, ssoContactSyncEnabled: e.target.checked })}
                    />
                    Contactsync inschakelen
                  </label>
                  {settings.ssoContactSyncEnabled && (
                    <>
                      <div className="input-group">
                        <label className="input-label">Groepen om te synchroniseren</label>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {(settings.ssoContactSyncGroups || []).map((group: string, idx: number) => (
                            <div key={idx} style={{ display: 'flex', gap: '8px' }}>
                              <input
                                type="text"
                                className="input-field"
                                value={group}
                                onChange={(e) => {
                                  const groups = [...(settings.ssoContactSyncGroups || [])];
                                  groups[idx] = e.target.value;
                                  onSettingsChange({ ...settings, ssoContactSyncGroups: groups });
                                }}
                                placeholder="Worship Band"
                                style={{ flex: 1 }}
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const groups = (settings.ssoContactSyncGroups || []).filter((_: string, i: number) => i !== idx);
                                  onSettingsChange({ ...settings, ssoContactSyncGroups: groups });
                                }}
                                style={{ background: 'rgba(239,68,68,0.15)', border: 'none', borderRadius: '8px', padding: '0 12px', cursor: 'pointer', color: '#f87171' }}
                              >
                                Verwijder
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() => onSettingsChange({ ...settings, ssoContactSyncGroups: [...(settings.ssoContactSyncGroups || []), ""] })}
                            style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '8px', padding: '8px 12px', cursor: 'pointer', fontSize: '0.85rem', alignSelf: 'flex-start' }}
                          >
                            + Groep toevoegen
                          </button>
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <div className="input-group">
                          <label className="input-label">Bron</label>
                          <select
                            className="input-field"
                            value={settings.ssoDirectoryMode || "authentik-api"}
                            onChange={(e) => onSettingsChange({ ...settings, ssoDirectoryMode: e.target.value as any })}
                          >
                            <option value="authentik-api">Authentik (API)</option>
                            <option value="synology-ldap">Synology (LDAP)</option>
                            <option value="synology-api">Synology (DSM-API)</option>
                          </select>
                        </div>
                        <div className="input-group">
                          <label className="input-label">Interval (minuten)</label>
                          <input
                            type="number"
                            className="input-field"
                            value={settings.ssoContactSyncIntervalMinutes || 360}
                            onChange={(e) => onSettingsChange({ ...settings, ssoContactSyncIntervalMinutes: Number(e.target.value) })}
                          />
                        </div>
                      </div>
                      {settings.ssoDirectoryMode === "synology-api" && (
                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px' }}>
                          <div className="input-group">
                            <label className="input-label">DSM-adres</label>
                            <input
                              type="text"
                              className="input-field"
                              value={settings.ssoDirectoryApiUrl || ""}
                              onChange={(e) => onSettingsChange({ ...settings, ssoDirectoryApiUrl: e.target.value })}
                              placeholder="https://192.168.2.250:5001"
                            />
                          </div>
                          <div className="input-group">
                            <label className="input-label">DSM-gebruikersnaam</label>
                            <input
                              type="text"
                              className="input-field"
                              value={settings.ssoDirectoryApiUser || ""}
                              onChange={(e) => onSettingsChange({ ...settings, ssoDirectoryApiUser: e.target.value })}
                            />
                          </div>
                        </div>
                      )}
                      <div className="input-group">
                        <label className="input-label">{settings.ssoDirectoryMode === "synology-api" ? "DSM-wachtwoord" : "API-token / bind-wachtwoord"}</label>
                        <input
                          type="password"
                          className="input-field"
                          value={settings.ssoDirectoryApiToken || ""}
                          onChange={(e) => onSettingsChange({ ...settings, ssoDirectoryApiToken: e.target.value })}
                        />
                      </div>
                      {settings.ssoDirectoryMode === "synology-ldap" && (
                        <p style={{ fontSize: '0.78rem', color: '#fcd34d' }}>
                          ⚠️ LDAP is bewust niet gebouwd — Directory Server is een permanent draaiende dienst die de toch al krappe NAS extra RAM kost. Kies de DSM-API in plaats daarvan.
                        </p>
                      )}
                    </>
                  )}
                </>
              )}
            </section>
          )}

          {settingsTab === "backup" && (
            <BackupRestoreSettings settings={settings} setSettings={onSettingsChange} />
          )}

          {settingsTab === "activityLog" && userRole === "admin" && (
            <section style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <h3 style={{ fontSize: '1.1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '12px' }}>⚠️ Foutmeldingen per e-mail</h3>
              <p style={{ fontSize: '0.8rem', opacity: 0.6, marginTop: '-8px' }}>
                Adres waar de app zelf naar mailt als er iets misgaat dat ook hier in het Activiteitenlog verschijnt (bv. de YouTube-koppeling verlopen, thema.jpg niet bijgewerkt, of de Beamer-PC onbereikbaar tijdens een sync) — geldt voor de hele app, niet alleen FreeShow. Gebruikt dezelfde SMTP-instellingen als de setlist-mails (tabblad FreeShow).
              </p>
              <div className="input-group">
                <label className="input-label">E-mailadres voor foutmeldingen</label>
                <input
                  type="text"
                  className="input-field"
                  value={settings.opsAlertEmail || ""}
                  onChange={(e) => onSettingsChange({ ...settings, opsAlertEmail: e.target.value })}
                  placeholder="jeffrey.go@arkchurch.nl"
                />
              </div>

              <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '16px', marginTop: '8px' }}>
                <ActivityLogPanel />
              </div>
            </section>
          )}

        </div>
      </div>

      {settingsTab !== "backup" && (
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '20px', paddingBottom: '20px' }}>
          <button
            className="btn-primary"
            style={{ width: '100%', padding: '20px', fontSize: '1.25rem', borderRadius: '16px', boxShadow: '0 10px 40px rgba(248, 113, 113, 0.2)' }}
            onClick={onSaveSettings}
          >
            <Save size={24} /> Wijzigingen Opslaan
          </button>
        </div>
      )}

      <style jsx>{`
        .settings-modal-card {
          width: 100%;
          max-width: 1000px;
          padding: 40px;
          height: 90vh;
          overflow-y: hidden;
          display: flex;
          flex-direction: column;
          gap: 30px;
        }

        .settings-body {
          display: flex;
          flex: 1;
          min-height: 0;
          gap: 30px;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          padding-top: 24px;
        }

        .settings-sidebar {
          width: 220px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          border-right: 1px solid rgba(255, 255, 255, 0.1);
          padding-right: 20px;
          flex-shrink: 0;
          overflow-y: auto;
        }

        .settings-content {
          flex: 1;
          overflow-y: auto;
          padding-right: 10px;
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        /* The sidebar/content split works as two side-by-side columns
           down to about tablet width, but a 220px fixed sidebar next to
           whatever's left on a phone (~375px) squeezes the content pane
           into an unusable sliver - stack them instead below this point. */
        @media (max-width: 768px) {
          .settings-modal-card {
            padding: 20px;
            height: 95vh;
            overflow-y: auto;
          }

          .settings-header {
            padding-right: 44px;
          }

          .settings-title {
            font-size: 1.4rem !important;
          }

          .settings-body {
            flex-direction: column;
            gap: 16px;
            padding-top: 16px;
          }

          .settings-sidebar {
            width: 100%;
            flex-direction: row;
            flex-wrap: wrap;
            border-right: none;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            padding-right: 0;
            padding-bottom: 16px;
            max-height: none;
          }

          .settings-content {
            padding-right: 0;
          }
        }
      `}</style>
    </div>
  );
}
