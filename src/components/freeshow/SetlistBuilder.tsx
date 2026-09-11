"use client";
import React, { useCallback, useEffect, useState } from 'react';
import SongInput from './SongInput';

interface DraftSong {
  id: string;
  title: string;
  artist?: string;
  category?: string;
  section: string;
  source: 'email' | 'manual';
  lyricsText?: string;
  chordsText?: string;
}

interface DraftService {
  id: string;
  serviceDate: string;
  songs: DraftSong[];
  scriptures: any[];
  media: any[];
  lastGeneratedAt?: string;
  lastGenerationNotes?: string[];
}

interface SetlistBuilderProps {
  catalogSongs: Array<{ name: string; category: string }>;
  freeshowCategories?: Record<string, { name: string; icon?: string; default?: boolean }>;
  t: (key: string) => string;
}

// Defaults to the coming Sunday (or today, if today already is one) - the
// date a worship leader building a setlist almost always means, without
// making them count days on a calendar picker first.
function upcomingSunday(): string {
  const d = new Date();
  const day = d.getDay(); // 0 = Sunday
  d.setDate(d.getDate() + ((7 - day) % 7));
  return d.toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return iso;
  }
}

export default function SetlistBuilder({ catalogSongs, freeshowCategories, t }: SetlistBuilderProps) {
  const [serviceDate, setServiceDate] = useState(upcomingSunday);
  const [draft, setDraft] = useState<DraftService | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [songInput, setSongInput] = useState('');
  const [section, setSection] = useState('Worship');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editLyrics, setEditLyrics] = useState('');
  const [editChords, setEditChords] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genMessage, setGenMessage] = useState('');

  const fetchDraft = useCallback(async (date: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/setlists/${encodeURIComponent(date)}`);
      const data = await res.json();
      if (data.success) {
        setDraft(data.draft);
      } else {
        setError(data.error || 'Onbekende fout');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDraft(serviceDate); }, [serviceDate, fetchDraft]);

  const addSong = async (title?: string) => {
    const finalTitle = title || songInput;
    if (!finalTitle.trim()) return;
    setError('');
    try {
      const res = await fetch(`/api/setlists/${encodeURIComponent(serviceDate)}/songs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: finalTitle.trim(), section })
      });
      const data = await res.json();
      if (data.success) {
        setDraft(data.draft);
        setSongInput('');
      } else {
        setError(data.error || 'Kon lied niet toevoegen');
      }
    } catch (e: any) {
      setError(e.message);
    }
  };

  const startEditing = (song: DraftSong) => {
    setExpandedId(song.id);
    setEditLyrics(song.lyricsText || '');
    setEditChords(song.chordsText || '');
  };

  const saveEditing = async (songId: string) => {
    setSavingId(songId);
    try {
      const res = await fetch(`/api/setlists/${encodeURIComponent(serviceDate)}/songs/${encodeURIComponent(songId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lyricsText: editLyrics, chordsText: editChords })
      });
      const data = await res.json();
      if (data.success) {
        setDraft(data.draft);
        setExpandedId(null);
      } else {
        setError(data.error || 'Kon lied niet opslaan');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingId(null);
    }
  };

  const removeSong = async (songId: string) => {
    setDeletingId(songId);
    try {
      const res = await fetch(`/api/setlists/${encodeURIComponent(serviceDate)}/songs/${encodeURIComponent(songId)}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success && draft) {
        setDraft({ ...draft, songs: draft.songs.filter(s => s.id !== songId) });
      } else if (!data.success) {
        setError(data.error || 'Kon lied niet verwijderen');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDeletingId(null);
    }
  };

  const moveSong = async (index: number, direction: -1 | 1) => {
    if (!draft) return;
    const target = index + direction;
    if (target < 0 || target >= draft.songs.length) return;
    const reordered = [...draft.songs];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setDraft({ ...draft, songs: reordered });
    try {
      await fetch(`/api/setlists/${encodeURIComponent(serviceDate)}/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds: reordered.map(s => s.id) })
      });
    } catch (e: any) {
      setError(e.message);
    }
  };

  const generateProject = async (force: boolean) => {
    setGenerating(true);
    setGenMessage('');
    try {
      const res = await fetch('/api/email/drafts/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceDate, force })
      });
      const data = await res.json();
      if (data.success) {
        setGenMessage('✅ ' + (data.message || 'Project bijgewerkt'));
        await fetchDraft(serviceDate);
      } else {
        setGenMessage('❌ ' + (data.message || data.error || 'Onbekende fout'));
      }
    } catch (e: any) {
      setGenMessage('❌ ' + e.message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="glass-card" style={{ padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <h2 style={{ margin: 0 }}>🎤 Setlist bouwen</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <label style={{ fontSize: '0.75rem', opacity: 0.7 }}>Dienstdatum:</label>
          <input
            type="date"
            className="input"
            value={serviceDate}
            onChange={e => setServiceDate(e.target.value)}
            style={{ padding: '0.4rem 0.6rem' }}
          />
        </div>
      </div>

      <p style={{ fontSize: '0.8rem', opacity: 0.7, marginBottom: '1.2rem' }}>
        Bouw hier de setlist voor <strong style={{ textTransform: 'capitalize' }}>{formatDate(serviceDate)}</strong> — dezelfde setlist waar ook een liturgie-mail voor deze datum in terechtkomt, dus een e-mail en handmatig toevoegen kunnen prima samen.
      </p>

      {error && (
        <div style={{ padding: '0.8rem 1rem', marginBottom: '1.5rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', color: '#fca5a5', fontSize: '0.85rem' }}>
          ⚠️ {error}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', opacity: 0.5 }}>Laden...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 340px) 1fr', gap: '1.5rem' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.75rem', opacity: 0.7 }}>Sectie voor nieuw toegevoegde liederen</label>
            <input
              type="text"
              className="input"
              value={section}
              onChange={e => setSection(e.target.value)}
              placeholder="bv. Worship"
              style={{ marginBottom: '1rem' }}
            />
            <SongInput
              songInput={songInput}
              setSongInput={setSongInput}
              catalogSongs={catalogSongs}
              onAddSong={addSong}
              t={t}
              freeshowCategories={freeshowCategories}
            />
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>🎵 Liederen ({draft?.songs.length || 0})</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                {genMessage && <span style={{ fontSize: '0.75rem' }}>{genMessage}</span>}
                <button
                  className="button"
                  style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem', background: 'var(--primary)', color: '#020617' }}
                  onClick={() => generateProject(false)}
                  disabled={generating || !draft?.songs.length}
                >
                  {generating ? 'Bezig...' : draft?.lastGeneratedAt ? '🔄 Project bijwerken' : '📁 Project aanmaken'}
                </button>
              </div>
            </div>

            {!draft || draft.songs.length === 0 ? (
              <div style={{ fontSize: '0.85rem', opacity: 0.5, padding: '2rem', textAlign: 'center', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: '8px' }}>
                Nog geen liederen — zoek er hiernaast een op uit de catalogus of typ er zelf een in.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {draft.songs.map((s, i) => (
                  <div key={s.id} className="glass-card" style={{ padding: '0.7rem 0.9rem', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
                        <span style={{ opacity: 0.4, fontSize: '0.75rem', width: '1.2rem', textAlign: 'right', flexShrink: 0 }}>{i + 1}.</span>
                        <span style={{ fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {s.title}{s.artist ? <span style={{ opacity: 0.5 }}> - {s.artist}</span> : ''}
                        </span>
                        {s.source === 'email' && <span title="Aangeleverd via e-mail" style={{ flexShrink: 0 }}>📬</span>}
                        {(s.lyricsText || s.chordsText) && <span title="Tekst/akkoorden toegevoegd" style={{ flexShrink: 0 }}>📝</span>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', flexShrink: 0 }}>
                        <button onClick={() => moveSong(i, -1)} disabled={i === 0} title="Omhoog" style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.8rem', padding: '0 0.2rem', opacity: i === 0 ? 0.3 : 1 }}>▲</button>
                        <button onClick={() => moveSong(i, 1)} disabled={i === draft.songs.length - 1} title="Omlaag" style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.8rem', padding: '0 0.2rem', opacity: i === draft.songs.length - 1 ? 0.3 : 1 }}>▼</button>
                        <button onClick={() => startEditing(s)} title="Tekst/akkoorden bewerken" style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.8rem', padding: '0 0.3rem' }}>✏️</button>
                        <button onClick={() => removeSong(s.id)} disabled={deletingId === s.id} title="Verwijderen" style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.8rem', padding: '0 0.2rem' }}>
                          {deletingId === s.id ? '...' : '🗑️'}
                        </button>
                      </div>
                    </div>

                    {expandedId === s.id && (
                      <div style={{ marginTop: '0.6rem', paddingTop: '0.6rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                        <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.7rem', opacity: 0.6 }}>Songtekst</label>
                        <textarea
                          className="input"
                          value={editLyrics}
                          onChange={e => setEditLyrics(e.target.value)}
                          rows={5}
                          style={{ width: '100%', marginBottom: '0.6rem', fontFamily: 'inherit', resize: 'vertical' }}
                        />
                        <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.7rem', opacity: 0.6 }}>Akkoorden (vrije tekst, optioneel)</label>
                        <textarea
                          className="input"
                          value={editChords}
                          onChange={e => setEditChords(e.target.value)}
                          rows={5}
                          placeholder={'bv.\nG            D\nAmazing grace, how sweet the sound'}
                          style={{ width: '100%', marginBottom: '0.6rem', fontFamily: 'monospace', resize: 'vertical' }}
                        />
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button
                            className="button"
                            style={{ fontSize: '0.75rem', padding: '0.3rem 0.8rem', background: 'var(--primary)', color: '#020617' }}
                            onClick={() => saveEditing(s.id)}
                            disabled={savingId === s.id}
                          >
                            {savingId === s.id ? 'Bezig...' : 'Opslaan'}
                          </button>
                          <button
                            className="button"
                            style={{ fontSize: '0.75rem', padding: '0.3rem 0.8rem', background: 'rgba(255,255,255,0.05)' }}
                            onClick={() => setExpandedId(null)}
                          >
                            Annuleren
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
