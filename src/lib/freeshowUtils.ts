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

export function getCategoryDisplayName(catId: string): string {
  const map: Record<string, string> = {
    'user': 'Eigen',
    'song': 'Lied',
    'presentation': 'Presentatie',
    'scripture': 'Schrift',
    'Songs': 'Liederen',
    'Presentation': 'Presentatie',
    'Media': 'Media',
    'User': 'Eigen'
  };

  return map[catId] || catId;
}
