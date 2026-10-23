import JSZip from 'jszip';
import fs from 'fs/promises';
import path from 'path';
import { chunkForScreen, splitOverlongLines } from './slideSplit';
import { getBijbelStijl } from './bijbelstijlen';
import { getSettings } from './settingsStore';

function generateId() {
  return Math.random().toString(36).padEnd(15, '0').substring(2, 13);
}

const GROUP_COLORS: any = {
  'chorus': '#f525d2',
  'bridge': '#f52598',
  'tag': '#7525f5',
  'pre-chorus': '#8825f5',
  'pre_chorus': '#8825f5',
  'verse': '#5825f5',
  'intro': '#b125f5',
  'outro': '#b125f5',
  'break': '#f52525'
};

// FreeShow's own global-group ids (confirmed against the real FreeShow
// source's text importer, converters/txt.ts, which returns these exact
// literals for recognized labels) - when a label maps to one of these,
// globalGroup lets FreeShow's own group name/color registry take over
// instead of only using the color we guess below.
const GROUP_KEYWORDS: Record<string, string> = {
  verse: 'verse', vers: 'verse', couplet: 'verse',
  chorus: 'chorus', refrein: 'chorus', refrain: 'chorus',
  prechorus: 'pre_chorus', prerefrein: 'pre_chorus', prerefrain: 'pre_chorus',
  bridge: 'bridge', brug: 'bridge',
  intro: 'intro',
  outro: 'outro', slot: 'outro',
  tag: 'tag',
  break: 'break', pauze: 'break'
};

// A bare group-label line with no brackets, e.g. "Refrein", "Couplet 1",
// "Chorus:", "Verse1" - how worship leaders commonly type lyrics out,
// as opposed to FreeShow's own "[Chorus]" bracket convention (still
// recognized separately below). Anchored to the whole line so a genuine
// lyric that happens to start with one of these words (e.g. "Chorus of
// angels sang") is never mistaken for a label.
const GROUP_LABEL_RE = /^(pre[\s-]?chorus|pre[\s-]?refrein|pre[\s-]?refrain|verse|vers|couplet|chorus|refrein|refrain|bridge|brug|intro|outro|slot|tag|break|pauze)\s*[\divxIVX]*\s*:?\s*$/i;

const SANS_NUMMER = "Arial, Helvetica, sans-serif";

