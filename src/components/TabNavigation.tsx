"use client";

import {
  Calendar,
  ShieldAlert,
  Activity,
  Sun,
  Layers,
  type LucideIcon
} from "lucide-react";

type TabType = "planner" | "monitor" | "control" | "lights" | "freeshow";

interface TabNavigationProps {
  activeTab: TabType;
  userRole: "admin" | "operator" | null;
  userPermissions: string[];
  onTabChange: (tab: TabType) => void;
}

const TABS: { id: TabType; label: string; icon: LucideIcon }[] = [
  { id: "planner", label: "Planner", icon: Calendar },
  { id: "control", label: "Regie", icon: ShieldAlert },
  { id: "monitor", label: "Monitor", icon: Activity },
  { id: "lights", label: "Licht", icon: Sun },
  { id: "freeshow", label: "FreeShow", icon: Layers },
];

export default function TabNavigation({
  activeTab,
  userRole,
  userPermissions,
  onTabChange
}: TabNavigationProps) {
  return (
    <div className="tab-bar">
      {TABS.filter(tab => userRole === "admin" || userPermissions.includes(tab.id)).map(tab => {
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`tab-item${activeTab === tab.id ? " active" : ""}`}
          >
            <Icon size={16} /> {tab.label}
          </button>
        );
      })}
    </div>
  );
}
