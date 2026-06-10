import JSZip from 'jszip';
import fs from 'fs/promises';
import path from 'path';

function generateId() {
  return Math.random().toString(36).padEnd(15, '0').substring(2, 13);
}

const GROUP_COLORS: any = {
  'chorus': '#f525d2',
  'bridge': '#f52598',
  'tag': '#7525f5',
  'pre-chorus': '#8825f5',
  'verse': '#5825f5',
  'intro': '#b125f5',
  'outro': '#b125f5',
  'break': '#f52525'
};

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
      name: show.backgroundMedia.split('/').pop(),
      path: show.backgroundMedia,
      type: show.backgroundType || "video",
      muted: true,
      loop: true
    };
  }

  let activeGroupName: string | null = null;
  let activeGroupColor: string | null = null;

  textSections.forEach((section: string, idx: number) => {
    const slideId = generateId();
    let cleanSection = section;

    const groupMatch = section.match(/^\[(.*?)\]\s*\n?/);
    if (groupMatch) {
      activeGroupName = groupMatch[1];
      cleanSection = section.replace(groupMatch[0], '');
      const lowerGroup = activeGroupName.toLowerCase();
      activeGroupColor = null; 
      for (const [key, color] of Object.entries(GROUP_COLORS)) {
        if (lowerGroup.includes(key)) {
          activeGroupColor = color as string;
          break;
        }
      }
    } else if (!activeGroupName) {
      activeGroupName = "Verse 1";
      activeGroupColor = GROUP_COLORS['verse'];
    }

    const isBible = show.data.category === 'scripture';
    const itemIds: string[] = [];
    const layoutChildren: any = {};

    if (isBible && show.refData && show.refData.chunks) {
      const chunk = show.refData.chunks[idx] || [];
      if (chunk.length === 0) return;

      const firstVerse = chunk[0].verse;
      const lastVerse = chunk[chunk.length - 1].verse;
      const verseRange = firstVerse === lastVerse ? firstVerse : `${firstVerse}-${lastVerse}`;
      const slideRef = `${show.refData.book} ${show.refData.chapter}:${verseRange}`;

      const itemIdMain = generateId();
      const itemIdDecor = generateId();
      itemIds.push(itemIdMain, itemIdDecor);
      layoutChildren[itemIdMain] = {};
      layoutChildren[itemIdDecor] = {};

      const lines: any[] = [{ align: "text-align: left;", text: [] }];

      chunk.forEach((v: any, vIdx: number) => {
        lines[0].text.push({
          value: v.verse,
          style: "font-size: 80px;;font-size: 40px;color: rgb(255 255 255 / 0.6);font-size: 60px;margin-right: 0.3em;",
          customType: "disableTemplate"
        });
        lines[0].text.push({
          value: v.text + (vIdx < chunk.length - 1 ? " " : ""),
          sourceDynamicKey: `scripture_text:${vIdx}`,
          style: "font-size: 80px;;font-size: 80px;"
        });
      });

      slides[slideId] = {
        group: slideRef,
        color: null,
        settings: {},
        notes: "",
        items: [
          {
            id: itemIdMain,
            type: "text",
            lines: lines,
            style: "top: 30px;left: 30px;width: 1860px;height: 865px;background-color: rgb(0 0 0 / 0.4);border-radius: 20px;padding: 25px;",
            align: "",
            auto: false
          },
          {
            id: itemIdDecor,
            type: "text",
            lines: [
              { align: "", text: [{ value: slideRef, style: "font-size: 55px;color: rgb(255 255 255 / 0.8);" }] },
              { align: "", text: [{ value: show.refData.metadata?.name || "Bijbel", style: "font-size: 40px;color: rgb(255 255 255 / 0.7);" }] }
            ],
            style: "top: 900px;left: 30px;width: 1860px;height: 150px;",
            align: "",
            decoration: true
          }
        ],
        children: itemIds,
        customDynamicValues: {
          scripture_name: show.refData.metadata?.name || "",
          scripture_book: show.refData.book,
          scripture_book_abbr: show.refData.bookAbbr || show.refData.book.substring(0, 3),
          scripture_chapter: show.refData.chapter.toString(),
          scripture_reference_full: slideRef,
          meta_copyright: show.refData.metadata?.copyright || "",
          meta_title: show.refData.metadata?.name || "",
          scripture_reference: slideRef,
          scripture_verses: verseRange,
          scripture_text: chunk.map((v: any) => [v.verse, v.text])
        }
      };
    } else {
      const lines = cleanSection.split('\n').filter(l => l.trim() !== '').map(line => ({
        align: "",
        text: [{ value: line.trim(), style: "font-size: 100px;" }]
      }));

      const itemId = generateId();
      itemIds.push(itemId);
      layoutChildren[itemId] = {};

      slides[slideId] = {
        group: activeGroupName,
        color: activeGroupColor,
        settings: {},
        notes: "",
        items: [{
          id: itemId,
          type: "text",
          lines: lines,
          style: "top:88px;left:50px;height:904px;width:1820px;",
          align: "",
          auto: false
        }],
        children: itemIds,
        globalGroup: activeGroupName ? activeGroupName.toLowerCase().replace(/\s+/g, '_') : null
      };
    }

    const layoutPush: any = { id: slideId, children: layoutChildren };
    if (idx === 0 && bgMediaId) {
      layoutPush.background = bgMediaId;
    }
    layoutSlides.push(layoutPush);
  });

  const defaultLayoutId = generateId();
  const showLayouts: any = {};
  showLayouts[defaultLayoutId] = { name: "Default", notes: "", slides: layoutSlides };

  const showObj: any = {
    name: show.data.name,
    private: false,
    category: show.data.category,
    settings: {
      activeLayout: defaultLayoutId,
      template: show.data.category === 'scripture' ? 'scripture' : 'default'
    },
    timestamps: { created: now, modified: now, used: now },
    meta: {},
    slides: slides,
    layouts: showLayouts,
    media: showMedia,
    quickAccess: {}
  };

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
    const childIds: string[] = [];

    if (isMedia && !isBackground) {
      const itemId = generateId();
      slideItems.push({
        id: itemId,
        type: "media",
        src: slideData.filePath,
        style: "top:0px;left:0px;height:1080px;width:1920px;",
        fit: "contain"
      });
      childIds.push(itemId);
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
        auto: false
      });
      childIds.push(itemId);
    }

    slides[slideId] = {
      group: slideData.group || "Media",
      color: slideData.color || null,
      settings: {},
      notes: "",
      items: slideItems,
      children: childIds
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
    settings: { activeLayout: layoutId, template: null },
    timestamps: { created: now, modified: now, used: now },
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
    muted: true,
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
    ],
    children: []
  };

  const layoutSlide: any = { id: slideId };
  if (isBackground) layoutSlide.background = mediaId;
  if (item.timer && item.timer > 0) {
    layoutSlide.nextTimer = item.timer;
    layoutSlide.end = true;
  }
  layoutSlides.push(layoutSlide);

  const layoutId = generateId();
  const layouts: any = {};
  layouts[layoutId] = { name: "Default", notes: "", slides: layoutSlides };

  return {
    name: item.title,
    private: false,
    category: "presentation",
    settings: { activeLayout: layoutId, template: null },
    timestamps: { created: now, modified: now, used: now },
    slides: slides,
    layouts: layouts,
    media: media,
    quickAccess: {}
  };
}

export async function createFreeShowProject(dateStr: string, showsList: any[], projectName?: string, templatePath?: string, useTemplate: boolean = true) {
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
              items: [],
              children: []
            };
            layout.slides.push({ id: slideId, children: {}, background: mediaId });
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
      const sectionIdx = dataFile.project.shows.findIndex((s: any) => s.type === 'section' && s.name === sectionName);
      if (sectionIdx !== -1) {
        insertAtIndices(dataFile, itemsToInsert, sectionIdx + 1);
      } else {
        insertAtIndices(dataFile, itemsToInsert, dataFile.project.shows.length);
      }
    }
  });

  dataFile.project.shows.forEach((s: any, idx: number) => { s.index = idx; });
  return dataFile;
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
      showsToPush.push({ id: showId });
      dataFile.shows[showId] = item.fullData?.data || createShowObject(item);
    }
  });
  dataFile.project.shows.splice(startIdx, 0, ...showsToPush);
}

export async function serializeProject(dataJson: any): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("data.json", JSON.stringify(dataJson));
  return await zip.generateAsync({ type: "uint8array" });
}