export function createShowObject(show: any) {
  const now = Date.now();
  const slides: any = {};
  const layoutSlides: any[] = [];
  const textSections = show.data.text.split('\n\n');
  
  let bgMediaId: string | undefined = undefined;
  const showMedia: any = {};
  if (show.backgroundMedia) {
    bgMediaId = generateId();
    showMedia[bgMediaId] = {
      name: show.backgroundMedia.split(/[\\/]/).pop(),
      path: show.backgroundMedia,
      type: show.backgroundType || "video",
      muted: true,
      loop: true
    };
  }

  let activeGroupName: string | null = null;
  let activeGroupColor: string | null = null;
  let activeGroupKey: string | null = null; // canonical FreeShow global-group id, when recognized

  textSections.forEach((section: string, idx: number) => {
    const slideId = generateId();
    let cleanSection = section;

    const groupMatch = section.match(/^\[(.*?)\]\s*\n?/);
    let rawLabel: string | null = null;
    if (groupMatch) {
      rawLabel = groupMatch[1];
      cleanSection = section.replace(groupMatch[0], '');
    } else {
      const sectionLines = section.split('\n');
      const firstLine = (sectionLines[0] || '').trim();
      const bareMatch = firstLine.match(GROUP_LABEL_RE);
      if (bareMatch) {
        rawLabel = firstLine.replace(/:\s*$/, '').trim();
        cleanSection = sectionLines.slice(1).join('\n');
      }
    }

    if (rawLabel) {
      activeGroupName = rawLabel;
      const normalizedKeyword = rawLabel.toLowerCase().replace(/[\s\d:-]/g, '');
      activeGroupKey = GROUP_KEYWORDS[normalizedKeyword] || null;
      activeGroupColor = activeGroupKey ? GROUP_COLORS[activeGroupKey] : null;
      if (!activeGroupColor) {
        const lowerGroup = rawLabel.toLowerCase();
        for (const [key, color] of Object.entries(GROUP_COLORS)) {
          if (lowerGroup.includes(key)) {
            activeGroupColor = color as string;
            break;
          }
        }
      }
    } else if (!activeGroupName) {
      activeGroupName = "Verse 1";
      activeGroupKey = "verse";
      activeGroupColor = GROUP_COLORS['verse'];
    }

    const isBible = show.data.category === 'scripture';

    // A section that was purely a group label (e.g. "Chorus" on its own
    // line, blank line, then the actual lyrics as a *separate* section)
    // has nothing left to show once the label's stripped off above - the
    // label already updated activeGroupName/Color/Key for whichever
    // section comes next, so there's no reason to also emit a slide with
    // zero text items for it. Common when lyrics are pasted with the
    // label on its own line rather than as the first line of the verse.
    if (!isBible && rawLabel && cleanSection.split('\n').every(l => l.trim() === '')) {
      return;
    }

    if (isBible && show.refData && show.refData.chunks) {
      const chunk = show.refData.chunks[idx] || [];
      if (chunk.length === 0) return;

      const firstVerse = chunk[0].verse;
      const lastVerse = chunk[chunk.length - 1].verse;
      const verseRange = firstVerse === lastVerse ? firstVerse : `${firstVerse}-${lastVerse}`;
      const slideRef = `${show.refData.book} ${show.refData.chapter}:${verseRange}`;

      // Opmaak per bijbelstijl (src/lib/bijbelstijlen.ts): vak, lettertype, kleuren en een apart vak voor de verwijzing en de vertaling.
      const stijl = getBijbelStijl(show.bijbelStijl);
      const t = stijl.tekst;
      const textStyle = `font-family:${t.lettertype};font-size:${t.grootte}px;color:${t.kleur};font-weight:${t.gewicht};text-shadow:${t.schaduw};line-height:${t.regelhoogte};`;
      const lines: any[] = [{ align: `text-align: ${t.uitlijning};`, text: [] }];

      chunk.forEach((v: any, vIdx: number) => {
        lines[0].text.push({
          value: v.verse,
          style: `font-family:${SANS_NUMMER};font-size:${stijl.nummer.grootte}px;font-weight:bold;color:${stijl.nummer.kleur};vertical-align:super;margin-right:0.3em;text-shadow:none;`,
          customType: "disableTemplate"
        });
        lines[0].text.push({
          value: v.text + (vIdx < chunk.length - 1 ? " " : ""),
          sourceDynamicKey: `scripture_text:${vIdx}`,
          style: textStyle
        });
      });

      const kleinVak = (vak: string, uitlijning: string, tekstStijl: string, waarde: string) => ({
        id: generateId(),
        type: "text",
        lines: [{ align: `text-align: ${uitlijning};`, text: [{ value: waarde, style: tekstStijl }] }],
        style: vak,
        align: "",
        auto: false,
        decoration: true
      });
      const verwijzingVak = kleinVak(stijl.verwijzing.vak, stijl.verwijzing.uitlijning,
        `font-family:${stijl.verwijzing.lettertype};font-size:${stijl.verwijzing.grootte}px;color:${stijl.verwijzing.kleur};${stijl.verwijzing.stijl}`, slideRef);
      const vertalingVak = kleinVak(stijl.vertaling.vak, stijl.vertaling.uitlijning,
        `font-family:${stijl.vertaling.lettertype};font-size:${stijl.vertaling.grootte}px;color:${stijl.vertaling.kleur};`, show.refData.translationName || "Bijbel");
      const decorVakken = stijl.decor.map(d => ({ id: generateId(), type: "text", lines: [{ align: "", text: [{ value: "", style: "" }] }], style: d, align: "", auto: false, decoration: true }));

      slides[slideId] = {
        group: slideRef,
        color: null,
        settings: {},
        notes: "",
        items: [
          ...decorVakken,
          {
            id: generateId(),
            type: "text",
            lines: lines,
            style: t.vak,
            align: "align-items:center;",
            auto: true,
            textFit: "shrinkToFit"
          },
          verwijzingVak,
          vertalingVak
        ],
        customDynamicValues: {
          // Real bible templates often use the numbered {scripture1_...}
          // placeholder form (built for showing multiple translations side
          // by side) rather than the unprefixed {scripture_...} one - FreeShow's
          // own template-merge code treats scripture1_* as authoritative and
          // scripture_* as just a convenience alias of it. Only unprefixed
          // values here meant those placeholders stayed blank when a real
          // scripture template got applied. This church only uses one
          // translation, so scripture1_* just duplicates the same values.
          scripture_name: show.refData.translationName || "",
          scripture_book: show.refData.book,
          scripture_book_abbr: show.refData.bookAbbr || show.refData.book.substring(0, 3),
          scripture_chapter: show.refData.chapter.toString(),
          scripture_reference_full: slideRef,
          scripture_reference_last: slideRef,
          meta_copyright: show.refData.metadata?.copyright || "",
          meta_title: show.refData.translationName || "",
          scripture_reference: slideRef,
          scripture_verses: verseRange,
          scripture_text: chunk.map((v: any) => [v.verse, v.text]),
          scripture1_name: show.refData.translationName || "",
          scripture1_book: show.refData.book,
          scripture1_book_abbr: show.refData.bookAbbr || show.refData.book.substring(0, 3),
          scripture1_chapter: show.refData.chapter.toString(),
          scripture1_reference: slideRef,
          scripture1_verses: verseRange,
          scripture1_text: chunk.map((v: any) => [v.verse, v.text])
        }
      };
    } else {
      const lines = cleanSection.split('\n').filter(l => l.trim() !== '').map(line => ({
        align: "",
        text: [{ value: line.trim(), style: "font-size: 100px;" }]
      }));

      const textItems = (chunk: any[]) => [{
        id: generateId(),
        type: "text",
        lines: chunk,
        style: "top:88px;left:50px;height:904px;width:1820px;",
        align: "",
        auto: true,
        textFit: "shrinkToFit"
      }];

      // At most two rows on screen per slide (a long line wraps and counts
      // as two): more doesn't fit the livestream lower third. The group
      // slide gets the first lines, the rest become child slides of that
      // group - the same structure
      // FreeShow itself uses when it splits a group, so the layout still
      // references only the group slide and FreeShow shows the children
      // right after it. Presentations keep all their lines on one slide.
      const chunks: any[][] = show.data.category === 'presentation' ? [lines] : chunkForScreen(splitOverlongLines(lines));

      const childIds = chunks.slice(1).map(chunk => {
        const childId = generateId();
        slides[childId] = { group: null, color: null, settings: {}, notes: "", items: textItems(chunk) };
        return childId;
      });

      slides[slideId] = {
        group: activeGroupName,
        color: activeGroupColor,
        settings: {},
        notes: "",
        items: textItems(chunks[0]),
        globalGroup: activeGroupKey || (activeGroupName ? activeGroupName.toLowerCase().replace(/\s+/g, '_') : null),
        ...(childIds.length ? { children: childIds } : {})
      };
    }

    const layoutPush: any = { id: slideId };
    if (idx === 0 && bgMediaId) {
      layoutPush.background = bgMediaId;
    }
    layoutSlides.push(layoutPush);
  });

  const isBibleShow = show.data.category === 'scripture' && show.refData;

  const defaultLayoutId = generateId();
  const showLayouts: any = {};
  showLayouts[defaultLayoutId] = {
    name: isBibleShow ? (show.refData.translationName || "Default") : "Default",
    notes: "",
    slides: layoutSlides
  };

  const showObj: any = {
    name: show.data.name,
    private: false,
    category: show.data.category,
    settings: {
      activeLayout: defaultLayoutId,
      // Bijbelteksten krijgen hun eigen opmaak mee (bijbelstijlen.ts); FreeShow's ingebouwde sjabloon "scripture" zou die overschrijven.
      template: show.data.category === 'scripture' ? '' : (show.templateId || 'default')
    },
    timestamps: { created: now, modified: null, used: null },
    meta: isBibleShow ? {
      copyright: show.refData.metadata?.copyright || "",
      title: show.refData.translationName || ""
    } : {},
    slides: slides,
    layouts: showLayouts,
    media: showMedia,
    quickAccess: {}
  };

  // Links this show back to the bible collection/verses it was generated
  // from - this is what makes FreeShow recognize it as "scripture" content
  // (editable via its own bible tools, template-aware), not just plain text.
  // FreeShow itself splits long verses into numbered sub-parts ("1_1","1_2")
  // for finer slide control; this isn't reproduced here, so each verse gets
  // a single "_1" part instead - close enough for FreeShow to recognize the
  // reference, but won't support FreeShow's own long-verse re-splitting.
  if (isBibleShow) {
    const allVerses: string[] = (show.refData.chunks || []).flat().map((v: any) => `${v.verse}_1`);
    showObj.reference = {
      type: "scripture",
      data: {
        collection: show.refData.collectionId || "",
        translations: 1,
        version: show.refData.translationName || "",
        api: false,
        book: show.refData.bookNumber || "",
        chapter: Number(show.refData.chapter),
        verses: [allVerses],
        attributionString: ""
      }
    };
  }

  return showObj;
}

