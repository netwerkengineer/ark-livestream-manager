import fs from 'fs';
import path from 'path';
import type { Metadata } from 'next';
import { renderManualHtml } from '@/lib/manualContent';

export const metadata: Metadata = {
  title: 'Handleiding — Ark Church Livestream Manager',
};

// Print-friendly manual page, linked from the "Handleiding" help panel in
// FreeshowGenerator.tsx (previously a dead link - this route didn't exist).
// Public/unauthenticated on purpose: the content is generic instructional
// text (example values, not the church's real credentials/IPs), matching
// how the rest of the app's help text works.
//
// Everything is scoped under #manual-page with ID-selector CSS rather than
// bare element selectors (body, h2, ...), since the app's root layout
// (globals.css) already styles `body` with a dark theme - an ID selector
// reliably wins the cascade regardless of stylesheet load order, whereas a
// second `body { ... }` rule racing the global one would not.
export default async function ManualPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;

  const mdPath = path.join(process.cwd(), 'content', 'handleiding-nl.md');
  const markdown = fs.readFileSync(mdPath, 'utf-8');
  const { html, toc } = renderManualHtml(markdown);

  return (
    <div id="manual-page">
      <style dangerouslySetInnerHTML={{ __html: MANUAL_CSS }} />
      <div className="print-bar no-print">
        <span>Handleiding — Ark Church Livestream Manager</span>
        <button id="manual-print-btn" className="print-btn">Afdrukken / Opslaan als PDF</button>
      </div>
      {lang !== 'nl' && (
        <div className="manual-callout no-print" style={{ margin: '1rem auto 0', maxWidth: 800 }}>
          Deze handleiding is op dit moment alleen in het Nederlands beschikbaar.
          <br />This manual is currently only available in Dutch.
        </div>
      )}
      <div className="manual-layout">
        <nav className="manual-toc no-print">
          <div className="toc-title">Inhoud</div>
          {toc.map(entry => (
            <a key={entry.id} href={`#${entry.id}`} className={entry.level === 0 ? 'toc-l0' : 'toc-l1'}>
              {entry.text}
            </a>
          ))}
        </nav>
        <main className="manual-content" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
      <script
        dangerouslySetInnerHTML={{
          __html: "document.getElementById('manual-print-btn').addEventListener('click', function(){ window.print(); });",
        }}
      />
    </div>
  );
}

const MANUAL_CSS = `
#manual-page {
  background: #f8fafc;
  color: #0f172a;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  line-height: 1.6;
  min-height: 100vh;
}
#manual-page * { box-sizing: border-box; }
#manual-page .print-bar {
  position: sticky; top: 0; z-index: 10;
  background: #1d4ed8; color: white;
  padding: 0.75rem 1.5rem;
  display: flex; justify-content: space-between; align-items: center;
  font-weight: 600;
}
#manual-page .print-btn {
  background: white; color: #1d4ed8; border: none; border-radius: 6px;
  padding: 0.5rem 1rem; font-weight: 600; cursor: pointer; font-size: 0.85rem;
}
#manual-page .print-btn:hover { background: #e0e7ff; }
#manual-page .manual-layout { display: flex; max-width: 1100px; margin: 0 auto; gap: 2rem; padding: 2rem 1.5rem; align-items: flex-start; }
#manual-page .manual-toc {
  flex: 0 0 240px; position: sticky; top: 4.5rem;
  background: white; border: 1px solid #e2e8f0; border-radius: 10px; padding: 1rem;
  max-height: calc(100vh - 6rem); overflow-y: auto;
}
#manual-page .toc-title { font-weight: 700; color: #1d4ed8; margin-bottom: 0.5rem; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.03em; }
#manual-page .manual-toc a { display: block; font-size: 0.82rem; color: #334155; text-decoration: none; padding: 0.2rem 0; }
#manual-page .manual-toc a.toc-l1 { padding-left: 0.9rem; opacity: 0.75; font-size: 0.78rem; }
#manual-page .manual-toc a:hover { color: #1d4ed8; }
#manual-page .manual-content { flex: 1; min-width: 0; background: white; border: 1px solid #e2e8f0; border-radius: 10px; padding: 2.5rem 3rem; }
#manual-page .doc-title { text-align: center; font-size: 2rem; margin: 0 0 0.25rem 0; }
#manual-page .doc-title .doc-subtitle { display: block; font-size: 1rem; font-weight: 400; color: #64748b; margin-top: 0.25rem; }
#manual-page .doc-meta { text-align: center; color: #64748b; font-style: italic; font-size: 0.9rem; }
#manual-page h2 { color: #1d4ed8; font-size: 1.4rem; border-bottom: 2px solid #1d4ed8; padding-bottom: 0.4rem; margin-top: 2.5rem; }
#manual-page h3 { font-size: 1.1rem; margin-top: 1.75rem; color: #0f172a; }
#manual-page p { font-size: 0.92rem; margin: 0 0 0.75rem; }
#manual-page ul { padding-left: 1.3rem; font-size: 0.92rem; margin: 0 0 0.75rem; }
#manual-page li { margin-bottom: 0.3rem; }
#manual-page code { background: #eef2ff; color: #4338ca; padding: 0.1rem 0.35rem; border-radius: 4px; font-size: 0.85em; }
#manual-page .manual-table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 0.85rem; }
#manual-page .manual-table th { background: #1d4ed8; color: white; text-align: left; padding: 0.5rem 0.7rem; }
#manual-page .manual-table td { padding: 0.5rem 0.7rem; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
#manual-page .manual-table tr:nth-child(even) td { background: #f1f5f9; }
#manual-page .manual-code {
  background: #0f172a; color: #e2e8f0; padding: 1rem 1.2rem; border-radius: 8px;
  font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 0.8rem; overflow-x: auto; white-space: pre;
}
#manual-page .manual-callout {
  background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px;
  padding: 0.9rem 1.1rem; margin: 1rem 0; font-size: 0.88rem;
}
#manual-page .page-break { break-before: page; }
@media print {
  #manual-page .no-print { display: none !important; }
  #manual-page { background: white; }
  #manual-page .manual-layout { display: block; padding: 0; max-width: none; }
  #manual-page .manual-content { border: none; padding: 0; }
  #manual-page h2 { break-before: page; }
  #manual-page .doc-title { break-before: avoid; }
}
`;
