"use client";

import { HelpCircle, Settings, LogOut } from "lucide-react";
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
  const initial = currentUser ? currentUser.charAt(0).toUpperCase() : "?";

  return (
    <div className="app-header">
      <div className="logo-container" style={{ marginBottom: 0 }}>
        <img src="/logo.png" alt="Ark Church Logo" />
        <div>
          <h1 style={{ fontSize: '1.5rem', lineHeight: '1', display: 'flex', alignItems: 'center', gap: '8px' }}>
            Ark Church Operations <span style={{ fontSize: '0.7rem', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', padding: '2px 6px', borderRadius: '4px', fontWeight: 'normal', color: 'var(--primary)' }}>v{VERSION}</span>
          </h1>
        </div>
      </div>
      <div className="app-header-actions">
        <button onClick={onShowHelp} className="btn-outline app-header-icon-btn" title="Help">
          <HelpCircle size={20} />
        </button>
        {userRole === "admin" && (
          <button onClick={onShowSettings} className="btn-outline app-header-icon-btn" title="Instellingen">
            <Settings size={20} />
          </button>
        )}
        <div className="app-header-divider"></div>
        <div className="app-header-avatar" title={currentUser ?? undefined}>{initial}</div>
        <div className="app-header-user-info">
          <p className="app-header-role">{userRole === "admin" ? "Beheerder" : "Operator"}</p>
          <p className="app-header-name">{currentUser}</p>
        </div>
        <button onClick={onLogout} className="btn-outline app-header-icon-btn" title="Afmelden">
          <LogOut size={20} />
        </button>
      </div>
    </div>
  );
}
