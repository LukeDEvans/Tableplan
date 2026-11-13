// A document that lives only in memory, for the word processor's preview mode: a Word
// attachment opened from Mail is shown without becoming a file. Same shape as
// store-everyday.js, with nothing behind it: no storage, no table, no channel. It is
// gone when the preview closes.

const IMG_RE = /^[0-9a-f]{32}$/;

export function createMemoryDocStore({ content, images = [] }) {
  let bytes = content;
  const pictures = new Map(images.map((img) => [String(img.id), img.bytes]));
  return {
    kind: "memory",
    scope: "preview",
    fileId: null,
    channel: null,
    encrypt: null,
    loadContent: async () => bytes,
    saveContent: async (next) => { bytes = next; },
    saveRow: async () => {},
    rename: async () => {},
    images: {
      put: async (id, data) => { if (IMG_RE.test(id)) pictures.set(id, data); },
      get: async (id) => {
        const data = pictures.get(String(id));
        if (!data) { const e = new Error("That image isn't in this document."); e.code = "MISSING"; throw e; }
        return data;
      },
    },
    versions: {
      list: async () => [],
      cached: () => [],
      put: async () => {},
      get: async () => { throw new Error("A preview has no versions."); },
      rename: async () => {},
    },
    extraParts: async () => [],
  };
}
