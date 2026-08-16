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
  templates: any[];
  selectedPreviewTemplate: any | null;
  setSelectedPreviewTemplate: (template: any | null) => void;
  currentPreviewSlideIdx: number;
  setCurrentPreviewSlideIdx: (idx: number | ((prev: number) => number)) => void;
  onClose: () => void;
}

export default function PreviewModal({
  previewShow,
  templates,
  selectedPreviewTemplate,
  setSelectedPreviewTemplate,
  currentPreviewSlideIdx,
  setCurrentPreviewSlideIdx,
  onClose
}: PreviewModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scaleFactor, setScaleFactor] = React.useState(1);

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
