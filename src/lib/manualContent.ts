// Renders the handleiding markdown (content/handleiding-*.md) into
// print-friendly HTML for src/app/manual/[lang]/page.tsx. Tailored to this
// document's markdown subset only (headers, tables, blockquotes, fenced
// code blocks, bullet lists, **bold**/`code` inline) - not a general
// markdown parser.

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(text: string): string {
  let html = escapeHtml(text);
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  return html;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function renderTable(rows: string[][]): string {
  const [header, ...body] = rows;
  const thead = `<thead><tr>${header.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead>`;
  const tbody = `<tbody>${body.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
  return `<table class="manual-table">${thead}${tbody}</table>`;
}

export interface ManualToc {
  level: 0 | 1;
  text: string;
  id: string;
}

export function renderManualHtml(markdown: string): { html: string; toc: ManualToc[] } {
  const lines = markdown.split('\n');
  const toc: ManualToc[] = [];
  const out: string[] = [];
  let i = 0;
  let bulletBuf: string[] = [];
  let firstHeading = true;

  const flushBullets = () => {
    if (bulletBuf.length) {
      out.push(`<ul>${bulletBuf.map(b => `<li>${inline(b)}</li>`).join('')}</ul>`);
      bulletBuf = [];
    }
  };

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();

    if (line === '') { flushBullets(); i++; continue; }

    if (line.startsWith('# ')) {
      flushBullets();
      const text = line.slice(2).trim();
      if (!firstHeading) out.push('<div class="page-break"></div>');
      firstHeading = false;
      if (text.includes('—')) {
        const [main, sub] = text.split('—');
        out.push(`<h1 class="doc-title">${inline(main.trim())}<span class="doc-subtitle">${inline(sub.trim())}</span></h1>`);
      } else {
        out.push(`<h1 class="doc-title">${inline(text)}</h1>`);
      }
      i++;
      continue;
    }

    if (line.startsWith('## ')) {
      flushBullets();
      const text = line.slice(3).trim();
      if (!firstHeading) out.push('<div class="page-break"></div>');
      firstHeading = false;
      const id = slugify(text);
      toc.push({ level: 0, text, id });
      out.push(`<h2 id="${id}">${inline(text)}</h2>`);
      i++;
      continue;
    }

    if (line.startsWith('### ')) {
      flushBullets();
      const text = line.slice(4).trim();
      const id = slugify(text);
      toc.push({ level: 1, text, id });
      out.push(`<h3 id="${id}">${inline(text)}</h3>`);
      i++;
      continue;
    }

    if (line === '---') { flushBullets(); i++; continue; }

    if (line.startsWith('*') && line.endsWith('*') && !line.startsWith('**')) {
      flushBullets();
      out.push(`<p class="doc-meta">${inline(line.slice(1, -1))}</p>`);
      i++;
      continue;
    }

    if (line.startsWith('```')) {
      flushBullets();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      out.push(`<pre class="manual-code">${escapeHtml(codeLines.join('\n'))}</pre>`);
      continue;
    }

    if (line.startsWith('> ')) {
      flushBullets();
      const warnLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        warnLines.push(lines[i].trim().slice(1).trim());
        i++;
      }
      out.push(`<div class="manual-callout">${inline(warnLines.join(' '))}</div>`);
      continue;
    }

    if (line.startsWith('|')) {
      flushBullets();
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
        i++;
      }
      if (rows.length >= 2 && /^:?-+:?$/.test(rows[1][0].replace(/\s/g, ''))) {
        rows.splice(1, 1);
      }
      out.push(renderTable(rows));
      continue;
    }

    if (line.startsWith('- ')) {
      bulletBuf.push(line.slice(2).trim());
      i++;
      continue;
    }

    flushBullets();
    out.push(`<p>${inline(line)}</p>`);
    i++;
  }

  flushBullets();
  return { html: out.join('\n'), toc };
}
