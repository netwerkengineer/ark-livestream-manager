"use client";
import React from 'react';
import { getCategoryDisplayName } from '@/lib/freeshowUtils';

interface PresentationInputProps {
  presentationInput: string;
  setPresentationInput: (value: string) => void;
  catalogSongs: Array<{ name: string; category: string }>;
  onAddSong: (title?: string) => void;
  t: (key: string) => string;
  freeshowCategories?: Record<string, { name: string; icon?: string; default?: boolean }>;
}

export default function PresentationInput({
  presentationInput,
  setPresentationInput,
  catalogSongs,
  onAddSong,
  t,
  freeshowCategories
}: PresentationInputProps) {
  const filteredPresentations = catalogSongs.filter(
    s => s.category === 'presentation' &&
         (!presentationInput || s.name.toLowerCase().includes(presentationInput.toLowerCase()))
  );

  return (
    <div>
      <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.75rem', opacity: 0.7 }}>
        {t('search_presentation')}
      </label>
      <input
        type="text"
        className="input"
        value={presentationInput}
        onChange={e => setPresentationInput(e.target.value)}
        placeholder={t('search_placeholder')}
        style={{ marginBottom: '0.5rem' }}
      />

      <div className="glass-card" style={{ padding: '0.8rem', marginBottom: '1rem', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--card-border)', borderRadius: '8px' }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block', marginBottom: '0.5rem' }}>
          {presentationInput ? `Zoekresultaten (${filteredPresentations.length})` : 'Selecteer een presentatie uit de catalogus:'}
        </span>

        <div style={{ maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px', paddingRight: '4px' }}>
          {filteredPresentations.slice(0, 50).map((song, i) => (
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
          {filteredPresentations.length === 0 && (
            <div style={{ padding: '1rem', textAlign: 'center', opacity: 0.5, fontSize: '0.8rem' }}>
              Geen presentaties gevonden. Typ hierboven om handmatig toe te voegen.
            </div>
          )}
        </div>
      </div>

      <button
        className="button"
        style={{ width: '100%', background: presentationInput ? 'var(--primary)' : 'rgba(255,255,255,0.05)', color: presentationInput ? '#020617' : '#ffffff' }}
        onClick={() => onAddSong()}
        disabled={!presentationInput}
      >
        + Handmatig presentatie toevoegen: "{presentationInput || '...'}"
      </button>
    </div>
  );
}
