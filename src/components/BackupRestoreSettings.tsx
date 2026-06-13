import React, { useState } from 'react';
import { Save, Download, Upload, AlertTriangle, RefreshCcw } from 'lucide-react';
import { AppSettings } from '@/lib/settingsStore';

interface Props {
  settings: AppSettings;
  setSettings: (s: AppSettings) => void;
}

export default function BackupRestoreSettings({ settings, setSettings }: Props) {
  const [includeMedia, setIncludeMedia] = useState(false);
  const [backupTargets, setBackupTargets] = useState({
    config: true,
    freeshow: true,
    qlc: true,
    companion: true,
  });
  
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{type: 'success' | 'error', message: string} | null>(null);
  const [progress, setProgress] = useState<{status: string, percent: number} | null>(null);

  // Restore State
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreTargets, setRestoreTargets] = useState({
    config: false,
    freeshow: false,
    qlc: false,
    companion: false,
  });

  const handleBackupLocal = async () => {
    setStatus(null);
    setLoading(true);
    try {
      const targets = Object.entries(backupTargets)
        .filter(([_, checked]) => checked)
        .map(([key]) => key)
        .join(',');
      
      if (!targets) {
        setStatus({ type: 'error', message: 'Selecteer minimaal één onderdeel om te back-uppen.' });
        setLoading(false);
        return;
      }

      window.location.href = `/api/maintenance/backup?targets=${targets}&includeMedia=${includeMedia}`;
      
      setStatus({ type: 'success', message: 'Backup download gestart. Volg de voortgang hieronder.' });
    } catch (e: any) {
      setStatus({ type: 'error', message: e.message });
      setLoading(false);
    }
  };

  React.useEffect(() => {
    let interval: NodeJS.Timeout;
    if (loading) {
      interval = setInterval(async () => {
        try {
          const res = await fetch('/api/maintenance/backup/progress');
          const data = await res.json();
          if (data && typeof data.percent === 'number') {
            setProgress(data);
            if (data.status === 'completed') {
              setStatus({ type: 'success', message: 'Backup succesvol afgerond!' });
              setLoading(false);
            } else if (data.status === 'error') {
              setStatus({ type: 'error', message: `Backup mislukt: ${data.error || 'Onbekende fout'}` });
              setLoading(false);
            }
          }
        } catch (e) {}
      }, 1500);
    } else {
      setProgress(null);
    }
    return () => clearInterval(interval);
  }, [loading]);

  const handleBackupRemote = async () => {
    setStatus(null);
    setLoading(true);
    try {
      const targets = Object.entries(backupTargets)
        .filter(([_, checked]) => checked)
        .map(([key]) => key)
        .join(',');
      
      if (!targets) {
        setStatus({ type: 'error', message: 'Selecteer minimaal één onderdeel om te back-uppen.' });
        setLoading(false);
        return;
      }

      const res = await fetch(`/api/maintenance/remote?targets=${targets}&includeMedia=${includeMedia}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Fout bij het verzenden naar remote storage.');

      setStatus({ type: 'success', message: 'Backup verzenden gestart! Volg de voortgang hieronder.' });
    } catch (e: any) {
      setStatus({ type: 'error', message: e.message });
      setLoading(false);
    }
  };

  const handleRestore = async () => {
    if (!restoreFile) {
      setStatus({ type: 'error', message: 'Selecteer eerst een backup (.zip) bestand.' });
      return;
    }

    const targets = Object.entries(restoreTargets)
      .filter(([_, checked]) => checked)
      .map(([key]) => key)
      .join(',');

    if (!targets) {
      setStatus({ type: 'error', message: 'Selecteer minimaal één onderdeel om te herstellen.' });
      return;
    }

    if (!confirm('Weet je zeker dat je deze onderdelen wilt herstellen? Bestaande data wordt overschreven! (Er wordt wel eerst een pre-restore backup gemaakt)')) {
      return;
    }

    setStatus(null);
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', restoreFile);
      formData.append('targets', targets);

      const res = await fetch('/api/maintenance/restore', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Fout tijdens herstellen.');

      setStatus({ type: 'success', message: 'Herstel succesvol afgerond! Systemen zijn herstart waar nodig.' });
      setRestoreFile(null);
    } catch (e: any) {
      setStatus({ type: 'error', message: e.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '12px' }}>
        <h3 style={{ fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Save size={20} color="var(--primary)" /> Backup & Herstel
        </h3>
      </div>

      <div className="glass-card" style={{ padding: '24px', marginBottom: '8px' }}>
        <h4 style={{ fontSize: '1.1rem', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Save size={18} /> Configuratie Opslagdoel
        </h4>
        <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '16px' }}>Instellingen voor automatische opslag en externe backups.</p>

        <div className="input-group" style={{ marginBottom: '16px' }}>
          <label className="input-label">Backup Doel (Remote Storage)</label>
          <select 
            className="input-field" 
            value={settings.backupTarget || "none"} 
            onChange={(e) => setSettings({ ...settings, backupTarget: e.target.value })}
          >
            <option value="none">Geen (Alleen lokaal opslaan)</option>
            <option value="ftp">FTP Server</option>
            <option value="webdav">WebDAV Cloud Server</option>
          </select>
        </div>

        <div className="input-group" style={{ marginBottom: '16px' }}>
          <label className="input-label">Backup Bestandsnaam Voorvoegsel (Prefix)</label>
          <input 
            type="text" 
            className="input-field" 
            value={settings.backupPrefix || ""} 
            onChange={(e) => setSettings({ ...settings, backupPrefix: e.target.value })}
            placeholder="Bijv. NAS of PROXMOX"
          />
          <span className="text-sm text-slate-400 mt-1" style={{ fontSize: '0.85rem', color: 'var(--muted)', display: 'block', marginTop: '4px' }}>Dit voorkomt dat meerdere omgevingen elkaars cloud backups overschrijven. (Bijv. NAS_backup_...)</span>
        </div>

        {settings.backupTarget === "ftp" && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', background: 'rgba(255,255,255,0.01)', padding: '16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px' }}>
              <div className="input-group">
                <label className="input-label">FTP Host</label>
                <input type="text" className="input-field" value={settings.ftpHost || ""} onChange={e => setSettings({...settings, ftpHost: e.target.value})} placeholder="ftp.voorbeeld.nl" />
              </div>
              <div className="input-group">
                <label className="input-label">FTP Poort</label>
                <input type="number" className="input-field" value={settings.ftpPort || 21} onChange={e => setSettings({...settings, ftpPort: parseInt(e.target.value)})} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className="input-group">
                <label className="input-label">FTP Gebruiker</label>
                <input type="text" className="input-field" value={settings.ftpUser || ""} onChange={e => setSettings({...settings, ftpUser: e.target.value})} placeholder="User" />
              </div>
              <div className="input-group">
                <label className="input-label">FTP Wachtwoord</label>
                <input type="password" className="input-field" value={settings.ftpPass || ""} onChange={e => setSettings({...settings, ftpPass: e.target.value})} placeholder="••••••••" />
              </div>
            </div>
          </div>
        )}

        {settings.backupTarget === "webdav" && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', background: 'rgba(255,255,255,0.01)', padding: '16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="input-group">
              <label className="input-label">WebDAV URL</label>
              <input type="text" className="input-field" value={settings.webdavUrl || ""} onChange={e => setSettings({...settings, webdavUrl: e.target.value})} placeholder="https://wolk.voorbeeld.nl/webdav/files/user" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className="input-group">
                <label className="input-label">WebDAV Gebruiker</label>
                <input type="text" className="input-field" value={settings.webdavUser || ""} onChange={e => setSettings({...settings, webdavUser: e.target.value})} placeholder="User" />
              </div>
              <div className="input-group">
                <label className="input-label">WebDAV Wachtwoord (Token)</label>
                <input type="password" className="input-field" value={settings.webdavPass || ""} onChange={e => setSettings({...settings, webdavPass: e.target.value})} placeholder="••••••••" />
              </div>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px' }}>
        {/* Backup Sectie */}
        <div className="glass-card" style={{ padding: '24px' }}>
          <h4 style={{ fontSize: '1.1rem', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Download size={18} /> Nieuwe Backup Maken
          </h4>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
              <input type="checkbox" checked={backupTargets.config} onChange={e => setBackupTargets({...backupTargets, config: e.target.checked})} />
              <span>Applicatie Configuratie (Instellingen, Tokens)</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
              <input type="checkbox" checked={backupTargets.qlc} onChange={e => setBackupTargets({...backupTargets, qlc: e.target.checked})} />
              <span>QLC+ Workspace & Config</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
              <input type="checkbox" checked={backupTargets.companion} onChange={e => setBackupTargets({...backupTargets, companion: e.target.checked})} />
              <span>Bitfocus Companion Database</span>
            </label>
            <div style={{ paddingLeft: '12px', borderLeft: '2px solid rgba(255,255,255,0.1)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', marginBottom: '8px' }}>
                <input type="checkbox" checked={backupTargets.freeshow} onChange={e => setBackupTargets({...backupTargets, freeshow: e.target.checked})} />
                <span>FreeShow Database (Shows, Bibles)</span>
              </label>
              {backupTargets.freeshow && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', marginLeft: '24px', fontSize: '0.85rem', color: 'var(--muted)' }}>
                  <input type="checkbox" checked={includeMedia} onChange={e => setIncludeMedia(e.target.checked)} />
                  <span>Inclusief Media bestanden (Let op: Kan héél groot zijn!)</span>
                </label>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <button className="btn-outline" onClick={handleBackupLocal} disabled={loading} style={{ width: '100%', justifyContent: 'center' }}>
              <Download size={18} /> Lokaal Downloaden (.zip)
            </button>
            <button className="btn-primary" onClick={handleBackupRemote} disabled={loading} style={{ width: '100%', justifyContent: 'center' }}>
              <Upload size={18} /> Verzenden naar Externe Opslag
            </button>
          </div>
        </div>

        {/* Restore Sectie */}
        <div className="glass-card" style={{ padding: '24px', background: 'rgba(248, 113, 113, 0.05)', border: '1px solid rgba(248, 113, 113, 0.2)' }}>
          <h4 style={{ fontSize: '1.1rem', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', color: '#f87171' }}>
            <AlertTriangle size={18} /> Systeem Herstellen
          </h4>
          <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '16px' }}>
            Kies een eerder gegenereerde .zip backup om specifieke onderdelen te herstellen. Na het herstellen worden benodigde services (zoals Companion) automatisch herstart.
          </p>

          <input 
            type="file" 
            accept=".zip" 
            onChange={(e) => setRestoreFile(e.target.files?.[0] || null)}
            style={{ marginBottom: '20px', width: '100%' }}
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
              <input type="checkbox" checked={restoreTargets.config} onChange={e => setRestoreTargets({...restoreTargets, config: e.target.checked})} />
              <span>Applicatie Configuratie</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
              <input type="checkbox" checked={restoreTargets.qlc} onChange={e => setRestoreTargets({...restoreTargets, qlc: e.target.checked})} />
              <span>QLC+ Workspace & Config</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
              <input type="checkbox" checked={restoreTargets.companion} onChange={e => setRestoreTargets({...restoreTargets, companion: e.target.checked})} />
              <span>Bitfocus Companion Database</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
              <input type="checkbox" checked={restoreTargets.freeshow} onChange={e => setRestoreTargets({...restoreTargets, freeshow: e.target.checked})} />
              <span>FreeShow Database</span>
            </label>
          </div>

          <button 
            className="btn-primary" 
            onClick={handleRestore} 
            disabled={loading || !restoreFile} 
            style={{ width: '100%', justifyContent: 'center', background: '#ef4444' }}
          >
            {loading ? <RefreshCcw size={18} className="spin" /> : <Upload size={18} />} Herstel Geselecteerde Onderdelen
          </button>
        </div>
      </div>

      {status && (
        <div style={{ 
          padding: '16px', 
          borderRadius: '8px', 
          background: status.type === 'success' ? 'rgba(74, 222, 128, 0.1)' : 'rgba(248, 113, 113, 0.1)', 
          border: `1px solid ${status.type === 'success' ? 'rgba(74, 222, 128, 0.2)' : 'rgba(248, 113, 113, 0.2)'}`,
          color: status.type === 'success' ? '#4ade80' : '#f87171',
          textAlign: 'center'
        }}>
          {status.message}
        </div>
      )}

      {loading && progress && (
        <div style={{ marginTop: '16px', background: 'rgba(255,255,255,0.05)', padding: '16px', borderRadius: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.9rem' }}>
            <span>
              {progress.status === 'zipping' && 'Bezig met inpakken (inclusief media kan lang duren)...'}
              {progress.status === 'uploading' && 'Bestand wordt geüpload naar Externe Opslag...'}
              {progress.status === 'completed' && 'Afronden...'}
              {progress.status === 'error' && 'Fout opgetreden!'}
            </span>
            <span>{progress.percent}%</span>
          </div>
          <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress.percent}%`, background: progress.status === 'error' ? 'var(--danger)' : 'var(--primary)', transition: 'width 0.3s ease' }}></div>
          </div>
        </div>
      )}
    </section>
  );
}
