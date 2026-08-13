"use client";
import React from 'react';

interface SectionInputProps {
  sectionName: string;
  setSectionName: (name: string) => void;
  sectionColor: string;
  setSectionColor: (color: string) => void;
  onAddSection: () => void;
  t: (key: string) => string;
}

export default function SectionInput({
  sectionName,
  setSectionName,
  sectionColor,
  setSectionColor,
  onAddSection,
  t
}: SectionInputProps) {
  return (
    <div>
      <input
        type="text"
        className="input"
        value={sectionName}
        onChange={e => setSectionName(e.target.value)}
        placeholder={t('section_title')}
      />
      <input
        type="color"
        className="input"
        value={sectionColor}
        onChange={e => setSectionColor(e.target.value)}
        style={{ height: '40px', marginTop: '0.5rem' }}
      />
      {sectionName && (
        <div style={{ marginTop: '1rem', padding: '0.5rem', background: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
          <label style={{ fontSize: '0.65rem', marginBottom: '0.4rem' }}>{t('preview')}:</label>
          <div style={{
            width: '100%',
            borderBottom: `2px solid ${sectionColor}`,
            color: sectionColor,
            fontWeight: 'bold',
            fontSize: '0.9rem'
          }}>
            {sectionName.toUpperCase()}
          </div>
        </div>
      )}
      <button
        className="button"
        style={{ width: '100%', marginTop: '1rem' }}
        onClick={onAddSection}
        title={t('add_section_to_playlist')}
      >
        + {t('add_section')}
      </button>
    </div>
  );
}
