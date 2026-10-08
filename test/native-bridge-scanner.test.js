import { describe, it, expect } from "vitest";
import { nativeDocumentScanner, scannedPagesToFiles } from "../native-bridge.js";

describe("native document scanner bridge", () => {
  it("is null outside the native app (browser falls back to the camera input)", () => {
    expect(nativeDocumentScanner()).toBeNull();
  });

  it("turns base64 JPEG pages into Files for the scan pipeline", async () => {
    const files = scannedPagesToFiles([btoa("abc"), "", null, btoa("de")], 42);
    expect(files.map((f) => [f.name, f.type, f.size])).toEqual([
      ["receipt-42-1.jpg", "image/jpeg", 3],
      ["receipt-42-2.jpg", "image/jpeg", 2],
    ]);
    expect(new TextDecoder().decode(await files[0].arrayBuffer())).toBe("abc");
  });

  it("returns nothing for a cancelled / empty scan", () => {
    expect(scannedPagesToFiles(undefined)).toEqual([]);
  });
});

import { nativeWebAuth, parseAppCallback, APP_CALLBACK_SCHEME } from "../native-bridge.js";
describe("in-app sign-in bridge", () => {
  it("is null outside the native app", () => { expect(nativeWebAuth()).toBeNull(); });
  it("reads the status the Gmail callback puts on the app-scheme URL", () => {
    expect(parseAppCallback(`${APP_CALLBACK_SCHEME}://gmail?status=connected`)).toEqual({ status: "connected", reason: "" });
    expect(parseAppCallback(`${APP_CALLBACK_SCHEME}://gmail?status=error&reason=denied`)).toEqual({ status: "error", reason: "denied" });
    expect(parseAppCallback("https://evil.example/?status=connected").status).toBe("unknown");
    expect(parseAppCallback("not a url").status).toBe("unknown");
  });
});

import { parseOAuthCallback, APP_AUTH_CALLBACK_URL } from "../native-bridge.js";
describe("the app's own Apple / Google sign-in callback", () => {
  it("returns to the app's scheme", () => {
    expect(APP_AUTH_CALLBACK_URL).toBe(`${APP_CALLBACK_SCHEME}://auth-callback`);
  });
  it("reads a PKCE code", () => {
    expect(parseOAuthCallback(`${APP_AUTH_CALLBACK_URL}?code=abc-123`)).toEqual({ kind: "code", code: "abc-123" });
  });
  it("reads implicit-flow tokens from the fragment", () => {
    expect(parseOAuthCallback(`${APP_AUTH_CALLBACK_URL}#access_token=at&expires_in=3600&refresh_token=rt&token_type=bearer`))
      .toEqual({ kind: "tokens", accessToken: "at", refreshToken: "rt" });
  });
  it("reads a refusal from the query or the fragment", () => {
    expect(parseOAuthCallback(`${APP_AUTH_CALLBACK_URL}?error=access_denied&error_description=User+cancelled+the+request`))
      .toEqual({ kind: "error", message: "User cancelled the request" });
    expect(parseOAuthCallback(`${APP_AUTH_CALLBACK_URL}#error=server_error`)).toEqual({ kind: "error", message: "server_error" });
  });
  it("ignores anything that isn't the app's scheme or carries no session", () => {
    expect(parseOAuthCallback("https://effervescent-malabi-e0af55.netlify.app/#access_token=at&refresh_token=rt").kind).toBe("unknown");
    expect(parseOAuthCallback(`${APP_AUTH_CALLBACK_URL}#access_token=at`).kind).toBe("unknown");
    expect(parseOAuthCallback("nope").kind).toBe("unknown");
  });
});