export function createComplexShowObject(item: any) {
  const now = Date.now();
  const slides: any = {};
  const media: any = {};
  const layoutSlides: any[] = [];
  const layoutId = generateId();

  (item.slides || []).forEach((slideData: any) => {
    const slideId = generateId();
    const isMedia = slideData.type === 'media';
    const isBackground = slideData.layer === 'background';
    
    let mediaId: string | null = null;
    if (isMedia || (slideData.backgroundMedia)) {
      mediaId = generateId();
      const path = slideData.filePath || slideData.backgroundMedia;
      media[mediaId] = {
        name: slideData.title || path.split('/').pop(),
        path: path,
        type: slideData.metaType || slideData.backgroundType || "image",
        muted: true,
        loop: !!slideData.loop
      };
    }

    const slideItems: any[] = [];

    if (isMedia && !isBackground) {
      const itemId = generateId();
      slideItems.push({
        id: itemId,
        type: "media",
        src: slideData.filePath,
        style: "top:0px;left:0px;height:1080px;width:1920px;",
        fit: "contain"
      });
    } else if (slideData.text) {
      const itemId = generateId();
      const lines = slideData.text.split('\n').filter((l:any) => l.trim() !== '').map((line:any) => ({
        align: "",
        text: [{ value: line.trim(), style: "font-size: 80px;" }]
      }));
      slideItems.push({
        id: itemId,
        type: "text",
        lines: lines,
        style: "top:100px;left:100px;height:880px;width:1720px;",
        align: "",
        auto: true,
        textFit: "shrinkToFit"
      });
    }

    slides[slideId] = {
      group: slideData.group || "Media",
      color: slideData.color || null,
      settings: {},
      notes: "",
      items: slideItems
    };

    const layoutSlide: any = { id: slideId };
    if (mediaId && (isMedia && isBackground || slideData.backgroundMedia)) {
      layoutSlide.background = mediaId;
    }
    if (slideData.timer && slideData.timer > 0) {
      layoutSlide.nextTimer = slideData.timer;
    }
    layoutSlides.push(layoutSlide);
  });

  if (layoutSlides.length > 0 && item.slides?.[0]?.timer) {
    layoutSlides[layoutSlides.length - 1].end = true;
  }

  return {
    name: item.title || "Custom Show",
    private: false,
    category: "presentation",
    settings: { activeLayout: layoutId, template: false },
    timestamps: { created: now, modified: null, used: null },
    meta: {},
    slides: slides,
    layouts: { [layoutId]: { name: "Default", notes: "", slides: layoutSlides } },
    media: media,
    quickAccess: {}
  };
}

