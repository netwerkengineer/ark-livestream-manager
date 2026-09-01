"use client";
import React, { useEffect, useMemo, useState } from 'react';
import { getCategoryDisplayName } from '@/lib/freeshowUtils';

const CATEGORY_STORAGE_KEY = 'freeshow_song_search_categories';

function loadStoredCategories(): string[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CATEGORY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

interface SongInputProps {
  songInput: string;
  setSongInput: (value: string) => void;
  catalogSongs: Array<{ name: string; category: string }>;
  onAddSong: (title?: string) => void;
  t: (key: string) => string;
  freeshowCategories?: Record<string, { name: string; icon?: string; default?: boolean }>;
}

const RESULTS_LIMIT = 150;

export default function SongInput({
  songInput,
  setSongInput,
  catalogSongs,
  onAddSong,
  t,
  freeshowCategories
}: SongInputProps) {
  const searchableSongs = useMemo(
    () => catalogSongs.filter(s => s.category !== 'presentation' && s.category !== 'scripture'),
    [catalogSongs]
  );

  const availableCategories = useMemo(() => {
    const cats = Array.from(new Set(searchableSongs.map(s => s.category)));
    cats.sort((a, b) => getCategoryDisplayName(a, freeshowCategories).localeCompare(getCategoryDisplayName(b, freeshowCategories)));
    return cats;
  }, [searchableSongs, freeshowCategories]);

  // null = "alle categorieën" (het gedrag als de gebruiker nog nooit iets
  // heeft uitgevinkt) - pas zodra iemand een categorie aan/uit klikt wordt
  // dit een concrete lijst, die we vanaf dat moment onthouden.
  const [selectedCategories, setSelectedCategories] = useState<string[] | null>(loadStoredCategories);
  const activeCategories = selectedCategories ?? availableCategories;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (selectedCategories === null) {
      localStorage.removeItem(CATEGORY_STORAGE_KEY);
    } else {
      localStorage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify(selectedCategories));
    }
  }, [selectedCategories]);

  const toggleCategory = (cat: string) => {
    const current = selectedCategories ?? availableCategories;
    const next = current.includes(cat) ? current.filter(c => c !== cat) : [...current, cat];
    setSelectedCategories(next);
  };

  const filteredSongs = searchableSongs.filter(
    s => activeCategories.includes(s.category) &&
         (!songInput || s.name.toLowerCase().includes(songInput.toLowerCase()))
  );

  return (
    <div>
      <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.75rem', opacity: 0.7 }}>
        {t('search_song')}
      </label>
      <input
        type="text"
        className="input"
        value={songInput}
        onChange={e => setSongInput(e.target.value)}
        placeholder={t('search_placeholder')}
        style={{ marginBottom: '0.5rem' }}
      />

      {availableCategories.length > 1 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
          {availableCategories.map(cat => (
            <label
              key={cat}
              style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.7rem', opacity: activeCategories.includes(cat) ? 1 : 0.5, cursor: 'pointer' }}
            >
              <input
                type="checkbox"
                checked={activeCategories.includes(cat)}
                onChange={() => toggleCategory(cat)}
                style={{ width: '14px', height: '14px' }}
              />
              {getCategoryDisplayName(cat, freeshowCategories)}
            </label>
          ))}
        </div>
      )}

      <div className="glass-card" style={{ padding: '0.8rem', marginBottom: '1rem', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--card-border)', borderRadius: '8px' }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block', marginBottom: '0.5rem' }}>
          {songInput ? `Zoekresultaten (${filteredSongs.length})` : `Selecteer een lied uit de catalogus (${filteredSongs.length}):`}
        </span>

        <div style={{ maxHeight: '320px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px', paddingRight: '4px' }}>
          {filteredSongs.slice(0, RESULTS_LIMIT).map((song, i) => (
            <div
              key={i}
              title={song.name}
              style={{
                padding: '8px 12px',
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.05)',
                borderRadius: '6px',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                transition: 'all 0.2s'
              }}
              onClick={() => onAddSong(song.name)}
              onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--primary)'}
              onMouseLeave={(e) => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)'}
            >
              <span style={{ fontSize: '0.85rem', fontWeight: 500, color: '#fff' }}>{song.name}</span>
              <span style={{ fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px', background: 'rgba(56, 189, 248, 0.1)', color: 'var(--primary)', fontWeight: 600 }}>
                {getCategoryDisplayName(song.category, freeshowCategories)}
              </span>
            </div>
          ))}
          {filteredSongs.length === 0 && (
            <div style={{ padding: '1rem', textAlign: 'center', opacity: 0.5, fontSize: '0.8rem' }}>
              Geen liederen gevonden. Typ hierboven om handmatig toe te voegen.
            </div>
          )}
          {filteredSongs.length > RESULTS_LIMIT && (
            <div style={{ padding: '0.5rem', textAlign: 'center', opacity: 0.6, fontSize: '0.7rem' }}>
              +{filteredSongs.length - RESULTS_LIMIT} meer — typ om te zoeken of vink categorieën uit.
            </div>
          )}
        </div>
      </div>

      <button
        className="button"
        style={{ width: '100%', background: songInput ? 'var(--primary)' : 'rgba(255,255,255,0.05)', color: songInput ? '#020617' : '#ffffff' }}
        onClick={() => onAddSong()}
        disabled={!songInput}
      >
        + Handmatig lied toevoegen: "{songInput || '...'}"
      </button>
    </div>
  );
}
