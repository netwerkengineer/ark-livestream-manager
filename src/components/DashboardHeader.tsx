"use client";

import { HelpCircle, Settings, User } from "lucide-react";
import { VERSION } from "@/lib/version";

interface DashboardHeaderProps {
  userRole: "admin" | "operator" | null;
  currentUser: string | null;
  onShowHelp: () => void;
  onShowSettings: () => void;
  onLogout: () => void;
}

export default function DashboardHeader({
  userRole,
  currentUser,
  onShowHelp,
  onShowSettings,
  onLogout
}: DashboardHeaderProps) {
  return (
    <div className="logo-container" style={{ marginBottom: '48px', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <img src="/logo.png" alt="Ark Church Logo" />
        <div>
          <h1 style={{ fontSize: '1.5rem', lineHeight: '1', display: 'flex', alignItems: 'center', gap: '8px' }}>
            Ark Church <span style={{ fontSize: '0.7rem', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', padding: '2px 6px', borderRadius: '4px', fontWeight: 'normal', color: 'var(--primary)' }}>v{VERSION}</span>
          </h1>
          <p style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>Operations Center</p>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button onClick={onShowHelp} className="btn-outline" style={{ padding: '10px' }} title="Help">
          <HelpCircle size={20} />
        </button>
        {userRole === "admin" && (
          <button onClick={onShowSettings} className="btn-outline" style={{ padding: '10px' }} title="Instellingen">
            <Settings size={20} />
          </button>
        )}
        <div style={{ borderLeft: '1px solid var(--card-border)', height: '24px', margin: '0 8px' }}></div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 600 }}>
            {userRole === "admin" ? "ADMINISTRATOR" : "OPERATOR"}
          </p>
          <p style={{ fontSize: '0.9rem' }}>{currentUser}</p>
        </div>
        <button onClick={onLogout} className="btn-outline" style={{ padding: '10px' }} title="Afmelden Operator">
          <User size={20} />
        </button>
      </div>
    </div>
  );
}
