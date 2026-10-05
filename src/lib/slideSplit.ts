// Splitting song text over FreeShow slides. Shared by the show builder
// (freeshow.ts), the conversion of existing shows and the show editor, so
// all three split the same way.
//
// FreeShow's own structure for a group spread over several slides: the
// group slide (with group name/colour) holds the first lines and lists the
// rest as `children` - child slides without a group name. Layouts reference
// only the group slide; FreeShow plays its children right after it.

// Lower thirds in the livestream only look right with at most two lines.
export const MAX_LINES_PER_SLIDE = 2;
// A longer line wraps in the lower third and takes two rows on screen
// (measured: 32 characters still fit, 37 wrap).
export const MAX_CHARS_PER_LINE = 32;

// The layout trackArrangement.ts builds for songs with tracks. It's derived
// from the normal layout, so editing always happens in that one.
export const TRACKS_LAYOUT_NAME = 'Tracks';

export function editableLayoutId(show: any): string | undefined {
  const layouts = show?.layouts || {};
  const active = show?.settings?.activeLayout;
  if (active && layouts[active] && layouts[active].name !== TRACKS_LAYOUT_NAME) return active;
  return Object.keys(layouts).find(id => layouts[id].name !== TRACKS_LAYOUT_NAME) || active;
}

export interface EditorChild {
  id: string;
  slideObj: any;
}

export function newSlideId(): string {
  return Math.random().toString(36).padEnd(15, '0').substring(2, 13);
}

function textItem(slideObj: any): any | undefined {
  return slideObj?.items?.find((it: any) => (it.type || 'text') === 'text' && Array.isArray(it.lines));
}

export function slideLines(slideObj: any): any[] {
  return textItem(slideObj)?.lines || [];
}

export function lineText(line: any): string {
  return (line?.text || []).map((t: any) => t.value || '').join('');
}

// Rows a line takes on screen in the lower third.
export function screenRows(line: any): number {
  return Math.max(1, Math.ceil(lineText(line).trim().length / MAX_CHARS_PER_LINE));
}

export function slideRows(slideObj: any): number {
  return slideLines(slideObj).reduce((sum: number, l: any) => sum + screenRows(l), 0);
}

// Lines in order, at most MAX_LINES_PER_SLIDE rows on screen per slide. A
// line that wraps by itself gets a slide of its own.
export function chunkForScreen<T>(lines: T[], rowsOf: (line: T) => number = screenRows): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let rows = 0;
  for (const line of lines) {
    const r = rowsOf(line);
    if (current.length && rows + r > MAX_LINES_PER_SLIDE) {
      chunks.push(current);
      current = [];
      rows = 0;
    }
    current.push(line);
    rows += r;
  }
  if (current.length) chunks.push(current);
  return chunks.length ? chunks : [[]];
}

export function chunkLines<T>(lines: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < lines.length; i += size) chunks.push(lines.slice(i, i + size));
  return chunks.length ? chunks : [[]];
}

// A child slide in FreeShow's format, carrying the text item's styling of
// the group slide it belongs to.
export function childSlideFrom(parent: any, lines: any[]): any {
  const base = textItem(parent) || {};
  const { id: _omit, ...rest } = base;
  void _omit;
  return {
    group: null,
    color: null,
    settings: {},
    notes: '',
    items: [{ ...rest, ...(base.id ? { id: newSlideId() } : {}), lines }],
  };
}

// Puts `lines` back into a group slide + children: "screen" = songs (max two
// rows on screen per slide), a number = at most that many lines per slide.
// Existing child ids are reused where possible.
export function resplitGroup(parent: any, children: EditorChild[], lines: any[], size: number | 'screen'): { parent: any; children: EditorChild[] } {
  const chunks = size === 'screen' ? chunkForScreen(lines) : chunkLines(lines, size);
  const item = textItem(parent);
  const newParent = { ...parent, items: parent.items.map((it: any) => (it === item ? { ...it, lines: chunks[0] } : it)) };
  const newChildren = chunks.slice(1).map((chunk, i) => ({
    id: children[i]?.id || newSlideId(),
    slideObj: childSlideFrom(newParent, chunk),
  }));
  if (newChildren.length) newParent.children = newChildren.map(c => c.id);
  else delete newParent.children;
  return { parent: newParent, children: newChildren };
}

// Largest number of screen rows on any slide of a group.
export function maxRowsInGroup(parent: any, children: { slideObj: any }[]): number {
  return Math.max(0, slideRows(parent), ...children.map(c => slideRows(c.slideObj)));
}

// Largest number of lines on any slide of a group (group slide + children).
export function maxLinesInGroup(parent: any, children: { slideObj: any }[]): number {
  return Math.max(0, slideLines(parent).length, ...children.map(c => slideLines(c.slideObj).length));
}
