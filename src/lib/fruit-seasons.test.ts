import { describe, expect, it } from "vitest";
import {
  buildFarms, dayOfYear, daysInMonthCovered, isoToDayOfYear, monthsToRanges, rangeCovers, rangeLabel, rangesOverlapDays,
  REGION_MIN_LISTINGS, tripDays, type RawFarm,
} from "./fruit-seasons.js";

describe("day-of-year windows", () => {
  it("maps month and day to a non-leap day of the year", () => {
    expect(dayOfYear([1, 1])).toBe(1);
    expect(dayOfYear([3, 1])).toBe(60);
    expect(dayOfYear([12, 31])).toBe(365);
    expect(dayOfYear([2, 31])).toBe(59); // clamps to Feb 28
    expect(isoToDayOfYear("2028-02-29")).toBe(59);
  });

  it("covers a window that wraps the new year", () => {
    const winter: [[number, number], [number, number]] = [[12, 11], [5, 20]];
    expect(rangeCovers(winter, dayOfYear([12, 10]))).toBe(false);
    expect(rangeCovers(winter, dayOfYear([12, 11]))).toBe(true);
    expect(rangeCovers(winter, dayOfYear([3, 1]))).toBe(true);
    expect(rangeCovers(winter, dayOfYear([5, 20]))).toBe(true);
    expect(rangeCovers(winter, dayOfYear([5, 21]))).toBe(false);
  });

  it("counts the days a window covers in a month", () => {
    expect(daysInMonthCovered([[12, 11], [5, 20]], 12)).toBe(21);
    expect(daysInMonthCovered([[12, 11], [5, 20]], 5)).toBe(20);
    expect(daysInMonthCovered([[12, 11], [5, 20]], 7)).toBe(0);
  });

  it("joins months into ranges across the new year", () => {
    expect(monthsToRanges([12, 1, 2, 3, 4, 5])).toEqual([[[12, 1], [5, 31]]]);
    expect(monthsToRanges([6, 8])).toEqual([[[6, 1], [6, 30]], [[8, 1], [8, 31]]]);
    expect(monthsToRanges([])).toEqual([]);
  });

  it("turns trip dates into days of the year, across the new year", () => {
    expect(tripDays("2026-12-30", "2027-01-02")).toEqual([364, 365, 1, 2]);
    expect(tripDays("2026-05-02", "2026-05-01")).toEqual([]);
  });

  it("matches a trip against a season", () => {
    const cherries = monthsToRanges([5, 6, 7]);
    expect(rangesOverlapDays(cherries, tripDays("2026-04-25", "2026-05-01"))).toBe(true);
    expect(rangesOverlapDays(cherries, tripDays("2026-04-01", "2026-04-30"))).toBe(false);
  });

  it("labels windows in plain words", () => {
    expect(rangeLabel([[12, 11], [5, 20]])).toBe("mid December to mid May");
    expect(rangeLabel([[7, 1], [11, 30]])).toBe("July to November");
    expect(rangeLabel([[1, 1], [12, 31]])).toBe("all year");
    expect(rangeLabel([[6, 1], [6, 30]])).toBe("June");
  });
});

describe("buildFarms", () => {
  const farm = (id: string, address: string, fruits: string[]): RawFarm => ({ id, name: id, address, fruits, url: `https://example.com/${id}`, lat: 36, lon: 139 });

  it("prefers the farm's own dates, then the region's listings, then the typical guide", () => {
    const listed = Array.from({ length: REGION_MIN_LISTINGS }, (_v, i) => farm(`k${i}`, "千葉県千葉市", ["Strawberry"]));
    const seasons = Object.fromEntries(listed.map((f) => [f.id, { windows: [{ fruit: null, from: [1, 1] as [number, number], to: [5, 10] as [number, number] }] }]));
    const { farms } = buildFarms([...listed, farm("u", "埼玉県秩父市", ["Strawberry"]), farm("h", "北海道札幌市", ["Strawberry"])], seasons);

    expect(farms.find((f) => f.id === "k0")!.seasons[0]).toEqual({ fruit: "Strawberry", ranges: [[[1, 1], [5, 10]]], source: "farm" });
    // Kanto listings are open Jan to early May; May has only 10 days, which still counts.
    expect(farms.find((f) => f.id === "u")!.seasons[0]).toEqual({ fruit: "Strawberry", ranges: [[[1, 1], [5, 31]]], source: "region", basis: REGION_MIN_LISTINGS });
    expect(farms.find((f) => f.id === "h")!.seasons[0].source).toBe("typical");
  });

  it("trims an estimate with a mixed farm's opening dates", () => {
    const { farms } = buildFarms([farm("m", "山梨県甲州市", ["Peach", "Grape"])], {
      m: { windows: [{ fruit: null, from: [8, 1], to: [9, 30] }] },
    });
    const peach = farms[0].seasons.find((s) => s.fruit === "Peach")!;
    expect(peach.source).toBe("typical");
    expect(peach.ranges).toEqual([[[8, 1], [9, 30]]]);
  });

  it("uses a one-fruit farm's tagged dates over its general opening dates", () => {
    const { farms } = buildFarms([farm("g", "山梨県甲州市", ["Grape"])], {
      g: { windows: [{ fruit: null, from: [7, 11], to: [12, 31] }, { fruit: "Grape", from: [8, 11], to: [10, 20] }] },
    });
    expect(farms[0].seasons[0].ranges).toEqual([[[8, 11], [10, 20]]]);
  });

  it("drops farms without coordinates or a known prefecture", () => {
    const { farms } = buildFarms([{ ...farm("x", "千葉県", ["Apple"]), lat: undefined }, farm("y", "Somewhere", ["Apple"])]);
    expect(farms).toEqual([]);
  });
});
