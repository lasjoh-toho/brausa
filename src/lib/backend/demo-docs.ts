/**
 * Real document bytes for the demo backend, so the reader (pdf.js, HTML view)
 * can be tried in a plain browser.
 */

/** A minimal but valid PDF: Helvetica text, one array of lines per page. */
export function makePdf(pages: string[][], title = 'Demo'): Uint8Array {
  const esc = (t: string) =>
    [...t]
      .map((ch) => {
        const c = ch.charCodeAt(0);
        if (ch === '(' || ch === ')' || ch === '\\') return '\\' + ch;
        return c < 128 ? ch : c < 256 ? '\\' + c.toString(8).padStart(3, '0') : '?';
      })
      .join('');
  const objs: string[] = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  pages.forEach((lines, i) => {
    const [head, ...body] = lines;
    const stream =
      `BT /F1 18 Tf 60 770 Td (${esc(head)}) Tj ET\n` +
      `BT /F1 11 Tf 15 TL 60 735 Td ${body.map((l) => `(${esc(l)}) Tj T*`).join(' ')} ET`;
    objs[pageIds[i]] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`;
    objs[pageIds[i] + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let out = `%PDF-1.4\n% ${title}\n`;
  const offsets: number[] = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(out, (c) => c.charCodeAt(0) & 0xff);
}

export const DEMO_PDF = makePdf(
  [
    [
      'Konzept: brausa',
      'brausa ist ein Dateimanager, der Projekte versteht.',
      'Statt Sidecar-Dateien gibt es einen zentralen Index pro Projekt.',
      'Der Index erkennt verschobene Dateien wieder und repariert sich selbst.',
      '',
      'Projektmaps sind unendliche, zoombare Flächen mit Karten.',
      'Karten können Unterkarten enthalten, beliebig tief.',
      'Pfeile verbinden Karten, auch über Ebenen hinweg.',
      '',
      'Snippets: Text aus PDF und HTML wird auf die Map gezogen.',
      'Ein Klick auf das Snippet springt zurück an die Stelle im Dokument.'
    ],
    [
      'Roadmap',
      'Phase A: zentraler Index',
      'Phase B und C: Map-Grundgerüst, Unterkarten und Zoom',
      'Phase D: Dateien als Karten, Kanban als Ansicht',
      'Phase E: TiddlyWiki-Export und -Import',
      'Phase F: Web-Pane, Leser und Snippets',
      '',
      'Offene Fragen:',
      'Wie werden Snippet-Stapel nach TiddlyWiki exportiert?',
      'Antwort: als list-Feld des Stapel-Tiddlers.'
    ]
  ],
  'Konzept'
);

export const DEMO_HTML = `<!doctype html><html><head><title>Recherche: Zoomable User Interfaces</title>
<style>body{font-family:serif}</style><script>alert('nie ausführen')</script></head><body>
<h1>Zoomable User Interfaces</h1>
<p>Eine <b>zoomable user interface</b> (ZUI) zeigt Informationen auf einer unendlichen Fläche.
Statt Fenster zu öffnen, zoomt man in Inhalte hinein.</p>
<h2>Semantischer Zoom</h2>
<p>Beim semantischen Zoom ändert sich nicht nur die Größe, sondern auch der Detailgrad:
aus einem Punkt wird ein Titel, aus dem Titel ein ganzer Text.</p>
<p onclick="alert(1)">iMapping verbindet diese Idee mit verschachtelten Karten und Pfeilen
zwischen beliebigen Ebenen.</p>
<ul><li>Pad++ (1994)</li><li>Zoomworld</li><li>iMapping</li></ul>
</body></html>`;
