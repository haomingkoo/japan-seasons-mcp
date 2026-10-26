import { describe, expect, it } from "vitest";
import { koyoForecastFreshness, koyoSpotPhase, koyoViewingWindowOverlaps, parseJmcScheduleEntry } from "./koyo.js";
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

describe("koyoForecastFreshness", () => {
  const schedule = ["9月2日(水)", "10月上旬(予定)", "11月上旬(予定)"];

  it("names the next JMC round after the issue date", () => {
    const f = koyoForecastFreshness("2026-10-01T00:00:00+09:00", schedule, new Date("2026-10-26T03:00:00Z"));
    expect(f).toEqual({ issued: "2026-10-01", nextUpdate: "early November (planned)", overdue: false });
  });

  it("flags a round that is more than three days late", () => {
    // early November ends Nov 10; grace runs to the end of Nov 13 JST (15:00 UTC).
    expect(koyoForecastFreshness("2026-10-01T00:00:00+09:00", schedule, new Date("2026-11-13T14:00:00Z")).overdue).toBe(false);
    expect(koyoForecastFreshness("2026-10-01T00:00:00+09:00", schedule, new Date("2026-11-13T15:30:00Z")).overdue).toBe(true);
  });

  it("has no next round after the last one", () => {
    expect(koyoForecastFreshness("2026-11-05T00:00:00+09:00", schedule, new Date("2026-12-20T00:00:00Z"))).toEqual({ issued: "2026-11-05", nextUpdate: null, overdue: false });
  });

  it("parses fixed days and month thirds", () => {
    expect(parseJmcScheduleEntry("9月2日(水)", 2026)?.label).toBe("Sep 2");
    expect(parseJmcScheduleEntry("10月下旬(予定)", 2026)?.latest.toISOString().slice(0, 10)).toBe("2026-10-31");
    expect(parseJmcScheduleEntry("未定", 2026)).toBeNull();
  });
});
