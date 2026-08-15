"use client";
import React, { useEffect, useState, useCallback } from 'react';

interface DraftSong {
  id: string;
  title: string;
  category?: string;
  section: string;
}
interface DraftScripture {
  id: string;
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd?: number;
  translation: string;
  section: string;
}
interface DraftMedia {
  id: string;
  mediaType: 'youtube' | 'attachment' | 'link';
  url?: string;
  attachmentName?: string;
  filePath?: string;
  section: string;
}
interface SourceEmailRecord {
  messageId?: string;
  subject?: string;
  receivedAt: string;
  notes: string[];
}
interface DraftService {
  id: string;
  serviceDate: string;
  songs: DraftSong[];
  scriptures: DraftScripture[];
  media: DraftMedia[];
  sourceEmails: SourceEmailRecord[];
  lastUpdatedAt: string;
}
interface UnassignedEmailRecord extends SourceEmailRecord {
  excerpt: string;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return iso;
  }
}

function sectionBadge(section: string) {
  return (
    <span style={{ fontSize: '0.65rem', padding: '0.15rem 0.5rem', borderRadius: '4px', background: 'rgba(56,189,248,0.12)', color: 'var(--primary)', fontWeight: 600 }}>
      {section || 'Overig'}
    </span>
  );
}

export default function DraftServicesReview() {
  const [drafts, setDrafts] = useState<DraftService[]>([]);
  const [unassigned, setUnassigned] = useState<UnassignedEmailRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  const fetchDrafts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/email/drafts');
      const data = await res.json();
      if (data.success) {
        setDrafts(data.drafts || []);
        setUnassigned(data.unassigned || []);
        setError('');
      } else {
        setError(data.error || 'Onbekende fout');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDrafts(); }, [fetchDrafts]);

  const checkNow = async () => {
    setChecking(true);
    setError('');
    try {
      const res = await fetch('/api/email');
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Onbekende fout bij ophalen mail');
      }
      await fetchDrafts();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setChecking(false);
    }
  };

  const allNotes = (draft: DraftService) => draft.sourceEmails.flatMap(e => e.notes);

  return (
    <div className="glass-card" style={{ padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <h2 style={{ margin: 0 }}>📬 Concept-diensten uit e-mail</h2>
        <button className="button" onClick={checkNow} disabled={checking} style={{ background: 'var(--primary)', color: '#020617' }}>
          {checking ? 'Bezig...' : '🔄 Check nu'}
        </button>
      </div>

      {error && (
        <div style={{ padding: '0.8rem 1rem', marginBottom: '1.5rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', color: '#fca5a5', fontSize: '0.85rem' }}>
          ⚠️ {error}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', opacity: 0.5 }}>Laden...</div>
      ) : drafts.length === 0 && unassigned.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', opacity: 0.5 }}>
          Nog geen aanleveringen gevonden. Klik op &quot;Check nu&quot; of wacht op de volgende automatische controle.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {drafts.map(draft => {
            const notes = allNotes(draft);
            return (
              <div key={draft.id} className="glass-card" style={{ padding: '1.2rem', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', background: 'rgba(255,255,255,0.02)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <h3 style={{ margin: 0, textTransform: 'capitalize' }}>{formatDate(draft.serviceDate)}</h3>
                  <span style={{ fontSize: '0.7rem', opacity: 0.5 }}>
                    Laatst bijgewerkt: {new Date(draft.lastUpdatedAt).toLocaleString('nl-NL')} · {draft.sourceEmails.length} mail(s)
                  </span>
                </div>

                {notes.length > 0 && (
                  <div style={{ marginBottom: '1rem', padding: '0.6rem 0.8rem', background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.3)', borderRadius: '8px' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#fcd34d', marginBottom: '0.3rem' }}>Niet herkende regels — handmatig controleren:</div>
                    {notes.map((n, i) => (
                      <div key={i} style={{ fontSize: '0.75rem', opacity: 0.8 }}>• {n}</div>
                    ))}
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                  <div>
                    <div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '0.4rem', fontWeight: 600 }}>🎵 Liederen ({draft.songs.length})</div>
                    {draft.songs.length === 0 ? (
                      <div style={{ fontSize: '0.8rem', opacity: 0.4 }}>Nog niet aangeleverd</div>
                    ) : draft.songs.map(s => (
                      <div key={s.id} style={{ fontSize: '0.8rem', padding: '0.3rem 0', display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                        <span>{s.title}</span>
                        {sectionBadge(s.section)}
                      </div>
                    ))}
                  </div>

                  <div>
                    <div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '0.4rem', fontWeight: 600 }}>📖 Bijbeltekst ({draft.scriptures.length})</div>
                    {draft.scriptures.length === 0 ? (
                      <div style={{ fontSize: '0.8rem', opacity: 0.4 }}>Nog niet aangeleverd</div>
                    ) : draft.scriptures.map(s => (
                      <div key={s.id} style={{ fontSize: '0.8rem', padding: '0.3rem 0', display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                        <span>{s.book} {s.chapter}:{s.verseStart}{s.verseEnd ? `-${s.verseEnd}` : ''} ({s.translation})</span>
                        {sectionBadge(s.section)}
                      </div>
                    ))}
                  </div>

                  <div>
                    <div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '0.4rem', fontWeight: 600 }}>🎬 Media ({draft.media.length})</div>
                    {draft.media.length === 0 ? (
                      <div style={{ fontSize: '0.8rem', opacity: 0.4 }}>Nog niet aangeleverd</div>
                    ) : draft.media.map(m => (
                      <div key={m.id} style={{ fontSize: '0.8rem', padding: '0.3rem 0', display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                        <span title={m.url || m.attachmentName}>
                          {m.mediaType === 'youtube' ? '▶️ YouTube' : m.mediaType === 'attachment' ? `📎 ${m.attachmentName}${m.filePath ? '' : ' (niet gevonden)'}` : `🔗 Link`}
                        </span>
                        {sectionBadge(m.section)}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}

          {unassigned.length > 0 && (
            <div className="glass-card" style={{ padding: '1.2rem', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '12px', background: 'rgba(239,68,68,0.04)' }}>
              <h3 style={{ margin: '0 0 0.8rem 0' }}>⚠️ Niet toegewezen mails ({unassigned.length})</h3>
              <div style={{ fontSize: '0.8rem', opacity: 0.7, marginBottom: '1rem' }}>
                Deze mails konden niet aan een dienstdatum gekoppeld worden (geen of onleesbare &quot;Dienst datum:&quot;-regel). Controleer handmatig.
              </div>
              {unassigned.map((u, i) => (
                <div key={i} style={{ padding: '0.6rem 0', borderTop: i > 0 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{u.subject}</div>
                  <div style={{ fontSize: '0.7rem', opacity: 0.5, marginBottom: '0.3rem' }}>{new Date(u.receivedAt).toLocaleString('nl-NL')}</div>
                  <div style={{ fontSize: '0.75rem', opacity: 0.6, whiteSpace: 'pre-wrap' }}>{u.excerpt}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
