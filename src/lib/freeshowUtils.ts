/**
 * FreeShow utility functions for slide processing and styling
 */

export const BIBLE_BOOKS = [
  "Genesis", "Exodus", "Leviticus", "Numeri", "Deuteronomium", "Jozua", "Rechters", "Ruth",
  "1 Samuël", "2 Samuël", "1 Koningen", "2 Koningen", "1 Kronieken", "2 Kronieken", "Ezra", "Nehemia", "Esther",
  "Job", "Psalmen", "Spreuken", "Prediker", "Hooglied", "Jesaja", "Jeremia", "Klaagliederen", "Ezechiël", "Daniël",
  "Hosea", "Joël", "Amos", "Obadja", "Jona", "Micha", "Nahum", "Habakuk", "Sefanja", "Haggaï", "Zacharia", "Maleachi",
  "Mattheüs", "Marcus", "Lukas", "Johannes", "Handelingen", "Romeinen", "1 Korinthiërs", "2 Korinthiërs", "Galaten",
  "Efeziërs", "Filippenzen", "Kolossenzen", "1 Thessalonicenzen", "2 Thessalonicenzen", "1 Timotheüs", "2 Timotheüs",
  "Titus", "Filemon", "Hebreeën", "Jakobus", "1 Petrus", "2 Petrus", "1 Johannes", "2 Johannes", "3 Johannes", "Judas", "Openbaring"
];

// Strips diacritics (ë, ï, ü, ...) so "1 Samuel"/"Korinthiers" match
// "1 Samuël"/"Korinthiërs" regardless of which side (typed input, or a
// specific .fsb bible file's internal book names) omits the accent -
// different translations aren't consistent about this.
export function foldDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// The server (this app) and the machine FreeShow actually runs on mount the
// same shared folder at different paths (e.g. server: /mnt/data/Projects/...,
// FreeShow's Mac: /Volumes/Projects/...). A path this app just wrote to disk
// is only useful inside a generated show if it's rewritten to how FreeShow's
// own machine sees that same file - otherwise the media reference silently
// renders as a black slide. Both roots come from settings
// (freeshowPath / freeshowClientPath); if either is unset, the path is left
// unchanged so nothing breaks for setups that haven't configured this yet.
export function toFreeShowClientPath(serverPath: string, serverRoot?: string, clientRoot?: string): string {
  if (!serverPath || !serverRoot || !clientRoot || serverRoot === clientRoot) return serverPath;
  if (serverPath.startsWith(serverRoot)) {
    return clientRoot + serverPath.slice(serverRoot.length);
  }
  return serverPath;
}

export function resolveMediaPath(filePath: string): string {
  if (!filePath) return '';

  // HTTP(S) URLs - return as-is
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
    return filePath;
  }

  const base = '/api/freeshow/media';

  // Windows absolute paths (e.g. Z:\FreeShow\Media\...)
  if (filePath.match(/^[A-Z]:\\/i)) {
    // Remove drive letter (e.g. Z:\)
    let pathWithoutDrive = filePath.replace(/^[A-Z]:\\/i, '');

    // Remove FreeShow\Media\ prefix if present
    pathWithoutDrive = pathWithoutDrive.replace(/^FreeShow[/\\]Media[/\\]/i, '');

    // Convert backslashes to forward slashes
    const normalizedPath = pathWithoutDrive.replace(/\\/g, '/');

    return `${base}/${normalizedPath}`;
  }

  // Unix absolute paths
  if (filePath.startsWith('/')) {
    // Try to extract relative path from common base paths
    const mediaMatch = filePath.match(/\/Media\/(.+)$/i);
    if (mediaMatch) {
      return `${base}/${mediaMatch[1]}`;
    }
    // Fallback: use filename only
    const parts = filePath.split('/');
    const filename = parts[parts.length - 1];
    return `${base}/${filename}`;
  }

  // Relative path from FreeShow media folder
  // Strip leading dots or slashes
  let cleanPath = filePath.replace(/^\.+[/\\]/, '');

  // Handle nested media/ prefix
  if (cleanPath.startsWith('media/') || cleanPath.startsWith('media\\')) {
    cleanPath = cleanPath.replace(/^media[/\\]/, '');
  }

  // Convert backslashes to forward slashes
  cleanPath = cleanPath.replace(/\\/g, '/');

  return `${base}/${cleanPath}`;
}

