// mail-frame.js — the pure (no-DOM) half: which images count as trackers, the
// placeholder a parked image gets, and the embedded-image data URL. Everything
// that needs a browser (when the frame becomes readable, what is fetched and
// when) is in scripts/check-mail-frame.mjs — `npm run check:mail-frame`.
import { describe, it, expect } from "vitest";
import { isMailTrackerImage, mailImagePlaceholder, embeddedImageDataUrl } from "../mail-frame.js";

describe("isMailTrackerImage", () => {
  it("flags 1×1 (or smaller) remote images, by attribute or inline style", () => {
    expect(isMailTrackerImage({ src: "https://x.test/a.gif", width: "1", height: "1" })).toBe(true);
    expect(isMailTrackerImage({ src: "https://x.test/a.gif", width: "0", height: "0" })).toBe(true);
    expect(isMailTrackerImage({ src: "https://x.test/a.gif", width: "1px", height: "1px" })).toBe(true);
    expect(isMailTrackerImage({ src: "https://x.test/a.gif", style: "display:block; width:1px; height:1px" })).toBe(true);
    expect(isMailTrackerImage({ src: "https://x.test/a.gif", style: "width: 1px !important; height: 1px !important;" })).toBe(true);
    expect(isMailTrackerImage({ src: "https://x.test/a.gif", width: "1", style: "height:1px" })).toBe(true);
  });
  it("leaves real images alone, including thin rules and spacers with one real dimension", () => {
    expect(isMailTrackerImage({ src: "https://x.test/hero.jpg", width: "600", height: "300" })).toBe(false);
    expect(isMailTrackerImage({ src: "https://x.test/rule.gif", width: "600", height: "1" })).toBe(false);
    expect(isMailTrackerImage({ src: "https://x.test/spacer.gif", width: "1", height: "20" })).toBe(false);
    expect(isMailTrackerImage({ src: "https://x.test/hero.jpg" })).toBe(false);
    expect(isMailTrackerImage({ src: "https://x.test/hero.jpg", width: "100%", height: "1" })).toBe(false);
    // max-width / min-height / line-height must not read as width / height
    expect(isMailTrackerImage({ src: "https://x.test/hero.jpg", style: "max-width:1px; min-height:1px; line-height:1px" })).toBe(false);
  });
  it("flags known open-tracking endpoints whatever their size", () => {
    for (const src of [
      "https://acme.us1.list-manage.com/track/open.php?u=1&id=2",
      "https://mandrillapp.com/track/open.php?u=1",
      "https://u123.ct.sendgrid.net/wf/open?upn=abc",
      "https://click.e.example.com/open.aspx?ffcb10",
      "https://mailtrack.io/trace/mail/abc.png",
      "https://t.sidekickopen07.com/Cto/abc",
      "https://www.google-analytics.com/collect?v=1",
      "https://www.facebook.com/tr?id=1&ev=PageView",
      "https://cdn.example.com/img/pixel.gif?x=1",
    ]) expect(isMailTrackerImage({ src, width: "200", height: "50" }), src).toBe(true);
  });
  it("does not mistake look-alike paths for trackers", () => {
    for (const src of [
      "https://cdn.example.com/photos/open-house.jpg",
      "https://cdn.example.com/track/opening-night.png",
      "https://cdn.example.com/pixel-art/hero.png",
      "https://cdn.example.com/beacon-hill.png",
      "https://www.facebook.com/trending/banner.png",
    ]) expect(isMailTrackerImage({ src }), src).toBe(false);
  });
  it("never flags embedded or data images — they ship with the message", () => {
    expect(isMailTrackerImage({ src: "cid:logo@x", width: "1", height: "1" })).toBe(false);
    expect(isMailTrackerImage({ src: "data:image/gif;base64,AAAA", width: "1", height: "1" })).toBe(false);
    expect(isMailTrackerImage({})).toBe(false);
    expect(isMailTrackerImage()).toBe(false);
  });
});

describe("mailImagePlaceholder", () => {
  it("reserves the declared size", () => {
    const p = mailImagePlaceholder("560", "200");
    expect(p.startsWith("data:image/svg+xml,")).toBe(true);
    expect(p).toContain("width='560'");
    expect(p).toContain("height='200'");
  });
  it("is 0×0 when the size is missing, partial, or not in pixels", () => {
    for (const [w, h] of [[null, null], ["560", null], ["100%", "200"], ["", ""], ["0", "0"], ["abc", "1"]]) {
      const p = mailImagePlaceholder(w, h);
      expect(p).toContain("width='0'");
      expect(p).toContain("height='0'");
    }
  });
  it("cannot be made to carry markup from the attribute values", () => {
    expect(mailImagePlaceholder("1'/><script>", "2")).not.toContain("script");
  });
});

describe("embeddedImageDataUrl", () => {
  it("turns Gmail's base64url into a plain-base64 data URL", () => {
    expect(embeddedImageDataUrl("image/PNG", "ab-_cd")).toBe("data:image/png;base64,ab+/cd");
  });
  it("refuses anything that isn't an inert raster image, and empty data", () => {
    expect(embeddedImageDataUrl("image/svg+xml", "AAAA")).toBe("");
    expect(embeddedImageDataUrl("text/html", "AAAA")).toBe("");
    expect(embeddedImageDataUrl("", "AAAA")).toBe("");
    expect(embeddedImageDataUrl("image/png", "")).toBe("");
    expect(embeddedImageDataUrl("image/png", null)).toBe("");
  });
});
