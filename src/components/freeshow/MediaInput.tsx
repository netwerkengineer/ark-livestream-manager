"use client";
import React from 'react';

interface MediaInputProps {
  mediaFile: File | null;
  setMediaFile: (file: File | null) => void;
  mediaPlacementMode: 'direct' | 'show';
  setMediaPlacementMode: (mode: 'direct' | 'show') => void;
  mediaLayer: 'foreground' | 'background';
  setMediaLayer: (layer: 'foreground' | 'background') => void;
  mediaShowName: string;
  setMediaShowName: (name: string) => void;
  mediaAttachTarget: number | null;
  setMediaAttachTarget: (id: number | null) => void;
  mediaTargetMode: 'swap' | 'append';
  items: any[];
  onUpload: (isForeground: boolean) => void;
  t: (key: string) => string;
}

export default function MediaInput({
  mediaFile,
  setMediaFile,
  mediaPlacementMode,
  setMediaPlacementMode,
  mediaLayer,
  setMediaLayer,
  mediaShowName,
  setMediaShowName,
  mediaAttachTarget,
  setMediaAttachTarget,
  mediaTargetMode,
  items,
  onUpload,
  t
}: MediaInputProps) {
  return (
    <div>
      <input
        type="file"
        accept="image/*,video/*"
        onChange={e => setMediaFile(e.target.files?.[0] || null)}
        className="input"
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
        <div className="input-group">
          <label style={{ fontSize: '0.65rem', marginBottom: '0.2rem', display: 'block' }}>
            {t('placement')}
          </label>
          <div style={{ display: 'flex', gap: '2px', background: 'rgba(255,255,255,0.05)', padding: '2px', borderRadius: '4px' }}>
            <button
              onClick={() => setMediaPlacementMode('direct')}
              title={t('place_direct')}
              style={{
                flex: 1,
                padding: '4px',
                fontSize: '0.55rem',
                border: 'none',
                borderRadius: '3px',
                cursor: 'pointer',
                background: mediaPlacementMode === 'direct' ? 'var(--primary)' : 'transparent'
              }}
            >
              {t('file')}
            </button>
            <button
              onClick={() => setMediaPlacementMode('show')}
              title={t('place_in_show')}
              style={{
                flex: 1,
                padding: '4px',
                fontSize: '0.55rem',
                border: 'none',
                borderRadius: '3px',
                cursor: 'pointer',
                background: mediaPlacementMode === 'show' ? 'var(--primary)' : 'transparent'
              }}
            >
              {t('show')}
            </button>
          </div>
        </div>
        <div className="input-group">
          <label style={{ fontSize: '0.65rem', marginBottom: '0.2rem', display: 'block' }}>
            {t('layer_role')}
          </label>
          <div style={{ display: 'flex', gap: '2px', background: 'rgba(255,255,255,0.05)', padding: '2px', borderRadius: '4px' }}>
            <button
              onClick={() => setMediaLayer('foreground')}
              title={t('foreground_layer')}
              style={{
                flex: 1,
                padding: '4px',
                fontSize: '0.6rem',
                border: 'none',
                borderRadius: '3px',
                cursor: 'pointer',
                background: mediaLayer === 'foreground' ? 'var(--primary)' : 'transparent'
              }}
            >
              {t('foreground')}
            </button>
            <button
              onClick={() => setMediaLayer('background')}
              title={t('background_layer')}
              style={{
                flex: 1,
                padding: '4px',
                fontSize: '0.6rem',
                border: 'none',
                borderRadius: '3px',
                cursor: 'pointer',
                background: mediaLayer === 'background' ? 'var(--primary)' : 'transparent'
              }}
            >
              {t('background')}
            </button>
          </div>
        </div>
      </div>

      {mediaPlacementMode === 'show' && (
        <div className="input-group" style={{ marginBottom: '0.5rem' }}>
          <label style={{ fontSize: '0.65rem', marginBottom: '0.2rem', display: 'block' }}>
            {t('show_name_optional')}
          </label>
          <input
            type="text"
            className="input"
            value={mediaShowName}
            onChange={e => setMediaShowName(e.target.value)}
            placeholder={t('own_name')}
            style={{ fontSize: '0.8rem', marginBottom: 0 }}
          />
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button
          className="button"
          style={{ flex: 1, fontSize: '0.75rem' }}
          onClick={() => onUpload(true)}
          disabled={!mediaFile}
          title={t('upload_to_staging')}
        >
          {t('upload')}
        </button>
        <button
          className="button"
          style={{ flex: 1, fontSize: '0.75rem', background: 'rgba(255,255,255,0.1)' }}
          onClick={() => onUpload(false)}
          disabled={!mediaFile || (!mediaAttachTarget && mediaTargetMode !== 'append')}
          title={t('attach_to_item')}
        >
          {mediaTargetMode === 'append' ? t('add_slide') : t('attach_media')}
        </button>
      </div>
      {mediaFile && mediaTargetMode === 'swap' && (
        <select
          className="input"
          style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}
          value={mediaAttachTarget || ''}
          onChange={e => setMediaAttachTarget(Number(e.target.value))}
        >
          <option value="">-- {t('choose_item_for_bg')} --</option>
          {items.filter(i => i.type === 'song' || i.source === 'template').map(i => (
            <option key={i.id} value={i.id}>
              {i.title || i.name || i.ref}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