export function getOrderedSlides(show: any): any[] {
  if (!show) return [];

  const activeLayoutId = show.settings?.activeLayout;
  if (activeLayoutId && show.layouts?.[activeLayoutId]?.slides) {
    const flatSlides: any[] = [];
    const layoutSlides = show.layouts[activeLayoutId].slides;

    for (const slide of layoutSlides) {
      const rawSlide = show.slides?.[slide.id];

      // Push parent slide first
      flatSlides.push(slide);

      // Collect children from ALL sources, deduplicate
      const childrenSeen = new Set<string>();
      const addChild = (childId: string, extra: any = {}) => {
        if (childrenSeen.has(childId)) return;
        childrenSeen.add(childId);
        flatSlides.push({
          id: childId,
          parentId: slide.id,
          parentBackground: slide.background || rawSlide?.background,
          ...extra
        });
      };

      // 1. Layout-level children (object)
      if (slide.children && typeof slide.children === 'object') {
        for (const [childId, childData] of Object.entries(slide.children)) {
          addChild(childId, typeof childData === 'object' ? childData : {});
        }
      }

      // 2. Raw slide children (array or object)
      if (rawSlide?.children) {
        if (Array.isArray(rawSlide.children)) {
          for (const childId of rawSlide.children) {
            addChild(childId);
          }
        } else if (typeof rawSlide.children === 'object') {
          for (const [childId, childData] of Object.entries(rawSlide.children)) {
            addChild(childId, typeof childData === 'object' ? childData : {});
          }
        }
      }
    }
    return flatSlides;
  }

  // Fallback: return all slides if no layout
  if (show.slides) {
    return Object.keys(show.slides).map(id => ({ id }));
  }

  return [];
}

export function getSlideBackground(show: any, slideIdx: number): any {
  if (!show || !show.layouts) return null;

  const ordered = getOrderedSlides(show);

  // Check current slide and its parent first
  const currentSlide = ordered[slideIdx];
  if (currentSlide) {
    if (currentSlide.background && show.media?.[currentSlide.background]) {
      return show.media[currentSlide.background];
    }
    if (currentSlide.parentBackground && show.media?.[currentSlide.parentBackground]) {
      return show.media[currentSlide.parentBackground];
    }
  }

  // Check backwards for active backgrounds
  for (let i = slideIdx - 1; i >= 0; i--) {
    const layoutSlide = ordered[i];
    if (layoutSlide) {
      if (layoutSlide.background && show.media?.[layoutSlide.background]) {
        return show.media[layoutSlide.background];
      }
      if (layoutSlide.parentBackground && show.media?.[layoutSlide.parentBackground]) {
        return show.media[layoutSlide.parentBackground];
      }
    }
  }

  return null;
}

export function parseStyleString(styleStr: string): React.CSSProperties {
  if (!styleStr || typeof styleStr !== 'string') return {};

  const style: any = {};
  const pairs = styleStr.split(';').filter(Boolean);

  for (const pair of pairs) {
    const [key, value] = pair.split(':').map(s => s.trim());
    if (key && value) {
      const camelKey = key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      style[camelKey] = value;
    }
  }

  return style;
}

export function getAlignmentStyle(alignValue: any): React.CSSProperties {
  if (!alignValue) {
    return {
      justifyContent: 'center',
      textAlign: 'center',
      alignItems: 'center'
    };
  }

  const val = String(alignValue).toLowerCase().trim();

  if (val === 'left') {
    return {
      justifyContent: 'flex-start',
      textAlign: 'left',
      alignItems: 'flex-start'
    };
  }

  if (val === 'right') {
    return {
      justifyContent: 'flex-end',
      textAlign: 'right',
      alignItems: 'flex-end'
    };
  }

  if (val === 'center') {
    return {
      justifyContent: 'center',
      textAlign: 'center',
      alignItems: 'center'
    };
  }

  // If align contains CSS (e.g. "justify-content: flex-end;"), parse it
  if (val.includes(':')) {
    return parseStyleString(alignValue);
  }

  // Default fallback
  return {
    justifyContent: 'center',
    textAlign: 'center',
    alignItems: 'center'
  };
}

