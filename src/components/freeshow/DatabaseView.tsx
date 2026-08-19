"use client";
import React, { useState } from 'react';
import { getCategoryDisplayName } from '@/lib/freeshowUtils';
import DraftServicesReview from './DraftServicesReview';

interface DatabaseViewProps {
  databaseSubTab: 'catalog' | 'builder' | 'maintenance' | 'drafts';
  showsSearch: string;
  setShowsSearch: (value: string) => void;
  showsCategoryFilter: string;
  setShowsCategoryFilter: (value: string) => void;
  showsSortOrder: 'name' | 'modified';
  setShowsSortOrder: (value: 'name' | 'modified') => void;
  loadingShows: boolean;
  showsList: any[];
  uniqueCategories: string[];
  builderSlides: any[];
  setBuilderSlides: (slides: any[]) => void;
  builderTitle: string;
  setBuilderTitle: (title: string) => void;
  targetSection: string;
  insertPosition: 'before' | 'after';
  manualItems: any[];
  setManualItems: (items: any[]) => void;
  setDatabaseSubTab: (tab: 'catalog' | 'builder' | 'maintenance') => void;
  setStatus: (status: string) => void;
  fetchShows: () => void;
  loadShowDetail: (filename: string) => void;
  openPreview: (filename: string) => void;
  duplicateShow: (filename: string) => void;
  deleteShowDirect: (filename: string) => void;
  catalogSongs: any[];
  loadingCatalog: boolean;
  catalogSearch: string;
  setCatalogSearch: (value: string) => void;
  fetchCatalog: () => void;
  deleteFromLibrary: (filename: string) => void;
  duplicateGroups: any[];
  scanDuplicates: () => void;
  isScanning: boolean;
  deleteDuplicate: (filename: string) => void;
  optimizeMediaPaths: () => void;
  isOptimizing: boolean;
  comparingPair: any[] | null;
  setComparingPair: (pair: any[] | null) => void;
  historyItems: any[];
  loadingHistory: boolean;
  restoreItem: (id: string) => void;
  selectedTrashIds: string[];
  setSelectedTrashIds: (ids: string[]) => void;
  loadHistory: () => void;
  isSyncing: boolean;
  setIsSyncing: (value: boolean) => void;
  isDeletingScriptures: boolean;
  setIsDeletingScriptures: (value: boolean) => void;
  downloadBackup: () => void;
  restoreSelectedItems: () => void;
  emptyTrash: () => void;
  t: (key: string) => string;
  freeshowCategories?: Record<string, { name: string; icon?: string; default?: boolean }>;
}

