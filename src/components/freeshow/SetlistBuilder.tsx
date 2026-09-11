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

interface Contact {
  id: string;
  name: string;
  role: 'band' | 'operator' | 'other';
  email?: string;
  phone?: string;
  active?: boolean;
}

const ROLE_LABELS: Record<Contact['role'], string> = {
  band: 'Band',
  operator: 'Beamer-operator',
  other: 'Overig'
};

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
  const [templateSections, setTemplateSections] = useState<string[]>([]);
  const [staging, setStaging] = useState<{ title: string; artist?: string; text: string; chords: string; section: string; loading: boolean } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editLyrics, setEditLyrics] = useState('');
  const [editChords, setEditChords] = useState('');
  const [editSection, setEditSection] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genMessage, setGenMessage] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [sendPanelOpen, setSendPanelOpen] = useState(false);
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>([]);
  const [includePdf, setIncludePdf] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendMessage, setSendMessage] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [sendPreview, setSendPreview] = useState<{ to: Array<{ name: string; email: string }>; subject: string; bodyText: string; attachments: string[] } | null>(null);
  const [checking, setChecking] = useState(false);
  const [unassigned, setUnassigned] = useState<Array<{ messageId?: string; subject?: string; receivedAt: string; excerpt: string }>>([]);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [extraMessage, setExtraMessage] = useState('');

  // Remembered per browser (not per service) - a worship leader's dresscode
  // note or sign-off ("God bless, Jeffrey") tends to stay the same week to
  // week, so don't make them retype it every time.
  useEffect(() => {
    try {
      const saved = localStorage.getItem('setlist_extra_message');
      if (saved) setExtraMessage(saved);
    } catch {
      // localStorage can throw in some contexts (private mode, blocked) - not fatal.
    }
  }, []);

  const updateExtraMessage = (value: string) => {
    setExtraMessage(value);
    try {
      localStorage.setItem('setlist_extra_message', value);
    } catch {
      // best-effort, see above
    }
  };

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

  const fetchUnassigned = useCallback(async () => {
    try {
      const res = await fetch('/api/email/drafts');
      const data = await res.json();
      if (data.success) setUnassigned(data.unassigned || []);
    } catch {
      // Non-critical - this is just a convenience notice, not the main setlist data.
    }
  }, []);

  useEffect(() => { fetchUnassigned(); }, [fetchUnassigned]);

  const checkNow = async () => {
    setChecking(true);
    try {
      await fetch('/api/email');
      await fetchDraft(serviceDate);
      await fetchUnassigned();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setChecking(false);
    }
  };

  const dismissUnassigned = async (messageId: string) => {
    setDismissingId(messageId);
    try {
      const res = await fetch(`/api/email/drafts?messageId=${encodeURIComponent(messageId)}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setUnassigned(prev => prev.filter(u => u.messageId !== messageId));
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDismissingId(null);
    }
  };

  useEffect(() => {
    fetch('/api/contacts')
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          const active: Contact[] = (data.contacts || []).filter((c: Contact) => c.active !== false);
          setContacts(active);
          setSelectedRecipientIds(active.map(c => c.id));
        }
      })
      .catch(() => {});
  }, []);

  // The actual service structure (Welkom, Worship, Collecte, Worship 2,
  // Preek, Einde, ...) lives in the FreeShow template project - reuse that
  // instead of asking the worship leader to type section names from memory.
  useEffect(() => {
    fetch('/api/template')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data.shows)) {
          const sections = data.shows.filter((s: any) => s.type === 'section').map((s: any) => s.title || s.name);
          setTemplateSections(sections.filter(Boolean));
        }
      })
      .catch(() => {});
  }, []);

  // Same "title - artist" split FreeshowGenerator's ad-hoc song add uses, so
  // catalog songs (stored as "Title - Artist") preview/save consistently.
  const stageSong = async (title?: string) => {
    const finalTitle = (title || songInput).trim();
    if (!finalTitle) return;
    setError('');
    const split = finalTitle.split('-');
    const songTitle = split[0]?.trim() || finalTitle;
    const artist = split[1]?.trim() || '';
    setSongInput('');
    setStaging({ title: songTitle, artist, text: '', chords: '', section, loading: true });
    try {
      const res = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ type: 'song', title: songTitle, artist }] })
      });
      const data = await res.json();
      const text = data.success && data.items?.[0] ? data.items[0].text || '' : '';
      setStaging(prev => (prev ? { ...prev, text, loading: false } : prev));
    } catch {
      setStaging(prev => (prev ? { ...prev, loading: false } : prev));
    }
  };

  const cancelStaging = () => setStaging(null);

  const confirmStagedSong = async () => {
    if (!staging) return;
    setError('');
    try {
      const res = await fetch(`/api/setlists/${encodeURIComponent(serviceDate)}/songs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: staging.title, artist: staging.artist, section: staging.section, lyricsText: staging.text, chordsText: staging.chords })
      });
      const data = await res.json();
      if (data.success) {
        setDraft(data.draft);
        setStaging(null);
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
    setEditSection(song.section || '');
  };

  const saveEditing = async (songId: string) => {
    setSavingId(songId);
    try {
      const res = await fetch(`/api/setlists/${encodeURIComponent(serviceDate)}/songs/${encodeURIComponent(songId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lyricsText: editLyrics, chordsText: editChords, section: editSection })
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

  const generateProject = async (force: boolean): Promise<boolean> => {
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
        return true;
      } else {
        setGenMessage('❌ ' + (data.message || data.error || 'Onbekende fout'));
        return false;
      }
    } catch (e: any) {
      setGenMessage('❌ ' + e.message);
      return false;
    } finally {
      setGenerating(false);
    }
  };

  const toggleRecipient = (id: string) => {
    setSelectedRecipientIds(prev => prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id]);
  };

  // "Verstuur e-mail" no longer sends straight away - it first asks the
  // server (dryRun) for exactly what would be sent (recipients, subject,
  // body, attachment filenames) so the worship leader can review it, then
  // confirmSend fires the real send with the same parameters.
  const openSendPreview = async () => {
    setPreviewLoading(true);
    setSendMessage('');
    try {
      const res = await fetch(`/api/setlists/${encodeURIComponent(serviceDate)}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientIds: selectedRecipientIds, includePdf, message: extraMessage, dryRun: true })
      });
      const data = await res.json();
      if (data.success) {
        setSendPreview(data.preview);
      } else {
        setSendMessage(`❌ ${data.error}`);
      }
    } catch (e: any) {
      setSendMessage(`❌ ${e.message}`);
    } finally {
      setPreviewLoading(false);
    }
  };

  const cancelSendPreview = () => setSendPreview(null);

  // Sends exactly what's shown in the (possibly edited) preview - subject
  // and bodyText travel along so a tweak made in the review step is what
  // actually goes out, not a freshly recomposed version.
  const confirmSend = async () => {
    if (!sendPreview) return;
    setSending(true);
    setSendMessage('');
    try {
      const res = await fetch(`/api/setlists/${encodeURIComponent(serviceDate)}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientIds: selectedRecipientIds,
          includePdf,
          subject: sendPreview.subject,
          bodyText: sendPreview.bodyText
        })
      });
      const data = await res.json();
      if (data.success) {
        setSendMessage(`✅ Verstuurd naar ${data.sentTo} ontvanger(s) — project wordt bijgewerkt...`);
        const projectOk = await generateProject(false);
        setSendMessage(
          projectOk
            ? `✅ Verstuurd naar ${data.sentTo} ontvanger(s), en project bijgewerkt`
            : `✅ Verstuurd naar ${data.sentTo} ontvanger(s) — ⚠️ project bijwerken is mislukt, probeer dat los`
        );
      } else {
        setSendMessage(`❌ ${data.error}`);
      }
    } catch (e: any) {
      setSendMessage(`❌ ${e.message}`);
    } finally {
      setSending(false);
      setSendPreview(null);
    }
  };

  // Deliberately not automated (see the plan's no-cloud constraint - true
  // automated WhatsApp sending needs a cloud API like WhatsApp Business/
  // Twilio) - reuses the same wa.me deep-link pattern already used
  // elsewhere in this app (src/app/page.tsx), which just opens WhatsApp's
  // own share sheet for a human to pick a recipient and send.
  const sendWhatsAppSummary = () => {
    if (!draft) return;
    const lines = [`Setlist ${formatDate(serviceDate)}:`, ''];
    draft.songs.forEach((s, i) => {
      lines.push(`${i + 1}. ${s.title}${s.artist ? ` - ${s.artist}` : ''}`);
    });
    window.open(`https://wa.me/?text=${encodeURIComponent(lines.join('\n'))}`, '_blank');
  };

  const contactsByRole = contacts.reduce<Record<string, Contact[]>>((acc, c) => {
    (acc[c.role] = acc[c.role] || []).push(c);
    return acc;
  }, {});

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
          <button
            className="button"
            style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem', background: 'rgba(255,255,255,0.08)' }}
            onClick={checkNow}
            disabled={checking}
            title="Nieuwe liturgie-mails ophalen"
          >
            {checking ? 'Bezig...' : '🔄 Check nu (mail)'}
          </button>
        </div>
      </div>

      <p style={{ fontSize: '0.8rem', opacity: 0.7, marginBottom: '1.2rem' }}>
        Bouw hier de setlist voor <strong style={{ textTransform: 'capitalize' }}>{formatDate(serviceDate)}</strong> — dezelfde setlist waar ook een liturgie-mail voor deze datum in terechtkomt, dus een e-mail en handmatig toevoegen kunnen prima samen.
      </p>

      {unassigned.length > 0 && (
        <div className="glass-card" style={{ padding: '1rem', marginBottom: '1.5rem', border: '1px solid rgba(239,68,68,0.25)', background: 'rgba(239,68,68,0.04)' }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>⚠️ Niet-toegewezen mails ({unassigned.length})</div>
          <p style={{ fontSize: '0.75rem', opacity: 0.7, marginBottom: '0.6rem' }}>
            Deze mails konden niet aan een dienstdatum gekoppeld worden (geen of onleesbare &quot;Dienst datum:&quot;-regel).
          </p>
          {unassigned.map((u, i) => (
            <div key={u.messageId || i} style={{ padding: '0.5rem 0', borderTop: i > 0 ? '1px solid rgba(255,255,255,0.05)' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem' }}>
              <div>
                <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>{u.subject}</div>
                <div style={{ fontSize: '0.7rem', opacity: 0.5 }}>{new Date(u.receivedAt).toLocaleString('nl-NL')}</div>
              </div>
              {u.messageId && (
                <button
                  onClick={() => dismissUnassigned(u.messageId!)}
                  disabled={dismissingId === u.messageId}
                  title="Verwijderen uit deze lijst"
                  style={{ background: 'rgba(255,0,0,0.15)', color: '#ef4444', border: 'none', borderRadius: '6px', padding: '0.3rem 0.5rem', fontSize: '0.75rem', cursor: 'pointer', flexShrink: 0 }}
                >
                  {dismissingId === u.messageId ? '...' : '🗑️'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

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
            <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.75rem', opacity: 0.7 }}>
              Standaard-sectie voor het volgende lied
            </label>
            <input
              type="text"
              className="input"
              list="setlist-sections"
              value={section}
              onChange={e => setSection(e.target.value)}
              placeholder="bv. Worship"
              style={{ marginBottom: '1rem' }}
            />
            <datalist id="setlist-sections">
              {templateSections.map(s => <option key={s} value={s} />)}
            </datalist>
            {staging ? (
              <div className="glass-card" style={{ padding: '1rem', border: '2px solid var(--primary)', background: 'rgba(56,189,248,0.05)' }}>
                <div style={{ fontWeight: 'bold', marginBottom: '0.8rem' }}>
                  {staging.title}{staging.artist ? <span style={{ opacity: 0.6 }}> - {staging.artist}</span> : ''}
                </div>
                <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.7rem', opacity: 0.6 }}>Sectie</label>
                {templateSections.length > 0 ? (
                  <select
                    className="input"
                    value={staging.section}
                    onChange={e => setStaging(prev => (prev ? { ...prev, section: e.target.value } : prev))}
                    style={{ width: '100%', marginBottom: '0.8rem' }}
                  >
                    {!templateSections.includes(staging.section) && (
                      <option value={staging.section}>{staging.section}</option>
                    )}
                    {templateSections.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                ) : (
                  <input
                    type="text"
                    className="input"
                    value={staging.section}
                    onChange={e => setStaging(prev => (prev ? { ...prev, section: e.target.value } : prev))}
                    style={{ width: '100%', marginBottom: '0.8rem' }}
                  />
                )}
                {staging.loading ? (
                  <div style={{ padding: '1.5rem', textAlign: 'center', opacity: 0.6, fontSize: '0.85rem' }}>Songtekst ophalen...</div>
                ) : (
                  <>
                    <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.7rem', opacity: 0.6 }}>
                      Songtekst — controleer voor je 'm toevoegt (je kunt 'm hier aanpassen)
                    </label>
                    {!staging.text && (
                      <div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '0.4rem' }}>
                        Geen tekst gevonden in de catalogus — vul 'm hieronder zelf in, of laat leeg.
                      </div>
                    )}
                    <textarea
                      className="input"
                      value={staging.text}
                      onChange={e => setStaging(prev => (prev ? { ...prev, text: e.target.value } : prev))}
                      rows={12}
                      style={{ width: '100%', fontFamily: 'monospace', resize: 'vertical', marginBottom: '0.8rem' }}
                    />
                    <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.7rem', opacity: 0.6 }}>
                      Akkoorden (vrije tekst, optioneel)
                    </label>
                    <textarea
                      className="input"
                      value={staging.chords}
                      onChange={e => setStaging(prev => (prev ? { ...prev, chords: e.target.value } : prev))}
                      rows={5}
                      placeholder={'bv.\nG            D\nAmazing grace, how sweet the sound'}
                      style={{ width: '100%', fontFamily: 'monospace', resize: 'vertical', marginBottom: '0.8rem' }}
                    />
                  </>
                )}
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className="button" style={{ flex: 1, background: 'rgba(255,255,255,0.1)' }} onClick={cancelStaging}>
                    Annuleren
                  </button>
                  <button
                    className="button"
                    style={{ flex: 1, background: 'var(--primary)', color: '#020617' }}
                    onClick={confirmStagedSong}
                    disabled={staging.loading}
                  >
                    + Toevoegen aan setlist
                  </button>
                </div>
              </div>
            ) : (
              <SongInput
                songInput={songInput}
                setSongInput={setSongInput}
                catalogSongs={catalogSongs}
                onAddSong={stageSong}
                t={t}
                freeshowCategories={freeshowCategories}
              />
            )}
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>🎵 Liederen ({draft?.songs.length || 0})</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                {genMessage && <span style={{ fontSize: '0.75rem' }}>{genMessage}</span>}
                <button
                  className="button"
                  style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem', background: 'rgba(255,255,255,0.08)' }}
                  onClick={() => setSendPanelOpen(open => !open)}
                  disabled={!draft?.songs.length}
                >
                  📤 Verstuur naar team
                </button>
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

            {sendPanelOpen && draft && (
              <div className="glass-card" style={{ padding: '1rem', marginBottom: '1rem', background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: '8px' }}>
                {contacts.length === 0 ? (
                  <p style={{ fontSize: '0.8rem', opacity: 0.7, margin: 0 }}>
                    Nog geen teamleden ingesteld — voeg ze toe bij Instellingen → Team.
                  </p>
                ) : (
                  <>
                    {(['band', 'operator', 'other'] as const).map(role => contactsByRole[role]?.length ? (
                      <div key={role} style={{ marginBottom: '0.6rem' }}>
                        <div style={{ fontSize: '0.7rem', opacity: 0.6, marginBottom: '0.3rem', fontWeight: 600 }}>{ROLE_LABELS[role]}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
                          {contactsByRole[role].map(c => (
                            <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', opacity: c.email ? 1 : 0.4, cursor: c.email ? 'pointer' : 'default' }}>
                              <input
                                type="checkbox"
                                checked={selectedRecipientIds.includes(c.id)}
                                onChange={() => toggleRecipient(c.id)}
                                disabled={!c.email}
                              />
                              {c.name}{!c.email && ' (geen e-mail)'}
                            </label>
                          ))}
                        </div>
                      </div>
                    ) : null)}

                    <label style={{ display: 'block', marginTop: '0.6rem', marginBottom: '0.3rem', fontSize: '0.75rem', opacity: 0.7 }}>
                      Extra bericht (optioneel) — bijv. dresscode, een opmerking, of een groet
                    </label>
                    <textarea
                      className="input"
                      value={extraMessage}
                      onChange={e => updateExtraMessage(e.target.value)}
                      rows={3}
                      placeholder={'bv.\nLet op: aankomende zondag is het smart casual.\nGod bless, Jeffrey'}
                      style={{ width: '100%', resize: 'vertical', marginBottom: '0.6rem' }}
                    />

                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', margin: '0.6rem 0' }}>
                      <input type="checkbox" checked={includePdf} onChange={e => setIncludePdf(e.target.checked)} />
                      Ook als PDF bijvoegen (naast tekstbestand)
                    </label>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                      <button
                        className="button"
                        style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem', background: 'var(--primary)', color: '#020617' }}
                        onClick={openSendPreview}
                        disabled={previewLoading || selectedRecipientIds.length === 0}
                      >
                        {previewLoading ? 'Voorbereiden...' : '✉️ Verstuur e-mail'}
                      </button>
                      <button
                        className="button"
                        style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem', background: 'rgba(37,211,102,0.15)', border: '1px solid rgba(37,211,102,0.4)', color: '#25d366' }}
                        onClick={sendWhatsAppSummary}
                      >
                        📱 WhatsApp-samenvatting
                      </button>
                      {sendMessage && <span style={{ fontSize: '0.75rem' }}>{sendMessage}</span>}
                    </div>
                  </>
                )}
              </div>
            )}

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
                        <span style={{ fontSize: '0.65rem', padding: '1px 6px', borderRadius: '4px', background: 'rgba(255,255,255,0.06)', color: 'var(--muted)', flexShrink: 0 }}>
                          {s.section}
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
                        <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.7rem', opacity: 0.6 }}>Sectie</label>
                        {templateSections.length > 0 ? (
                          <select
                            className="input"
                            value={editSection}
                            onChange={e => setEditSection(e.target.value)}
                            style={{ width: '100%', marginBottom: '0.6rem' }}
                          >
                            {!templateSections.includes(editSection) && (
                              <option value={editSection}>{editSection}</option>
                            )}
                            {templateSections.map(sec => <option key={sec} value={sec}>{sec}</option>)}
                          </select>
                        ) : (
                          <input
                            type="text"
                            className="input"
                            value={editSection}
                            onChange={e => setEditSection(e.target.value)}
                            style={{ width: '100%', marginBottom: '0.6rem' }}
                          />
                        )}
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

      {sendPreview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
          <div className="glass-card" style={{ padding: '1.5rem', maxWidth: '560px', width: '100%', maxHeight: '85vh', overflowY: 'auto', background: '#0f172a', border: '1px solid rgba(56,189,248,0.3)' }}>
            <h3 style={{ marginTop: 0, marginBottom: '1rem' }}>📧 Controleer voor je verstuurt</h3>
            <p style={{ fontSize: '0.75rem', opacity: 0.6, marginTop: '-0.6rem', marginBottom: '1rem' }}>
              Onderwerp en bericht zijn hieronder aan te passen — de wijzigingen worden meegestuurd.
            </p>

            <div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '0.2rem' }}>Aan</div>
            <div style={{ fontSize: '0.85rem', marginBottom: '0.8rem' }}>
              {sendPreview.to.map(r => `${r.name} <${r.email}>`).join(', ')}
            </div>

            <div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '0.2rem' }}>Onderwerp</div>
            <input
              type="text"
              className="input"
              value={sendPreview.subject}
              onChange={e => setSendPreview(prev => (prev ? { ...prev, subject: e.target.value } : prev))}
              style={{ marginBottom: '0.8rem' }}
            />

            <div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '0.2rem' }}>Bericht</div>
            <textarea
              className="input"
              value={sendPreview.bodyText}
              onChange={e => setSendPreview(prev => (prev ? { ...prev, bodyText: e.target.value } : prev))}
              rows={12}
              style={{ width: '100%', resize: 'vertical', marginBottom: '0.8rem' }}
            />

            <div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '0.2rem' }}>Bijlagen ({sendPreview.attachments.length})</div>
            <div style={{ fontSize: '0.8rem', marginBottom: '1.2rem', opacity: 0.85 }}>
              {sendPreview.attachments.join(', ')}
            </div>

            {sendMessage && <div style={{ fontSize: '0.8rem', marginBottom: '0.8rem' }}>{sendMessage}</div>}

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="button" style={{ flex: 1, background: 'rgba(255,255,255,0.1)' }} onClick={cancelSendPreview} disabled={sending}>
                Annuleren
              </button>
              <button
                className="button"
                style={{ flex: 1, background: 'var(--primary)', color: '#020617' }}
                onClick={confirmSend}
                disabled={sending}
              >
                {sending ? 'Bezig met versturen...' : '✅ Akkoord, versturen'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