export function applyTemplateToSlideItem(slideItem: any, templateItem: any): any {
  const merged = { ...slideItem };

  if (templateItem.style) {
    merged.style = {
      ...(slideItem.style || {}),
      ...templateItem.style
    };
  }

  if (templateItem.align) {
    merged.align = templateItem.align;
  }

  if (templateItem.lines && slideItem.lines) {
    merged.lines = slideItem.lines.map((line: any, lineIdx: number) => {
      const templateLine = templateItem.lines?.[lineIdx];
      if (!templateLine) return line;

      const mergedLine = { ...line };
      if (templateLine.align) mergedLine.align = templateLine.align;
      if (templateLine.text && Array.isArray(templateLine.text) && Array.isArray(line.text)) {
        mergedLine.text = line.text.map((seg: any, segIdx: number) => {
          const templateSeg = templateLine.text?.[segIdx];
          if (!templateSeg) return seg;

          return {
            ...seg,
            style: {
              ...(seg.style || {}),
              ...(templateSeg.style || {})
            }
          };
        });
      }

      return mergedLine;
    });
  }

  return merged;
}

export function applyTemplateToSlide(slide: any, template: any): any {
  const merged = { ...slide };

  // If no template, return slide as-is
  if (!template) return merged;

  // Apply background
  if (template.background) {
    merged.background = template.background;
  }

  // Apply items styling
  if (template.items && slide.items) {
    const templateItemsArray = Array.isArray(template.items)
      ? template.items
      : Object.values(template.items);

    const slideItemsArray = Array.isArray(slide.items)
      ? slide.items
      : Object.values(slide.items);

    merged.items = slideItemsArray.map((item: any, idx: number) => {
      const templateItem = templateItemsArray[idx];
      if (!templateItem) return item;

      return applyTemplateToSlideItem(item, templateItem);
    });
  }

  return merged;
}

export function getContainerStyle(item: any): React.CSSProperties {
  const styleObj = item.style ? parseStyleString(item.style) : {};
  const alignObj = getAlignmentStyle(item.align);

  return {
    position: 'absolute',
    display: 'flex',
    flexDirection: 'column',
    ...styleObj,
    ...alignObj
  };
}

export function getLineStyle(line: any, itemAlign: any): React.CSSProperties {
  const align = line.align || itemAlign;
  return getAlignmentStyle(align);
}

export function getSegmentStyle(seg: any): React.CSSProperties {
  return seg.style ? parseStyleString(seg.style) : {};
}

export function getTranslatedTitle(title: string): string {
  const translations: Record<string, string> = {
    'Songs': 'Liederen',
    'Presentation': 'Presentatie',
    'Media': 'Media',
    'User': 'Eigen',
    'Song': 'Lied'
  };

  return translations[title] || title;
}

export function getCategoryDisplayName(
  catId: string,
  freeshowCategories?: Record<string, { name: string; icon?: string; default?: boolean }>
): string {
  const map: Record<string, string> = {
    'user': 'Eigen',
    'song': 'Lied',
    'presentation': 'Presentatie',
    'scripture': 'Schrift',
    'unknown': 'Onbekend',
    'Songs': 'Liederen',
    'Presentation': 'Presentatie',
    'Media': 'Media',
    'User': 'Eigen'
  };

  // Built-in categories store an untranslated i18n key (e.g. "category.song")
  // as their "name" in settings_synced.json, not a display name - use our own.
  if (map[catId]) return map[catId];

  // FreeShow custom categories (e.g. "ff29de14140") store their real name
  // in settings_synced.json, keyed by that id. Prefer it when available.
  const entry = freeshowCategories?.[catId];
  if (entry?.name) return entry.name;

  // A custom category that exists but has no name set yet - FreeShow itself
  // labels these "Unnamed" rather than showing the generated id.
  if (entry) return 'Naamloos';

  return catId;
}

// Flattens a show's slide text into one preview string, same shape the
// manual Bouwer expects for a song/bible item's `text` field. Mirrors
// songs.ts's getLocalSongText() extraction exactly, factored out here (no
// fs dependency) so it can also run client-side for reconstructing a
// project loaded straight from a .project file's data.json.
export function extractShowSlideText(showObj: any): string {
  const lyricsParts: string[] = [];
  if (showObj && showObj.slides) {
    Object.values(showObj.slides).forEach((slide: any) => {
      const slideTexts: string[] = [];
      if (slide.items) {
        slide.items.forEach((item: any) => {
          if (item.lines) {
            item.lines.forEach((line: any) => {
              if (line.text) {
                line.text.forEach((t: any) => {
                  if (t.value) slideTexts.push(t.value);
                });
              }
            });
          }
        });
      }
      if (slideTexts.length > 0) {
        lyricsParts.push(slideTexts.join('\n'));
      }
    });
  }
  return lyricsParts.join('\n\n');
}

