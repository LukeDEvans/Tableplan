// Print and PDF (WORD_PROCESSOR_DESIGN.md §9): the pages exactly as laid out on
// screen. Each page is a page-sized box showing its slice of a copy of the laid-out
// sheet (page shapes, headers, footers and text), so what prints is what Pages mode
// shows. On a laptop the browser's print dialog does the rest (Save as PDF); on the
// iPhone the native PdfExport plugin renders the same boxes to a PDF file and hands
// it to the share sheet. Pageless documents print with the browser's own pages.

import { PAGE_GAP } from "./pages.js";

export async function printPages({ sheet, editor, settings, layout, geometry, name, print = false, nativePdf = null, share, relayout }) {
  relayout?.();
  await new Promise((r) => setTimeout(r, 250)); // let a pending layout pass run
  const pages = settings.pageless ? null : layout;
  const container = document.createElement("div");
  container.className = "wp-print";
  const style = document.createElement("style");
  const geo = geometry;
  if (pages) {
    const stride = geo.pageH + PAGE_GAP;
    for (let i = 0; i < pages.pages; i++) {
      const box = document.createElement("div");
      box.className = "wp-print-page";
      box.style.width = `${geo.pageW}px`;
      box.style.height = `${geo.pageH}px`;
      const copy = sheet.cloneNode(true);
      copy.removeAttribute("data-sheet");
      Object.assign(copy.style, { position: "absolute", left: "0", top: `${-i * stride}px`, margin: "0", zoom: "1", width: `${geo.pageW}px` });
      for (const el of copy.querySelectorAll(".collaboration-carets__caret, .ProseMirror-gapcursor, .wp-endnotes[hidden]")) el.remove();
      for (const el of copy.querySelectorAll(".find-hit, .is-active, .ProseMirror-selectednode")) el.classList.remove("find-hit", "is-active", "ProseMirror-selectednode");
      for (const el of copy.querySelectorAll("[contenteditable]")) el.removeAttribute("contenteditable");
      // images inside the copy: same object URLs (still valid while printing)
      const wrap = document.createElement("div");
      wrap.className = "wp-root wp-print-root";
      wrap.style.cssText = "position:relative;inset:auto;z-index:auto;display:block;padding:0;background:transparent";
      wrap.appendChild(copy);
      box.appendChild(wrap);
      container.appendChild(box);
    }
    style.textContent = `@page { size: ${geo.pageW}px ${geo.pageH}px; margin: 0; } @media print { html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; } .wp-print-root .wp-page { box-shadow: none !important; } }`;
  } else {
    const wrap = document.createElement("div");
    wrap.className = "wp-root wp-print-root is-pageless";
    wrap.style.cssText = "position:static;display:block;padding:0;background:#fff";
    const doc = document.createElement("div");
    doc.className = "wp-doc";
    doc.appendChild(editor.view.dom.cloneNode(true));
    wrap.appendChild(doc);
    container.appendChild(wrap);
    style.textContent = `@page { size: letter; margin: 0.75in; } @media print { .wp-print-root .ProseMirror { padding: 0 !important; min-height: 0 !important; } }`;
  }
  container.appendChild(style);
  document.body.appendChild(container);
  const cleanup = () => container.remove();
  await Promise.all([...container.querySelectorAll("img")].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }))));

  try {
    if (nativePdf) {
      const b64 = await nativePdf({ widthPt: (geo.pageW * 72) / 96, heightPt: (geo.pageH * 72) / 96, pages: pages?.pages || 0 });
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await share(new Blob([bytes], { type: "application/pdf" }), `${name}.pdf`, "application/pdf");
      return;
    }
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; window.removeEventListener("afterprint", finish); resolve(); };
      window.addEventListener("afterprint", finish);
      window.print();
      setTimeout(finish, 60_000);
    });
    void print;
  } finally { cleanup(); }
}
