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

  // Absolute path
  if (filePath.startsWith('/') || filePath.match(/^[A-Z]:\\/i)) {
    return filePath;
  }

  // Relative path from FreeShow media folder
  const base = '/api/freeshow/media';

  // Strip leading dots or slashes
  let cleanPath = filePath.replace(/^\.+[/\\]/, '');

  // Handle nested media/ prefix
  if (cleanPath.startsWith('media/') || cleanPath.startsWith('media\\')) {
    cleanPath = cleanPath.replace(/^media[/\\]/, '');
  }

  return `${base}/${encodeURIComponent(cleanPath)}`;
}

export function getOrderedSlides(show: any): any[] {
  if (!show?.slides) return [];

  const groups = show.groups || [];
  const slides = show.slides;
  const layouts = show.layouts || {};

  let orderedSlides: any[] = [];

  for (const group of groups) {
    const layoutId = group.layout;
    const layout = layouts[layoutId];

    if (!layout) continue;

    for (const slideRef of layout) {
      const slideId = slideRef.id;
      const slide = slides[slideId];

      if (slide) {
        orderedSlides.push({ ...slide, id: slideId });
      }
    }
  }

  return orderedSlides;
}

export function getSlideBackground(show: any, slideIdx: number): any {
  if (!show?.slides) return null;

  const ordered = getOrderedSlides(show);
  if (slideIdx < 0 || slideIdx >= ordered.length) return null;

  const layoutSlide = ordered[slideIdx];
  if (!layoutSlide) return null;

  const slide = show.slides[layoutSlide.id];
  return slide?.background || null;
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
  let horizontal = 'center';
  let vertical = 'center';

  if (typeof alignValue === 'string') {
    const parts = alignValue.toLowerCase().split(' ');
    if (parts.length === 2) {
      vertical = parts[0];
      horizontal = parts[1];
    } else if (parts.length === 1) {
      horizontal = parts[0];
    }
  } else if (typeof alignValue === 'object' && alignValue !== null) {
    horizontal = alignValue.horizontal || 'center';
    vertical = alignValue.vertical || 'center';
  }

  const hMap: Record<string, string> = {
    left: 'flex-start',
    center: 'center',
    right: 'flex-end'
  };

  const vMap: Record<string, string> = {
    top: 'flex-start',
    middle: 'center',
    center: 'center',
    bottom: 'flex-end'
  };

  return {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: vMap[vertical] || 'center',
    alignItems: hMap[horizontal] || 'center',
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
  return {
    width: '100%',
    height: '100%',
    ...getAlignmentStyle(item.align),
    ...(item.style ? parseStyleString(item.style) : {})
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
