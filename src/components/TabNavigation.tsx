"use client";

import {
  Calendar,
  ShieldAlert,
  Activity,
  Sun,
  Layers
} from "lucide-react";

type TabType = "planner" | "monitor" | "control" | "lights" | "freeshow";

interface TabNavigationProps {
  activeTab: TabType;
  userRole: "admin" | "operator" | null;
  userPermissions: string[];
  onTabChange: (tab: TabType) => void;
}

export default function TabNavigation({
  activeTab,
  userRole,
  userPermissions,
  onTabChange
}: TabNavigationProps) {
  return (
    <div style={{ display: 'flex', gap: '8px', marginBottom: '32px' }}>
      {(userRole === "admin" || userPermissions.includes("planner")) && (
        <button
          onClick={() => onTabChange("planner")}
          className={activeTab === "planner" ? "btn-primary" : "btn-outline"}
          style={{ padding: '8px 20px', borderRadius: '12px' }}
        >
          <Calendar size={18} /> Stream Planner
        </button>
      )}
      {(userRole === "admin" || userPermissions.includes("control")) && (
        <button
          onClick={() => onTabChange("control")}
          className={activeTab === "control" ? "btn-primary" : "btn-outline"}
          style={{ padding: '8px 20px', borderRadius: '12px', border: activeTab === "control" ? 'none' : '1px solid rgba(248, 113, 113, 0.4)' }}
        >
          <ShieldAlert size={18} /> Control Center
        </button>
      )}
      {(userRole === "admin" || userPermissions.includes("monitor")) && (
        <button
          onClick={() => onTabChange("monitor")}
          className={activeTab === "monitor" ? "btn-primary" : "btn-outline"}
          style={{ padding: '8px 20px', borderRadius: '12px' }}
        >
          <Activity size={18} /> Live Monitor
        </button>
      )}
      {(userRole === "admin" || userPermissions.includes("lights")) && (
        <button
          onClick={() => onTabChange("lights")}
          className={activeTab === "lights" ? "btn-primary" : "btn-outline"}
          style={{ padding: '8px 20px', borderRadius: '12px', border: activeTab === "lights" ? 'none' : '1px solid rgba(249, 115, 22, 0.4)' }}
        >
          <Sun size={18} /> Lichtregie
        </button>
      )}
      {(userRole === "admin" || userPermissions.includes("freeshow")) && (
        <button
          onClick={() => onTabChange("freeshow")}
          className={activeTab === "freeshow" ? "btn-primary" : "btn-outline"}
          style={{ padding: '8px 20px', borderRadius: '12px', border: activeTab === "freeshow" ? 'none' : '1px solid rgba(56, 189, 248, 0.4)' }}
        >
          <Layers size={18} /> FreeShow Projecten
        </button>
      )}
    </div>
  );
}