// Best-effort reconstruction of the manual Bouwer's `manualItems` list from
// a raw FreeShow .project's data.json - used when loading a project that
// has no (or an incompatible) livestream_state.json, i.e. anything not
// generated by this app's manual Bouwer: a project authored natively in
// FreeShow, or one generated by the email-automation pipeline. Every show
// referenced by the project is turned into a plain, editable item; nothing
// is regenerated from scratch - each item carries the original show data
// verbatim via `fullData` so re-saving reproduces it exactly, even though
// the *display* fields (title/ref/text preview) are approximated.
//
// Known limitations, surfaced to the caller via `skipped`: project.shows
// entries FreeShow itself supports but this app never creates (e.g. audio-
// only items, camera inputs) aren't recognized and are left out rather than
// guessed at.
export function reconstructManualItemsFromProject(dataFile: any): { items: any[]; skipped: number } {
  const showRefs: any[] = dataFile?.project?.shows || [];
  const showsData: Record<string, any> = dataFile?.shows || {};
  const items: any[] = [];
  let skipped = 0;
  let counter = 0;
  const nextId = () => Date.now() + (counter++);

  for (const ref of showRefs) {
    if (!ref || typeof ref !== 'object') { skipped++; continue; }

    if (ref.type === 'section') {
      items.push({ id: nextId(), type: 'section', title: ref.name || 'Sectie', color: ref.color });
      continue;
    }

    if (ref.type === 'image' || ref.type === 'video') {
      // Direct media in the running order - see insertAtIndices in
      // freeshow.ts: for these, ref.id IS the file path, not a show id.
      const filePath = typeof ref.id === 'string' ? ref.id : '';
      items.push({
        id: nextId(),
        type: 'media',
        title: ref.name || filePath.split('/').pop() || 'Media',
        filePath,
        metaType: ref.type,
        layer: 'direct',
        timer: ref.settings?.timer,
        loop: !!ref.settings?.loop,
        status: 'manual'
      });
      continue;
    }

    const showObj = ref.id ? showsData[ref.id] : null;
    if (!showObj) { skipped++; continue; }

    if (showObj.category === 'scripture') {
      items.push({
        id: nextId(),
        type: 'bible',
        // This app always names a bible show "Boek H:V-V - Vertaling" (see
        // createShowObject/resolveScriptureItem), so the show's own name is
        // a better reference label than reconstructing one from per-slide
        // customDynamicValues, which only cover that one slide's verses.
        ref: showObj.name || 'Bijbeltekst',
        translation: '',
        text: extractShowSlideText(showObj),
        status: 'local',
        fullData: { id: ref.id, data: showObj }
      });
    } else {
      // Songs and presentations both land here - the manual Bouwer already
      // treats a catalog-picked presentation as a "song"-type item with
      // fullData reuse (see PresentationInput/adHocAddSong), so this stays
      // consistent with that rather than inventing a separate code path.
      items.push({
        id: nextId(),
        type: 'song',
        title: showObj.name || 'Naamloos',
        text: extractShowSlideText(showObj),
        status: 'local',
        fullData: { id: ref.id, data: showObj }
      });
    }
  }

  return { items, skipped };
}

// FreeShow itself doesn't always write an explicit `type` field on slide
// items - a plain text item is frequently untyped (FreeShow's own renderer
// treats a missing type as implicitly "text"). Confirmed against a real
// native-FreeShow-authored scripture show: every item lacked `type`
// entirely, which silently broke this app's preview (item.type === 'text'
// was never true, so nothing rendered) - any code that branches on an
// item's type must infer it from shape when the field is absent, not
// assume FreeShow always wrote it.
export function getItemType(item: any): 'text' | 'media' | 'unknown' {
  if (item?.type === 'text' || item?.type === 'media') return item.type;
  if (item?.src !== undefined) return 'media';
  if (item?.lines !== undefined) return 'text';
  return 'unknown';
}
