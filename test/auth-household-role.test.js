// Household role changes (Luke, 2026-10-26): only the admin, only for someone else in
// the same household, only admin/member, and the household always keeps an admin.
import { describe, it, expect, vi, afterEach } from "vitest";
import mod from "../netlify/functions/household-role.js";

const { checkRoleChange, handler } = mod;
const admin = { id: "luke" };
const members = [{ user_id: "luke", role: "admin" }, { user_id: "mj", role: "member" }];

describe("checkRoleChange", () => {
  const base = { caller: admin, callerMembership: { group_id: "g1", role: "admin" }, members };
  it("lets the admin promote or demote another member", () => {
    expect(checkRoleChange({ ...base, targetUserId: "mj", newRole: "admin" })).toEqual({ ok: true });
    const two = [{ user_id: "luke", role: "admin" }, { user_id: "mj", role: "admin" }];
    expect(checkRoleChange({ ...base, members: two, targetUserId: "mj", newRole: "member" })).toEqual({ ok: true });
  });
  it("refuses anyone who isn't the admin", () => {
    expect(checkRoleChange({ ...base, caller: { id: "mj" }, callerMembership: { group_id: "g1", role: "member" }, targetUserId: "luke", newRole: "member" }).status).toBe(403);
    expect(checkRoleChange({ ...base, callerMembership: null, targetUserId: "mj", newRole: "admin" }).status).toBe(403);
    expect(checkRoleChange({ ...base, caller: null, targetUserId: "mj", newRole: "admin" }).status).toBe(401);
  });
  it("refuses your own role, people outside the household, and other roles", () => {
    expect(checkRoleChange({ ...base, targetUserId: "luke", newRole: "member" }).status).toBe(400);
    expect(checkRoleChange({ ...base, targetUserId: "stranger", newRole: "admin" }).status).toBe(404);
    expect(checkRoleChange({ ...base, targetUserId: "mj", newRole: "hoh" }).status).toBe(400);
    expect(checkRoleChange({ ...base, targetUserId: "mj", newRole: "owner" }).status).toBe(400);
    expect(checkRoleChange({ ...base, targetUserId: "", newRole: "admin" }).status).toBe(400);
  });
  it("never leaves the household without an admin", () => {
    // A stale admin view of the members (the caller is listed as a member) can't demote the last admin.
    const stale = [{ user_id: "luke", role: "member" }, { user_id: "mj", role: "admin" }];
    expect(checkRoleChange({ ...base, members: stale, targetUserId: "mj", newRole: "member" }).status).toBe(400);
  });
  it("treats a no-op as done", () => {
    expect(checkRoleChange({ ...base, targetUserId: "mj", newRole: "member" })).toEqual({ ok: true, unchanged: true });
  });
});

describe("household-role handler", () => {
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.SUPABASE_SERVICE_ROLE_KEY; });
  const call = (body, token = "tok") => handler({ httpMethod: "POST", headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) });

  function stubSupabase({ callerId = "luke", callerRole = "admin", groupMembers = members, patchOk = true } = {}) {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "svc";
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
      calls.push({ url, method: opts.method || "GET", body: opts.body });
      if (url.endsWith("/auth/v1/user")) return { ok: Boolean(callerId), json: async () => ({ id: callerId }) };
      if (url.includes("live_group_members?user_id=eq.")) return { ok: true, json: async () => [{ group_id: "g1", role: callerRole }] };
      if (url.includes("live_group_members?group_id=eq.g1&select=")) return { ok: true, json: async () => groupMembers };
      if (opts.method === "PATCH") return { ok: patchOk, json: async () => ({}) };
      return { ok: false, json: async () => ({}) };
    }));
    return calls;
  }

  it("writes only the role, scoped to the caller's household and the target", async () => {
    const calls = stubSupabase();
    const res = await call({ userId: "mj", role: "admin" });
    expect(res.statusCode).toBe(200);
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch.url).toContain("live_group_members?group_id=eq.g1&user_id=eq.mj");
    expect(JSON.parse(patch.body)).toEqual({ role: "admin" });
  });

  it("refuses a member and writes nothing", async () => {
    const calls = stubSupabase({ callerId: "mj", callerRole: "member" });
    const res = await call({ userId: "luke", role: "member" });
    expect(res.statusCode).toBe(403);
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("needs a session", async () => {
    stubSupabase();
    expect((await call({ userId: "mj", role: "admin" }, "")).statusCode).toBe(401);
    stubSupabase({ callerId: "" });
    expect((await call({ userId: "mj", role: "admin" })).statusCode).toBe(401);
  });
});
