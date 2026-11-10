// The phone's side of presenting to a TV (SLIDES_DESIGN.md §9). When the iPhone is
// connected to a TV or Apple TV, the slides go to the TV (tv.js in a second web view)
// and the phone shows presenter view: notes, timer, the next slide, and a big Next
// button on the right for the right thumb. Unplugging the TV returns the slides to the
// phone. Videos play on the TV.

import * as Y from "yjs";
import { presenterHtml, mountPresenter } from "./present.js";
import { encode, decode, toB64, CHUNK } from "./tv-protocol.js";

export function connectAirPlay({ plugin, model, media, show, root, t0, onScreen = () => {} }) {
  let open = false, ready = false, pv = null, closed = false;
  const listeners = [];
  const black = { v: null };
  const send = (m) => plugin.send({ msg: encode(m) }).catch(() => {});

  const onUpdate = (u, origin) => { if (ready && origin !== "phone") send({ t: "upd", u: toB64(u) }); };
  model.ydoc.on("update", onUpdate);

  async function sendMedia(id) {
    let bytes;
    try { bytes = await media.bytes(id); } catch { return; }
    const n = Math.max(1, Math.ceil(bytes.length / CHUNK));
    for (let i = 0; i < n; i++) await send({ t: "media", id, i, n, d: toB64(bytes.subarray(i * CHUNK, (i + 1) * CHUNK)) });
  }
  function sync() { if (ready) send({ t: "show", idx: show.index, step: show.step, ended: !!show.ended, black: black.v }); }

  async function openTv() {
    if (open || closed) return;
    const r = await plugin.open().catch(() => ({ opened: false }));
    if (!r?.opened) return;
    open = true;
    onScreen(true);
    // presenter view on the phone, over the show
    const host = document.createElement("div");
    host.innerHTML = presenterHtml();
    host.firstElementChild.dataset.air = "1";
    root.appendChild(host.firstElementChild);
    pv = mountPresenter({ doc: root.ownerDocument, win: null, model, media, show, t0, onEnd: () => root.ownerDocument.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })) });
  }
  function closeTv() {
    if (!open) return;
    open = false; ready = false;
    plugin.close().catch(() => {});
    pv?.close(); pv = null;
    root.querySelector("[data-air]")?.remove();
    onScreen(false);
  }

  listeners.push(plugin.addListener("screen", (e) => { if (e.connected) openTv(); else closeTv(); }));
  listeners.push(plugin.addListener("message", async (e) => {
    const m = decode(e.msg);
    if (!m) return;
    if (m.t === "ready") {
      ready = true;
      await send({ t: "show", idx: show.index, step: show.step, ended: !!show.ended });
      await send({ t: "doc", u: toB64(Y.encodeStateAsUpdate(model.ydoc)) });
    } else if (m.t === "need" && typeof m.id === "string" && /^[0-9a-f]{32}$/.test(m.id)) sendMedia(m.id);
  }));
  plugin.status().then((s) => { if (s?.connected) openTv(); }).catch(() => {});

  return {
    update() { pv?.update(); sync(); },
    black(v) { black.v = v; sync(); },
    get onTv() { return open; },
    close() {
      closed = true;
      closeTv();
      model.ydoc.off("update", onUpdate);
      for (const l of listeners) Promise.resolve(l).then((h) => h?.remove?.()).catch(() => {});
    },
  };
}
