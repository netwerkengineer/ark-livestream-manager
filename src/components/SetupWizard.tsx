"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Key,
  Database,
  Link,
  ChevronRight,
  ChevronLeft,
  CheckCircle2
} from "lucide-react";

interface SetupWizardProps {
  settings: any;
  onComplete: (settings: any) => void;
}

export default function SetupWizard({ settings: initialSettings, onComplete }: SetupWizardProps) {
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
          <p style={{ color: 'var(--muted)', marginTop: '8px' }}>Laten we het Operations Center configureren voor je NAS.</p>
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
