// The calculation Web Worker: formulas are computed here, off the page's thread, so
// typing and scrolling stay smooth on big sheets (SPREADSHEET_DESIGN.md §3).
import { createEngineHost } from "./host.js";

const host = createEngineHost();
self.onmessage = (e) => { self.postMessage(host.handle(e.data)); };