export function createMediaShowObject(item: any) {
  const now = Date.now();
  const slideId = generateId();
  const mediaId = generateId();
  const slides: any = {};
  const media: any = {};
  const layoutSlides: any[] = [];

  media[mediaId] = {
    name: item.title,
    path: item.filePath,
    type: item.metaType || "video",
    muted: item.muted !== false,
    loop: !!item.loop
  };

  const isBackground = item.layer === 'background';
  
  slides[slideId] = {
    group: "Media",
    color: null,
    settings: {},
    notes: "",
    items: isBackground ? [] : [
      {
        id: generateId(),
        type: "media",
        src: item.filePath,
        style: "top:0px;left:0px;height:1080px;width:1920px;",
        fit: "contain"
      }
    ]
  };

  const layoutSlide: any = { id: slideId };
  if (isBackground) layoutSlide.background = mediaId;
  if (item.timer && item.timer > 0) {
    layoutSlide.nextTimer = item.timer;
    layoutSlide.end = true;
  }
  // Switches the configured output to the "Livestream Video fullscreen"
  // style when this slide plays, matching how this is set up by hand today
  // - only added when both a resolved style ID and a configured (per-
  // machine local) output ID are available, see resolveMediaItem().
  if (item.livestreamStyleId && item.livestreamOutputId) {
    layoutSlide.actions = {
      slideActions: [
        {
          id: generateId(),
          name: "Set style to livestream video",
          triggers: ["change_output_style"],
          actionValues: {
            change_output_style: {
              styleOutputs: {
                type: "specific",
                outputs: { [item.livestreamOutputId]: item.livestreamStyleId }
              }
            }
          },
          customActivation: "",
          midiEnabled: false
        }
      ]
    };
  }
  layoutSlides.push(layoutSlide);

  const layoutId = generateId();
  const layouts: any = {};
  layouts[layoutId] = { name: "Default", notes: "", slides: layoutSlides };

  return {
    name: item.title,
    private: false,
    category: "presentation",
    settings: { activeLayout: layoutId, template: false },
    timestamps: { created: now, modified: null, used: null },
    meta: {},
    slides: slides,
    layouts: layouts,
    media: media,
    quickAccess: {}
  };
}