export default function DatabaseView(props: DatabaseViewProps) {
  const {
    databaseSubTab,
    showsSearch,
    setShowsSearch,
    showsCategoryFilter,
    setShowsCategoryFilter,
    showsSortOrder,
    setShowsSortOrder,
    loadingShows,
    showsList,
    uniqueCategories,
    builderSlides,
    setBuilderSlides,
    builderTitle,
    setBuilderTitle,
    targetSection,
    insertPosition,
    manualItems,
    setManualItems,
    setDatabaseSubTab,
    setStatus,
    fetchShows,
    loadShowDetail,
    openPreview,
    duplicateShow,
    deleteShowDirect,
    catalogSongs,
    loadingCatalog,
    catalogSearch,
    setCatalogSearch,
    fetchCatalog,
    deleteFromLibrary,
    duplicateGroups,
    scanDuplicates,
    isScanning,
    deleteDuplicate,
    optimizeMediaPaths,
    isOptimizing,
    comparingPair,
    setComparingPair,
    historyItems,
    loadingHistory,
    restoreItem,
    selectedTrashIds,
    setSelectedTrashIds,
    loadHistory,
    isSyncing,
    setIsSyncing,
    isDeletingScriptures,
    setIsDeletingScriptures,
    downloadBackup,
    restoreSelectedItems,
    emptyTrash,
    t,
    freeshowCategories
  } = props;

  const categoryCounts = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const show of showsList) {
      counts[show.category] = (counts[show.category] || 0) + 1;
    }
    return counts;
  }, [showsList]);

  const [isImportingProject, setIsImportingProject] = useState(false);
  const [importProjectStatus, setImportProjectStatus] = useState('');

  interface SyncTargetStatus { key: string; label?: string; status: 'pending' | 'running' | 'done' | 'skipped' | 'error' }
  interface SyncStatus {
    running: boolean;
    started_at?: string;
    finished_at?: string | null;
    success?: boolean | null;
    error?: string | null;
    targets?: SyncTargetStatus[];
  }
  const [syncProgress, setSyncProgress] = useState<SyncStatus | null>(null);

  // Polls the sync status file: on mount (to catch a sync started elsewhere,
  // e.g. before the page was reopened) and continuously while running, so
  // progress and the completion notification show up without a refresh.
  // isSyncing is driven entirely by this poll rather than by the button
  // click itself, since a manual sync keeps running long after the HTTP
  // call that triggers it returns.
  const pollSyncStatus = React.useCallback(async () => {
    try {
      const res = await fetch('/api/maintenance/sync/status', { cache: 'no-store' });
      const data: SyncStatus = await res.json();
      setSyncProgress(prev => {
        if (prev?.running && !data.running) {
          if (data.success === false) {
            setStatus('❌ Sync mislukt: ' + (data.error || 'Onbekende fout'));
          } else if (data.success === true) {
            setStatus('✅ Sync voltooid.');
          }
        }
        return data;
      });
      setIsSyncing(data.running);
    } catch {
      // Best-effort polling only - a failed check just gets retried
    }
  }, []);

  React.useEffect(() => {
    pollSyncStatus();
    const interval = setInterval(pollSyncStatus, 5000);
    return () => clearInterval(interval);
  }, [pollSyncStatus]);

  return (
    <div className="database-dashboard-view" style={{ marginTop: '3rem' }}>
          {databaseSubTab === 'catalog' && (
            <div className="glass-card" style={{ padding: '2rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
                <h2 style={{ margin: 0 }}>📂 {t('tab_database')} <span style={{ fontSize: '0.85rem', opacity: 0.5, fontWeight: 'normal' }}>({showsList.length})</span></h2>
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
                    <option value="all">Alle Categorieën ({showsList.length})</option>
                    {uniqueCategories.map(cat => (
                      <option key={cat} value={cat}>
                        {getCategoryDisplayName(cat, freeshowCategories)} ({categoryCounts[cat] || 0})
                      </option>
                    ))}
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
                              🏷️ {getCategoryDisplayName(show.category, freeshowCategories)}
                            </span>
                            <span style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', borderRadius: '4px', background: 'rgba(255,255,255,0.08)', opacity: 0.8 }}>
                              📄 {show.slideCount} slides
                            </span>
                          </div>
                          <div style={{ fontSize: '0.7rem', opacity: 0.5, marginBottom: '1rem' }}>
                            🕒 {new Date(show.lastModified).toLocaleString('nl-NL')}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', width: '100%' }}>
                          <div className="tooltip-container" style={{ flex: 2 }}>
                            <button className="button" style={{ width: '100%', padding: '0.4rem', fontSize: '0.75rem', background: 'var(--primary)', color: '#020617' }} onClick={() => loadShowDetail(show.filename)}>
                              📝 Bewerken
                            </button>
                            <span className="tooltip-text">Show bewerken</span>
                          </div>
                          <div className="tooltip-container" style={{ flex: 2 }}>
                            <button className="button" style={{ width: '100%', padding: '0.4rem', fontSize: '0.75rem', background: 'rgba(255,255,255,0.15)', color: '#fff' }} onClick={() => openPreview(show.filename)}>
                              👁️ Preview
                            </button>
                            <span className="tooltip-text">Slide preview bekijken</span>
                          </div>
                          <div className="tooltip-container" style={{ flex: 1 }}>
                            <button className="button" style={{ width: '100%', padding: '0.4rem', fontSize: '0.75rem', background: 'rgba(255,255,255,0.1)' }} onClick={() => duplicateShow(show.filename)}>
                              👯
                            </button>
                            <span className="tooltip-text">Show dupliceren</span>
                          </div>
                          <div className="tooltip-container" style={{ flex: 1 }}>
                            <button className="button" style={{ width: '100%', padding: '0.4rem', fontSize: '0.75rem', background: 'rgba(255,0,0,0.15)', color: '#ef4444' }} onClick={() => deleteShowDirect(show.filename)}>
                              🗑️
                            </button>
                            <span className="tooltip-text">Verwijderen naar prullenbak</span>
                          </div>
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
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button className="button" style={{ padding: '0.4rem 0.8rem', fontSize: '0.75rem' }} onClick={optimizeMediaPaths} disabled={isOptimizing}>
                       {isOptimizing ? t('loading') : t('optimize_media')}
                    </button>
                    <button className="button" style={{ padding: '0.4rem 0.8rem', fontSize: '0.75rem' }} onClick={downloadBackup}>
                       {t('backup')}
                    </button>
                  </div>
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
                            <div style={{ fontSize: '0.7rem', opacity: 0.4 }}>{getCategoryDisplayName(song.category, freeshowCategories)}</div>
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
                   <div style={{ display: 'flex', gap: '0.5rem' }}>
                     {selectedTrashIds.length > 0 && (
                       <button 
                         className="button" 
                         style={{ padding: '0.3rem 0.6rem', fontSize: '0.7rem', background: 'var(--primary)' }}
                         onClick={restoreSelectedItems}
                       >
                         🔄 {t('restore_selected')} ({selectedTrashIds.length})
                       </button>
                     )}
                     {historyItems.length > 0 && (
                       <button 
                         className="button" 
                         style={{ padding: '0.3rem 0.6rem', fontSize: '0.7rem', background: 'rgba(255,0,0,0.15)', color: '#ef4444' }}
                         onClick={emptyTrash}
                       >
                         🗑️ {t('empty_trash')}
                       </button>
                     )}
                   </div>
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

               {/* Fourth Column: System Actions */}
               <div className="glass-card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
                 <h3 style={{ margin: 0, marginBottom: '1.5rem' }}>{t('system_actions')}</h3>
                 <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1 }}>
                   <div style={{ background: 'rgba(255,255,255,0.03)', padding: '1.2rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                     <p style={{ fontSize: '0.8rem', opacity: 0.6, marginBottom: '0.8rem' }}>Synchroniseer Shows, Bibles, Templates en Media tussen de NAS en de Beamer PC. Dit is hetzelfde als de automatische wekelijkse sync, maar handmatig gestart.</p>
                     <button
                       className="button"
                       style={{ width: '100%', background: 'var(--primary)', color: '#020617', padding: '0.6rem', fontSize: '0.8rem', fontWeight: 700 }}
                       disabled={isSyncing}
                       onClick={async () => {
                         setIsSyncing(true);
                         setStatus(t('syncing'));
                         try {
                           const res = await fetch('/api/maintenance/sync', { method: 'POST' });
                           const data = await res.json();
                           if (res.ok) {
                             setStatus('✅ Sync gestart op de achtergrond: ' + (data.message || 'OK') + ' - dit kan enkele minuten duren.');
                             // Status file needs a moment to reflect the new run - poll
                             // shortly after so progress shows up without waiting 5s.
                             setTimeout(pollSyncStatus, 1500);
                           } else {
                             setStatus('❌ Sync fout: ' + (data.error || 'Onbekende fout'));
                             setIsSyncing(false);
                           }
                         } catch (e: any) {
                           setStatus('❌ Sync fout: ' + e.message);
                           setIsSyncing(false);
                         }
                       }}
                     >
                       {isSyncing ? t('syncing') : t('manual_sync')}
                     </button>
                     {isSyncing && syncProgress?.targets && syncProgress.targets.length > 0 && (
                       <div style={{ marginTop: '0.8rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                         {syncProgress.targets.map(target => {
                           const icon = target.status === 'done' ? '✅'
                             : target.status === 'error' ? '❌'
                             : target.status === 'skipped' ? '⏭️'
                             : target.status === 'running' ? '⏳'
                             : '⏸️';
                           return (
                             <p key={target.key} style={{ fontSize: '0.72rem', opacity: 0.75, margin: 0 }}>
                               {icon} {target.label || target.key}
                             </p>
                           );
                         })}
                       </div>
                     )}
                   </div>

                   <div style={{ background: 'rgba(255,255,255,0.03)', padding: '1.2rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                     <p style={{ fontSize: '0.8rem', opacity: 0.6, marginBottom: '0.8rem' }}>Stuur het laatst gegenereerde project direct naar de Beamer PC en zet het klaar in FreeShow, zonder te wachten op een stekker-schema. Handig als de PC al aanstaat.</p>
                     <button
                       className="button"
                       style={{ width: '100%', background: 'var(--primary)', color: '#020617', padding: '0.6rem', fontSize: '0.8rem', fontWeight: 700 }}
                       disabled={isImportingProject}
                       onClick={async () => {
                         setIsImportingProject(true);
                         setImportProjectStatus('Project wordt klaargezet...');
                         try {
                           const res = await fetch('/api/maintenance/import-project', { method: 'POST' });
                           const data = await res.json();
                           if (res.ok) {
                             setImportProjectStatus('✅ ' + (data.message || 'OK'));
                           } else {
                             setImportProjectStatus('❌ Fout: ' + (data.error || 'Onbekende fout'));
                           }
                         } catch (e: any) {
                           setImportProjectStatus('❌ Fout: ' + e.message);
                         } finally {
                           setIsImportingProject(false);
                         }
                       }}
                     >
                       {isImportingProject ? 'Bezig...' : 'Project nu klaarzetten'}
                     </button>
                     {importProjectStatus && (
                       <p style={{ fontSize: '0.75rem', marginTop: '0.6rem', color: 'var(--primary)', textAlign: 'center' }}>{importProjectStatus}</p>
                     )}
                   </div>

                   <div style={{ background: 'rgba(239,68,68,0.05)', padding: '1.2rem', borderRadius: '12px', border: '1px solid rgba(239,68,68,0.15)' }}>
                     <p style={{ fontSize: '0.8rem', opacity: 0.6, marginBottom: '0.8rem' }}>Verwijder alle bijbeltekst-shows (categorie &quot;bible&quot;) van zowel de NAS als de Beamer PC. Dit kan niet ongedaan worden gemaakt.</p>
                     <button
                       className="button"
                       style={{ width: '100%', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.35)', color: '#ef4444', padding: '0.6rem', fontSize: '0.8rem', fontWeight: 700 }}
                       disabled={isDeletingScriptures}
                       onClick={async () => {
                         if (!confirm(t('delete_scriptures_confirm'))) return;
                         setIsDeletingScriptures(true);
                         setStatus(t('deleting_scriptures'));
                         try {
                           const res = await fetch('/api/maintenance/delete-scriptures', { method: 'POST' });
                           const data = await res.json();
                           if (res.ok) {
                             setStatus('✅ Bijbelteksten verwijderd: ' + (data.message || 'OK'));
                             fetchCatalog();
                             loadHistory();
                             scanDuplicates();
                           } else {
                             setStatus('❌ Fout: ' + (data.error || 'Onbekende fout'));
                           }
                         } catch (e: any) {
                           setStatus('❌ Fout: ' + e.message);
                         } finally {
                           setIsDeletingScriptures(false);
                         }
                       }}
                     >
                       {isDeletingScriptures ? t('deleting_scriptures') : t('delete_all_scriptures')}
                     </button>
                   </div>
                 </div>
               </div>
              </div>
          )}

          {databaseSubTab === 'drafts' && <DraftServicesReview />}
    </div>
  );
}
