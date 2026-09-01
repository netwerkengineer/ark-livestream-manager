"use client";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

interface ActivityEntry {
  ts: string;
  category: "sync" | "plug" | "led" | "error" | "settings" | "system";
  message: string;
  details?: Record<string, unknown>;
}

const CATEGORY_LABELS: Record<ActivityEntry["category"], string> = {
  sync: "Sync",
  plug: "Stekker",
  led: "LED-scherm",
  error: "Fout",
  settings: "Instellingen",
  system: "Systeem"
};

const CATEGORY_COLORS: Record<ActivityEntry["category"], string> = {
  sync: "#38bdf8",
  plug: "#a78bfa",
  led: "#fb923c",
  error: "#f87171",
  settings: "#4ade80",
  system: "#94a3b8"
};

export default function ActivityLogPanel() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const fetchEntries = async () => {
    setLoading(true);
    setError(null);
    try {
      const url = categoryFilter === "all"
        ? "/api/activity-log?limit=200"
        : `/api/activity-log?limit=200&category=${categoryFilter}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.success) {
        setEntries(data.entries);
      } else {
        setError(data.error || "Kon logboek niet laden");
      }
    } catch (e: any) {
      setError(e.message || "Verbindingsfout");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryFilter]);

  const formatTs = (ts: string) => {
    try {
      return new Date(ts).toLocaleString('nl-NL', { dateStyle: 'medium', timeStyle: 'medium' });
    } catch {
      return ts;
    }
  };

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div>
        <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Activiteitenlog</h3>
        <p style={{ margin: '4px 0 0', fontSize: '0.8rem', opacity: 0.6 }}>
          Overzicht van sync-runs, stekker-acties, LED-triggers en fouten - alleen zichtbaar voor beheerders.
          Automatisch beperkt tot de laatste ~5000 gebeurtenissen om schijfruimte te sparen.
        </p>
      </div>

      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          className="input"
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
          style={{ margin: 0, width: '180px' }}
        >
          <option value="all">Alle categorieën</option>
          {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        <button className="button" onClick={fetchEntries} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <RefreshCw size={14} />
          {loading ? 'Laden...' : 'Vernieuwen'}
        </button>
      </div>

      {error && (
        <div style={{ padding: '0.8rem', borderRadius: '8px', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171', fontSize: '0.85rem' }}>
          {error}
        </div>
      )}

      <div className="glass-card" style={{ padding: 0, border: '1px solid var(--card-border)', borderRadius: '8px', overflow: 'hidden' }}>
        {loading && entries.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', opacity: 0.5, fontSize: '0.85rem' }}>Laden...</div>
        ) : entries.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', opacity: 0.5, fontSize: '0.85rem' }}>Geen gebeurtenissen gevonden.</div>
        ) : (
          <div style={{ maxHeight: '55vh', overflowY: 'auto' }}>
            {entries.map((entry, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  gap: '0.8rem',
                  alignItems: 'flex-start',
                  padding: '0.6rem 0.9rem',
                  borderBottom: i < entries.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                  fontSize: '0.82rem'
                }}
              >
                <span style={{ opacity: 0.5, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  {formatTs(entry.ts)}
                </span>
                <span
                  style={{
                    padding: '1px 8px',
                    borderRadius: '4px',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    background: `${CATEGORY_COLORS[entry.category]}22`,
                    color: CATEGORY_COLORS[entry.category]
                  }}
                >
                  {CATEGORY_LABELS[entry.category] || entry.category}
                </span>
                <span style={{ flex: 1 }}>{entry.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
