#!/usr/bin/env node
// Manual App Store signing for the TestFlight workflow (Luke, 2026-11-14).
//
// Why: once the app and its Share Extension use the App Group
// (group.com.mrlukedevans.live), Xcode's automatic "cloud" signing can't make the
// new App Store profiles ("Authentication failed" / "No profiles for …", while
// builds without the group still sign). So the workflow signs manually instead,
// with a distribution certificate and two profiles it keeps up to date itself
// through the App Store Connect API (the same Admin key the upload uses):
//
//   1. The certificate: the Apple Distribution certificate whose public key
//      matches the IOS_DIST_KEY secret; made from a CSR for that key if none.
//   2. Per bundle id: an App Store profile named "Live CI <bundle id>" holding
//      that certificate; made again if missing, invalid or holding another one
//      (a new profile picks up the App ID's current capabilities).
//   3. Writes the certificate (DER), the profiles, and ExportOptions entries.
//
// Usage: node scripts/ios-manual-signing.mjs <outDir> <bundleId>...
// Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH (the .p8), DIST_KEY_PATH (PEM RSA
// private key). Needs openssl on PATH (CSR and public-key comparison).
// Prints only ids and names, never key material.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createSign, createPrivateKey, createPublicKey, X509Certificate } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const API = "https://api.appstoreconnect.apple.com/v1";
const PROFILE_PREFIX = "Live CI ";

function b64url(buf) { return Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_"); }

export function ascToken({ keyId, issuerId, p8, now = Math.floor(Date.now() / 1000) }) {
  const header = b64url(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iss: issuerId, iat: now, exp: now + 15 * 60, aud: "appstoreconnect-v1" }));
  const signer = createSign("SHA256");
  signer.update(`${header}.${payload}`);
  const sig = signer.sign({ key: p8, dsaEncoding: "ieee-p1363" });
  return `${header}.${payload}.${b64url(sig)}`;
}

// Same public key? (DER SPKI of the cert vs of the private key.)
export function certMatchesKey(certDerB64, privatePem) {
  const cert = new X509Certificate(Buffer.from(certDerB64, "base64"));
  const a = cert.publicKey.export({ type: "spki", format: "der" });
  const b = createPublicKey(createPrivateKey(privatePem)).export({ type: "spki", format: "der" });
  return Buffer.compare(a, b) === 0;
}

// requiredText: strings the profile's plist must contain (e.g. the App Group id),
// so a profile made before a capability was set on the App ID is made again.
export function profileUsable(profile, certId, requiredText = []) {
  const a = profile?.attributes || {};
  const certs = profile?.relationships?.certificates?.data || [];
  const content = a.profileContent ? Buffer.from(a.profileContent, "base64").toString("latin1") : "";
  return a.profileState === "ACTIVE" && certs.some((c) => c.id === certId)
    && (!a.expirationDate || Date.parse(a.expirationDate) > Date.now() + 7 * 86400e3)
    && requiredText.every((t) => content.includes(t));
}

async function main() {
  const [outDir, ...bundleIds] = process.argv.slice(2);
  if (!outDir || !bundleIds.length) throw new Error("usage: ios-manual-signing.mjs <outDir> <bundleId>...");
  const { ASC_KEY_ID: keyId, ASC_ISSUER_ID: issuerId, ASC_KEY_PATH, DIST_KEY_PATH } = process.env;
  const p8 = readFileSync(ASC_KEY_PATH, "utf8");
  const distPem = readFileSync(DIST_KEY_PATH, "utf8");
  mkdirSync(outDir, { recursive: true });

  async function api(method, path, body) {
    const res = await fetch(path.startsWith("http") ? path : `${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${ascToken({ keyId, issuerId, p8 })}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 600);
      try { detail = (JSON.parse(text).errors || []).map((e) => `${e.code}: ${e.title} — ${e.detail}`).join("; ") || detail; } catch {}
      throw new Error(`${method} ${path.split("?")[0]} → ${res.status} ${detail}`);
    }
    return text ? JSON.parse(text) : {};
  }

  // 1. Certificate.
  const certs = (await api("GET", "/certificates?filter[certificateType]=DISTRIBUTION,IOS_DISTRIBUTION&limit=200")).data || [];
  let cert = certs.find((c) => c.attributes?.certificateContent && certMatchesKey(c.attributes.certificateContent, distPem));
  if (cert) console.log(`certificate: using ${cert.id} (${cert.attributes.name || "Apple Distribution"}, expires ${cert.attributes.expirationDate})`);
  else {
    const keyFile = DIST_KEY_PATH;
    const csr = execFileSync("openssl", ["req", "-new", "-key", keyFile, "-subj", "/CN=Live CI Distribution/O=Live", "-outform", "PEM"], { encoding: "utf8" });
    const csrContent = csr.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
    cert = (await api("POST", "/certificates", { data: { type: "certificates", attributes: { certificateType: "DISTRIBUTION", csrContent } } })).data;
    console.log(`certificate: created ${cert.id}`);
  }
  writeFileSync(join(outDir, "dist.cer"), Buffer.from(cert.attributes.certificateContent, "base64"));

  // 2. Profiles.
  const mapping = {};
  for (const identifier of bundleIds) {
    const bundles = (await api("GET", `/bundleIds?filter[identifier]=${encodeURIComponent(identifier)}&limit=20`)).data || [];
    const bundle = bundles.find((b) => b.attributes?.identifier === identifier);
    if (!bundle) throw new Error(`no App ID ${identifier}`);
    const name = `${PROFILE_PREFIX}${identifier}`;
    const found = (await api("GET", `/profiles?filter[name]=${encodeURIComponent(name)}&include=certificates&limit=20`)).data || [];
    const required = (process.env.REQUIRED_PROFILE_TEXT || "").split(",").map((t) => t.trim()).filter(Boolean);
    let profile = found.find((p) => p.attributes?.name === name && profileUsable(p, cert.id, required));
    for (const stale of found.filter((p) => p !== profile && p.attributes?.name === name)) {
      await api("DELETE", `/profiles/${stale.id}`);
      console.log(`profile: removed stale ${stale.id} (${name})`);
    }
    if (!profile) {
      profile = (await api("POST", "/profiles", { data: {
        type: "profiles", attributes: { name, profileType: "IOS_APP_STORE" },
        relationships: { bundleId: { data: { type: "bundleIds", id: bundle.id } }, certificates: { data: [{ type: "certificates", id: cert.id }] } },
      } })).data;
      console.log(`profile: created ${profile.id} (${name})`);
    } else console.log(`profile: using ${profile.id} (${name})`);
    const content = Buffer.from(profile.attributes.profileContent, "base64").toString("latin1");
    const missing = required.filter((t) => !content.includes(t));
    if (missing.length) throw new Error(`${name} was made without ${missing.join(", ")}: the App ID ${identifier} doesn't have it yet (developer.apple.com › Identifiers › ${identifier} › App Groups › Configure, tick it, Save)`);
    writeFileSync(join(outDir, `${profile.attributes.uuid}.mobileprovision`), Buffer.from(profile.attributes.profileContent, "base64"));
    mapping[identifier] = name;
  }
  writeFileSync(join(outDir, "profiles.json"), JSON.stringify(mapping, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.log(`::error title=manual-signing::${String(e.message || e).slice(0, 900)}`); process.exit(1); });
}
