import { describe, expect, it } from "vitest";
import { koyoSpotPhase, koyoViewingWindowOverlaps } from "./koyo.js";
import { jstDate } from "./dates.js";
import { parseRegionObservations, type SpotObservationMap } from "./sakura-forecast.js";

const NOW = new Date("2026-10-23T03:00:00Z"); // 12:00 JST
const TODAY_STAMP = "2026-10-23T00:00:00+09:00";

describe("parseRegionObservations", () => {
  it("keys region-mode reports by spot code across prefectures", () => {
    const map: SpotObservationMap = new Map();
    const regionResponse = {
      result_list: {
        update_datetime: TODAY_STAMP,
        data: [
          { code: "26", name: "京都府", map_spot: [{ code: "26360011", name: "嵐山", state: "0" }] },
          { code: "25", name: "滋賀県", map_spot: [{ code: "25360009", name: "彦根城", state: "2" }] },
        ],
      },
    };

    parseRegionObservations(regionResponse, map);

    expect(map.get("26360011")).toEqual({ state: 0, updated: TODAY_STAMP });
    expect(map.get("25360009")).toEqual({ state: 2, updated: TODAY_STAMP });
  });
});

describe("koyoSpotPhase", () => {
  it("uses a fresh report over forecast dates", () => {
    const ended = "2026-10-17T00:00:00+09:00";

    expect(koyoSpotPhase({ state: 2, updated: TODAY_STAMP }, ended, NOW)).toEqual({ phase: "peak_now", phaseSource: "report" });
  });

  it("never claims a now phase from forecast dates alone", () => {
    const future = "2026-11-02T00:00:00+09:00";

    expect(koyoSpotPhase(null, future, NOW)).toEqual({ phase: "forecast", phaseSource: "forecast" });
  });

  it("falls to forecast dates when the report is stale", () => {
    const staleReport = { state: 1, updated: "2026-10-01T00:00:00+09:00" };

    expect(koyoSpotPhase(staleReport, "2026-10-20T00:00:00+09:00", NOW)).toEqual({ phase: "past", phaseSource: "forecast" });
  });

  it("maps fading and fallen reports to past", () => {
    expect(koyoSpotPhase({ state: 3, updated: TODAY_STAMP }, null, NOW).phase).toBe("past");
    expect(koyoSpotPhase({ state: 4, updated: TODAY_STAMP }, null, NOW).phase).toBe("past");
  });
});

describe("koyoViewingWindowOverlaps", () => {
  const city = { maple: { forecast: "2026-11-20T00:00:00+09:00" }, ginkgo: null };

  it("matches a trip inside the peak-3 to peak+10 window", () => {
    expect(koyoViewingWindowOverlaps(city, jstDate("2026-11-17"), jstDate("2026-11-17"))).toBe(true);
    expect(koyoViewingWindowOverlaps(city, jstDate("2026-11-30"), jstDate("2026-12-02"))).toBe(true);
  });

  it("rejects a trip outside the window", () => {
    expect(koyoViewingWindowOverlaps(city, jstDate("2026-11-10"), jstDate("2026-11-16"))).toBe(false);
    expect(koyoViewingWindowOverlaps(city, jstDate("2026-12-01"), jstDate("2026-12-05"))).toBe(false);
  });
});
