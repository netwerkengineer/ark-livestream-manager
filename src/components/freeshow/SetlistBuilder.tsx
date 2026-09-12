"use client";
import React, { useCallback, useEffect, useState } from 'react';
import SongInput from './SongInput';
import { BIBLE_BOOKS } from '@/lib/freeshowUtils';

interface DraftSong {
  id: string;
  title: string;
  artist?: string;
  category?: string;
  section: string;
  source: 'email' | 'manual';
  lyricsText?: string;
  chordsText?: string;
  chordsFileName?: string;
  chordsFilePath?: string;
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
  lastGeneratedAt?: string;
  lastGenerationNotes?: string[];
}

function sectionBadge(section: string) {
  return (
    <span style={{ fontSize: '0.65rem', padding: '0.15rem 0.5rem', borderRadius: '4px', background: 'rgba(56,189,248,0.12)', color: 'var(--primary)', fontWeight: 600, flexShrink: 0 }}>
      {section || 'Overig'}
    </span>
  );
}

interface Contact {
  id: string;
  name: string;
  role: 'band' | 'operator' | 'other';
  email?: string;
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
  availableBibles: string[];
  freeshowMediaPath: string;
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

export default function SetlistBuilder({ catalogSongs, freeshowCategories, availableBibles, freeshowMediaPath, t }: SetlistBuilderProps) {
  const [serviceDate, setServiceDate] = useState(upcomingSunday);
  const [draft, setDraft] = useState<DraftService | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [songInput, setSongInput] = useState('');
  const [section, setSection] = useState('Worship');
  const [templateSections, setTemplateSections] = useState<string[]>([]);
  const [staging, setStaging] = useState<{ title: string; artist?: string; text: string; chords: string; chordsFileName?: string; chordsFilePath?: string; youtubeUrl?: string; section: string; loading: boolean } | null>(null);
  const [stagingChordsUploading, setStagingChordsUploading] = useState(false);
  const [addMode, setAddMode] = useState<'song' | 'bible' | 'media'>('song');
  const [bibleTranslation, setBibleTranslation] = useState('');
  const [bibleBook, setBibleBook] = useState('Genesis');
  const [bibleChapter, setBibleChapter] = useState('');
  const [bibleVerseStart, setBibleVerseStart] = useState('');
  const [bibleVerseEnd, setBibleVerseEnd] = useState('');
  const [addingBible, setAddingBible] = useState(false);
  const [mediaType, setMediaType] = useState<'youtube' | 'attachment' | 'link'>('youtube');
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [addingMedia, setAddingMedia] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editLyrics, setEditLyrics] = useState('');
  const [editChords, setEditChords] = useState('');
  const [editChordsFileName, setEditChordsFileName] = useState('');
  const [editChordsFilePath, setEditChordsFilePath] = useState('');
  const [editChordsUploading, setEditChordsUploading] = useState(false);
  const [editSection, setEditSection] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genMessage, setGenMessage] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [sendPanelOpen, setSendPanelOpen] = useState(false);
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>([]);
  const [replyToIds, setReplyToIds] = useState<string[]>([]);
  const [includeText, setIncludeText] = useState(true);
  const [includePdf, setIncludePdf] = useState(false);
  const [includeChords, setIncludeChords] = useState(false);
  const [includeYoutube, setIncludeYoutube] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendMessage, setSendMessage] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [sendPreview, setSendPreview] = useState<{ to: Array<{ name: string; email: string }>; replyTo: Array<{ name: string; email: string }>; subject: string; bodyText: string; attachments: string[] } | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkMessage, setCheckMessage] = useState('');
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

  useEffect(() => {
    if (!bibleTranslation && availableBibles.length > 0) {
      setBibleTranslation(availableBibles[0]);
    }
  }, [availableBibles, bibleTranslation]);

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
    setCheckMessage('');
    try {
      const res = await fetch('/api/email');
      const data = await res.json();
      if (data.success) {
        const count = data.updatedDrafts?.length || 0;
        setCheckMessage(count > 0 ? `✅ ${count} dienst(en) bijgewerkt` : '✅ Gecontroleerd — geen nieuwe mails');
      } else {
        setCheckMessage(`❌ ${data.error || 'Onbekende fout'}`);
      }
      await fetchDraft(serviceDate);
      await fetchUnassigned();
    } catch (e: any) {
      setCheckMessage(`❌ ${e.message}`);
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
    setStagingChordsUploading(false);
    try {
      const [previewRes, metaRes] = await Promise.all([
        fetch('/api/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: [{ type: 'song', title: songTitle, artist }] })
        }),
        // A song already added to a setlist before (or edited in the show
        // editor) may already have chords/a reference link saved - pre-fill
        // from there the same way the lyrics themselves are pre-filled,
        // instead of always starting blank.
        fetch(`/api/song-meta?title=${encodeURIComponent(songTitle)}&artist=${encodeURIComponent(artist)}`)
      ]);
      const previewData = await previewRes.json();
      const text = previewData.success && previewData.items?.[0] ? previewData.items[0].text || '' : '';
      const metaData = await metaRes.json().catch(() => null);
      const meta = metaData?.success ? metaData.meta : null;
      setStaging(prev => (prev ? {
        ...prev,
        text,
        chords: meta?.chordsText || prev.chords,
        chordsFileName: meta?.chordsFileName,
        chordsFilePath: meta?.chordsFilePath,
        youtubeUrl: meta?.youtubeUrl,
        loading: false
      } : prev));
    } catch {
      setStaging(prev => (prev ? { ...prev, loading: false } : prev));
    }
  };

  const cancelStaging = () => setStaging(null);

  // Shared by the staging panel and the per-song edit panel - a band's
  // existing chord chart (txt/pdf) gets attached to the setlist mail
  // verbatim later, rather than making the worship leader retype it as
  // free text.
  const uploadChordsFile = async (file: File): Promise<{ filePath: string; fileName: string } | null> => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/chords-upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (!data.success) {
      setError(data.error || 'Upload van akkoordbestand mislukt');
      return null;
    }
    return { filePath: data.filePath, fileName: data.fileName };
  };

  const stagingChordsFileSelected = async (file: File | null) => {
    if (!file) return;
    setStagingChordsUploading(true);
    setError('');
    const uploaded = await uploadChordsFile(file);
    if (uploaded) {
      setStaging(prev => (prev ? { ...prev, chordsFileName: uploaded.fileName, chordsFilePath: uploaded.filePath, chords: '' } : prev));
    }
    setStagingChordsUploading(false);
  };

  const editChordsFileSelected = async (file: File | null) => {
    if (!file) return;
    setEditChordsUploading(true);
    setError('');
    const uploaded = await uploadChordsFile(file);
    if (uploaded) {
      setEditChordsFileName(uploaded.fileName);
      setEditChordsFilePath(uploaded.filePath);
      setEditChords('');
    }
    setEditChordsUploading(false);
  };

  const confirmStagedSong = async () => {
    if (!staging) return;
    setError('');
    try {
      const res = await fetch(`/api/setlists/${encodeURIComponent(serviceDate)}/songs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: staging.title,
          artist: staging.artist,
          section: staging.section,
          lyricsText: staging.text,
          chordsText: staging.chords,
          chordsFileName: staging.chordsFileName,
          chordsFilePath: staging.chordsFilePath
        })
      });
      const data = await res.json();
      if (data.success) {
        setDraft(data.draft);
        // Save chords back to this app's own song database too (not just
        // this one service) so the next time this song comes up - in any
        // setlist - the chords are already there. Best-effort: a failure
        // here shouldn't block the song actually being added to the setlist.
        if (staging.chordsFilePath || staging.chords.trim()) {
          fetch('/api/song-meta', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: staging.title,
              artist: staging.artist,
              chordsText: staging.chords,
              chordsFileName: staging.chordsFileName,
              chordsFilePath: staging.chordsFilePath
            })
          }).catch(() => {});
        }
        setStaging(null);
      } else {
        setError(data.error || 'Kon lied niet toevoegen');
      }
    } catch (e: any) {
      setError(e.message);
    }
  };

  // Matches FreeshowGenerator's own bible-add flow: availableBibles carries
  // full labels like "Basisbijbel (BB)", but the code stored on a scripture
  // (and what the e-mail pipeline stores) is just the short acronym in
  // parentheses - falls back to the raw value for a translation with no
  // parenthesized code at all.
  const addBible = async () => {
    if (!bibleBook || !bibleChapter || !bibleVerseStart) return;
    setAddingBible(true);
    setError('');
    try {
      const acronymMatch = bibleTranslation.match(/\((.*?)\)/);
      const translation = acronymMatch ? acronymMatch[1] : bibleTranslation;
      const res = await fetch(`/api/setlists/${encodeURIComponent(serviceDate)}/scriptures`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          book: bibleBook,
          chapter: Number(bibleChapter),
          verseStart: Number(bibleVerseStart),
          verseEnd: bibleVerseEnd ? Number(bibleVerseEnd) : undefined,
          translation,
          section
        })
      });
      const data = await res.json();
      if (data.success) {
        setDraft(data.draft);
        setBibleChapter('');
        setBibleVerseStart('');
        setBibleVerseEnd('');
      } else {
        setError(data.error || 'Kon bijbeltekst niet toevoegen');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAddingBible(false);
    }
  };

  const addMedia = async () => {
    setError('');
    if (mediaType === 'attachment' && !mediaFile) {
      setError('Kies eerst een bestand');
      return;
    }
    if (mediaType !== 'attachment' && !mediaUrl.trim()) {
      setError('Vul een link in');
      return;
    }
    setAddingMedia(true);
    try {
      let filePath: string | undefined;
      let attachmentName: string | undefined;
      if (mediaType === 'attachment' && mediaFile) {
        const formData = new FormData();
        formData.append('file', mediaFile);
        formData.append('directory', freeshowMediaPath);
        const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData });
        const uploadData = await uploadRes.json();
        if (!uploadData.success) {
          setError(uploadData.error || 'Upload mislukt');
          setAddingMedia(false);
          return;
        }
        filePath = uploadData.filePath;
        attachmentName = mediaFile.name;
      }

      const res = await fetch(`/api/setlists/${encodeURIComponent(serviceDate)}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mediaType,
          url: mediaType === 'attachment' ? undefined : mediaUrl.trim(),
          attachmentName,
          filePath,
          section
        })
      });
      const data = await res.json();
      if (data.success) {
        setDraft(data.draft);
        setMediaUrl('');
        setMediaFile(null);
      } else {
        setError(data.error || 'Kon media niet toevoegen');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAddingMedia(false);
    }
  };

  const startEditing = (song: DraftSong) => {
    setExpandedId(song.id);
    setEditLyrics(song.lyricsText || '');
    setEditChords(song.chordsText || '');
    setEditChordsFileName(song.chordsFileName || '');
    setEditChordsFilePath(song.chordsFilePath || '');
    setEditSection(song.section || '');
  };

  const saveEditing = async (songId: string) => {
    setSavingId(songId);
    try {
      const res = await fetch(`/api/setlists/${encodeURIComponent(serviceDate)}/songs/${encodeURIComponent(songId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lyricsText: editLyrics,
          chordsText: editChords,
          chordsFileName: editChordsFileName,
          chordsFilePath: editChordsFilePath,
          section: editSection
        })
      });
      const data = await res.json();
      if (data.success) {
        setDraft(data.draft);
        // Same as when a song is first added: keep this app's own song
        // database (data/songMeta.json) in sync so an edit here also helps
        // next time this song comes up.
        const editedSong = draft?.songs.find(s => s.id === songId);
        if (editedSong && (editChordsFilePath || editChords.trim())) {
          fetch('/api/song-meta', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: editedSong.title,
              artist: editedSong.artist,
              chordsText: editChords,
              chordsFileName: editChordsFileName,
              chordsFilePath: editChordsFilePath
            })
          }).catch(() => {});
        }
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

  // Scripture/media items only ever came from the e-mail pipeline (there's
  // no manual add-flow for them in this UI), so this reuses the existing
  // drafts route rather than adding a second delete endpoint for them.
  const removeItem = async (itemType: 'scripture' | 'media', itemId: string) => {
    setDeletingId(itemId);
    try {
      const res = await fetch(`/api/email/drafts?serviceDate=${encodeURIComponent(serviceDate)}&itemType=${itemType}&itemId=${encodeURIComponent(itemId)}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success && draft) {
        setDraft({
          ...draft,
          scriptures: itemType === 'scripture' ? draft.scriptures.filter(s => s.id !== itemId) : draft.scriptures,
          media: itemType === 'media' ? draft.media.filter(m => m.id !== itemId) : draft.media
        });
      } else if (!data.success) {
        setError(data.error || 'Kon item niet verwijderen');
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

  const toggleReplyTo = (id: string) => {
    setReplyToIds(prev => prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id]);
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
        body: JSON.stringify({ recipientIds: selectedRecipientIds, replyToIds, includeText, includePdf, includeChords, includeYoutube, message: extraMessage, dryRun: true })
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
          replyToIds,
          includeText,
          includePdf,
          includeChords,
          includeYoutube,
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

  // Lines from a liturgie-mail the parser couldn't make sense of (e.g. an
  // unrecognized Bijbelboek spelling) - surfaced here so "Check nu" showing
  // a count isn't the only signal of whether an import actually succeeded.
  const parsingNotes = draft ? draft.sourceEmails.flatMap(e => e.notes) : [];

  return (
    <div className="glass-card setlist-builder" style={{ padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <h2 style={{ margin: 0 }}>🎤 Setlist bouwen</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
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
          {checkMessage && <span style={{ fontSize: '0.75rem' }}>{checkMessage}</span>}
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

      {parsingNotes.length > 0 && (
        <div style={{ padding: '0.8rem 1rem', marginBottom: '1.5rem', background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.3)', borderRadius: '8px' }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#fcd34d', marginBottom: '0.3rem' }}>
            ⚠️ Niet herkende regels uit de mail — handmatig controleren:
          </div>
          {parsingNotes.map((n, i) => (
            <div key={i} style={{ fontSize: '0.8rem', opacity: 0.85 }}>• {n}</div>
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
        <div className="setlist-columns" style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 340px) 1fr', gap: '1.5rem' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.75rem', opacity: 0.7 }}>
              Standaard-sectie voor het volgende lied
            </label>
            {templateSections.length > 0 ? (
              <select
                className="input"
                value={section}
                onChange={e => setSection(e.target.value)}
                style={{ marginBottom: '1rem' }}
              >
                {!templateSections.includes(section) && (
                  <option value={section}>{section}</option>
                )}
                {templateSections.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            ) : (
              <input
                type="text"
                className="input"
                value={section}
                onChange={e => setSection(e.target.value)}
                placeholder="bv. Worship"
                style={{ marginBottom: '1rem' }}
              />
            )}

            <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem' }}>
              {([
                ['song', '🎵 Lied'],
                ['bible', '📖 Bijbeltekst'],
                ['media', '🎬 Media']
              ] as const).map(([mode, label]) => (
                <button
                  key={mode}
                  className="button"
                  style={{ flex: 1, fontSize: '0.75rem', padding: '0.5rem', background: addMode === mode ? 'var(--primary)' : 'rgba(255,255,255,0.05)', color: addMode === mode ? '#020617' : '#fff' }}
                  onClick={() => setAddMode(mode)}
                >
                  {label}
                </button>
              ))}
            </div>

            {addMode === 'bible' && (
              <div>
                <select
                  className="input"
                  value={bibleTranslation}
                  onChange={e => setBibleTranslation(e.target.value)}
                  style={{ marginBottom: '0.5rem' }}
                >
                  {availableBibles.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <select
                    className="input"
                    value={bibleBook}
                    onChange={e => setBibleBook(e.target.value)}
                    style={{ flex: 2 }}
                  >
                    {BIBLE_BOOKS.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                  <input
                    type="number"
                    className="input"
                    placeholder="Hfst"
                    value={bibleChapter}
                    onChange={e => setBibleChapter(e.target.value)}
                    style={{ flex: 1 }}
                  />
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                  <input
                    type="number"
                    className="input"
                    placeholder="Vers vanaf"
                    value={bibleVerseStart}
                    onChange={e => setBibleVerseStart(e.target.value)}
                  />
                  <input
                    type="number"
                    className="input"
                    placeholder="Vers tot (optioneel)"
                    value={bibleVerseEnd}
                    onChange={e => setBibleVerseEnd(e.target.value)}
                  />
                </div>
                <button
                  className="button"
                  style={{ width: '100%', background: 'var(--primary)', color: '#020617' }}
                  onClick={addBible}
                  disabled={addingBible || !bibleBook || !bibleChapter || !bibleVerseStart}
                >
                  {addingBible ? 'Bezig...' : '+ Toevoegen aan setlist'}
                </button>
              </div>
            )}

            {addMode === 'media' && (
              <div>
                <div style={{ display: 'flex', gap: '0.3rem', marginBottom: '0.6rem', background: 'rgba(255,255,255,0.05)', padding: '3px', borderRadius: '6px' }}>
                  {([
                    ['youtube', 'YouTube'],
                    ['attachment', 'Bestand'],
                    ['link', 'Link']
                  ] as const).map(([type, label]) => (
                    <button
                      key={type}
                      onClick={() => setMediaType(type)}
                      style={{ flex: 1, padding: '0.4rem', fontSize: '0.7rem', border: 'none', borderRadius: '4px', cursor: 'pointer', background: mediaType === type ? 'var(--primary)' : 'transparent', color: mediaType === type ? '#020617' : '#fff' }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {mediaType === 'attachment' ? (
                  <input
                    type="file"
                    accept="image/*,video/*"
                    className="input"
                    onChange={e => setMediaFile(e.target.files?.[0] || null)}
                    style={{ marginBottom: '1rem' }}
                  />
                ) : (
                  <input
                    type="text"
                    className="input"
                    placeholder={mediaType === 'youtube' ? 'https://youtube.com/...' : 'https://...'}
                    value={mediaUrl}
                    onChange={e => setMediaUrl(e.target.value)}
                    style={{ marginBottom: '1rem' }}
                  />
                )}
                <button
                  className="button"
                  style={{ width: '100%', background: 'var(--primary)', color: '#020617' }}
                  onClick={addMedia}
                  disabled={addingMedia}
                >
                  {addingMedia ? 'Bezig...' : '+ Toevoegen aan setlist'}
                </button>
              </div>
            )}

            {addMode === 'song' && (staging ? (
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
                      Akkoorden (optioneel) — wordt bewaard bij dit lied voor de volgende keer
                    </label>
                    {staging.chordsFilePath ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.8rem', fontSize: '0.8rem', background: 'rgba(255,255,255,0.05)', borderRadius: '6px', padding: '0.5rem 0.7rem' }}>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📎 {staging.chordsFileName}</span>
                        <button
                          type="button"
                          onClick={() => setStaging(prev => (prev ? { ...prev, chordsFilePath: undefined, chordsFileName: undefined } : prev))}
                          title="Bestand verwijderen"
                          style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.8rem' }}
                        >
                          🗑️
                        </button>
                      </div>
                    ) : (
                      <>
                        <textarea
                          className="input"
                          value={staging.chords}
                          onChange={e => setStaging(prev => (prev ? { ...prev, chords: e.target.value } : prev))}
                          rows={5}
                          placeholder={'bv.\nG            D\nAmazing grace, how sweet the sound'}
                          style={{ width: '100%', fontFamily: 'monospace', resize: 'vertical', marginBottom: '0.4rem' }}
                        />
                        <label style={{ display: 'inline-block', fontSize: '0.7rem', opacity: 0.7, marginBottom: '0.8rem', cursor: 'pointer' }}>
                          {stagingChordsUploading ? '⏳ Bezig met uploaden...' : '📎 of upload een akkoordenbestand (.txt/.pdf)'}
                          <input
                            type="file"
                            accept=".txt,.pdf"
                            onChange={e => stagingChordsFileSelected(e.target.files?.[0] || null)}
                            disabled={stagingChordsUploading}
                            style={{ display: 'none' }}
                          />
                        </label>
                      </>
                    )}
                    {staging.youtubeUrl && (
                      <div style={{ fontSize: '0.75rem', marginBottom: '0.8rem' }}>
                        🎥 <a href={staging.youtubeUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)' }}>
                          YouTube-referentie bekijken
                        </a>
                        <span style={{ opacity: 0.5 }}> (aanpassen via Beheer → Catalogus)</span>
                      </div>
                    )}
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
            ))}
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
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.9rem' }}>
                          {contactsByRole[role].map(c => (
                            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                              <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', opacity: c.email ? 1 : 0.4, cursor: c.email ? 'pointer' : 'default' }}>
                                <input
                                  type="checkbox"
                                  checked={selectedRecipientIds.includes(c.id)}
                                  onChange={() => toggleRecipient(c.id)}
                                  disabled={!c.email}
                                />
                                {c.name}{!c.email && ' (geen e-mail)'}
                              </label>
                              {c.email && (
                                <label
                                  style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.7rem', opacity: 0.7, cursor: 'pointer' }}
                                  title="Antwoorden op deze e-mail gaan naar dit adres"
                                >
                                  <input type="checkbox" checked={replyToIds.includes(c.id)} onChange={() => toggleReplyTo(c.id)} />
                                  ↩️ antwoord aan
                                </label>
                              )}
                            </div>
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
                      <input type="checkbox" checked={includeText} onChange={e => setIncludeText(e.target.checked)} />
                      Songtekst (.txt) bijvoegen
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', margin: '0.6rem 0' }}>
                      <input type="checkbox" checked={includePdf} onChange={e => setIncludePdf(e.target.checked)} />
                      PDF bijvoegen
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', margin: '0.6rem 0' }}>
                      <input type="checkbox" checked={includeChords} onChange={e => setIncludeChords(e.target.checked)} />
                      Akkoorden bijvoegen
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', margin: '0.6rem 0' }}>
                      <input type="checkbox" checked={includeYoutube} onChange={e => setIncludeYoutube(e.target.checked)} />
                      YouTube bijvoegen
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
                        <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.7rem', opacity: 0.6 }}>Akkoorden (optioneel)</label>
                        {editChordsFilePath ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem', fontSize: '0.8rem', background: 'rgba(255,255,255,0.05)', borderRadius: '6px', padding: '0.5rem 0.7rem' }}>
                            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📎 {editChordsFileName}</span>
                            <button
                              type="button"
                              onClick={() => { setEditChordsFilePath(''); setEditChordsFileName(''); }}
                              title="Bestand verwijderen"
                              style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.8rem' }}
                            >
                              🗑️
                            </button>
                          </div>
                        ) : (
                          <>
                            <textarea
                              className="input"
                              value={editChords}
                              onChange={e => setEditChords(e.target.value)}
                              rows={5}
                              placeholder={'bv.\nG            D\nAmazing grace, how sweet the sound'}
                              style={{ width: '100%', marginBottom: '0.4rem', fontFamily: 'monospace', resize: 'vertical' }}
                            />
                            <label style={{ display: 'inline-block', fontSize: '0.7rem', opacity: 0.7, marginBottom: '0.6rem', cursor: 'pointer' }}>
                              {editChordsUploading ? '⏳ Bezig met uploaden...' : '📎 of upload een akkoordenbestand (.txt/.pdf)'}
                              <input
                                type="file"
                                accept=".txt,.pdf"
                                onChange={e => editChordsFileSelected(e.target.files?.[0] || null)}
                                disabled={editChordsUploading}
                                style={{ display: 'none' }}
                              />
                            </label>
                          </>
                        )}
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

            {draft && (draft.scriptures.length > 0 || draft.media.length > 0) && (
              <div style={{ marginTop: '1.5rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                {draft.scriptures.length > 0 && (
                  <div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.6rem' }}>📖 Bijbelteksten ({draft.scriptures.length})</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      {draft.scriptures.map(s => (
                        <div key={s.id} className="glass-card" style={{ padding: '0.5rem 0.7rem', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ fontSize: '0.8rem' }}>{s.book} {s.chapter}:{s.verseStart}{s.verseEnd ? `-${s.verseEnd}` : ''} ({s.translation})</span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
                            {sectionBadge(s.section)}
                            <button
                              onClick={() => removeItem('scripture', s.id)}
                              disabled={deletingId === s.id}
                              title="Deze bijbeltekst verwijderen"
                              style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.8rem', padding: '0 0.2rem' }}
                            >
                              {deletingId === s.id ? '...' : '🗑️'}
                            </button>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {draft.media.length > 0 && (
                  <div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.6rem' }}>🎬 Media ({draft.media.length})</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      {draft.media.map(m => (
                        <div key={m.id} className="glass-card" style={{ padding: '0.5rem 0.7rem', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ fontSize: '0.8rem' }} title={m.url || m.attachmentName}>
                            {m.mediaType === 'youtube' ? '▶️ YouTube' : m.mediaType === 'attachment' ? `📎 ${m.attachmentName}${m.filePath ? '' : ' (niet gevonden)'}` : '🔗 Link'}
                          </span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
                            {sectionBadge(m.section)}
                            <button
                              onClick={() => removeItem('media', m.id)}
                              disabled={deletingId === m.id}
                              title="Deze media verwijderen"
                              style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.8rem', padding: '0 0.2rem' }}
                            >
                              {deletingId === m.id ? '...' : '🗑️'}
                            </button>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {sendPreview && (
        <div className="setlist-preview-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
          <div className="glass-card" style={{ padding: '1.5rem', maxWidth: '560px', width: '100%', maxHeight: '85vh', overflowY: 'auto', background: '#0f172a', border: '1px solid rgba(56,189,248,0.3)' }}>
            <h3 style={{ marginTop: 0, marginBottom: '1rem' }}>📧 Controleer voor je verstuurt</h3>
            <p style={{ fontSize: '0.75rem', opacity: 0.6, marginTop: '-0.6rem', marginBottom: '1rem' }}>
              Onderwerp en bericht zijn hieronder aan te passen — de wijzigingen worden meegestuurd.
            </p>

            <div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '0.2rem' }}>Aan</div>
            <div style={{ fontSize: '0.85rem', marginBottom: '0.8rem' }}>
              {sendPreview.to.map(r => `${r.name} <${r.email}>`).join(', ')}
            </div>

            {sendPreview.replyTo.length > 0 && (
              <>
                <div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '0.2rem' }}>Antwoord aan</div>
                <div style={{ fontSize: '0.85rem', marginBottom: '0.8rem' }}>
                  {sendPreview.replyTo.map(r => `${r.name} <${r.email}>`).join(', ')}
                </div>
              </>
            )}

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

      <style jsx>{`
        @media (max-width: 700px) {
          .setlist-builder {
            padding: 1.2rem !important;
          }
          .setlist-columns {
            grid-template-columns: 1fr !important;
          }
          .setlist-preview-overlay {
            padding: 0.75rem !important;
          }
        }
      `}</style>
    </div>
  );
}
