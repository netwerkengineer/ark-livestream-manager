"use client";
import React, { useState, useEffect } from 'react';
import { translations } from '@/lib/translations';

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
  
  const BIBLE_BOOKS = [
    "Genesis", "Exodus", "Leviticus", "Numeri", "Deuteronomium", "Jozua", "Rechters", "Ruth", 
    "1 Samuël", "2 Samuël", "1 Koningen", "2 Koningen", "1 Kronieken", "2 Kronieken", "Ezra", "Nehemia", "Esther", 
    "Job", "Psalmen", "Spreuken", "Prediker", "Hooglied", "Jesaja", "Jeremia", "Klaagliederen", "Ezechiël", "Daniël", 
    "Hosea", "Joël", "Amos", "Obadja", "Jona", "Micha", "Nahum", "Habakuk", "Sefanja", "Haggaï", "Zacharia", "Maleachi",
    "Mattheüs", "Marcus", "Lukas", "Johannes", "Handelingen", "Romeinen", "1 Korinthiërs", "2 Korinthiërs", "Galaten", 
    "Efeziërs", "Filippenzen", "Kolossenzen", "1 Thessalonicenzen", "2 Thessalonicenzen", "1 Timotheüs", "2 Timotheüs", 
    "Titus", "Filemon", "Hebreeën", "Jakobus", "1 Petrus", "2 Petrus", "1 Johannes", "2 Johannes", "3 Johannes", "Judas", "Openbaring"
  ];
  
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
  const [comparingPair, setComparingPair] = useState<any[] | null>(null);
  const [catalogSongs, setCatalogSongs] = useState<any[]>([]);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [historyItems, setHistoryItems] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [selectedTrashIds, setSelectedTrashIds] = useState<string[]>([]);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');

  // Shows Database Dashboard geconsolideerde states
  const [databaseSubTab, setDatabaseSubTab] = useState<'catalog'|'builder'|'maintenance'>('catalog');
  const [showsList, setShowsList] = useState<any[]>([]);
  const [loadingShows, setLoadingShows] = useState(false);
  const [showsSearch, setShowsSearch] = useState('');
  const [showsCategoryFilter, setShowsCategoryFilter] = useState('all');
  const [showsSortOrder, setShowsSortOrder] = useState<'name'|'modified'>('name');

  const [selectedShow, setSelectedShow] = useState<any>(null); // Full JSON array [id, showObj]
  const [showEditorTitle, setShowEditorTitle] = useState('');
  const [showEditorCategory, setShowEditorCategory] = useState('');
  const [showEditorSlides, setShowEditorSlides] = useState<Record<string, string>>({}); // { slideId: slideText }
  const [showEditorRawJson, setShowEditorRawJson] = useState('');
  const [showEditorMode, setShowEditorMode] = useState<'visual'|'raw'>('visual');
  const [isSavingShow, setIsSavingShow] = useState(false);

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
      // Voeg items toe die VÓÓR deze sectie moeten komen
      if (tItem.type === 'section') {
        const beforeMatches = manualItems.filter(m => m.targetSection === tItem.title && m.insertPosition === 'before');
        combined.push(...beforeMatches);
      }
      
      combined.push(tItem);
      
      // Voeg items toe die NÁ deze sectie moeten komen
      if (tItem.type === 'section') {
        const afterMatches = manualItems.filter(m => m.targetSection === tItem.title && m.insertPosition === 'after');
        combined.push(...afterMatches);
      }
    });

    const remaining = manualItems.filter(m => 
      !m.targetSection || 
      m.targetSection === t('bottom') || 
      !activeTemplate.some(t => t.type === 'section' && t.title === m.targetSection)
    );
    
    setItems([...combined, ...remaining]);
  }, [manualItems, templateItems, useTemplate]);

  // Dynamische lijst van alle beschikbare secties voor de dropdown
  const allAvailableSections = React.useMemo(() => {
    const fromTemplate = templateItems.filter(i => i.type === 'section' && !i.isRemoved).map(i => i.title);
    const fromManual = manualItems.filter(i => i.type === 'section').map(i => i.title);
    return Array.from(new Set([t('bottom'), ...fromTemplate, ...fromManual]));
  }, [templateItems, manualItems]);

  const getTranslatedTitle = (title: string) => {
    // Probeer de titel te vertalen, val terug op origineel als geen vertaling beschikbaar is
    const translated = t(title);
    return translated === title ? title : translated;
  };

  const refreshCatalog = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/catalog');
      const data = await res.json();
      if (data.success) {
        setCatalog(data.catalog);
        setCatalogSongs(data.catalog.songs);
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
    } catch(e) {}
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
    setLoadingHistory(false);
  };

  const fetchShows = async () => {
    setLoadingShows(true);
    try {
      const res = await fetch('/api/shows');
      const data = await res.json();
      if (data.success) {
        setShowsList(data.shows);
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
        
        const extractedSlides: Record<string, string> = {};
        if (showObj.slides) {
          Object.entries(showObj.slides).forEach(([slideId, slide]: any) => {
            if (slide.items && slide.items[0] && slide.items[0].type === 'text') {
              const slideText = slide.items[0].lines?.map((line: any) => line.text?.map((t: any) => t.value).join('') || '').join('\n') || '';
              extractedSlides[slideId] = slideText;
            }
          });
        }
        setShowEditorSlides(extractedSlides);
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
        body = {
          title: showEditorTitle,
          category: showEditorCategory,
          slides: showEditorSlides
        };
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
            setManualItems([]);
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
          setManualItems([]);
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


  const filteredAvailableSongs = catalog.songs.filter(s => s.category === 'song');

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
            
            <div style={{ background: 'rgba(56, 189, 248, 0.1)', padding: '1.2rem', borderRadius: '12px', border: '1px solid rgba(56, 189, 248, 0.2)', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
              <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--primary)' }}>📄 {t('download_manual_pdf')}</h4>
              <p style={{ fontSize: '0.75rem', opacity: 0.7, marginBottom: '1rem' }}>{t('manual_print_hint')}</p>
              <a 
                href={`/manual/${lang}`} 
                target="_blank" 
                className="button"
                style={{ background: 'var(--primary)', textDecoration: 'none', display: 'inline-block', fontSize: '0.8rem' }}
              >
                📥 {t('download')}
              </a>
            </div>
          </div>
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
                <div style={{ fontWeight: 'bold', marginBottom: '1rem' }}>{draftItem.type === 'song' ? draftItem.title : draftItem.ref}</div>
                <textarea 
                  className="input" style={{ height: '350px', fontFamily: 'monospace' }}
                  value={draftItem.text} onChange={e => updateItemText(draftItem.id, e.target.value)}
                />
              </div>
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
                    <div>
                      <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.75rem', opacity: 0.7 }}>{t('search_song')}</label>
                      <input 
                        type="text" 
                        className="input" 
                        value={songInput} 
                        onChange={e => setSongInput(e.target.value)} 
                        placeholder={t('search_placeholder')} 
                        style={{ marginBottom: '0.5rem' }}
                      />
                      
                      <div className="glass-card" style={{ padding: '0.8rem', marginBottom: '1rem', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--card-border)', borderRadius: '8px' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block', marginBottom: '0.5rem' }}>
                          {songInput ? `Zoekresultaten (${catalogSongs.filter(s => s.category !== 'presentation' && s.name.toLowerCase().includes(songInput.toLowerCase())).length})` : 'Selecteer een lied uit de catalogus:'}
                        </span>
                        
                        <div style={{ maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px', paddingRight: '4px' }}>
                          {catalogSongs
                            .filter(s => s.category !== 'presentation' && (!songInput || s.name.toLowerCase().includes(songInput.toLowerCase())))
                            .slice(0, 50)
                            .map((song, i) => (
                              <div 
                                key={i} 
                                title={song.name}
                                style={{ 
                                  padding: '8px 12px', 
                                  background: 'rgba(255,255,255,0.02)', 
                                  border: '1px solid rgba(255,255,255,0.05)',
                                  borderRadius: '6px',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  transition: 'all 0.2s'
                                }}
                                onClick={() => { 
                                  adHocAddSong(song.name); 
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--primary)'}
                                onMouseLeave={(e) => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)'}
                              >
                                <span style={{ fontSize: '0.85rem', fontWeight: 500, color: '#fff' }}>{song.name}</span>
                                <span style={{ fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px', background: 'rgba(56, 189, 248, 0.1)', color: 'var(--primary)', fontWeight: 600 }}>
                                  {song.category}
                                </span>
                              </div>
                            ))
                          }
                          {catalogSongs.filter(s => s.category !== 'presentation' && (!songInput || s.name.toLowerCase().includes(songInput.toLowerCase()))).length === 0 && (
                            <div style={{ padding: '1rem', textAlign: 'center', opacity: 0.5, fontSize: '0.8rem' }}>
                              Geen liederen gevonden. Typ hierboven om handmatig toe te voegen.
                            </div>
                          )}
                        </div>
                      </div>

                      <button 
                        className="button" 
                        style={{ width: '100%', background: songInput ? 'var(--primary)' : 'rgba(255,255,255,0.05)', color: songInput ? '#020617' : '#ffffff' }} 
                        onClick={() => adHocAddSong()}
                        disabled={!songInput}
                      >
                        + Handmatig lied toevoegen: "{songInput || '...'}"
                      </button>
                    </div>
                  )}

                  {inputType === 'presentation' && (
                    <div>
                      <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.75rem', opacity: 0.7 }}>{t('search_presentation')}</label>
                      <input 
                        type="text" 
                        className="input" 
                        value={presentationInput} 
                        onChange={e => setPresentationInput(e.target.value)} 
                        placeholder={t('search_placeholder')} 
                        style={{ marginBottom: '0.5rem' }}
                      />
                      
                      <div className="glass-card" style={{ padding: '0.8rem', marginBottom: '1rem', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--card-border)', borderRadius: '8px' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block', marginBottom: '0.5rem' }}>
                          {presentationInput ? `Zoekresultaten (${catalogSongs.filter(s => s.category === 'presentation' && s.name.toLowerCase().includes(presentationInput.toLowerCase())).length})` : 'Selecteer een presentatie uit de catalogus:'}
                        </span>
                        
                        <div style={{ maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px', paddingRight: '4px' }}>
                          {catalogSongs
                            .filter(s => s.category === 'presentation' && (!presentationInput || s.name.toLowerCase().includes(presentationInput.toLowerCase())))
                            .slice(0, 50)
                            .map((song, i) => (
                              <div 
                                key={i} 
                                title={song.name}
                                style={{ 
                                  padding: '8px 12px', 
                                  background: 'rgba(255,255,255,0.02)', 
                                  border: '1px solid rgba(255,255,255,0.05)',
                                  borderRadius: '6px',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  transition: 'all 0.2s'
                                }}
                                onClick={() => { 
                                  adHocAddSong(song.name); 
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--primary)'}
                                onMouseLeave={(e) => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)'}
                              >
                                <span style={{ fontSize: '0.85rem', fontWeight: 500, color: '#fff' }}>{song.name}</span>
                                <span style={{ fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px', background: 'rgba(56, 189, 248, 0.1)', color: 'var(--primary)', fontWeight: 600 }}>
                                  PRESENTATIE
                                </span>
                              </div>
                            ))
                          }
                          {catalogSongs.filter(s => s.category === 'presentation' && (!presentationInput || s.name.toLowerCase().includes(presentationInput.toLowerCase()))).length === 0 && (
                            <div style={{ padding: '1rem', textAlign: 'center', opacity: 0.5, fontSize: '0.8rem' }}>
                              Geen presentaties gevonden. Typ hierboven om handmatig toe te voegen.
                            </div>
                          )}
                        </div>
                      </div>

                      <button 
                        className="button" 
                        style={{ width: '100%', background: presentationInput ? 'var(--primary)' : 'rgba(255,255,255,0.05)', color: presentationInput ? '#020617' : '#ffffff' }} 
                        onClick={() => adHocAddSong()}
                        disabled={!presentationInput}
                      >
                        + Handmatige presentatie toevoegen: "{presentationInput || '...'}"
                      </button>
                    </div>
                  )}
                {inputType === 'bible' && (
                  <div>
                    <select className="input" value={bibleTranslation} onChange={e => setBibleTranslation(e.target.value)}>
                       {catalog.bibles.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                      <select className="input" value={bibleBook} onChange={e => setBibleBook(e.target.value)} style={{ flex: 2 }}>
                        {BIBLE_BOOKS.map(b => <option key={b} value={b}>{b}</option>)}
                      </select>
                      <input type="number" className="input" value={bibleChapter} onChange={e => setBibleChapter(e.target.value)} style={{ flex: 1 }} />
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                      <input type="number" className="input" value={bibleVerseStart} onChange={e => setBibleVerseStart(e.target.value)} placeholder={t('from')} />
                      <input type="number" className="input" value={bibleVerseEnd} onChange={e => setBibleVerseEnd(e.target.value)} placeholder={t('to')} />
                    </div>
                    <button className="button" style={{ width: '100%', marginTop: '0.5rem' }} onClick={adHocAddBible} title={t('add_bible_to_staging')}>+ {t('add_bible')}</button>
                  </div>
                )}
                {inputType === 'section' && (
                  <div>
                    <input type="text" className="input" value={sectionName} onChange={e => setSectionName(e.target.value)} placeholder={t('section_title')} />
                    <input type="color" className="input" value={sectionColor} onChange={e => setSectionColor(e.target.value)} style={{ height: '40px', marginTop: '0.5rem' }} />
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
                    <button className="button" style={{ width: '100%', marginTop: '1rem' }} onClick={adHocAddSection} title={t('add_section_to_playlist')}>+ {t('add_section')}</button>
                  </div>
                )}

                {inputType === 'media' && (
                  <div>
                    <input type="file" accept="image/*,video/*" onChange={e => setMediaFile(e.target.files?.[0] || null)} className="input" />
                    
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
                      <div className="input-group">
                         <label style={{ fontSize: '0.65rem', marginBottom: '0.2rem', display: 'block' }}>{t('placement')}</label>
                         <div style={{ display: 'flex', gap: '2px', background: 'rgba(255,255,255,0.05)', padding: '2px', borderRadius: '4px' }}>
                            <button onClick={() => setMediaPlacementMode('direct')} title={t('place_direct')} style={{ flex: 1, padding: '4px', fontSize: '0.55rem', border: 'none', borderRadius: '3px', cursor: 'pointer', background: mediaPlacementMode === 'direct' ? 'var(--primary)' : 'transparent' }}>{t('file')}</button>
                            <button onClick={() => setMediaPlacementMode('show')} title={t('place_in_show')} style={{ flex: 1, padding: '4px', fontSize: '0.55rem', border: 'none', borderRadius: '3px', cursor: 'pointer', background: mediaPlacementMode === 'show' ? 'var(--primary)' : 'transparent' }}>{t('show')}</button>
                         </div>
                      </div>
                      <div className="input-group">
                         <label style={{ fontSize: '0.65rem', marginBottom: '0.2rem', display: 'block' }}>{t('layer_role')}</label>
                         <div style={{ display: 'flex', gap: '2px', background: 'rgba(255,255,255,0.05)', padding: '2px', borderRadius: '4px' }}>
                            <button onClick={() => setMediaLayer('foreground')} title={t('foreground_layer')} style={{ flex: 1, padding: '4px', fontSize: '0.6rem', border: 'none', borderRadius: '3px', cursor: 'pointer', background: mediaLayer === 'foreground' ? 'var(--primary)' : 'transparent' }}>{t('foreground')}</button>
                            <button onClick={() => setMediaLayer('background')} title={t('background_layer')} style={{ flex: 1, padding: '4px', fontSize: '0.6rem', border: 'none', borderRadius: '3px', cursor: 'pointer', background: mediaLayer === 'background' ? 'var(--primary)' : 'transparent' }}>{t('background')}</button>
                         </div>
                      </div>
                    </div>

                    {mediaPlacementMode === 'show' && (
                       <div className="input-group" style={{ marginBottom: '0.5rem' }}>
                          <label style={{ fontSize: '0.65rem', marginBottom: '0.2rem', display: 'block' }}>{t('show_name_optional')}</label>
                          <input type="text" className="input" value={mediaShowName} onChange={e => setMediaShowName(e.target.value)} placeholder={t('own_name')} style={{ fontSize: '0.8rem', marginBottom: 0 }} />
                       </div>
                    )}

                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button className="button" style={{ flex: 1, fontSize: '0.75rem' }} onClick={() => handleMediaUpload(true)} disabled={!mediaFile} title={t('upload_to_staging')}>{t('upload')}</button>
                      <button className="button" style={{ flex: 1, fontSize: '0.75rem', background: 'rgba(255,255,255,0.1)' }} onClick={() => handleMediaUpload(false)} disabled={!mediaFile || (!mediaAttachTarget && mediaTargetMode !== 'append')} title={t('attach_to_item')}>
                        {mediaTargetMode === 'append' ? t('add_slide') : t('attach_media')}
                      </button>
                    </div>
                    {mediaFile && mediaTargetMode === 'swap' && (
                      <select className="input" style={{ marginTop: '0.5rem', fontSize: '0.8rem' }} value={mediaAttachTarget || ''} onChange={e => setMediaAttachTarget(Number(e.target.value))}>
                        <option value="">-- {t('choose_item_for_bg')} --</option>
                        {items.filter(i => i.type === 'song' || i.source === 'template').map(i => <option key={i.id} value={i.id}>{i.title || i.name || i.ref}</option>)}
                      </select>
                    )}
                  </div>
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
                      <button 
                        className="button" 
                        style={{ justifyContent: 'flex-start', background: databaseSubTab === 'builder' ? 'var(--primary)' : 'rgba(255,255,255,0.05)', border: builderSlides.length > 0 ? '1px solid var(--primary)' : 'none', fontSize: '0.75rem', padding: '0.6rem' }} 
                        onClick={() => setDatabaseSubTab('builder')}
                      >
                        🛠️ Nieuwe Show {builderSlides.length > 0 ? `(${builderSlides.length})` : '(Builder)'}
                      </button>
                      <button 
                        className="button" 
                        style={{ justifyContent: 'flex-start', background: databaseSubTab === 'maintenance' ? 'var(--primary)' : 'rgba(255,255,255,0.05)', fontSize: '0.75rem', padding: '0.6rem' }} 
                        onClick={() => setDatabaseSubTab('maintenance')}
                      >
                        🧹 Database Onderhoud
                      </button>
                    </div>
                  </div>
                )}


                {inputType === 'youtube' && (
                  <div>
                    <input type="text" className="input" value={youtubeUrl} onChange={e => setYoutubeUrl(e.target.value)} placeholder={t('youtube_placeholder')} />
                    <button className="button" style={{ width: '100%', marginTop: '0.5rem' }} onClick={adHocAddYoutube} disabled={isDownloading}>
                      {isDownloading ? t('downloading') : `⬇️ ${t('download_add')}`}
                    </button>
                  </div>
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
            </>
          )}
        </div>

        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1.2rem', margin: 0 }}>2. {t('items_playlist')} ({items.length})</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              {selectedIds.length > 0 && (
                <button 
                  onClick={removeSelected}
                  style={{ fontSize: '0.7rem', background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '3px 8px', borderRadius: '4px' }}
                >
                  🗑️ {t('clear_selected')} ({selectedIds.length})
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
                       <button onClick={() => setDraftItem(item)} style={{ padding: '2px', opacity: 0.6 }} title={t('edit_staging')}>✏️</button>
                    )}
                    {item.source === 'template' && item.isMedia && (
                      <button onClick={() => { setMediaAttachTarget(item.id); setMediaTargetMode('swap'); setInputType('media'); }} style={{ padding: '2px', opacity: 0.6 }} title={t('swap_media')}>📸</button>
                    )}
                    {item.source === 'template' && (
                      <button onClick={() => { setMediaAttachTarget(item.id); setMediaTargetMode('append'); setInputType('media'); }} style={{ padding: '2px', opacity: 0.6 }} title={t('add_extra_slide')}>🎬+</button>
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
                <div key={i} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                  <div style={{ background: 'rgba(255,255,255,0.05)', padding: '1rem', borderRadius: '12px', marginBottom: '1rem' }}>
                    <div style={{ fontWeight: 'bold', color: 'var(--primary)' }}>{item.filename}</div>
                    <div style={{ fontSize: '0.8rem', opacity: 0.6 }}>{t('modified')}: {new Date(item.modified).toLocaleString()}</div>
                    <div style={{ fontSize: '0.8rem', opacity: 0.6 }}>{t('category')}: {item.category}</div>
                    {item.mediaInfo && (
                      <div style={{ marginTop: '0.5rem', padding: '0.4rem', background: 'rgba(255,255,255,0.05)', borderRadius: '6px', fontSize: '0.75rem', border: '1px solid var(--primary)' }}>
                        🎬 <b>{t('background')}:</b> {item.mediaInfo.name} ({item.mediaInfo.type})
                      </div>
                    )}
                  </div>
                  <div style={{ flex: 1, background: 'rgba(0,0,0,0.3)', padding: '1.5rem', borderRadius: '12px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.9rem', lineHeight: '1.6' }}>
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
                  <option value="song">Liederen (song)</option>
                  <option value="presentation">Presentaties (presentation)</option>
                  <option value="scripture">Bijbelteksten (scripture)</option>
                  <option value="unknown">Onbekend (unknown)</option>
                </select>
              </div>
            </div>

            {/* Mode Selector */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', background: 'rgba(255,255,255,0.05)', padding: '0.3rem', borderRadius: '8px', width: 'fit-content' }}>
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

            {/* Editor Body */}
            <div style={{ flex: 1, overflowY: 'auto', marginBottom: '1.5rem', paddingRight: '0.5rem' }}>
              {showEditorMode === 'visual' ? (
                Object.keys(showEditorSlides).length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '3rem', opacity: 0.4 }}>Geen bewerkbare slides gevonden in deze show.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                    {Object.entries(showEditorSlides).map(([slideId, text], idx) => {
                      const slideObj = selectedShow[1].slides?.[slideId];
                      const groupLabel = slideObj?.group || `Slide ${idx + 1}`;
                      const groupColor = slideObj?.color || 'var(--primary)';
                      return (
                        <div key={slideId} className="glass-card" style={{ padding: '1rem', borderLeft: `4px solid ${groupColor}`, background: 'rgba(255,255,255,0.01)', borderRadius: '8px' }}>
                          <div style={{ fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '0.6rem', color: groupColor }}>
                            🏷️ {groupLabel}
                          </div>
                          <textarea 
                            className="input" 
                            style={{ height: '140px', fontFamily: 'monospace', fontSize: '0.9rem', margin: 0 }}
                            value={text} 
                            onChange={e => setShowEditorSlides({ ...showEditorSlides, [slideId]: e.target.value })}
                          />
                        </div>
                      );
                    })}
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

      {/* Unified Database Dashboard & Manager View */}
      {inputType === 'database' && (
        <div className="database-dashboard-view" style={{ marginTop: '3rem' }}>
          {databaseSubTab === 'catalog' && (
            <div className="glass-card" style={{ padding: '2rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
                <h2 style={{ margin: 0 }}>📂 {t('tab_database')}</h2>
                <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  {/* Search */}
                  <input 
                    type="text" 
                    className="input" 
                    placeholder={t('search_placeholder')} 
                    value={showsSearch} 
                    onChange={e => setShowsSearch(e.target.value)} 
                    style={{ margin: 0, width: '220px' }} 
                  />
                  {/* Category Filter */}
                  <select 
                    className="input" 
                    value={showsCategoryFilter} 
                    onChange={e => setShowsCategoryFilter(e.target.value)} 
                    style={{ margin: 0, width: '150px' }}
                  >
                    <option value="all">Alle Categorieën</option>
                    <option value="song">Liederen (song)</option>
                    <option value="presentation">Presentaties (presentation)</option>
                    <option value="scripture">Bijbelteksten (scripture)</option>
                    <option value="unknown">Onbekend (unknown)</option>
                  </select>
                  {/* Sorting */}
                  <select 
                    className="input" 
                    value={showsSortOrder} 
                    onChange={e => setShowsSortOrder(e.target.value as any)} 
                    style={{ margin: 0, width: '150px' }}
                  >
                    <option value="name">Naam (A-Z)</option>
                    <option value="modified">Laatst Gewijzigd</option>
                  </select>
                  <button className="button" onClick={fetchShows}>🔄</button>
                </div>
              </div>

              {loadingShows ? (
                <div style={{ textAlign: 'center', padding: '3rem', opacity: 0.5 }}>{t('loading')}</div>
              ) : showsList.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem', opacity: 0.5 }}>Geen shows gevonden op de NAS.</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem' }}>
                  {showsList
                    .filter(s => {
                      const matchesSearch = s.name.toLowerCase().includes(showsSearch.toLowerCase());
                      const matchesCategory = showsCategoryFilter === 'all' || s.category === showsCategoryFilter;
                      return matchesSearch && matchesCategory;
                    })
                    .sort((a, b) => {
                      if (showsSortOrder === 'modified') {
                        return new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime();
                      }
                      return a.name.localeCompare(b.name);
                    })
                    .map((show, i) => (
                      <div key={i} className="glass-card" style={{ padding: '1.2rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px', background: 'rgba(255,255,255,0.02)' }}>
                        <div>
                          <div style={{ fontWeight: 'bold', fontSize: '1rem', marginBottom: '0.4rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={show.name}>
                            {show.name}
                          </div>
                          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.8rem', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', borderRadius: '4px', background: 'rgba(255,255,255,0.08)', opacity: 0.8 }}>
                              🏷️ {show.category}
                            </span>
                            <span style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', borderRadius: '4px', background: 'rgba(255,255,255,0.08)', opacity: 0.8 }}>
                              📄 {show.slideCount} slides
                            </span>
                          </div>
                          <div style={{ fontSize: '0.7rem', opacity: 0.5, marginBottom: '1rem' }}>
                            🕒 {new Date(show.lastModified).toLocaleString('nl-NL')}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button className="button" style={{ flex: 2, padding: '0.4rem', fontSize: '0.75rem', background: 'var(--primary)', color: '#020617' }} onClick={() => loadShowDetail(show.filename)}>
                            📝 Bewerken
                          </button>
                          <button className="button" style={{ flex: 1, padding: '0.4rem', fontSize: '0.75rem', background: 'rgba(255,255,255,0.1)' }} onClick={() => duplicateShow(show.filename)} title="Dupliceren">
                            👯
                          </button>
                          <button className="button" style={{ flex: 1, padding: '0.4rem', fontSize: '0.75rem', background: 'rgba(255,0,0,0.15)', color: '#ef4444' }} onClick={() => deleteShowDirect(show.filename)} title="Verwijderen naar prullenbak">
                            🗑️
                          </button>
                        </div>
                      </div>
                    ))
                  }
                </div>
              )}
            </div>
          )}

          {databaseSubTab === 'builder' && (
            <div className="glass-card" style={{ padding: '2rem', maxWidth: '600px', margin: '0 auto' }}>
              <h2 style={{ margin: '0 0 1.5rem 0' }}>🛠️ {t('tab_builder')}</h2>
              <input type="text" className="input" placeholder={t('show_name_placeholder')} value={builderTitle} onChange={e => setBuilderTitle(e.target.value)} />
              <div style={{ maxHeight: '400px', overflowY: 'auto', marginBottom: '1.2rem', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', padding: '0.8rem' }}>
                 {builderSlides.length === 0 && <div style={{ fontSize: '0.85rem', opacity: 0.4, textAlign: 'center', padding: '2rem 0' }}>{t('builder_empty_hint')}</div>}
                 {builderSlides.map((s, idx) => (
                   <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0.8rem', background: 'rgba(255,255,255,0.03)', marginBottom: '0.4rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.02)' }}>
                      <div style={{ fontSize: '0.8rem' }}>
                         <span style={{ opacity: 0.5, marginRight: '0.8rem', fontWeight: 'bold' }}>{idx+1}</span>
                         <span>{t(s.title) || (s.type === 'bible' ? s.ref : (s.text?.substring(0, 30) + '...'))}</span>
                      </div>
                      <button onClick={() => setBuilderSlides(builderSlides.filter((_, i) => i !== idx))} style={{ color: '#f87171', background: 'transparent', padding: 0, border: 'none', cursor: 'pointer' }}>✕</button>
                   </div>
                 ))}
              </div>
              <div style={{ display: 'flex', gap: '0.8rem' }}>
                 <button className="button" style={{ flex: 1, background: 'var(--primary)', color: '#020617' }} disabled={builderSlides.length === 0} onClick={() => {
                    const newItem = {
                      id: Date.now(),
                      type: 'complex-show',
                      title: builderTitle || 'Custom Show',
                      slides: builderSlides,
                      status: 'manual',
                      targetSection,
                      insertPosition
                    };
                    setManualItems([...manualItems, newItem]);
                    setBuilderSlides([]);
                    setBuilderTitle('');
                    setDatabaseSubTab('catalog');
                    setStatus(t('item_added_to_playlist'));
                 }}>{t('create_show_add')}</button>
                 <button className="button" style={{ background: 'rgba(255,255,255,0.1)' }} onClick={() => setBuilderSlides([])}>{t('clear')}</button>
              </div>
            </div>
          )}

          {databaseSubTab === 'maintenance' && (
            <div className="maintenance-grid">
              {/* Left Column: Duplicate Scanner */}
              <div className="glass-card" style={{ padding: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                  <h3 style={{ margin: 0 }}>🔍 {t('duplicates')}</h3>
                  <button className="button" style={{ background: 'var(--primary)', padding: '0.4rem 0.8rem', fontSize: '0.75rem', color: '#020617' }} onClick={scanDuplicates} disabled={isScanning}>
                    {isScanning ? t('loading') : t('start_scan')}
                  </button>
                </div>
                
                <div style={{ height: '500px', overflowY: 'auto' }}>
                  {duplicateGroups.length === 0 ? (
                    <div style={{ textAlign: 'center', opacity: 0.4, padding: '2rem' }}>
                      {isScanning ? t('loading') : t('error_not_found')}
                    </div>
                  ) : (
                    duplicateGroups.map((group, idx) => (
                      <div key={idx} style={{ background: 'rgba(255,255,255,0.05)', padding: '1rem', borderRadius: '12px', marginBottom: '1rem', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <div style={{ fontWeight: 'bold', fontSize: '0.9rem', marginBottom: '0.8rem' }}>{group[0].name}</div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button className="button" style={{ flex: 1, fontSize: '0.75rem' }} onClick={() => setComparingPair([group[0], group[1]])}>{t('compare')}</button>
                          <button className="button" style={{ padding: '0.4rem', background: 'rgba(255,0,0,0.1)' }} onClick={() => deleteDuplicate(group[1].filename)}>🗑️</button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Right Column: Library Management */}
              <div className="glass-card" style={{ padding: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h3 style={{ margin: 0 }}>📖 {t('library')}</h3>
                  <button className="button" style={{ padding: '0.4rem 0.8rem', fontSize: '0.75rem' }} onClick={downloadBackup}>
                     {t('backup')}
                  </button>
                </div>

                <div style={{ marginBottom: '1.5rem' }}>
                  <input 
                    type="text" 
                    className="input" 
                    placeholder={t('search_placeholder')} 
                    value={catalogSearch}
                    onChange={(e) => setCatalogSearch(e.target.value)}
                    style={{ margin: 0 }}
                  />
                </div>

                <div style={{ height: '445px', overflowY: 'auto' }}>
                  {loadingCatalog ? (
                    <div style={{ textAlign: 'center', padding: '1rem', opacity: 0.5 }}>{t('loading')}</div>
                  ) : (
                    catalogSongs
                      .filter(s => s.name.toLowerCase().includes(catalogSearch.toLowerCase()))
                      .map((song, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.8rem 0.5rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                          <div style={{ overflow: 'hidden' }}>
                            <div style={{ fontSize: '0.9rem', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{song.name}</div>
                            <div style={{ fontSize: '0.7rem', opacity: 0.4 }}>{song.category}</div>
                          </div>
                          <button 
                            onClick={() => deleteFromLibrary(song.name + '.show')}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', opacity: 0.4 }}
                          >
                            🗑️
                          </button>
                        </div>
                      ))
                  )}
                </div>
              </div>

              {/* Third Column: History / Trash */}
              <div className="glass-card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
                 <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                   <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                     裁 {t('trash')}
                   </h3>
                   {selectedTrashIds.length > 0 && (
                     <button 
                       className="button" 
                       style={{ padding: '0.3rem 0.6rem', fontSize: '0.7rem', background: 'var(--primary)' }}
                       onClick={restoreSelectedItems}
                     >
                       🔄 {t('restore_selected')} ({selectedTrashIds.length})
                     </button>
                   )}
                 </div>
                 
                 <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                    <button 
                      className="button" 
                      style={{ flex: 1, padding: '0.3rem', fontSize: '0.65rem', background: 'rgba(255,255,255,0.05)' }} 
                      onClick={() => setSelectedTrashIds(historyItems.map(i => i.id))}
                    >
                      {t('select_all')}
                    </button>
                    <button 
                      className="button" 
                      style={{ flex: 1, padding: '0.3rem', fontSize: '0.65rem', background: 'rgba(255,255,255,0.05)' }} 
                      onClick={() => setSelectedTrashIds([])}
                    >
                      {t('deselect_all')}
                    </button>
                 </div>

                 <div style={{ flex: 1, overflowY: 'auto', maxHeight: '500px' }}>
                   {loadingHistory ? (
                     <div style={{ textAlign: 'center', padding: '1rem', opacity: 0.5 }}>{t('loading')}</div>
                   ) : historyItems.length > 0 ? (
                     historyItems.map((item, idx) => (
                        <div key={idx} style={{ padding: '0.8rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', marginBottom: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                           <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', overflow: 'hidden' }}>
                             <input 
                                 type="checkbox" 
                                 checked={selectedTrashIds.includes(item.id)}
                                 onChange={e => {
                                   if (e.target.checked) setSelectedTrashIds([...selectedTrashIds, item.id]);
                                   else setSelectedTrashIds(selectedTrashIds.filter(id => id !== item.id));
                                 }}
                                 style={{ width: '14px', height: '14px' }}
                              />
                              <div style={{ overflow: 'hidden' }}>
                                <div style={{ fontSize: '0.85rem', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{item.name}</div>
                                <div style={{ fontSize: '0.7rem', opacity: 0.4 }}>🗑️ {t('deleted')}: {new Date(item.deletedAt).toLocaleString()}</div>
                              </div>
                            </div>
                            <button 
                              className="button" 
                              style={{ padding: '0.3rem 0.6rem', fontSize: '0.7rem', background: 'rgba(255,255,255,0.1)' }}
                              onClick={() => restoreItem(item.id)}
                            >
                              {t('restore')}
                            </button>
                         </div>
                       ))
                     ) : (
                       <div style={{ padding: '2rem', textAlign: 'center', opacity: 0.5, fontSize: '0.8rem' }}>
                         {t('no_history')}
                       </div>
                     )}
                   </div>
                </div>
              </div>
          )}
        </div>
      )}

      <datalist id="available-songs">
        {catalogSongs.filter(s => s.category !== 'presentation').map((song, i) => <option key={i} value={song.name} />)}
      </datalist>
      <datalist id="available-presentations">
        {catalogSongs.filter(s => s.category === 'presentation').map((song, i) => <option key={i} value={song.name} />)}
      </datalist>
    </>
  )}
    </div>
  );
}
