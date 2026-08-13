"use client";
import React from 'react';
import { BIBLE_BOOKS } from '@/lib/freeshowUtils';

interface BibleInputProps {
  bibleTranslation: string;
  setBibleTranslation: (value: string) => void;
  bibleBook: string;
  setBibleBook: (value: string) => void;
  bibleChapter: string;
  setBibleChapter: (value: string) => void;
  bibleVerseStart: string;
  setBibleVerseStart: (value: string) => void;
  bibleVerseEnd: string;
  setBibleVerseEnd: (value: string) => void;
  availableBibles: string[];
  onAddBible: () => void;
  t: (key: string) => string;
}

export default function BibleInput({
  bibleTranslation,
  setBibleTranslation,
  bibleBook,
  setBibleBook,
  bibleChapter,
  setBibleChapter,
  bibleVerseStart,
  setBibleVerseStart,
  bibleVerseEnd,
  setBibleVerseEnd,
  availableBibles,
  onAddBible,
  t
}: BibleInputProps) {
  return (
    <div>
      <select
        className="input"
        value={bibleTranslation}
        onChange={e => setBibleTranslation(e.target.value)}
      >
        {availableBibles.map(b => <option key={b} value={b}>{b}</option>)}
      </select>
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
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
          value={bibleChapter}
          onChange={e => setBibleChapter(e.target.value)}
          style={{ flex: 1 }}
        />
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
        <input
          type="number"
          className="input"
          value={bibleVerseStart}
          onChange={e => setBibleVerseStart(e.target.value)}
          placeholder={t('from')}
        />
        <input
          type="number"
          className="input"
          value={bibleVerseEnd}
          onChange={e => setBibleVerseEnd(e.target.value)}
          placeholder={t('to')}
        />
      </div>
      <button
        className="button"
        style={{ width: '100%', marginTop: '0.5rem' }}
        onClick={onAddBible}
        title={t('add_bible_to_staging')}
      >
        + {t('add_bible')}
      </button>
    </div>
  );
}