// De shows uit het sjabloon (Welkom, Bedankt, Thema, ...) komen uit de showmap als daar een show met dezelfde naam staat:
// zo is de showmap de enige bron en is een aanpassing aan bijvoorbeeld Welkom meteen in het volgende project te zien. Staat
// er geen show met die naam (bijvoorbeeld hernoemd), dan blijft de kopie uit het sjabloon staan en komt er een melding.
// Het show-id uit het sjabloon blijft behouden, want de projectindeling verwijst daarnaar.
async function refreshTemplateShowsFromLibrary(dataFile: any, notes?: string[]): Promise<void> {
  let showsDir = '';
  try {
    const s = getSettings() as any;
    if (s.freeshowPath) showsDir = path.join(s.freeshowPath, 'Shows');
  } catch { /* geen instellingen: sjabloonkopie gebruiken */ }
  if (!showsDir) return;

  for (const [id, show] of Object.entries<any>(dataFile.shows || {})) {
    const name = String(show?.name || '').trim();
    if (!name || /[\\/]/.test(name)) continue;
    let raw: any;
    try {
      raw = JSON.parse(await fs.readFile(path.join(showsDir, `${name}.show`), 'utf-8'));
    } catch {
      notes?.push(`Sjabloonshow "${name}" staat niet in de showmap; de kopie uit het sjabloon is gebruikt.`);
      continue;
    }
    const content = Array.isArray(raw) ? raw[1] : raw;
    if (!content || typeof content !== 'object' || !content.slides || !content.layouts) {
      notes?.push(`Sjabloonshow "${name}" in de showmap is onleesbaar; de kopie uit het sjabloon is gebruikt.`);
      continue;
    }
    dataFile.shows[id] = { ...content, media: content.media || {} };
  }
}

