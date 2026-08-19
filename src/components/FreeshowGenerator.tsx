"use client";
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { translations } from '@/lib/translations';
import JSZip from 'jszip';
import PreviewModal from './freeshow/PreviewModal';
import SectionInput from './freeshow/SectionInput';
import SongInput from './freeshow/SongInput';
import PresentationInput from './freeshow/PresentationInput';
import BibleInput from './freeshow/BibleInput';
import YoutubeInput from './freeshow/YoutubeInput';
import MediaInput from './freeshow/MediaInput';
import DatabaseView from './freeshow/DatabaseView';
import {
  BIBLE_BOOKS,
  resolveMediaPath,
  getOrderedSlides,
  getSlideBackground,
  parseStyleString,
  getAlignmentStyle,
  applyTemplateToSlideItem,
  applyTemplateToSlide,
  getContainerStyle,
  getLineStyle,
  getSegmentStyle,
  getTranslatedTitle,
  getCategoryDisplayName,
  reconstructManualItemsFromProject,
  getItemType
} from '@/lib/freeshowUtils';
export default function FreeshowGenerator() {
  const [lang, setLang] = useState<string>('nl');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [saveProjectToNas, setSaveProjectToNas] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [useTemplate, setUseTemplate] = useState(true);

  const t = (key: string) => {
    return translations[lang]?.[key] || translations['en']?.[key] || key;
  };
  
   const [inputType, setInputType] = useState<'song'|'presentation'|'bible'|'media'|'youtube'|'section'|'database'>('song');

  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState({
    freeshowPath: '',
    freeshowProjectPath: '',
    freeshowMediaPath: '',
    imapUser: '', imapPass: '', imapHost: 'imap.gmail.com', imapPort: 993,
    autoSaveToNas: false,
    hasPin: false,
    backupTarget: 'none', // 'none' | 'ftp' | 'webdav'
    ftpHost: '', ftpUser: '', ftpPass: '', ftpPort: 21,
    webdavUrl: '', webdavUser: '', webdavPass: '',
    defaultTemplate: '',
    freeshowTrashPath: ''
  });

  const handlePathChange = (newPath: string) => {
    // Detecteer separator (backslashes voor Windows, forward voor de rest)
    const sep = newPath.includes('\\') ? '\\' : '/';
    const cleanPath = newPath.endsWith(sep) ? newPath.slice(0, -1) : newPath;
    
    setSettings({
      ...settings,
      freeshowPath: newPath,
      freeshowProjectPath: cleanPath + sep + 'projects',
      freeshowMediaPath: cleanPath + sep + 'media',
      freeshowTrashPath: cleanPath + sep + '.trash'
    });
  };

  const [availableProjects, setAvailableProjects] = useState<string[]>([]);
  const [newPassword, setNewPassword] = useState('');

  const [showHelp, setShowHelp] = useState(false);
  const [items, setItems] = useState<any[]>([]); // De gecombineerde lijst voor weergave
  const [manualItems, setManualItems] = useState<any[]>([]);
  const [templateItems, setTemplateItems] = useState<any[]>([]);
  const [draftItem, setDraftItem] = useState<any | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [catalog, setCatalog] = useState<{songs: { name: string, category: string }[], bibles: string[]}>({ songs: [], bibles: [] });
  
  const [songInput, setSongInput] = useState('');
  const [presentationInput, setPresentationInput] = useState('');

  const [bibleTranslation, setBibleTranslation] = useState('BB');
  const [bibleBook, setBibleBook] = useState('Genesis');
  const [bibleChapter, setBibleChapter] = useState('1');
  const [bibleVerseStart, setBibleVerseStart] = useState('1');
  const [bibleVerseEnd, setBibleVerseEnd] = useState('');
  const [bibleVersesPerSlide, setBibleVersesPerSlide] = useState(1);

  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [youtubeName, setYoutubeName] = useState('');

  const [sectionName, setSectionName] = useState('');
  const [sectionColor, setSectionColor] = useState('#38bdf8');

  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaUploadStatus, setMediaUploadStatus] = useState('');
  const [mediaAttachTarget, setMediaAttachTarget] = useState<number | null>(null);
  const [mediaTargetMode, setMediaTargetMode] = useState<'swap' | 'append'>('swap');
  const [mediaTimer, setMediaTimer] = useState<number>(0);
  const [mediaLoop, setMediaLoop] = useState<boolean>(false);
  const [mediaLayer, setMediaLayer] = useState<'foreground' | 'background'>('foreground');
  const [mediaPlacementMode, setMediaPlacementMode] = useState<'direct' | 'show'>('show');
  const [mediaShowName, setMediaShowName] = useState('');
  
  const [builderSlides, setBuilderSlides] = useState<any[]>([]);
  const [builderTitle, setBuilderTitle] = useState('');

  const [templateSections, setTemplateSections] = useState<any[]>([]);
  const [targetSection, setTargetSection] = useState('Laatst gekozen');
  const [insertPosition, setInsertPosition] = useState<'before' | 'after'>('after');
  const [showTextId, setShowTextId] = useState<number | null>(null);

  // Maintenance states
  const [duplicateGroups, setDuplicateGroups] = useState<any[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [comparingPair, setComparingPair] = useState<any[] | null>(null);
  const [catalogSongs, setCatalogSongs] = useState<any[]>([]);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [historyItems, setHistoryItems] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [selectedTrashIds, setSelectedTrashIds] = useState<string[]>([]);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [isSyncing, setIsSyncing] = useState(false);
  const [isDeletingScriptures, setIsDeletingScriptures] = useState(false);

  // Shows Database Dashboard geconsolideerde states
  const [databaseSubTab, setDatabaseSubTab] = useState<'catalog'|'builder'|'maintenance'|'drafts'>('catalog');
  const [showsList, setShowsList] = useState<any[]>([]);
  const [loadingShows, setLoadingShows] = useState(false);
  const [showsSearch, setShowsSearch] = useState('');
  const [showsCategoryFilter, setShowsCategoryFilter] = useState('all');
  const [showsSortOrder, setShowsSortOrder] = useState<'name'|'modified'>('name');

  const [freeshowCategories, setFreeshowCategories] = useState<Record<string, { name: string; icon: string; default?: boolean }>>({
    song: { name: 'category.song', icon: 'song', default: true },
    presentation: { name: 'category.presentation', icon: 'presentation', default: true },
    scripture: { name: 'category.scripture', icon: 'scripture', default: true }
  });

  const [selectedShow, setSelectedShow] = useState<any>(null); // Full JSON array [id, showObj]
  const [showEditorTitle, setShowEditorTitle] = useState('');
  const [showEditorCategory, setShowEditorCategory] = useState('');
  const [showEditorSlides, setShowEditorSlides] = useState<any[]>([]); // Array of { id, nextTimer, slideObj }
  const [showEditorRawJson, setShowEditorRawJson] = useState('');
  const [showEditorMode, setShowEditorMode] = useState<'visual'|'raw'>('visual');
  const [showPasteLyrics, setShowPasteLyrics] = useState(false);
  const [pasteLyricsText, setPasteLyricsText] = useState('');
  const [isParsingLyrics, setIsParsingLyrics] = useState(false);
  const [isSavingShow, setIsSavingShow] = useState(false);

  // Preview & Template States
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedPreviewTemplate, setSelectedPreviewTemplate] = useState<any>(null);
  const [previewShow, setPreviewShow] = useState<any>(null);
  const [currentPreviewSlideIdx, setCurrentPreviewSlideIdx] = useState<number>(0);

  const fetchTemplates = async () => {
    try {
      const res = await fetch('/api/templates');
      const data = await res.json();
      if (data.success) {
        setTemplates(data.templates);
      }
    } catch (err) {
      console.error("Fout bij laden templates:", err);
    }
  };

  const openPreview = async (filename: string) => {
    try {
      setLoadingShows(true);
      const res = await fetch(`/api/shows/${encodeURIComponent(filename)}`);
      const data = await res.json();
      if (data.success) {
        setPreviewShow(data.show[1]);
        setCurrentPreviewSlideIdx(0);
        setSelectedPreviewTemplate(null);
      } else {
        alert(data.error || 'Fout bij laden show-details voor preview');
      }
    } catch (e: any) {
      alert(e.message || 'Verbindingsfout bij laden show-details voor preview');
    } finally {
      setLoadingShows(false);
    }
  };
  // Load language from localStorage
  useEffect(() => {
    const savedLang = localStorage.getItem('freeshow_lang');
    if (savedLang && translations[savedLang]) {
      setLang(savedLang);
    }
  }, []);

  // Save language to localStorage
  useEffect(() => {
    localStorage.setItem('freeshow_lang', lang);
  }, [lang]);

  // Load manualItems and projectName from localStorage on mount
  useEffect(() => {
    const savedItems = localStorage.getItem('freeshow_manual_items');
    if (savedItems) {
      try {
        setManualItems(JSON.parse(savedItems));
      } catch (e) {
        console.error("Failed to parse saved manual items:", e);
      }
    }
    const savedProjectName = localStorage.getItem('freeshow_project_name');
    if (savedProjectName) {
      setProjectName(savedProjectName);
    }
  }, []);

  // Save manualItems to localStorage
  useEffect(() => {
    localStorage.setItem('freeshow_manual_items', JSON.stringify(manualItems));
  }, [manualItems]);

  // Save projectName to localStorage
  useEffect(() => {
    localStorage.setItem('freeshow_project_name', projectName);
  }, [projectName]);

  useEffect(() => {
    if (inputType === 'database' && databaseSubTab === 'catalog') {
      fetchShows();
    } else if (inputType === 'database' && databaseSubTab === 'maintenance') {
      fetchCatalog();
      loadHistory();
    }
  }, [inputType, databaseSubTab]);

  useEffect(() => {
    const init = async () => {
      try {
        const res = await fetch('/api/settings');
        const data = await res.json();
        if (data.freeshowPath) {
          setSettings({ ...settings, ...data });
        }
      } catch (err: any) {
        setErrorMessage(t('error_loading_settings_label') + err.message);
      }
      
      // Laad Template bij opstarten
      try {
        const tRes = await fetch('/api/template');
        const tData = await tRes.json();
        if (tData.shows) {
          const initialTemplate = tData.shows.map((s: any) => ({
            ...s,
            source: 'template',
            isRemoved: false
          }));
          setTemplateItems(initialTemplate);
          const sections = tData.shows.filter((s: any) => s.type === 'section').map((s: any) => s.title);
          setTemplateSections([t('bottom'), ...sections]);
        } else if (tData.error) {
          setErrorMessage(t('template_error_label') + tData.error);
        }
      } catch (err: any) {
        console.error("Template load failed:", err);
        setErrorMessage(t('template_error_label') + err.message);
      }

      refreshCatalog();
      fetchTemplates();
    };
    init();
  }, []);

  // Update gecombineerde items lijst wanneer manualItems, templateItems of useTemplate veranderen
  useEffect(() => {
    if (!useTemplate) {
      setItems(manualItems);
      return;
    }

    const activeTemplate = templateItems.filter(i => !i.isRemoved);
    let combined: any[] = [];
    
    activeTemplate.forEach(tItem => {
      // Voeg items toe die VÓÓR dit item moeten komen
      const beforeMatches = manualItems.filter(m => m.targetSection === tItem.title && m.insertPosition === 'before');
      combined.push(...beforeMatches);
      
      combined.push(tItem);
      
      // Voeg items toe die NÁ dit item moeten komen
      const afterMatches = manualItems.filter(m => m.targetSection === tItem.title && m.insertPosition === 'after');
      combined.push(...afterMatches);
    });

    const remaining = manualItems.filter(m => 
      !m.targetSection || 
      m.targetSection === t('bottom') || 
      !activeTemplate.some(t => t.title === m.targetSection)
    );
    
    setItems([...combined, ...remaining]);
  }, [manualItems, templateItems, useTemplate]);

  // Dynamische lijst van alle beschikbare secties/items voor de dropdown
  const allAvailableSections = React.useMemo(() => {
    const fromTemplate = templateItems.filter(i => !i.isRemoved).map(i => i.title);
    const fromManual = manualItems.filter(i => i.type === 'section').map(i => i.title);
    return Array.from(new Set([t('bottom'), ...fromTemplate, ...fromManual]));
  }, [templateItems, manualItems]);

  const uniqueCategories = React.useMemo(() => {
    // Alleen categorieën met daadwerkelijk shows erin, plus de 3 kern-categorieën
    // die altijd beschikbaar moeten blijven. Categorieën die alleen in FreeShow's
    // config staan (bv. na het samenvoegen van een lege categorie) worden zo
    // automatisch niet meer getoond.
    const categoriesFromShows = showsList.map(s => s.category).filter(Boolean);
    const categoriesFromCatalog = catalogSongs.map(s => s.category).filter(Boolean);
    return Array.from(new Set([
      'song',
      'presentation',
      'scripture',
      ...categoriesFromShows,
      ...categoriesFromCatalog
    ])).filter(c => c !== 'all');
  }, [showsList, catalogSongs]);

  const refreshCatalog = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/catalog');
      const data = await res.json();
      if (data.success) {
        setCatalog(data.catalog);
        setCatalogSongs(data.catalog.songs);
        if (data.categories) {
          setFreeshowCategories(data.categories);
        }
        setErrorMessage('');
      } else {
        setErrorMessage(t('catalog_error_label') + (data.error || 'Onbekende fout'));
      }
    } catch (err: any) {
      setErrorMessage(t('connection_error_label') + err.message);
    }
    setLoading(false);
  };

  const handleSaveSettings = async () => {
    setSaveStatus('saving');
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          ...settings, 
          adminPassword: newPassword 
        })
      });
      const data = await res.json();
      if (data.success) {
        setSaveStatus('success');
        setNewPassword('');
        refreshCatalog();
        setTimeout(() => setSaveStatus('idle'), 3000);
      } else {
        setSaveStatus('error');
        alert(data.error || t('save_settings_btn') + ' ' + t('failed'));
        setTimeout(() => setSaveStatus('idle'), 3000);
      }
    } catch (e) {
      setSaveStatus('error');
      alert(t('settings_error_msg'));
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  const fetchProjects = async () => {
    try {
      const res = await fetch('/api/projects');
      const data = await res.json();
      if (data.success) {
        setAvailableProjects(data.projects);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const toggleSettings = () => {
    if (!showSettings) {
      fetchProjects();
    }
    setShowSettings(!showSettings);
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  };


  const triggerAutoSync = async (currentItems: any[], newItemId?: number) => {
    setLoading(true);
    setStatus(t('loading') + '...');
    try {
      const res = await fetch('/api/preview', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ items: currentItems })
      });
      const data = await res.json();
      if (data.success) {
        setItems(data.items);
        setStatus(t('done'));
        setErrorMessage('');
        if (newItemId) {
          setShowTextId(newItemId);
          if (settings.autoSaveToNas) {
            const newItem = data.items.find((i: any) => i.id === newItemId);
            if (newItem) saveShowToNas(newItem);
          }
        }
      } else {
        setErrorMessage(t('preview_error_label') + (data.error || 'Onbekende fout'));
      }
    } catch (err: any) {
      setErrorMessage(t('connection_error_label') + err.message);
    }
    setLoading(false);
  };

  const saveShowToNas = async (item: any) => {
    try {
      const res = await fetch('/api/save-show', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item, freeshowPath: settings.freeshowPath, saveToNas: true })
      });
      const data = await res.json();
      if (data.success) {
        setStatus(t('server_save_success'));
      } else {
        setErrorMessage(t('server_save_error') + data.error);
      }
    } catch (e: any) {
      setErrorMessage(t('connection_error_label') + e.message);
    }
  };

  const downloadSingleShow = async (item: any) => {
    try {
      const res = await fetch('/api/save-show', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item, saveToNas: false })
      });
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const fileName = `${item.title || item.ref}.show`.replace(/[\\/:*?"<>|]/g, '_');
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) {
      alert(t('download_error_label') + e);
    }
  };

  const adHocAddSong = (optTitle?: string) => {
    const title = optTitle || songInput || presentationInput;
    if (!title) return;
    const split = title.split('-');
    const itemId = Date.now();
    const newItem = { 
      id: itemId, 
      type: 'song', 
      title: split[0]?.trim() || title, 
      artist: split[1]?.trim() || '', 
      status: 'pending', 
      text: '',
      targetSection: targetSection,
      insertPosition: insertPosition
    };
    setDraftItem(newItem);
    setSongInput('');
    setPresentationInput('');
    triggerAutoSyncDraft(newItem);
  };

  const adHocAddBible = () => {
    if (!bibleChapter || !bibleVerseStart) return;
    let ref = `${bibleBook} ${bibleChapter}:${bibleVerseStart}`;
    if (bibleVerseEnd) ref += `-${bibleVerseEnd}`;
    const acronymMatch = bibleTranslation.match(/\((.*?)\)/);
    const trans = acronymMatch ? acronymMatch[1] : bibleTranslation;
    const itemId = Date.now();
    const newItem = { 
      id: itemId, 
      type: 'bible', 
      ref, 
      translation: trans, 
      versesPerSlide: bibleVersesPerSlide,
      status: 'pending', 
      text: '',
      targetSection: targetSection,
      insertPosition: insertPosition
    };
    setDraftItem(newItem);
    triggerAutoSyncDraft(newItem);
    setBibleVersesPerSlide(1);
  };

  // Maintenance Functions
  const scanDuplicates = async () => {
    setIsScanning(true);
    try {
      const res = await fetch('/api/maintenance/duplicates');
      const data = await res.json();
      if (data.success) {
        setDuplicateGroups(data.groups);
        setStatus(t('scan_complete').replace('{count}', data.groups.length.toString()));
      } else {
        alert(t('scanning_error_label') + data.error);
      }
    } catch (e: any) {
      alert(t('network_error_label') + e.message);
    }
    setIsScanning(false);
  };

  const optimizeMediaPaths = async () => {
    setIsOptimizing(true);
    setStatus(t('optimizing_media_paths'));
    try {
      const res = await fetch('/api/maintenance/fix-media');
      const data = await res.json();
      if (data.success) {
        setStatus(t('media_paths_optimized')
          .replace('{scanned}', data.showsScanned.toString())
          .replace('{fixed}', data.pathsFixed.toString())
          .replace('{copied}', data.filesCopied.toString())
          .replace('{symlinks}', data.symlinksCreated.toString()));
        fetchCatalog();
      } else {
        alert(t('optimization_failed_label') + data.error);
        setStatus(t('optimization_failed'));
      }
    } catch (e: any) {
      alert(t('network_error_label') + e.message);
      setStatus(t('optimization_failed'));
    }
    setIsOptimizing(false);
  };

  const downloadBackup = async () => {
    setStatus(t('generating_backup'));
    try {
      window.location.href = '/api/maintenance/backup';
      setStatus(t('backup_started'));
    } catch (e) {
      alert(t('backup_failed'));
    }
  };

  const deleteDuplicate = async (filename: string) => {
    if (!confirm(t('delete_confirm_nas').replace('{filename}', filename))) return;
    
    try {
      const res = await fetch('/api/maintenance/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename })
      });
      const data = await res.json();
      if (data.success) {
        // Verwijder uit de lokale state lijst
        setDuplicateGroups(prev => prev.map(group => 
          group.filter((item: any) => item.filename !== filename)
        ).filter(group => group.length > 1));
        
        // Ook uit de catalogus verwijderen als die open staat
        setCatalogSongs(prev => prev.filter(s => (s.name + '.show') !== filename));
        
        setStatus(t('delete_success').replace('{filename}', filename));
      } else {
        alert(t('error_label') + data.error);
      }
    } catch (e: any) {
      alert(t('network_error_label') + e.message);
    }
  };

  const fetchCatalog = async () => {
    setLoadingCatalog(true);
    try {
      const res = await fetch('/api/catalog');
      const data = await res.json();
      if (data.success) {
        setCatalogSongs(data.catalog.songs);
      }
    } catch (e) {
      console.error(t('catalog_error_label'), e);
    } finally {
      setLoadingCatalog(false);
    }
  };

  const deleteFromLibrary = async (filename: string) => {
    if (!confirm(t('delete_confirm_history').replace('{filename}', filename))) return;
    try {
      const res = await fetch('/api/maintenance/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename })
      });
      const data = await res.json();
      if (data.success) {
        setCatalogSongs(prev => prev.filter(s => (s.name + '.show') !== filename));
        // Ook uit duplicaten lijst halen als het daar stond
        setDuplicateGroups(prev => prev.map(g => g.filter((s: any) => s.filename !== filename)).filter(g => g.length > 1));
        setStatus(t('delete_archived').replace('{filename}', filename));
      } else {
        alert(t('error_label') + data.error);
      }
    } catch (e) {
      alert(t('api_error'));
    }
  };

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const res = await fetch('/api/maintenance/history');
      const data = await res.json();
      if (data.success) {
        setHistoryItems(data.history);
      }
    } catch (e) {
      console.error(t('error_loading_history'), e);
    } finally {
      setLoadingHistory(false);
    }
  };

  const restoreItem = async (id: string) => {
    try {
      const res = await fetch('/api/maintenance/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      const data = await res.json();
      if (data.success) {
        setStatus(t('restore_success'));
        loadHistory();
        refreshCatalog(); // Ververs ook de hoofdlijst
      } else {
        alert(t('restore_failed_label') + data.error);
      }
    } catch (e: any) {
      alert(t('network_error_label') + e.message);
    }
  };

  const restoreSelectedItems = async () => {
    if (selectedTrashIds.length === 0) return;
    setLoadingHistory(true);
    let successCount = 0;
    for (const id of selectedTrashIds) {
      try {
        const res = await fetch('/api/maintenance/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id })
        });
        const data = await res.json();
        if (data.success) successCount++;
      } catch (e) {}
    }
    setStatus(t('items_restored').replace('{count}', successCount.toString()));
    setSelectedTrashIds([]);
    refreshCatalog();
  };

  const emptyTrash = async () => {
    if (!confirm(t('empty_trash_confirm'))) return;
    setLoadingHistory(true);
    try {
      const res = await fetch('/api/maintenance/history', {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.success) {
        setStatus(data.message);
        setSelectedTrashIds([]);
        loadHistory();
      } else {
        alert(t('error_label') + data.error);
      }
    } catch (e: any) {
      alert(t('network_error_label') + e.message);
    } finally {
      setLoadingHistory(false);
    }
  };

  const fetchShows = async () => {
    setLoadingShows(true);
    try {
      const res = await fetch('/api/shows');
      const data = await res.json();
      if (data.success) {
        setShowsList(data.shows);
        if (data.categories) {
          setFreeshowCategories(data.categories);
        }
      } else {
        setErrorMessage(data.error || 'Fout bij inladen shows');
      }
    } catch (e: any) {
      setErrorMessage(e.message || 'Verbindingsfout bij inladen shows');
    } finally {
      setLoadingShows(false);
    }
  };

  const loadShowDetail = async (filename: string) => {
    try {
      const res = await fetch(`/api/shows/${encodeURIComponent(filename)}`);
      const data = await res.json();
      if (data.success) {
        const fullShow = data.show;
        setSelectedShow(fullShow);
        const showObj = fullShow[1];
        setShowEditorTitle(showObj.name || '');
        setShowEditorCategory(showObj.category || 'song');
        
        const slidesList: any[] = [];
        const activeLayoutId = showObj.settings?.activeLayout;
        if (activeLayoutId && showObj.layouts?.[activeLayoutId]?.slides) {
          const layoutSlides = showObj.layouts[activeLayoutId].slides;
          for (const layoutSlide of layoutSlides) {
            const slideId = layoutSlide.id;
            const slide = showObj.slides?.[slideId];
            if (slide) {
              slidesList.push({
                id: slideId,
                nextTimer: layoutSlide.nextTimer || 10,
                slideObj: JSON.parse(JSON.stringify(slide))
              });
            }
          }
        } else if (showObj.slides) {
          Object.entries(showObj.slides).forEach(([slideId, slide]: any) => {
            slidesList.push({
              id: slideId,
              nextTimer: 10,
              slideObj: JSON.parse(JSON.stringify(slide))
            });
          });
        }
        setShowEditorSlides(slidesList);
        setShowEditorRawJson(JSON.stringify(fullShow, null, 2));
        setShowEditorMode('visual');
      } else {
        alert(data.error || 'Fout bij laden show-details');
      }
    } catch (e: any) {
      alert(e.message || 'Verbindingsfout bij laden show-details');
    }
  };

  const saveShowChanges = async () => {
    if (!selectedShow) return;
    setIsSavingShow(true);
    const oldFilename = selectedShow[1].name + '.show';
    try {
      let body: any = {};
      if (showEditorMode === 'raw') {
        body = { rawJson: showEditorRawJson };
      } else {
        const showId = selectedShow[0];
        const showObj = JSON.parse(JSON.stringify(selectedShow[1]));
        
        showObj.name = showEditorTitle;
        showObj.category = showEditorCategory;
        showObj.timestamps = showObj.timestamps || {};
        showObj.timestamps.modified = Date.now();

        const newSlides: Record<string, any> = {};
        const activeLayoutId = showObj.settings?.activeLayout || 'default-layout';
        showObj.settings = showObj.settings || {};
        showObj.settings.activeLayout = activeLayoutId;

        const layoutSlidesList: any[] = [];

        showEditorSlides.forEach((s) => {
          newSlides[s.id] = s.slideObj;
          layoutSlidesList.push({
            id: s.id,
            nextTimer: s.nextTimer || 10
          });
        });

        showObj.slides = newSlides;
        showObj.layouts = showObj.layouts || {};
        showObj.layouts[activeLayoutId] = {
          name: showObj.layouts[activeLayoutId]?.name || "Default",
          notes: showObj.layouts[activeLayoutId]?.notes || "",
          slides: layoutSlidesList
        };

        const updatedShow = [showId, showObj];
        body = { rawJson: JSON.stringify(updatedShow, null, 2) };
      }

      const res = await fetch(`/api/shows/${encodeURIComponent(oldFilename)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (data.success) {
        setSelectedShow(null);
        fetchShows();
        refreshCatalog();
        setStatus(t('item_updated'));
      } else {
        alert(data.error || 'Fout bij opslaan show');
      }
    } catch (e: any) {
      alert(e.message || 'Verbindingsfout bij opslaan');
    } finally {
      setIsSavingShow(false);
    }
  };

  const moveSlide = (idx: number, direction: 'up' | 'down') => {
    const updated = [...showEditorSlides];
    if (direction === 'up' && idx > 0) {
      const temp = updated[idx];
      updated[idx] = updated[idx - 1];
      updated[idx - 1] = temp;
    } else if (direction === 'down' && idx < updated.length - 1) {
      const temp = updated[idx];
      updated[idx] = updated[idx + 1];
      updated[idx + 1] = temp;
    }
    setShowEditorSlides(updated);
  };

  const deleteSlide = (idx: number) => {
    if (!confirm('Weet je zeker dat je deze slide wilt verwijderen?')) return;
    const updated = showEditorSlides.filter((_, i) => i !== idx);
    setShowEditorSlides(updated);
  };

  const addSlide = (type: 'text' | 'media') => {
    const newId = Math.random().toString(16).substring(2, 13);
    const newSlideObj: any = {
      group: String(showEditorSlides.length + 1),
      color: null,
      settings: {},
      notes: "",
      items: []
    };

    if (type === 'media') {
      newSlideObj.items = [
        {
          type: "media",
          style: "top:0px;left:0px;height:1080px;width:1920px;",
          src: "/volume1/Beamer/FreeShow/thema.jpg",
          fit: "contain"
        }
      ];
    } else {
      newSlideObj.items = [
        {
          type: "text",
          style: "top:0px;left:0px;height:1080px;width:1920px;",
          lines: [
            {
              align: "",
              text: [
                {
                  value: "Nieuwe slide",
                  style: "font-size: 100px; color: white;"
                }
              ]
            }
          ]
        }
      ];
    }

    setShowEditorSlides([...showEditorSlides, {
      id: newId,
      nextTimer: 10,
      slideObj: newSlideObj
    }]);
  };

  const applyPastedLyrics = async () => {
    if (!pasteLyricsText.trim()) return;
    if (showEditorSlides.length > 0 && !confirm('Dit vervangt alle huidige slides in deze show door de geplakte tekst. Doorgaan?')) {
      return;
    }
    setIsParsingLyrics(true);
    try {
      const res = await fetch('/api/parse-lyrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: pasteLyricsText, category: showEditorCategory, name: showEditorTitle })
      });
      const data = await res.json();
      if (data.success) {
        setShowEditorSlides(data.slides);
        setPasteLyricsText('');
        setShowPasteLyrics(false);
      } else {
        alert(data.error || 'Fout bij verwerken van de tekst');
      }
    } catch (e: any) {
      alert(e.message || 'Verbindingsfout bij verwerken van de tekst');
    } finally {
      setIsParsingLyrics(false);
    }
  };

  const updateSlideText = (idx: number, newText: string) => {
    const updated = [...showEditorSlides];
    const s = updated[idx];
    if (s && s.slideObj && s.slideObj.items && s.slideObj.items[0]) {
      const item = s.slideObj.items[0];
      if (getItemType(item) === 'text') {
        const existingStyle = item.lines?.[0]?.text?.[0]?.style || "font-size: 100px; color: white;";
        item.lines = newText.split('\n').map((lineStr: string) => ({
          align: item.lines?.[0]?.align || "",
          text: [{ value: lineStr, style: existingStyle }]
        }));
      }
    }
    setShowEditorSlides(updated);
  };

  const updateSlideMedia = (idx: number, newSrc: string) => {
    const updated = [...showEditorSlides];
    const s = updated[idx];
    if (s && s.slideObj && s.slideObj.items && s.slideObj.items[0]) {
      const item = s.slideObj.items[0];
      if (getItemType(item) === 'media') {
        item.src = newSrc;
      }
    }
    setShowEditorSlides(updated);
  };

  const toggleSlideType = (idx: number) => {
    const updated = [...showEditorSlides];
    const s = updated[idx];
    if (s && s.slideObj && s.slideObj.items && s.slideObj.items[0]) {
      const item = s.slideObj.items[0];
      if (getItemType(item) === 'text') {
        s.slideObj.items = [
          {
            type: "media",
            style: "top:0px;left:0px;height:1080px;width:1920px;",
            src: "/volume1/Beamer/FreeShow/thema.jpg",
            fit: "contain"
          }
        ];
      } else {
        s.slideObj.items = [
          {
            type: "text",
            style: "top:0px;left:0px;height:1080px;width:1920px;",
            lines: [
              {
                align: "",
                text: [
                  {
                    value: "Nieuwe slide tekst",
                    style: "font-size: 100px; color: white;"
                  }
                ]
              }
            ]
          }
        ];
      }
    }
    setShowEditorSlides(updated);
  };

  const duplicateShow = async (filename: string) => {
    const newTitle = prompt('Voer een nieuwe titel in voor de gekopieerde show:', filename.replace(/\.show$/i, '') + ' (Kopie)');
    if (!newTitle) return;
    try {
      const res = await fetch('/api/shows/duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, newTitle })
      });
      const data = await res.json();
      if (data.success) {
        fetchShows();
        setStatus('Show succesvol gedupliceerd!');
      } else {
        alert(data.error || 'Fout bij dupliceren');
      }
    } catch (e: any) {
      alert(e.message || 'Verbindingsfout bij dupliceren');
    }
  };

  const deleteShowDirect = async (filename: string) => {
    if (!confirm(t('delete_confirm_nas').replace('{filename}', filename.replace(/\.show$/i, '')))) return;
    try {
      const res = await fetch(`/api/shows/${encodeURIComponent(filename)}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.success) {
        fetchShows();
        loadHistory();
        setStatus('Show succesvol naar prullenbak verplaatst!');
      } else {
        alert(data.error || 'Fout bij verwijderen show');
      }
    } catch (e: any) {
      alert(e.message || 'Verbindingsfout bij verwijderen');
    }
  };

  const adHocAddSection = () => {
    if (!sectionName) return;
    const itemId = Date.now();
    const newItem = { 
      id: itemId, 
      type: 'section', 
      title: sectionName,
      color: sectionColor,
      status: 'manual',
      targetSection: targetSection,
      insertPosition: insertPosition
    };
    setManualItems([...manualItems, newItem]);
    setSectionName('');
  };

  const [isDownloading, setIsDownloading] = useState(false);

  const adHocAddYoutube = async () => {
    if (!youtubeUrl) return;
    
    setIsDownloading(true);
    setErrorMessage('');
    setStatus(t('downloading_yt'));

    try {
      const res = await fetch('/api/yt-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: youtubeUrl,
          directory: settings.freeshowMediaPath
        })
      });

      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || t('download_error_label'));
      }

      const itemId = Date.now();
      const newItem = { 
        id: itemId, 
        type: 'media', 
        title: data.title,
        filePath: data.filePath,
        metaType: 'video',
        status: 'manual',
        targetSection: targetSection,
        insertPosition: insertPosition,
        layer: mediaLayer,
        timer: mediaTimer,
        loop: mediaLoop
      };
      setDraftItem(newItem);
      setYoutubeUrl('');
      setYoutubeName('');
      setStatus(t('yt_success'));
    } catch (e: any) {
      setErrorMessage(e.message);
      setStatus('');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleMediaUpload = async (isForeground: boolean) => {
    if (!mediaFile) return;
    setMediaUploadStatus(t('uploading'));
    
    // Create form data
    const formData = new FormData();
    formData.append('file', mediaFile);
    formData.append('directory', settings.freeshowMediaPath);

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      
      if (data.success) {
        setMediaUploadStatus(t('uploaded'));
        
        if (isForeground) {
          const itemId = Date.now();
          const newItem = {
            id: itemId,
            type: 'media',
            title: mediaFile.name,
            filePath: data.filePath, // Absolute NAS path
            metaType: mediaFile.type.startsWith('video') ? 'video' : 'image',
            status: 'manual',
            targetSection: targetSection,
            insertPosition: insertPosition,
            timer: mediaTimer,
            loop: mediaLoop,
            layer: mediaPlacementMode === 'direct' ? 'direct' : mediaLayer
          };
          setDraftItem(newItem);
        } else if (mediaAttachTarget && mediaTargetMode === 'swap') {
          const updateFn = (list: any[]) => list.map(item => {
            if (item.id === mediaAttachTarget) {
              if (item.source === 'template') {
                return { ...item, swappedMediaPath: data.filePath, timer: mediaTimer, loop: mediaLoop };
              }
              return {
                ...item,
                backgroundMedia: data.filePath,
                backgroundType: mediaFile.type.startsWith('video') ? 'video' : 'image',
                title: mediaShowName || mediaFile.name
              };
            }
            return item;
          });
          setTemplateItems(updateFn(templateItems));
          setManualItems(updateFn(manualItems));
        } else if (mediaAttachTarget && mediaTargetMode === 'append') {
          const updateFn = (list: any[]) => list.map(item => {
            if (item.id === mediaAttachTarget) {
              const newSlide = { 
                path: data.filePath, 
                type: mediaFile.type.startsWith('video') ? 'video' : 'image',
                layer: mediaLayer
              };
              return { 
                ...item, 
                extraSlides: [...(item.extraSlides || []), newSlide] 
              };
            }
            return item;
          });
          setTemplateItems(updateFn(templateItems));
          setManualItems(updateFn(manualItems));
        }
        
        setMediaFile(null);
        setTimeout(() => setMediaUploadStatus(''), 3000);
      } else {
        setMediaUploadStatus(t('error_label') + data.error);
      }
    } catch (e: any) {
      setMediaUploadStatus(t('error_label') + e.message);
    }
  };

  const loadProjectFromServer = async (filename: string) => {
    setLoading(true);
    try {
      const res = await fetch('/api/projects/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename })
      });
      const data = await res.json();
      if (data.success && data.state) {
        setManualItems(data.state.manualItems || []);
        if (data.state.projectName) setProjectName(data.state.projectName);
        setUseTemplate(false);
        setStatus(data.reconstructed
          ? `Project ingeladen (${data.state.manualItems.length} item(s) best-effort gereconstrueerd${data.skipped ? `, ${data.skipped} overgeslagen` : ''} - controleer voor gebruik).`
          : "Project ingeladen!");
      } else {
        alert("Kan status niet inladen: " + (data.error || "Bestand is geen opgeslagen livestream project"));
      }
    } catch(e) {
      alert("Fout bij laden: " + e);
    }
    setLoading(false);
  };

  const deleteProjectFromServer = async (filename: string) => {
    if (!confirm(`Weet je zeker dat je het project '${filename}' wilt verwijderen van de server?`)) return;
    
    setLoading(true);
    try {
      const res = await fetch(`/api/projects?filename=${encodeURIComponent(filename)}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setStatus(`Project verwijderd!`);
        fetchProjects();
      } else {
        alert("Kon project niet verwijderen: " + data.error);
      }
    } catch (e) {
      alert("Fout bij verwijderen: " + e);
    }
    setLoading(false);
  };

  const moveManualItemUp = (id: string) => {
    setManualItems(prev => {
      const idx = prev.findIndex(item => item.id === id);
      if (idx > 0) {
        const newItems = [...prev];
        [newItems[idx - 1], newItems[idx]] = [newItems[idx], newItems[idx - 1]];
        return newItems;
      }
      return prev;
    });
  };

  const moveManualItemDown = (id: string) => {
    setManualItems(prev => {
      const idx = prev.findIndex(item => item.id === id);
      if (idx !== -1 && idx < prev.length - 1) {
        const newItems = [...prev];
        [newItems[idx], newItems[idx + 1]] = [newItems[idx + 1], newItems[idx]];
        return newItems;
      }
      return prev;
    });
  };

  const loadProjectFromFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    setLoading(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const zip = await JSZip.loadAsync(arrayBuffer);

      const dataJsonFile = zip.file("data.json");
      if (!dataJsonFile) {
        alert("Ongeldig .project bestand: geen data.json gevonden.");
        setLoading(false);
        e.target.value = "";
        return;
      }
      const dataJson = JSON.parse(await dataJsonFile.async("string"));

      let manualItemsToLoad: any[] | null = null;
      const stateFile = zip.file("livestream_state.json");
      if (stateFile) {
        try {
          const stateObj = JSON.parse(await stateFile.async("string"));
          if (Array.isArray(stateObj.manualItems)) manualItemsToLoad = stateObj.manualItems;
        } catch {}
      }

      let reconstructed = false;
      let skipped = 0;
      if (!manualItemsToLoad) {
        const result = reconstructManualItemsFromProject(dataJson);
        manualItemsToLoad = result.items;
        skipped = result.skipped;
        reconstructed = true;
      }

      setManualItems(manualItemsToLoad);
      if (dataJson.project?.name) setProjectName(dataJson.project.name);
      setUseTemplate(false);
      setStatus(reconstructed
        ? `Project ingeladen (${manualItemsToLoad.length} item(s) best-effort gereconstrueerd${skipped ? `, ${skipped} overgeslagen` : ''} - controleer voor gebruik).`
        : "Project succesvol ingeladen!");
    } catch(err) {
      alert("Fout bij uitlezen ZIP-bestand: " + err);
    }
    setLoading(false);
    e.target.value = ""; // reset
  };

  const handleGenerate = async (mode: 'download' | 'nas') => {
    setLoading(true);
    setStatus(mode === 'nas' ? t('saving_on_server') : t('project_creating'));
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: new Date().toLocaleDateString('nl-NL'),
          projectName: projectName.trim(),
          items,
          useTemplate: useTemplate,
          saveToNas: mode === 'nas',
          projectPath: settings.freeshowProjectPath
        })
      });

      if (mode === 'nas') {
        const data = await res.json();
        if (data.success) {
          setStatus(t('project_save_success'));
          // Reset after success
          setTimeout(() => {
            setStatus('');
          }, 3000);
        } else {
          setStatus(t('error_label') + data.error);
        }
      } else {
        if (!res.ok) throw new Error(t('api_error'));
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const targetFilename = projectName.trim() ? `${projectName.trim().replace(/[\\/:*?"<>|]/g, '-')}.project` : `Project-${new Date().toLocaleDateString('nl-NL').replace(/\//g, '-')}.project`;
        a.download = targetFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setStatus(t('project_download_success'));
        // Reset na succes
        setTimeout(() => {
          setStatus('');
        }, 3000);
      }
    } catch (e: any) {
      setStatus(t('generation_failed_label') + e.message);
    }
    setLoading(false);
  };

  const triggerAutoSyncDraft = async (draft: any) => {
    setLoading(true);
    try {
      const res = await fetch('/api/preview', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ items: [draft] })
      });
      const data = await res.json();
      if (data.success && data.items.length > 0) {
        setDraftItem(data.items[0]);
      }
    } catch (err: any) {
      console.error('Preview error for draft:', err);
    }
    setLoading(false);
  };

  const confirmDraft = () => {
    if (!draftItem) return;
    
    const exists = manualItems.find(i => i.id === draftItem.id);
    if (exists) {
      setManualItems(manualItems.map(i => i.id === draftItem.id ? draftItem : i));
      setStatus(t('item_updated'));
    } else {
      setManualItems([...manualItems, draftItem]);
      setStatus(t('item_added_to_playlist'));
    }
    setDraftItem(null);
  };

  const cancelDraft = () => {
    setDraftItem(null);
    setStatus('');
  };

  // Saves the draft to the FreeShow catalog only - not added to the current
  // playlist/project. For media, the file was already written to the media
  // folder at upload time, so there's nothing extra to save.
  const saveDraftToLibrary = async () => {
    if (!draftItem) return;
    if (draftItem.type === 'song' || draftItem.type === 'bible') {
      await saveShowToNas(draftItem);
    }
    setDraftItem(null);
    setStatus(t('saved_to_library'));
  };

  const updateItemText = (id: number, text: string) => {
    if (draftItem && draftItem.id === id) {
       setDraftItem({ ...draftItem, text, status: 'manual' });
       return;
    }
    setManualItems(manualItems.map(item => item.id === id ? { ...item, text, status: 'manual' } : item));
  };

  const removeSelected = () => {
    const toRemoveManual = manualItems.filter(i => selectedIds.includes(i.id)).map(i => i.id);
    const toRemoveTemplate = templateItems.filter(i => selectedIds.includes(i.id)).map(i => i.id);

    if (toRemoveManual.length > 0) {
      setManualItems(manualItems.filter(i => !toRemoveManual.includes(i.id)));
    }
    if (toRemoveTemplate.length > 0) {
      setTemplateItems(templateItems.map(i => toRemoveTemplate.includes(i.id) ? { ...i, isRemoved: true } : i));
    }

    setSelectedIds([]);
    setStatus(t('items_processed').replace('{count}', selectedIds.length.toString()));
  };

  const removeItem = (id: number) => {
    setManualItems(manualItems.filter(item => item.id !== id));
  };


  const filteredAvailableSongs = catalog.songs.filter(s => s.category !== 'presentation' && s.category !== 'scripture');

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--foreground)' }}>
            FreeShow Projecten
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
            Liederen, Schriftlezing en media samenstellen tot playlists
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '4px', background: 'rgba(255,255,255,0.03)', padding: '4px', borderRadius: '8px', border: '1px solid var(--card-border)' }}>
            {['nl', 'en'].map(l => (
              <button 
                key={l} 
                onClick={() => setLang(l)}
                style={{ 
                  background: lang === l ? 'var(--primary)' : 'transparent',
                  border: 'none', 
                  color: lang === l ? '#020617' : 'var(--foreground)', 
                  padding: '4px 10px', 
                  borderRadius: '6px',
                  fontSize: '0.75rem', 
                  fontWeight: 600, 
                  cursor: 'pointer', 
                  textTransform: 'uppercase',
                  transition: 'all 0.2s'
                }}
              >
                {l}
              </button>
            ))}
          </div>
          <button 
            className="btn-outline" 
            style={{ padding: '8px 16px', fontSize: '0.85rem', borderRadius: '8px' }} 
            onClick={() => setShowHelp(!showHelp)}
          >
            {t('help')}
          </button>
        </div>
      </div>

      {!settings.freeshowPath ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '50vh', textAlign: 'center' }}>
          <div className="glass-card" style={{ maxWidth: '600px', padding: '40px', borderTop: '4px solid var(--primary)' }}>
            <div style={{ fontSize: '3.5rem', marginBottom: '16px' }}>⚙️</div>
            <h3 style={{ fontSize: '1.5rem', marginBottom: '12px', fontWeight: '700' }}>{t('setup_required')}</h3>
            <p style={{ fontSize: '0.95rem', color: 'var(--muted)', marginBottom: '24px', lineHeight: '1.6' }}>
              {t('setup_hint')}
            </p>
            <p style={{ fontSize: '0.9rem', color: 'var(--primary)', fontWeight: 600 }}>
              Configureer de FreeShow paden via de Instellingen (tandwiel rechtsboven).
            </p>
          </div>
        </div>
      ) : (
        <>
          {errorMessage && (
            <div className="glass-card" style={{ marginBottom: '2rem', background: 'rgba(239, 68, 68, 0.1)', borderColor: '#ef4444', color: '#f87171' }}>
              <strong>⚠️ Let op:</strong> {errorMessage}
              <button onClick={() => setErrorMessage('')} style={{ float: 'right', background: 'transparent', padding: 0 }}>✕</button>
            </div>
          )}


      {showHelp && (
        <div className="glass-card" style={{ marginBottom: '2rem', borderLeft: '4px solid #f59e0b', padding: '1.5rem 2rem' }}>
          <button onClick={() => setShowHelp(false)} style={{ float: 'right', background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', fontSize: '1.2rem', opacity: 0.5 }}>✕</button>
          <h2 style={{ color: 'var(--primary)', marginTop: 0 }}>{t('help_title')}</h2>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem', fontSize: '0.9rem', lineHeight: '1.6' }}>
            <div>
              <h4 style={{ marginBottom: '0.6rem', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><span>🔄</span> {t('help_workflow_title')}</h4>
              <p style={{ opacity: 0.85 }}>{t('help_workflow_desc')}</p>
            </div>
            <div>
              <h4 style={{ marginBottom: '0.6rem', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><span>📍</span> {t('help_playlist_title')}</h4>
              <p style={{ opacity: 0.85 }}>{t('help_playlist_desc')}</p>
            </div>
            <div>
              <h4 style={{ marginBottom: '0.6rem', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><span>🎥</span> {t('help_media_advanced_title')}</h4>
              <p style={{ opacity: 0.85 }}>{t('help_media_advanced_desc')}</p>
            </div>
          </div>
          <p style={{ fontSize: '0.8rem', opacity: 0.6, marginTop: '1.5rem', marginBottom: 0 }}>
            {t('full_manual_hint_prefix')} <strong>?</strong> {t('full_manual_hint_suffix')}
          </p>
        </div>
      )}




      <datalist id="available-songs">
        {filteredAvailableSongs.map((song, i) => <option key={i} value={song.name} />)}
      </datalist>

      <div className="content-grid">
        <div className="sticky-col">
          {draftItem ? (
            <div className="glass-card" style={{ border: '2px solid var(--primary)', background: 'rgba(56, 189, 248, 0.05)' }}>
              <h2 style={{ color: 'var(--primary)', marginBottom: '1rem' }}>{t('staging_area_title')}</h2>
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '12px', marginBottom: '1rem' }}>
                {draftItem.type === 'media' ? (
                  <div style={{ marginBottom: '1rem' }}>
                    <div style={{ fontWeight: 'bold', marginBottom: '0.8rem' }}>📎 {draftItem.title}</div>
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', overflow: 'hidden', minHeight: '160px' }}>
                      {draftItem.metaType === 'image' ? (
                        <img src={resolveMediaPath(draftItem.filePath)} alt={draftItem.title} style={{ maxWidth: '100%', maxHeight: '220px', objectFit: 'contain' }} />
                      ) : (
                        <div style={{ padding: '2rem', textAlign: 'center', opacity: 0.6 }}>🎬<div style={{ fontSize: '0.75rem', marginTop: '0.4rem' }}>{t('video')}</div></div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.6rem', fontSize: '0.7rem', opacity: 0.7 }}>
                      <span>{draftItem.layer === 'direct' ? t('file') : draftItem.layer === 'background' ? t('background') : t('foreground')}</span>
                      {draftItem.metaType === 'image' && <span>· {draftItem.timer || 5}s</span>}
                      {draftItem.loop && <span>· 🔁 {t('loop')}</span>}
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ fontWeight: 'bold', marginBottom: '1rem' }}>{draftItem.type === 'song' ? draftItem.title : draftItem.ref}</div>
                    <textarea
                      className="input" style={{ height: '350px', fontFamily: 'monospace' }}
                      value={draftItem.text} onChange={e => updateItemText(draftItem.id, e.target.value)}
                    />
                  </>
                )}
                <div style={{ marginTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '1rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.75rem', opacity: 0.7 }}>Sectie verplaatsen</label>
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <select 
                      className="input" style={{ marginBottom: 0, fontSize: '0.85rem', flex: 2 }} 
                      value={draftItem.targetSection || t('bottom')} 
                      onChange={e => setDraftItem({ ...draftItem, targetSection: e.target.value })}
                    >
                      {allAvailableSections.map(s => <option key={s} value={s}>{getTranslatedTitle(s)}</option>)}
                    </select>
                    <button 
                      className="button" style={{ flex: 1, padding: '0.5rem', fontSize: '0.7rem', background: draftItem.insertPosition === 'before' ? 'var(--primary)' : 'rgba(255,255,255,0.05)', color: draftItem.insertPosition === 'before' ? '#020617' : '#ffffff' }}
                      onClick={() => setDraftItem({ ...draftItem, insertPosition: draftItem.insertPosition === 'before' ? 'after' : 'before' })}
                    >
                      {draftItem.insertPosition === 'before' ? t('before') : t('after')}
                    </button>
                  </div>
                </div>
              </div>
              <div style={{ fontSize: '0.7rem', opacity: 0.6, marginBottom: '0.5rem' }}>{t('staging_area_help')}</div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="button" style={{ flex: 1, background: 'rgba(255,255,255,0.1)' }} onClick={cancelDraft}>{t('annuleren')}</button>
                <div style={{ display: 'flex', flex: 2, gap: '0.4rem' }}>
                  <button className="button" style={{ flex: 1, background: 'var(--primary)', color: '#020617' }} onClick={confirmDraft}>{t('add_to_playlist_btn')}</button>
                  <button className="button" style={{ flex: 1, background: 'rgba(255,255,255,0.1)' }} onClick={() => {
                    setBuilderSlides([...builderSlides, draftItem]); 
                    setDraftItem(null); 
                    setStatus(t('item_added_to_playlist')); // Logic matches add to builder usually but let's stick to translations
                    setDatabaseSubTab('builder');
                    setInputType('database'); 
                  }}>{t('add_to_builder_btn')}</button>
                </div>
              </div>
              <button
                className="button"
                style={{ width: '100%', marginTop: '0.5rem', background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', fontSize: '0.75rem' }}
                onClick={saveDraftToLibrary}
                title={t('save_to_library_help')}
              >
                {t('save_to_library_btn')}
              </button>
            </div>
          ) : (
            <>
              <div className="glass-card" style={{ marginBottom: '1.5rem' }}>
                <h2>{t('add_items_total')}</h2>
                
                <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                  {['song', 'presentation', 'bible', 'media', 'youtube', 'section', 'database'].map(tab => {
                    const icons: Record<string, string> = {
                      song: '🎵', presentation: '📊', bible: '📖', media: '📸',
                      youtube: '🎥', section: '📁', database: '🗃️'
                    };
                    const labels: Record<string, string> = {
                      song: t('tab_song'),
                      presentation: t('tab_presentation'),
                      bible: t('tab_bible'),
                      media: t('tab_media'),
                      youtube: t('tab_youtube'),
                      section: t('tab_section'),
                      database: t('tab_database')
                    };
                    return (
                      <div key={tab} className="tooltip-container" style={{ flex: '1 0 auto', display: 'flex' }}>
                        <button className="button" 
                          style={{ 
                            width: '100%', fontSize: '0.7rem', padding: '0.5rem', 
                            background: inputType === tab ? 'var(--primary)' : 'rgba(255,255,255,0.05)',
                            border: tab === 'database' && builderSlides.length > 0 ? '1px solid var(--primary)' : 'none'
                          }} 
                          onClick={() => setInputType(tab as any)}
                        >
                          {tab === 'database' && builderSlides.length > 0 ? `🗃️ (${builderSlides.length})` : icons[tab]}
                        </button>
                        <span className="tooltip-text">{labels[tab]}</span>
                      </div>
                    );
                  })}
                </div>
                {inputType === 'database' && databaseSubTab === 'maintenance' && (
                  <button className="button" style={{ width: '100%', marginBottom: '1rem', background: 'rgba(255,255,255,0.05)' }} onClick={() => { loadHistory(); scanDuplicates(); }}>
                    {t('refresh_maintenance')}
                  </button>
                )}




                 {inputType === 'song' && (
                   <SongInput
                     songInput={songInput}
                     setSongInput={setSongInput}
                     catalogSongs={catalogSongs}
                     onAddSong={adHocAddSong}
                     t={t}
                     freeshowCategories={freeshowCategories}
                   />
                 )}

                  {inputType === 'presentation' && (
                    <PresentationInput
                      presentationInput={presentationInput}
                      setPresentationInput={setPresentationInput}
                      catalogSongs={catalogSongs}
                      onAddSong={adHocAddSong}
                      t={t}
                      freeshowCategories={freeshowCategories}
                    />
                  )}

                {inputType === 'bible' && (
                  <BibleInput
                    bibleTranslation={bibleTranslation}
                    setBibleTranslation={setBibleTranslation}
                    bibleBook={bibleBook}
                    setBibleBook={setBibleBook}
                    bibleChapter={bibleChapter}
                    setBibleChapter={setBibleChapter}
                    bibleVerseStart={bibleVerseStart}
                    setBibleVerseStart={setBibleVerseStart}
                    bibleVerseEnd={bibleVerseEnd}
                    setBibleVerseEnd={setBibleVerseEnd}
                    availableBibles={catalog.bibles}
                    onAddBible={adHocAddBible}
                    t={t}
                  />
                )}
                {inputType === 'section' && (
                  <SectionInput
                    sectionName={sectionName}
                    setSectionName={setSectionName}
                    sectionColor={sectionColor}
                    setSectionColor={setSectionColor}
                    onAddSection={adHocAddSection}
                    t={t}
                  />
                )}

                {inputType === 'media' && (
                  <MediaInput
                    mediaFile={mediaFile}
                    setMediaFile={setMediaFile}
                    mediaPlacementMode={mediaPlacementMode}
                    setMediaPlacementMode={setMediaPlacementMode}
                    mediaLayer={mediaLayer}
                    setMediaLayer={setMediaLayer}
                    mediaShowName={mediaShowName}
                    setMediaShowName={setMediaShowName}
                    mediaAttachTarget={mediaAttachTarget}
                    setMediaAttachTarget={setMediaAttachTarget}
                    mediaTargetMode={mediaTargetMode}
                    items={items}
                    onUpload={handleMediaUpload}
                    t={t}
                  />
                )}
                
                {inputType === 'database' && (
                  <div style={{ padding: '0.5rem 0' }}>
                    <p style={{ fontSize: '0.8rem', opacity: 0.7, marginBottom: '1.2rem', lineHeight: '1.4' }}>
                      Beheer de FreeShow database remote vanaf hier. Kies een weergave hieronder om aan de slag te gaan.
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                      <button 
                        className="button" 
                        style={{ justifyContent: 'flex-start', background: databaseSubTab === 'catalog' ? 'var(--primary)' : 'rgba(255,255,255,0.05)', fontSize: '0.75rem', padding: '0.6rem' }} 
                        onClick={() => setDatabaseSubTab('catalog')}
                      >
                        📂 Shows Catalogus & Editor
                      </button>
                      {builderSlides.length > 0 && (
                        <button
                          className="button"
                          style={{ justifyContent: 'flex-start', background: databaseSubTab === 'builder' ? 'var(--primary)' : 'rgba(255,255,255,0.05)', border: '1px solid var(--primary)', fontSize: '0.75rem', padding: '0.6rem' }}
                          onClick={() => setDatabaseSubTab('builder')}
                        >
                          🛠️ Bouwer-sessie ({builderSlides.length})
                        </button>
                      )}
                      <button
                        className="button"
                        style={{ justifyContent: 'flex-start', background: databaseSubTab === 'maintenance' ? 'var(--primary)' : 'rgba(255,255,255,0.05)', fontSize: '0.75rem', padding: '0.6rem' }}
                        onClick={() => setDatabaseSubTab('maintenance')}
                      >
                        🧹 Database Onderhoud
                      </button>
                      <button
                        className="button"
                        style={{ justifyContent: 'flex-start', background: databaseSubTab === 'drafts' ? 'var(--primary)' : 'rgba(255,255,255,0.05)', fontSize: '0.75rem', padding: '0.6rem' }}
                        onClick={() => setDatabaseSubTab('drafts')}
                      >
                        📬 Concept-diensten (mail)
                      </button>
                    </div>
                  </div>
                )}


                {inputType === 'youtube' && (
                  <YoutubeInput
                    youtubeUrl={youtubeUrl}
                    setYoutubeUrl={setYoutubeUrl}
                    isDownloading={isDownloading}
                    onAddYoutube={adHocAddYoutube}
                    t={t}
                  />
                )}

                <div style={{ marginTop: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '1rem' }}>
                   <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.75rem', opacity: 0.7 }}>{t('placement_section')}</label>
                   <div style={{ display: 'flex', gap: '0.4rem' }}>
                     <select className="input" style={{ marginBottom: 0, fontSize: '0.85rem', flex: 2 }} value={targetSection} onChange={e => setTargetSection(e.target.value)}>
                        {allAvailableSections.map(s => <option key={s} value={s}>{getTranslatedTitle(s)}</option>)}
                     </select>
                     <button 
                       className="button" style={{ flex: 1, padding: '0.5rem', fontSize: '0.7rem', background: insertPosition === 'before' ? 'var(--primary)' : 'rgba(255,255,255,0.05)', color: insertPosition === 'before' ? '#020617' : '#ffffff' }}
                       onClick={() => setInsertPosition(insertPosition === 'before' ? 'after' : 'before')}
                     >
                       {insertPosition === 'before' ? t('before') : t('after')}
                     </button>
                   </div>
                </div>
              </div>

              <div className="glass-card">
                <h2>{t('generate')}</h2>
                <div className="input-group" style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', background: 'rgba(255,255,255,0.03)', padding: '0.8rem', borderRadius: '8px', marginBottom: '1rem' }}>
                  <input 
                    type="checkbox" id="useTemplate" checked={useTemplate} 
                    onChange={e => setUseTemplate(e.target.checked)} 
                    style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                  />
                  <label htmlFor="useTemplate" style={{ fontSize: '0.85rem', cursor: 'pointer', flex: 1 }}>
                    <strong>{t('use_template')}</strong><br/>
                    <span style={{ fontSize: '0.75rem', opacity: 0.6 }}>{t('template_hint')}</span>
                  </label>
                </div>
                <input type="text" className="input" value={projectName} onChange={e => setProjectName(e.target.value)} placeholder={t('project_name')} />
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className="button" style={{ flex: 1, background: 'rgba(255,255,255,0.1)' }} onClick={() => handleGenerate('download')} disabled={loading || items.length === 0} title={t('download_project_title')}>
                    {t('download')}
                  </button>
                  <button className="button" style={{ flex: 1, background: 'var(--primary)', color: '#020617' }} onClick={() => handleGenerate('nas')} disabled={loading || items.length === 0} title={t('send_to_server_title')}>
                    {t('send_to_server')}
                  </button>
                </div>
                {status && <p style={{ textAlign: 'center', marginTop: '1rem', color: 'var(--primary)' }}>{status}</p>}
              </div>

              <div className="glass-card" style={{ marginTop: '0.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h2 style={{ fontSize: '1.2rem', margin: 0, color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '1.2rem' }}>📂</span> Bestaand Project Inladen
                  </h2>
                  <button onClick={() => fetchProjects()} style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontSize: '0.9rem', padding: '4px 8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Lijst met projecten vernieuwen">↻</button>
                </div>
                
                <p style={{ opacity: 0.8, fontSize: '0.85rem', marginBottom: '1rem', lineHeight: '1.4' }}>
                  Kies een opgeslagen project van de NAS om de liederen weer in te laden.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '1rem', maxHeight: '180px', overflowY: 'auto', paddingRight: '0.5rem' }} className="custom-scrollbar">
                  {availableProjects.length === 0 ? (
                    <div style={{ padding: '1rem', textAlign: 'center', background: 'rgba(0,0,0,0.2)', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: '6px', opacity: 0.7, fontSize: '0.85rem' }}>
                      Geen projecten gevonden.
                    </div>
                  ) : (
                    availableProjects.map(proj => (
                      <div key={proj} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.8rem', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '6px' }}>
                        <span style={{ fontSize: '0.85rem', wordBreak: 'break-all', paddingRight: '0.5rem' }}>{proj}</span>
                        <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                          <button className="button" style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', background: 'rgba(56, 189, 248, 0.15)', border: '1px solid rgba(56, 189, 248, 0.4)', color: 'var(--primary)' }} onClick={() => loadProjectFromServer(proj)}>
                            Inladen
                          </button>
                          <button className="button" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171' }} onClick={() => deleteProjectFromServer(proj)} title="Verwijder project">
                            🗑️
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '0.8rem' }}>
                  <p style={{ fontSize: '0.8rem', marginBottom: '0.4rem', opacity: 0.8 }}>Of upload een lokaal <strong>.project</strong> bestand:</p>
                  <input 
                    type="file" 
                    accept=".project,.zip" 
                    onChange={loadProjectFromFile} 
                    style={{ display: 'block', width: '100%', padding: '0.5rem', fontSize: '0.8rem', background: 'rgba(0,0,0,0.2)', border: '1px dashed rgba(255,255,255,0.2)', borderRadius: '6px', cursor: 'pointer' }} 
                  />
                </div>
              </div>
            </>
          )}
        </div>

        {inputType === 'database' ? (
          <DatabaseView
            databaseSubTab={databaseSubTab}
            showsSearch={showsSearch}
            setShowsSearch={setShowsSearch}
            showsCategoryFilter={showsCategoryFilter}
            setShowsCategoryFilter={setShowsCategoryFilter}
            showsSortOrder={showsSortOrder}
            setShowsSortOrder={setShowsSortOrder}
            loadingShows={loadingShows}
            showsList={showsList}
            uniqueCategories={uniqueCategories}
            freeshowCategories={freeshowCategories}
            builderSlides={builderSlides}
            setBuilderSlides={setBuilderSlides}
            builderTitle={builderTitle}
            setBuilderTitle={setBuilderTitle}
            targetSection={targetSection}
            insertPosition={insertPosition}
            manualItems={manualItems}
            setManualItems={setManualItems}
            setDatabaseSubTab={setDatabaseSubTab}
            setStatus={setStatus}
            fetchShows={fetchShows}
            loadShowDetail={loadShowDetail}
            openPreview={openPreview}
            duplicateShow={duplicateShow}
            deleteShowDirect={deleteShowDirect}
            catalogSongs={catalogSongs}
            loadingCatalog={loadingCatalog}
            catalogSearch={catalogSearch}
            setCatalogSearch={setCatalogSearch}
            fetchCatalog={fetchCatalog}
            deleteFromLibrary={deleteFromLibrary}
            duplicateGroups={duplicateGroups}
            scanDuplicates={scanDuplicates}
            isScanning={isScanning}
            deleteDuplicate={deleteDuplicate}
            optimizeMediaPaths={optimizeMediaPaths}
            isOptimizing={isOptimizing}
            comparingPair={comparingPair}
            setComparingPair={setComparingPair}
            historyItems={historyItems}
            loadingHistory={loadingHistory}
            restoreItem={restoreItem}
            selectedTrashIds={selectedTrashIds}
            setSelectedTrashIds={setSelectedTrashIds}
            loadHistory={loadHistory}
            isSyncing={isSyncing}
            setIsSyncing={setIsSyncing}
            isDeletingScriptures={isDeletingScriptures}
            setIsDeletingScriptures={setIsDeletingScriptures}
            downloadBackup={downloadBackup}
            restoreSelectedItems={restoreSelectedItems}
            emptyTrash={emptyTrash}
            t={t}
          />
        ) : (
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1.2rem', margin: 0 }}>2. {t('items_playlist')} ({items.length})</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              {selectedIds.length > 0 && (
                <button 
                  onClick={removeSelected}
                  style={{ fontSize: '0.7rem', background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '3px 8px', borderRadius: '4px', cursor: 'pointer' }}
                >
                  🗑️ {t('clear_selected')} ({selectedIds.length})
                </button>
              )}
              {items.length > 0 && (
                <button 
                  onClick={() => { if(confirm('Weet je zeker dat je de lijst wilt wissen?')) setManualItems([]); }}
                  style={{ fontSize: '0.7rem', background: 'rgba(239, 68, 68, 0.2)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.4)', padding: '3px 8px', borderRadius: '4px', cursor: 'pointer' }}
                >
                  🗑️ Alles wissen
                </button>
              )}
            </div>
          </div>
          <div style={{ flex: 1, background: 'rgba(0,0,0,0.15)', borderRadius: '12px', padding: '0.75rem', overflowY: 'auto', maxHeight: '75vh' }}>
            {items.map((item, idx) => (
              <div key={item.id} style={{ 
                background: item.type === 'section' ? 'transparent' : 'rgba(255,255,255,0.03)', 
                padding: item.type === 'section' ? '0.5rem 0' : '0.6rem 0.8rem', 
                borderRadius: '6px', marginBottom: '0.3rem', position: 'relative',
                borderLeft: item.type === 'section' ? 'none' : `3px solid ${item.source === 'template' ? '#a855f7' : '#38bdf8'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.9rem'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
                  <input 
                    type="checkbox" 
                    checked={selectedIds.includes(item.id)}
                    onChange={e => {
                      if (e.target.checked) setSelectedIds([...selectedIds, item.id]);
                      else setSelectedIds(selectedIds.filter(id => id !== item.id));
                    }}
                    style={{ width: '14px', height: '14px' }}
                  />
                  {item.type === 'section' ? (
                    <div style={{ 
                      width: '100%', 
                      borderBottom: `2px solid ${item.color || '#38bdf8'}`, 
                      paddingBottom: '2px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline'
                    }}>
                      <span style={{ fontWeight: 'bold', fontSize: '0.95rem', color: item.color || '#38bdf8' }}>{getTranslatedTitle(item.title).toUpperCase()}</span>
                      {item.source === 'template' && (
                        <input 
                          type="color" 
                          value={item.color || '#38bdf8'} 
                          onChange={e => setTemplateItems(templateItems.map(i => i.id === item.id ? { ...i, color: e.target.value } : i))}
                          style={{ width: '20px', height: '20px', border: 'none', background: 'transparent', cursor: 'pointer' }}
                          title={t('section_color_tooltip')}
                        />
                      )}
                    </div>
                  ) : (
                    <>
                      <span style={{ opacity: 0.6, fontSize: '0.75rem', minWidth: '20px' }}>{idx + 1}.</span>
                      <span style={{ fontWeight: 500 }} title={item.type === 'song' ? item.title : item.type === 'bible' ? item.ref : t(item.title)}>
                        {item.type === 'song' ? item.title : item.type === 'bible' ? item.ref : t(item.title)}
                      </span>
                      {item.source === 'template' && <span style={{ fontSize: '0.6rem', opacity: 0.4 }}>(T)</span>}
                      {(item.swappedMediaPath || item.backgroundMedia || (item.extraSlides && item.extraSlides.length > 0)) && <span title={t('media_changed')} style={{ fontSize: '0.8rem', marginLeft: '0.3rem' }}>🎞️</span>}
                    </>
                  )}
                </div>
                
                {item.type !== 'section' && (
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    {item.source !== 'template' && (
                       <>
                         <button onClick={() => moveManualItemUp(item.id)} style={{ padding: '2px 6px', margin: '0 2px', opacity: 0.9, cursor: 'pointer', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '4px', color: '#fff', fontSize: '0.8rem' }} title="Omhoog verplaatsen">↑</button>
                         <button onClick={() => moveManualItemDown(item.id)} style={{ padding: '2px 6px', margin: '0 2px', opacity: 0.9, cursor: 'pointer', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '4px', color: '#fff', fontSize: '0.8rem' }} title="Omlaag verplaatsen">↓</button>
                         <button onClick={() => setDraftItem(item)} style={{ padding: '2px', opacity: 0.6, cursor: 'pointer', background: 'transparent', border: 'none', marginLeft: '6px' }} title={t('edit_staging')}>✏️</button>
                       </>
                    )}

                    <button 
                      onClick={() => {
                        if (item.source === 'template') {
                          setTemplateItems(templateItems.map(i => i.id === item.id ? { ...i, isRemoved: !i.isRemoved } : i));
                        } else {
                          removeItem(item.id);
                        }
                      }}
                      style={{ padding: '2px', opacity: 0.4 }}
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        )}
      </div>

      {/* Maintenance Comparison Modal */}
      {comparingPair && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
          <div className="glass-card" style={{ width: '100%', maxWidth: '1200px', height: '90vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2>{t('compare_duplicates_title')}</h2>
              <button className="button" style={{ background: 'rgba(255,255,255,0.1)' }} onClick={() => setComparingPair(null)}>{t('close')}</button>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', flex: 1, overflow: 'hidden' }}>
              {comparingPair.map((item, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
                  <div style={{ background: 'rgba(255,255,255,0.05)', padding: '1rem', borderRadius: '12px', marginBottom: '1rem' }}>
                    <div style={{ fontWeight: 'bold', color: 'var(--primary)' }}>{item.filename}</div>
                    <div style={{ fontSize: '0.8rem', opacity: 0.6 }}>{t('modified')}: {new Date(item.modified).toLocaleString()}</div>
                    <div style={{ fontSize: '0.8rem', opacity: 0.6 }}>{t('category')}: {getCategoryDisplayName(item.category, freeshowCategories)}</div>
                    {item.mediaInfo && (
                      <div style={{ marginTop: '0.5rem', padding: '0.4rem', background: 'rgba(255,255,255,0.05)', borderRadius: '6px', fontSize: '0.75rem', border: '1px solid var(--primary)' }}>
                        🎬 <b>{t('background')}:</b> {item.mediaInfo.name} ({item.mediaInfo.type})
                      </div>
                    )}
                  </div>
                  <div style={{ flex: 1, minHeight: 0, background: 'rgba(0,0,0,0.3)', padding: '1.5rem', borderRadius: '12px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.9rem', lineHeight: '1.6' }}>
                    {item.contentHash ? item.contentHash.split('\n').map((line: string, li: number) => (
                      <div key={li}>{line}</div>
                    )) : t('no_text_found')}
                  </div>
                  <button className="button" style={{ marginTop: '1rem', width: '100%', background: 'var(--primary)', color: '#020617' }} onClick={() => {
                    const other = comparingPair[1 - i];
                    deleteDuplicate(other.filename);
                    setComparingPair(null);
                  }}>
                    {t('keep_this_version')}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Show Editor Modal */}
      {selectedShow && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
          <div className="glass-card" style={{ width: '100%', maxWidth: '1000px', height: '90vh', display: 'flex', flexDirection: 'column', padding: '2rem' }}>
            
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '1rem' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.4rem', color: 'var(--primary)' }}>📝 Show Bewerken</h2>
                <div style={{ fontSize: '0.8rem', opacity: 0.5, marginTop: '0.2rem' }}>Bestandsnaam: {selectedShow[1].name}.show</div>
              </div>
              <button className="button" style={{ background: 'rgba(255,255,255,0.1)', padding: '0.5rem 1rem' }} onClick={() => setSelectedShow(null)}>Sluiten</button>
            </div>

            {/* Editor Config Fields */}
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
              <div style={{ flex: 2, minWidth: '200px' }}>
                <label style={{ fontSize: '0.8rem', opacity: 0.7, display: 'block', marginBottom: '0.4rem' }}>Naam van de Show</label>
                <input 
                  type="text" 
                  className="input" 
                  value={showEditorTitle} 
                  onChange={e => setShowEditorTitle(e.target.value)} 
                  style={{ margin: 0 }}
                  placeholder="Naam" 
                />
              </div>
              <div style={{ flex: 1, minWidth: '150px' }}>
                <label style={{ fontSize: '0.8rem', opacity: 0.7, display: 'block', marginBottom: '0.4rem' }}>Categorie</label>
                <select 
                  className="input" 
                  value={showEditorCategory} 
                  onChange={e => setShowEditorCategory(e.target.value)}
                  style={{ margin: 0 }}
                >
                  {uniqueCategories.map(cat => (
                    <option key={cat} value={cat}>
                      {getCategoryDisplayName(cat, freeshowCategories)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Mode Selector */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: '0.5rem', background: 'rgba(255,255,255,0.05)', padding: '0.3rem', borderRadius: '8px', width: 'fit-content' }}>
                <button
                  className="button"
                  style={{ background: showEditorMode === 'visual' ? 'var(--primary)' : 'transparent', padding: '0.4rem 1rem', fontSize: '0.8rem', borderRadius: '6px' }}
                  onClick={() => setShowEditorMode('visual')}
                >
                  Visual Editor
                </button>
                <button
                  className="button"
                  style={{ background: showEditorMode === 'raw' ? 'var(--primary)' : 'transparent', padding: '0.4rem 1rem', fontSize: '0.8rem', borderRadius: '6px' }}
                  onClick={() => setShowEditorMode('raw')}
                >
                  Raw JSON Editor
                </button>
              </div>
              {showEditorMode === 'visual' && (
                <button
                  className="button"
                  style={{ background: showPasteLyrics ? 'var(--primary)' : 'rgba(255,255,255,0.05)', color: showPasteLyrics ? '#020617' : '#fff', padding: '0.4rem 1rem', fontSize: '0.8rem', borderRadius: '6px' }}
                  onClick={() => setShowPasteLyrics(!showPasteLyrics)}
                >
                  📋 Plak volledige tekst
                </button>
              )}
            </div>

            {showEditorMode === 'visual' && showPasteLyrics && (
              <div className="glass-card" style={{ padding: '1rem', marginBottom: '1.5rem', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--card-border)', borderRadius: '8px' }}>
                <div style={{ fontSize: '0.75rem', opacity: 0.7, marginBottom: '0.5rem' }}>
                  Plak hier de volledige songtekst (lege regel = nieuwe slide, "[Refrein]" of "Couplet 1" wordt herkend als groepslabel). Dit vervangt alle huidige slides.
                </div>
                <textarea
                  className="input"
                  style={{ height: '160px', fontFamily: 'monospace', fontSize: '0.85rem', margin: 0, marginBottom: '0.5rem' }}
                  value={pasteLyricsText}
                  onChange={e => setPasteLyricsText(e.target.value)}
                  placeholder={'[Couplet 1]\nRegel 1\nRegel 2\n\n[Refrein]\nRegel 1\nRegel 2'}
                />
                <button
                  className="button"
                  style={{ background: 'var(--primary)', color: '#020617' }}
                  onClick={applyPastedLyrics}
                  disabled={isParsingLyrics || !pasteLyricsText.trim()}
                >
                  {isParsingLyrics ? 'Verwerken...' : 'Toepassen'}
                </button>
              </div>
            )}

            {/* Editor Body */}
            <div style={{ flex: 1, overflowY: 'auto', marginBottom: '1.5rem', paddingRight: '0.5rem' }}>
              {showEditorMode === 'visual' ? (
                showEditorSlides.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '3rem', opacity: 0.4 }}>Geen bewerkbare slides gevonden in deze show.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    {showEditorSlides.map((slideItem: any, idx: number) => {
                      const slideObj = slideItem.slideObj;
                      const item = slideObj?.items?.[0] || { type: 'text' };
                      const inferredType = getItemType(item);
                      const isText = inferredType === 'text';
                      const isMedia = inferredType === 'media';
                      
                      const groupLabel = slideObj?.group || `Slide ${idx + 1}`;
                      const groupColor = slideObj?.color || 'var(--primary)';
                      
                      let textVal = '';
                      if (isText) {
                        textVal = item.lines?.map((line: any) => line.text?.map((t: any) => t.value).join('') || '').join('\n') || '';
                      }
                      
                      let mediaSrc = '';
                      if (isMedia) {
                        mediaSrc = item.src || '';
                      }

                      return (
                        <div key={slideItem.id || idx} className="glass-card" style={{ padding: '1.25rem', borderLeft: `4px solid ${groupColor}`, background: 'rgba(255,255,255,0.01)', borderRadius: '8px' }}>
                          
                          {/* Slide Header with Index, Type & Controls */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.5rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', fontSize: '0.9rem', color: groupColor }}>
                              <span>Slide {idx + 1}</span>
                              <span style={{ fontSize: '0.75rem', padding: '2px 6px', borderRadius: '4px', background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)', fontWeight: 'normal' }}>
                                {isText ? 'Tekst' : isMedia ? 'Media' : 'Onbekend'}
                              </span>
                            </div>
                            
                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                              <button 
                                className="button" 
                                style={{ padding: '2px 8px', fontSize: '0.75rem', background: 'rgba(255,255,255,0.05)', minWidth: 'unset' }}
                                onClick={() => moveSlide(idx, 'up')}
                                disabled={idx === 0}
                                title="Omhoog verplaatsen"
                              >
                                ↑
                              </button>
                              <button 
                                className="button" 
                                style={{ padding: '2px 8px', fontSize: '0.75rem', background: 'rgba(255,255,255,0.05)', minWidth: 'unset' }}
                                onClick={() => moveSlide(idx, 'down')}
                                disabled={idx === showEditorSlides.length - 1}
                                title="Omlaag verplaatsen"
                              >
                                ↓
                              </button>
                              <button 
                                className="button" 
                                style={{ padding: '2px 8px', fontSize: '0.75rem', background: 'rgba(239, 68, 68, 0.1)', color: '#f87171', minWidth: 'unset', border: '1px solid rgba(239,68,68,0.2)' }}
                                onClick={() => toggleSlideType(idx)}
                                title="Wissel tussen Tekst en Media"
                              >
                                Wissel type
                              </button>
                              <button 
                                className="button" 
                                style={{ padding: '2px 8px', fontSize: '0.75rem', background: 'rgba(239, 68, 68, 0.2)', color: '#ef4444', minWidth: 'unset', border: '1px solid rgba(239,68,68,0.3)' }}
                                onClick={() => deleteSlide(idx)}
                                title="Slide verwijderen"
                              >
                                🗑️
                              </button>
                            </div>
                          </div>

                          {/* Slide Fields */}
                          {isText ? (
                            <textarea 
                              className="input" 
                              style={{ height: '100px', fontFamily: 'monospace', fontSize: '0.9rem', margin: 0 }}
                              value={textVal} 
                              onChange={e => updateSlideText(idx, e.target.value)}
                              placeholder="Typ hier de tekst voor de slide..."
                            />
                          ) : isMedia ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <span style={{ fontSize: '0.8rem', opacity: 0.7, minWidth: '90px' }}>Media Bron:</span>
                                <input 
                                  type="text" 
                                  className="input" 
                                  style={{ flex: 1, margin: 0, fontFamily: 'monospace', fontSize: '0.85rem' }}
                                  value={mediaSrc}
                                  onChange={e => updateSlideMedia(idx, e.target.value)}
                                  placeholder="Bijv. /volume1/Beamer/FreeShow/thema.jpg of thema.jpg"
                                />
                              </div>
                              <div style={{ fontSize: '0.75rem', opacity: 0.5, paddingLeft: '98px' }}>
                                Tip: Gebruik <code>/volume1/Beamer/FreeShow/thema.jpg</code> (of <code>/FreeShow/thema.jpg</code>) voor de automatische YouTube thumbnail background.
                              </div>
                            </div>
                          ) : (
                            <div style={{ opacity: 0.5, fontSize: '0.85rem' }}>Dit slide type wordt niet direct visueel ondersteund. Gebruik Raw JSON editor voor geavanceerde wijzigingen.</div>
                          )}

                        </div>
                      );
                    })}

                    {/* Add Slide Buttons */}
                    <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '1rem', borderTop: '1px dashed rgba(255,255,255,0.1)', paddingTop: '1.5rem' }}>
                      <button 
                        className="button" 
                        style={{ background: 'rgba(255,255,255,0.05)', fontSize: '0.85rem' }}
                        onClick={() => addSlide('text')}
                      >
                        + Voeg Tekst Slide toe
                      </button>
                      <button 
                        className="button" 
                        style={{ background: 'rgba(255,255,255,0.05)', fontSize: '0.85rem' }}
                        onClick={() => addSlide('media')}
                      >
                        + Voeg Media Slide toe
                      </button>
                    </div>
                  </div>
                )
              ) : (
                <textarea 
                  className="input" 
                  style={{ height: '100%', fontFamily: 'monospace', fontSize: '0.85rem', margin: 0, resize: 'none' }}
                  value={showEditorRawJson} 
                  onChange={e => setShowEditorRawJson(e.target.value)}
                />
              )}
            </div>

            {/* Footer Buttons */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.8rem', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '1.2rem' }}>
              <button className="button" style={{ background: 'rgba(255,255,255,0.1)' }} onClick={() => setSelectedShow(null)}>Annuleren</button>
              <button className="button" style={{ background: 'var(--primary)', minWidth: '120px', color: '#020617' }} onClick={saveShowChanges} disabled={isSavingShow}>
                {isSavingShow ? 'Opslaan...' : 'Wijzigingen Opslaan'}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Slide Preview Modal */}
      <PreviewModal
        previewShow={previewShow}
        templates={templates}
        selectedPreviewTemplate={selectedPreviewTemplate}
        setSelectedPreviewTemplate={setSelectedPreviewTemplate}
        currentPreviewSlideIdx={currentPreviewSlideIdx}
        setCurrentPreviewSlideIdx={setCurrentPreviewSlideIdx}
        onClose={() => setPreviewShow(null)}
      />

      <datalist id="available-songs">
        {catalogSongs.filter(s => s.category !== 'presentation' && s.category !== 'scripture').map((song, i) => <option key={i} value={song.name} />)}
      </datalist>
      <datalist id="available-presentations">
        {catalogSongs.filter(s => s.category === 'presentation').map((song, i) => <option key={i} value={song.name} />)}
      </datalist>
    </>
  )}
    </div>
  );
}
