"use client";
import React, { useEffect, useRef } from 'react';
import {
  resolveMediaPath,
  getOrderedSlides,
  getSlideBackground,
  applyTemplateToSlide,
  getContainerStyle,
  getLineStyle,
  getSegmentStyle,
  getItemType
} from '@/lib/freeshowUtils';

interface PreviewModalProps {
  previewShow: any | null;
  /** bestandsnaam van de show (voor het opslaan van arrangementen) */
  showFilename?: string | null;
  /** nieuwe versie van de show na het aanpassen van arrangementen */
  onShowUpdated?: (show: any) => void;
  templates: any[];
  selectedPreviewTemplate: any | null;
  setSelectedPreviewTemplate: (template: any | null) => void;
  currentPreviewSlideIdx: number;
  setCurrentPreviewSlideIdx: (idx: number | ((prev: number) => number)) => void;
  onClose: () => void;
}

export default function PreviewModal({
  previewShow: baseShow,
  showFilename,
  onShowUpdated,
  templates,
  selectedPreviewTemplate,
  setSelectedPreviewTemplate,
  currentPreviewSlideIdx,
  setCurrentPreviewSlideIdx,
  onClose
}: PreviewModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scaleFactor, setScaleFactor] = React.useState(1);

  // Arrangement (layout) dat in het voorbeeld getoond wordt; standaard het actieve arrangement van de show
  const [layoutId, setLayoutId] = React.useState<string | null>(null);
  const [editor, setEditor] = React.useState<null | { mode: 'create' | 'edit'; name: string; notes: string; entries: any[] }>(null);
  const [addSlideId, setAddSlideId] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState('');

  const layouts: [string, any][] = baseShow?.layouts ? Object.entries(baseShow.layouts) : [];
  const effectiveLayoutId = layoutId && baseShow?.layouts?.[layoutId] ? layoutId : (baseShow?.settings?.activeLayout || layouts[0]?.[0] || null);
  const previewShow = React.useMemo(() => {
    if (!baseShow) return null;
    return { ...baseShow, settings: { ...(baseShow.settings || {}), activeLayout: effectiveLayoutId } };
  }, [baseShow, effectiveLayoutId]);
  const protectedLayout = effectiveLayoutId ? String(baseShow?.layouts?.[effectiveLayoutId]?.name) === 'Tracks' : false;

  const slideLabel = (slideId: string): string => {
    const sl = baseShow?.slides?.[slideId];
    if (!sl) return slideId;
    if (sl.group) return String(sl.group);
    const first = sl.items?.map((it: any) => (it.lines || []).map((ln: any) => (ln.text || []).map((t: any) => t.value).join('')).join(' ')).join(' ').trim();
    return first ? first.slice(0, 40) : '(lege dia)';
  };
  const parentSlideIds = (): string[] => {
    const children = new Set<string>();
    for (const sl of Object.values<any>(baseShow?.slides || {})) for (const c of (sl.children || [])) children.add(c);
    return Object.keys(baseShow?.slides || {}).filter(id => !children.has(id));
  };

  const callLayouts = async (payload: any) => {
    if (!showFilename) { setNote('❌ Bestandsnaam van de show onbekend'); return null; }
    setBusy(true);
    try {
      const res = await fetch(`/api/shows/${encodeURIComponent(showFilename)}/layouts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!data.success) { setNote('❌ ' + (data.error || 'Opslaan mislukt')); return null; }
      onShowUpdated?.(data.show[1]);
      return data;
    } catch (e: any) {
      setNote('❌ ' + (e?.message || 'Verbindingsfout'));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const startCreate = () => {
    const current = effectiveLayoutId ? baseShow.layouts[effectiveLayoutId] : null;
    setEditor({ mode: 'create', name: 'Nieuw arrangement', notes: '', entries: JSON.parse(JSON.stringify(current?.slides || [])) });
    setNote('');
  };
  const startEdit = () => {
    const current = effectiveLayoutId ? baseShow.layouts[effectiveLayoutId] : null;
    if (!current) return;
    setEditor({ mode: 'edit', name: String(current.name || ''), notes: String(current.notes || ''), entries: JSON.parse(JSON.stringify(current.slides || [])) });
    setNote('');
  };
  const saveEditor = async () => {
    if (!editor) return;
    const data = editor.mode === 'create'
      ? await callLayouts({ action: 'create', name: editor.name, notes: editor.notes, slides: editor.entries })
      : await callLayouts({ action: 'update', layoutId: effectiveLayoutId, name: editor.name, notes: editor.notes, slides: editor.entries });
    if (data) {
      setLayoutId(data.layoutId);
      setCurrentPreviewSlideIdx(0);
      setEditor(null);
      setNote('✅ Opgeslagen. Doe een sync om het arrangement op de Beamer-pc te krijgen (sluit FreeShow eerst).');
    }
  };
  const deleteCurrent = async () => {
    if (!effectiveLayoutId) return;
    const name = String(baseShow.layouts[effectiveLayoutId]?.name || '');
    if (!window.confirm(`Arrangement "${name}" verwijderen? De dia's zelf blijven bestaan.`)) return;
    const data = await callLayouts({ action: 'delete', layoutId: effectiveLayoutId });
    if (data) { setLayoutId(null); setCurrentPreviewSlideIdx(0); setNote('✅ Arrangement verwijderd.'); }
  };
  const moveEntry = (i: number, d: number) => setEditor(ed => {
    if (!ed) return ed;
    const j = i + d; if (j < 0 || j >= ed.entries.length) return ed;
    const next = [...ed.entries]; [next[i], next[j]] = [next[j], next[i]];
    return { ...ed, entries: next };
  });

  // Notitie bij de getoonde dia (hoort bij de dia zelf, dus in elk arrangement hetzelfde)
  const [noteEditing, setNoteEditing] = React.useState(false);
  const [noteDraft, setNoteDraft] = React.useState('');
  const currentLayoutSlide = previewShow ? getOrderedSlides(previewShow)[currentPreviewSlideIdx] : null;
  const currentSlideId: string | null = currentLayoutSlide?.id ?? null;
  const currentNote: string = currentSlideId ? String(baseShow?.slides?.[currentSlideId]?.notes || '') : '';
  const slidesWithNotes = Object.values<any>(baseShow?.slides || {}).filter(sl => String(sl?.notes || '').trim()).length;
  useEffect(() => { setNoteEditing(false); }, [currentPreviewSlideIdx, effectiveLayoutId, baseShow?.name]);
  const saveNote = async () => {
    if (!currentSlideId || !showFilename) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/shows/${encodeURIComponent(showFilename)}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slideId: currentSlideId, notes: noteDraft }) });
      const data = await res.json();
      if (!data.success) { setNote('❌ ' + (data.error || 'Notitie opslaan mislukt')); return; }
      onShowUpdated?.(data.show[1]);
      setNoteEditing(false);
      setNote(noteDraft.trim() ? '✅ Notitie opgeslagen. Doe een sync om hem op de Beamer-pc te krijgen (sluit FreeShow eerst).' : '✅ Notitie gewist.');
    } catch (e: any) {
      setNote('❌ ' + (e?.message || 'Verbindingsfout'));
    } finally {
      setBusy(false);
    }
  };

  // andere show of ander arrangement: bewerkpaneel sluiten
  useEffect(() => { setLayoutId(null); setEditor(null); setNote(''); }, [baseShow?.name]);

  // Resize listener for scaling the slide preview container
  useEffect(() => {
    if (!previewShow || !containerRef.current) return;
    const updateScale = () => {
      if (containerRef.current) {
        const width = containerRef.current.clientWidth;
        setScaleFactor(width / 1920);
      }
    };
    updateScale();
    const observer = new ResizeObserver(() => {
      updateScale();
    });
    observer.observe(containerRef.current);
    window.addEventListener('resize', updateScale);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateScale);
    };
  }, [previewShow]);

  // Keyboard navigation for Slide Preview
  useEffect(() => {
    if (!previewShow) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;   // tijdens het typen van een notitie niet bladeren of sluiten
      const ordered = getOrderedSlides(previewShow);
      if (e.key === 'ArrowLeft') {
        setCurrentPreviewSlideIdx(prev => Math.max(0, prev - 1));
      } else if (e.key === 'ArrowRight') {
        setCurrentPreviewSlideIdx(prev => Math.min(ordered.length - 1, prev + 1));
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [previewShow, onClose, setCurrentPreviewSlideIdx]);

  if (!previewShow) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
      <div className="glass-card" style={{ width: '100%', maxWidth: '1100px', display: 'flex', flexDirection: 'column', padding: '2rem', gap: '1.5rem' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '1rem' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.4rem', color: 'var(--primary)' }}>👁️ Show Preview</h2>
            <div style={{ fontSize: '0.8rem', opacity: 0.5, marginTop: '0.2rem' }}>Show: {previewShow.name}</div>
          </div>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            {/* Template Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>Template:</span>
              <select
                className="input"
                style={{ margin: 0, padding: '0.3rem 1.5rem 0.3rem 0.75rem', fontSize: '0.85rem', width: '220px' }}
                value={selectedPreviewTemplate ? selectedPreviewTemplate.filename : ''}
                onChange={e => {
                  const templateFile = e.target.value;
                  if (!templateFile) {
                    setSelectedPreviewTemplate(null);
                  } else {
                    const found = templates.find(t => t.filename === templateFile);
                    setSelectedPreviewTemplate(found || null);
                  }
                }}
              >
                <option value="">Standaard (Geen Template)</option>
                {templates.map(t => (
                  <option key={t.filename} value={t.filename}>{t.name}</option>
                ))}
              </select>
            </div>
            <button className="button" style={{ background: 'rgba(255,255,255,0.1)', padding: '0.5rem 1rem' }} onClick={onClose}>Sluiten</button>
          </div>
        </div>

        {/* Arrangementen (layouts) van deze show */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>Arrangement:</span>
          {layouts.map(([lid, l]) => (
            <button
              key={lid}
              className="button"
              style={{ padding: '0.3rem 0.8rem', fontSize: '0.8rem', background: lid === effectiveLayoutId ? 'var(--primary)' : 'rgba(255,255,255,0.08)', color: lid === effectiveLayoutId ? '#020617' : '#fff' }}
              onClick={() => { setLayoutId(lid); setCurrentPreviewSlideIdx(0); setEditor(null); setNote(''); }}
            >
              {l.name || '(zonder naam)'}{String(l.name) === 'Tracks' ? ' 🎚️' : ''} <span style={{ opacity: 0.6 }}>({(l.slides || []).length})</span>
            </button>
          ))}
          {showFilename && (
            <>
              <button className="button" style={{ padding: '0.3rem 0.8rem', fontSize: '0.8rem', background: 'rgba(255,255,255,0.08)' }} onClick={startCreate} disabled={busy}>➕ Nieuw arrangement</button>
              {!protectedLayout && effectiveLayoutId && (
                <>
                  <button className="button" style={{ padding: '0.3rem 0.8rem', fontSize: '0.8rem', background: 'rgba(255,255,255,0.08)' }} onClick={startEdit} disabled={busy}>✏️ Bewerken</button>
                  <button className="button" style={{ padding: '0.3rem 0.8rem', fontSize: '0.8rem', background: 'rgba(239,68,68,0.25)' }} onClick={deleteCurrent} disabled={busy}>🗑️ Verwijderen</button>
                </>
              )}
            </>
          )}
          {protectedLayout && <span style={{ fontSize: '0.75rem', opacity: 0.6 }}>Dit arrangement hoort bij de Tracks-tab (alleen bekijken)</span>}
          {note && <span style={{ fontSize: '0.8rem' }}>{note}</span>}
        </div>

        {!editor && effectiveLayoutId && String(baseShow?.layouts?.[effectiveLayoutId]?.notes || '').trim() && (
          <div style={{ fontSize: '0.8rem', opacity: 0.7, whiteSpace: 'pre-wrap' }}>📝 Notitie bij dit arrangement: {String(baseShow.layouts[effectiveLayoutId].notes)}</div>
        )}

        {editor && (
          <div style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: '12px', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <span style={{ fontSize: '0.85rem' }}>{editor.mode === 'create' ? 'Nieuw arrangement (start als kopie van het getoonde arrangement)' : 'Arrangement bewerken'}</span>
              <input className="input" style={{ margin: 0, padding: '0.3rem 0.6rem', width: '260px' }} value={editor.name} onChange={e => setEditor({ ...editor, name: e.target.value })} placeholder="Naam" />
            </div>
            <textarea className="input" style={{ margin: 0, padding: '0.4rem 0.6rem', minHeight: '52px', fontSize: '0.8rem', resize: 'vertical' }} value={editor.notes} onChange={e => setEditor({ ...editor, notes: e.target.value })} placeholder="Notitie bij dit arrangement (optioneel)" maxLength={4000} />
            <div style={{ maxHeight: '220px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              {editor.entries.map((entry, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', background: 'rgba(255,255,255,0.04)', borderRadius: '6px', padding: '0.2rem 0.5rem' }}>
                  <span style={{ opacity: 0.5, width: '1.8rem' }}>{i + 1}</span>
                  <span style={{ flex: 1 }}>{slideLabel(entry.id)}</span>
                  <button className="button" style={{ padding: '0 0.5rem' }} onClick={() => moveEntry(i, -1)} disabled={i === 0}>↑</button>
                  <button className="button" style={{ padding: '0 0.5rem' }} onClick={() => moveEntry(i, 1)} disabled={i === editor.entries.length - 1}>↓</button>
                  <button className="button" style={{ padding: '0 0.5rem', background: 'rgba(239,68,68,0.25)' }} onClick={() => setEditor({ ...editor, entries: editor.entries.filter((_, k) => k !== i) })}>✕</button>
                </div>
              ))}
              {editor.entries.length === 0 && <div style={{ opacity: 0.5, fontSize: '0.8rem' }}>Nog geen dia's: voeg er hieronder een toe.</div>}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <select className="input" style={{ margin: 0, padding: '0.3rem 0.6rem', width: '320px' }} value={addSlideId} onChange={e => setAddSlideId(e.target.value)}>
                <option value="">Dia toevoegen…</option>
                {parentSlideIds().map(id => <option key={id} value={id}>{slideLabel(id)}</option>)}
              </select>
              <button className="button" style={{ padding: '0.3rem 0.8rem', fontSize: '0.8rem' }} disabled={!addSlideId} onClick={() => { setEditor({ ...editor, entries: [...editor.entries, { id: addSlideId }] }); setAddSlideId(''); }}>Toevoegen</button>
              <span style={{ flex: 1 }} />
              <button className="button" style={{ padding: '0.3rem 1rem', background: 'var(--primary)', color: '#020617' }} onClick={saveEditor} disabled={busy || !editor.name.trim()}>{busy ? 'Bezig…' : 'Opslaan'}</button>
              <button className="button" style={{ padding: '0.3rem 1rem', background: 'rgba(255,255,255,0.08)' }} onClick={() => setEditor(null)} disabled={busy}>Annuleren</button>
            </div>
          </div>
        )}

        {/* Main Carousel Area */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', justifyContent: 'center' }}>
          {/* Prev Button */}
          <button
            className="button"
            style={{
              borderRadius: '50%',
              width: '50px',
              height: '50px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: currentPreviewSlideIdx > 0 ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.02)',
              color: currentPreviewSlideIdx > 0 ? '#fff' : 'rgba(255,255,255,0.2)',
              cursor: currentPreviewSlideIdx > 0 ? 'pointer' : 'default',
              border: '1px solid rgba(255,255,255,0.05)',
              fontSize: '1.5rem',
              padding: 0
            }}
            disabled={currentPreviewSlideIdx === 0}
            onClick={() => setCurrentPreviewSlideIdx(prev => Math.max(0, prev - 1))}
          >
            ‹
          </button>

          {/* Slide Wrapper Container */}
          <div style={{ flex: 1, maxWidth: '850px' }}>
            {(() => {
              const ordered = getOrderedSlides(previewShow);
              const layoutSlide = ordered[currentPreviewSlideIdx];
              if (!layoutSlide) {
                return <div style={{ aspectRatio: '16/9', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5 }}>Geen slides gevonden</div>;
              }

              const rawSlide = previewShow.slides[layoutSlide.id];
              if (!rawSlide) {
                return <div style={{ aspectRatio: '16/9', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5 }}>Slide data ontbreekt</div>;
              }

              const slide = applyTemplateToSlide(rawSlide, selectedPreviewTemplate);
              const bgMedia = getSlideBackground(previewShow, currentPreviewSlideIdx);

              return (
                <div ref={containerRef} style={{ width: '100%', aspectRatio: '16/9', overflow: 'hidden', position: 'relative', background: '#000', borderRadius: '12px', boxShadow: '0 20px 50px rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.1)' }}>
                  <div style={{
                    width: '1920px',
                    height: '1080px',
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    transform: `scale(${scaleFactor})`,
                    transformOrigin: 'top left',
                    color: '#fff',
                    fontFamily: 'sans-serif',
                    userSelect: 'none'
                  }}>
                    {/* Background media */}
                    {bgMedia && (
                      <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
                        {bgMedia.type === 'video' || bgMedia.path?.toLowerCase().endsWith('.mp4') ? (
                          <video src={resolveMediaPath(bgMedia.path)} autoPlay muted loop style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <img src={resolveMediaPath(bgMedia.path)} alt="Background" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        )}
                      </div>
                    )}

                    {/* Slide items */}
                    <div style={{ position: 'absolute', inset: 0, zIndex: 1 }}>
                      {slide.items && slide.items.map((item: any, itemIdx: number) => {
                        const itemType = getItemType(item);
                        if (itemType === 'media') {
                          return (
                            <div key={item.id || itemIdx} style={getContainerStyle(item)}>
                              {item.src && (
                                item.src.toLowerCase().endsWith('.mp4') || item.src.toLowerCase().endsWith('.mov') ? (
                                  <video src={resolveMediaPath(item.src)} autoPlay muted loop style={{ width: '100%', height: '100%', objectFit: item.fit || 'contain' }} />
                                ) : (
                                  <img src={resolveMediaPath(item.src)} alt="Media" style={{ width: '100%', height: '100%', objectFit: item.fit || 'contain' }} />
                                )
                              )}
                            </div>
                          );
                        }

                        if (itemType === 'text') {
                          return (
                            <div key={item.id || itemIdx} style={getContainerStyle(item)}>
                              {item.lines && item.lines.map((line: any, lineIdx: number) => (
                                <div key={lineIdx} style={{ display: 'flex', flexWrap: 'wrap', width: '100%', ...getLineStyle(line, item.align) }}>
                                  {line.text && line.text.map((seg: any, segIdx: number) => (
                                    <span key={segIdx} style={getSegmentStyle(seg)}>
                                      {seg.value}
                                    </span>
                                  ))}
                                </div>
                              ))}
                            </div>
                          );
                        }

                        return null;
                      })}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Next Button */}
          <button
            className="button"
            style={{
              borderRadius: '50%',
              width: '50px',
              height: '50px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: currentPreviewSlideIdx < getOrderedSlides(previewShow).length - 1 ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.02)',
              color: currentPreviewSlideIdx < getOrderedSlides(previewShow).length - 1 ? '#fff' : 'rgba(255,255,255,0.2)',
              cursor: currentPreviewSlideIdx < getOrderedSlides(previewShow).length - 1 ? 'pointer' : 'default',
              border: '1px solid rgba(255,255,255,0.05)',
              fontSize: '1.5rem',
              padding: 0
            }}
            disabled={currentPreviewSlideIdx === getOrderedSlides(previewShow).length - 1}
            onClick={() => setCurrentPreviewSlideIdx(prev => Math.min(getOrderedSlides(previewShow).length - 1, prev + 1))}
          >
            ›
          </button>
        </div>

        {/* Notitie bij de getoonde dia */}
        <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', padding: '0.8rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.85rem' }}>
            <strong>📝 Notitie bij deze dia</strong>
            <span style={{ opacity: 0.5 }}>{slidesWithNotes > 0 ? `${slidesWithNotes} dia${slidesWithNotes === 1 ? '' : "'s"} in deze show ${slidesWithNotes === 1 ? 'heeft' : 'hebben'} een notitie` : 'nog geen notities in deze show'}</span>
            <span style={{ flex: 1 }} />
            {showFilename && currentSlideId && !noteEditing && (
              <button className="button" style={{ padding: '0.25rem 0.8rem', fontSize: '0.8rem', background: 'rgba(255,255,255,0.08)' }} disabled={busy} onClick={() => { setNoteDraft(currentNote); setNoteEditing(true); setNote(''); }}>
                {currentNote ? '✏️ Aanpassen' : '➕ Notitie toevoegen'}
              </button>
            )}
          </div>
          {noteEditing ? (
            <>
              <textarea className="input" autoFocus style={{ margin: 0, padding: '0.5rem 0.7rem', minHeight: '90px', resize: 'vertical' }} value={noteDraft} onChange={e => setNoteDraft(e.target.value)} placeholder="Bijvoorbeeld: stil beginnen, band valt in bij het refrein…" maxLength={4000} />
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="button" style={{ padding: '0.3rem 1rem', background: 'var(--primary)', color: '#020617' }} disabled={busy} onClick={saveNote}>{busy ? 'Bezig…' : 'Opslaan'}</button>
                <button className="button" style={{ padding: '0.3rem 1rem', background: 'rgba(255,255,255,0.08)' }} disabled={busy} onClick={() => setNoteEditing(false)}>Annuleren</button>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: '0.75rem', opacity: 0.5 }}>Leeg opslaan wist de notitie</span>
              </div>
            </>
          ) : (
            <div style={{ fontSize: '0.9rem', whiteSpace: 'pre-wrap', opacity: currentNote ? 1 : 0.4 }}>{currentNote || 'Geen notitie bij deze dia.'}</div>
          )}
        </div>

        {/* Footer / Info */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '1rem', fontSize: '0.85rem' }}>
          <div style={{ opacity: 0.5 }}>
            Gebruik de <kbd style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 5px', borderRadius: '3px', fontFamily: 'monospace' }}>←</kbd> en <kbd style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 5px', borderRadius: '3px', fontFamily: 'monospace' }}>→</kbd> toetsen om te bladeren.
          </div>
          <div style={{ fontWeight: 'bold', color: 'var(--primary)' }}>
            Slide {currentPreviewSlideIdx + 1} / {getOrderedSlides(previewShow).length}
          </div>
        </div>
      </div>
    </div>
  );
}