export async function createFreeShowProject(dateStr: string, showsList: any[], projectName?: string, templatePath?: string, useTemplate: boolean = true, notes?: string[]) {
  const safeDateName = dateStr.replace(/\//g, '-');
  const finalProjectName = projectName ? projectName : safeDateName;
  const now = Date.now();

  let dataFile: any = {
    project: {
      name: finalProjectName,
      shows: [],
      notes: "",
      template: "default"
    },
    shows: {},
    media: {},
    files: []
  };

  if (useTemplate && templatePath) {
    try {
      const templateData = await fs.readFile(templatePath);
      const zip = new JSZip();
      const content = await zip.loadAsync(templateData);
      const dataJsonFile = content.file("data.json");
      if (dataJsonFile) {
        const dataJsonStr = await dataJsonFile.async("string");
        dataFile = JSON.parse(dataJsonStr);
        dataFile.project.name = finalProjectName;
      }
    } catch (err) {
      console.error("Fout bij laden template:", err);
    }
  }

  if (useTemplate) {
    // Eerst verversen, daarna de per project gekozen aanpassingen (andere media, extra dia's) erop zetten
    await refreshTemplateShowsFromLibrary(dataFile, notes);
    const removedIds = showsList.filter(s => s.source === 'template' && s.isRemoved).map(s => s.id);
    dataFile.project.shows = dataFile.project.shows.filter((s: any) => !removedIds.includes(s.id));

    showsList.forEach(showUpdate => {
      if (showUpdate.source === 'template' && showUpdate.swappedMediaPath) {
        const targetShow = dataFile.shows[showUpdate.id];
        if (targetShow) {
          const mediaId = generateId();
          targetShow.media[mediaId] = {
            name: showUpdate.swappedMediaPath.split('/').pop(),
            path: showUpdate.swappedMediaPath,
            type: showUpdate.swappedMetaType || "video"
          };
          Object.values(targetShow.layouts).forEach((layout: any) => {
            if (layout.slides) {
              layout.slides.forEach((sl: any, idx: number) => {
                if (idx === 0) sl.background = mediaId;
              });
            }
          });
          if (!dataFile.files.includes(showUpdate.swappedMediaPath)) dataFile.files.push(showUpdate.swappedMediaPath);
        }
      }

      if (showUpdate.source === 'template' && showUpdate.extraSlides && showUpdate.extraSlides.length > 0) {
        const targetShow = dataFile.shows[showUpdate.id];
        if (targetShow) {
          const layoutId = targetShow.settings?.activeLayout || Object.keys(targetShow.layouts)[0];
          const layout = targetShow.layouts[layoutId];
          showUpdate.extraSlides.forEach((extra: any) => {
            const slideId = generateId();
            const mediaId = generateId();
            targetShow.media[mediaId] = {
              name: extra.path.split('/').pop() || "media",
              path: extra.path,
              type: extra.type || "video"
            };
            targetShow.slides[slideId] = {
              group: "Extra",
              color: null,
              settings: { timer: extra.timer || 5, auto: true, loop: !!extra.loop },
              notes: "",
              items: []
            };
            layout.slides.push({ id: slideId, background: mediaId });
            if (!dataFile.files.includes(extra.path)) dataFile.files.push(extra.path);
          });
        }
      }
    });
  }

  const manualItems = showsList.filter(s => s.source !== 'template'); 
  const itemsBySection: Record<string, any[]> = {};
  manualItems.forEach(item => {
    const sec = item.targetSection || 'Onderaan';
    if (!itemsBySection[sec]) itemsBySection[sec] = [];
    itemsBySection[sec].push(item);
  });

  Object.entries(itemsBySection).forEach(([sectionName, itemsToInsert]) => {
    if (sectionName === 'Onderaan' || !useTemplate) {
      insertAtIndices(dataFile, itemsToInsert, dataFile.project.shows.length);
    } else {
      // Case/whitespace-insensitive: a section name typed in an email
      // (e.g. "[Sectie: welkom]") almost never matches the template's exact
      // casing ("Welkom") by coincidence, and an exact === match silently
      // dumps the item at the very end of the project instead of erroring -
      // a typo-triggered misplacement nobody would notice until too late.
      const normalize = (s: string) => s.trim().toLowerCase();
      const sectionIdx = dataFile.project.shows.findIndex((s: any) => s.type === 'section' && normalize(s.name || '') === normalize(sectionName));
      if (sectionIdx !== -1) {
        // Most sections have their pinned template show(s) FIRST (e.g.
        // "Thema" under Preek, "Welkom" under Start) - new items belong
        // after those. "Einde" is the opposite: its pinned "Bedankt" show
        // must always stay the very last thing in the service, so new items
        // there go right after the divider instead, before any pinned content.
        const sectionsWithTrailingPin = ['einde'];
        let insertIdx = sectionIdx + 1;
        if (!sectionsWithTrailingPin.includes(normalize(sectionName))) {
          while (insertIdx < dataFile.project.shows.length && dataFile.project.shows[insertIdx].type !== 'section') {
            insertIdx++;
          }
        }
        insertAtIndices(dataFile, itemsToInsert, insertIdx);
      } else {
        insertAtIndices(dataFile, itemsToInsert, dataFile.project.shows.length);
      }
    }
  });

  dataFile.project.shows.forEach((s: any, idx: number) => { s.index = idx; });
  return dataFile;
}

// Switches the livestream output back to the normal song style once a song
// starts, undoing whatever style foreground media before it switched to.
// Only touches the layout's first slide - once the output is on the song
// style, later slides in the same song don't need to repeat the switch.
// Clones rather than mutating in place: for a reused catalog song, showData
// is the actual object read from that song's real .show file, and this
// change must only ever affect the generated project's own embedded copy.
// Skips a slide that already has a hand-set style change, so a song someone has
// specifically configured in FreeShow isn't silently overridden. Other actions on
// that slide (bijvoorbeeld de lichtactie van de sfeer) blijven staan: de stijlwissel
// komt er dan bij. Eerder werd elke bestaande actie als "met de hand ingesteld"
// gezien, waardoor het eerste lied met een sfeer na Welkom de uitvoer niet terugzette.
function withRevertStyleAction(showData: any, outputId: string, styleId: string) {
  const layoutId = showData?.settings?.activeLayout;
  const layout = layoutId ? showData?.layouts?.[layoutId] : Object.values(showData?.layouts || {})[0];
  const slideRefs: any[] = (layout as any)?.slides || [];
  if (!slideRefs.length) return showData;

  // Dia 0 en, als dat een lege startdia is (zonder tekst, bijv. "Start (tracks)"), ook de eerste tekstdia erna: slaat de
  // operator de startdia over, dan moet de uitvoer toch op de liederenstijl staan. Dezelfde stijl twee keer zetten kan geen kwaad.
  const targets = [0];
  const def0 = showData?.slides?.[slideRefs[0].id];
  if (slideRefs.length > 1 && def0 && (def0.items || []).length === 0) targets.push(1);
  const needs = targets.filter(i => !(slideRefs[i].actions?.slideActions || []).some((a: any) => (a?.triggers || []).includes('change_output_style')));
  if (!needs.length) return showData;

  const cloned = JSON.parse(JSON.stringify(showData));
  const clonedLayout: any = layoutId ? cloned.layouts[layoutId] : Object.values(cloned.layouts)[0];
  for (const i of needs) {
    const clonedSlide = clonedLayout.slides[i];
    clonedSlide.actions = {
      ...(clonedSlide.actions || {}),
      slideActions: [{
        id: generateId(),
        name: 'Set style to livestream liederen',
        triggers: ['change_output_style'],
        actionValues: {
          change_output_style: {
            styleOutputs: { type: 'specific', outputs: { [outputId]: styleId } }
          }
        },
        customActivation: '',
        midiEnabled: false
      }, ...(clonedSlide.actions?.slideActions || [])]
    };
  }
  return cloned;
}

function insertAtIndices(dataFile: any, newItems: any[], startIdx: number) {
  const showsToPush: any[] = [];
  newItems.forEach(item => {
    const showId = item.id || generateId();
    if (item.type === 'section') {
      showsToPush.push({ id: showId, type: 'section', name: item.title, notes: "", color: item.color || "#ce3984" });
    } else if (item.type === 'media') {
      if (item.layer === 'direct') {
        showsToPush.push({
          id: item.filePath,
          type: item.metaType,
          name: item.title,
          settings: { timer: item.timer || (item.metaType === 'image' ? 5 : 0), auto: !!item.timer, loop: !!item.loop }
        });
        if (!dataFile.files.includes(item.filePath)) dataFile.files.push(item.filePath);
        dataFile.media[item.filePath] = dataFile.media[item.filePath] || {
          info: { mimeType: item.metaType === "video" ? "video/mp4" : "image/jpeg" },
          tracks: []
        };
      } else {
        const nId = generateId();
        showsToPush.push({ id: nId });
        const sObj = createMediaShowObject(item);
        dataFile.shows[nId] = sObj;
        if (!dataFile.files.includes(item.filePath)) dataFile.files.push(item.filePath);
      }
    } else if (item.type === 'complex-show') {
      const nId = generateId();
      showsToPush.push({ id: nId });
      const sObj = createComplexShowObject(item);
      dataFile.shows[nId] = sObj;
      Object.values(sObj.media || {}).forEach((m: any) => {
        if (m.path && !dataFile.files.includes(m.path)) dataFile.files.push(m.path);
      });
    } else {
      // For an existing catalog song, fullData carries its real show ID -
      // using the draft item's own id instead (a timestamp-random string
      // from draftServicesStore's newId(), unrelated to any real show)
      // embeds the song under a brand-new, unrecognized ID. FreeShow then
      // sees "no local show with this ID" and creates a fresh duplicate
      // named "... 2" instead of recognizing the song already in the
      // catalog. A genuinely new song (no fullData) still falls back to
      // its own id, which is fine since there's no existing entry to match.
      const realId = item.fullData?.id || showId;
      showsToPush.push({ id: realId });
      let showData = item.fullData?.data || createShowObject(item);
      // Gekozen sjabloon voor liedteksten (Instellingen -> FreeShow): ook op een bestaand lied uit de catalogus. Het project bevat
      // de hele show, dus FreeShow neemt dit bij het importeren over.
      if (item.type === 'song' && item.templateId) {
        showData = { ...showData, settings: { ...(showData.settings || {}), template: item.templateId } };
      }
      if ((item.type === 'song' || item.type === 'bible') && item.revertStyleId && item.revertOutputId) {
        showData = withRevertStyleAction(showData, item.revertOutputId, item.revertStyleId);
      }
      dataFile.shows[realId] = showData;
    }
  });
  dataFile.project.shows.splice(startIdx, 0, ...showsToPush);
}

export async function serializeProject(dataJson: any, generatorState?: any): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("data.json", JSON.stringify(dataJson));
  
  if (generatorState) {
    zip.file("livestream_state.json", JSON.stringify(generatorState, null, 2));
  }
  
  return await zip.generateAsync({ type: "uint8array" });
}
