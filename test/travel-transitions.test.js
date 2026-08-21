import { describe, it, expect } from "vitest";
import {
  pickMode, rankRoutes, recommendReasons, leaveByTime, bufferCheck,
  resolveTransition, formatDuration,
} from "../travel-transitions.js";

const times = {
  walk: { durationMin: 22, distance: "1.6 km" },
  transit: { durationMin: 18, distance: "2.1 km" },
  drive: { durationMin: 12, distance: "2.4 km" },
  bike: { durationMin: 9, distance: "1.7 km" },
};

describe("pickMode", () => {
  it("prefers a short walk", () => {
    expect(pickMode({ walk: { durationMin: 10 }, drive: { durationMin: 5 } }, true)).toBe("walk");
  });
  it("drives when a car is available and it isn't a short walk", () => {
    expect(pickMode(times, true)).toBe("drive");
  });
  it("takes transit over driving when comparable and no car", () => {
    expect(pickMode({ transit: { durationMin: 20 }, drive: { durationMin: 15 } }, false)).toBe("transit");
  });
  it("returns null with no data", () => {
    expect(pickMode(null, false)).toBeNull();
    expect(pickMode({}, false)).toBeNull();
  });
});

describe("rankRoutes", () => {
  it("floats the recommended mode to the top and keeps all modes", () => {
    const { best, rows } = rankRoutes(times, { hasCar: true });
    expect(best).toBe("drive");
    expect(rows[0].recommended).toBe(true);
    expect(rows[0].key).toBe("drive");
    expect(rows).toHaveLength(4);
  });
  it("marks unavailable modes disabled but present", () => {
    const { rows } = rankRoutes({ walk: { durationMin: 8 } }, {});
    const transit = rows.find(r => r.key === "transit");
    expect(transit.available).toBe(false);
  });
});

describe("recommendReasons", () => {
  it("explains a short walk", () => {
    const r = recommendReasons({ walk: { durationMin: 8 }, drive: { durationMin: 6 } }, "walk", { weatherGood: true });
    expect(r).toContain("short distance");
    expect(r.join(" ")).toMatch(/weather/);
  });
  it("explains transit avoids parking", () => {
    const r = recommendReasons(times, "transit", {});
    expect(r.join(" ")).toMatch(/parking|traffic/);
  });
});

describe("leaveByTime", () => {
  it("subtracts duration + buffer from arrival", () => {
    expect(leaveByTime("10:00", 22)).toBe("09:28"); // 22 + 10 buffer
  });
  it("wraps before midnight", () => {
    expect(leaveByTime("00:20", 30)).toBe("23:40"); // 20 - 30 - 10 buffer, wrapped
  });
  it("blank on missing input", () => {
    expect(leaveByTime("", 20)).toBe("");
    expect(leaveByTime("10:00", null)).toBe("");
  });
});

describe("bufferCheck", () => {
  it("passes when the gap covers travel + buffer", () => {
    const a = { time: "10:00", endTime: "12:00" };
    const b = { time: "12:30" };
    expect(bufferCheck(a, b, 15)).toMatchObject({ ok: true });
  });
  it("fails an impossible schedule", () => {
    const a = { time: "10:00", endTime: "12:25" };
    const b = { time: "12:30" };
    expect(bufferCheck(a, b, 40).ok).toBe(false);
  });
  it("returns null when a stop is untimed", () => {
    expect(bufferCheck({ time: null }, { time: "12:00" }, 10)).toBeNull();
  });
});

describe("resolveTransition", () => {
  const transition = {
    kind: "transition",
    fromLocation: "Hotel", toLocation: "Museum",
    fromStop: { time: "09:00", endTime: "09:00" }, toStop: { time: "10:00" },
  };

  it("resolves routing via the injected fetcher without mutating input", async () => {
    const snapshot = JSON.stringify(transition);
    const out = await resolveTransition(transition, { fetchTimes: async () => times, hasCar: false });
    expect(out.routing.status).toBe("ok");
    expect(out.routing.best).toBeTruthy();
    expect(out.routing.leaveBy).toBeTruthy();
    expect(JSON.stringify(transition)).toBe(snapshot);
  });

  it("degrades gracefully when the provider returns null (offline)", async () => {
    const out = await resolveTransition(transition, { fetchTimes: async () => null });
    expect(out.routing.status).toBe("unavailable");
  });

  it("degrades gracefully when the provider throws", async () => {
    const out = await resolveTransition(transition, { fetchTimes: async () => { throw new Error("network"); } });
    expect(out.routing.status).toBe("unavailable");
  });

  it("is unavailable with no fetcher or no locations", async () => {
    expect((await resolveTransition(transition, {})).routing.status).toBe("unavailable");
    expect((await resolveTransition({ fromLocation: "", toLocation: "X" }, { fetchTimes: async () => times })).routing.status).toBe("unavailable");
  });
});

describe("formatDuration", () => {
  it("formats minutes and hours", () => {
    expect(formatDuration(22)).toBe("22 min");
    expect(formatDuration(90)).toBe("1 hr 30 min");
    expect(formatDuration(120)).toBe("2 hr");
  });
});
