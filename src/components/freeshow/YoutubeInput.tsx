"use client";
import React from 'react';

interface YoutubeInputProps {
  youtubeUrl: string;
  setYoutubeUrl: (value: string) => void;
  isDownloading: boolean;
  onAddYoutube: () => void;
  t: (key: string) => string;
}

export default function YoutubeInput({
  youtubeUrl,
  setYoutubeUrl,
  isDownloading,
  onAddYoutube,
  t
}: YoutubeInputProps) {
  return (
    <div>
      <input
        type="text"
        className="input"
        value={youtubeUrl}
        onChange={e => setYoutubeUrl(e.target.value)}
        placeholder={t('youtube_placeholder')}
      />
      <button
        className="button"
        style={{ width: '100%', marginTop: '0.5rem' }}
        onClick={onAddYoutube}
        disabled={isDownloading}
      >
        {isDownloading ? t('downloading') : `⬇️ ${t('download_add')}`}
      </button>
    </div>
  );
}
