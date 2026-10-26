import { describe, expect, it } from "vitest";
import { nthWeekday, occurrence, occurrencesInRange, roughWindow, whenLine, type FestivalLike } from "./festival-dates.js";

const isoOf = (t: number) => new Date(t).toISOString().slice(0, 10);

describe("festival dates", () => {
  it("finds the nth and last Saturday of a month", () => {
    expect(isoOf(nthWeekday(2026, 7, 6, -1))).toBe("2026-07-25");
    expect(isoOf(nthWeekday(2027, 7, 6, -1))).toBe("2027-07-31");
    expect(isoOf(nthWeekday(2026, 10, 6, 1))).toBe("2026-10-03");
    expect(isoOf(nthWeekday(2026, 5, 6, 3))).toBe("2026-05-16");
    expect(isoOf(nthWeekday(2026, 12, 6, -1))).toBe("2026-12-26");
  });

  it("repeats fixed dates and spans a season into the next year", () => {
    expect(occurrence({ when: { type: "fixed", start: "08-02", end: "08-07" } }, 2027)).toEqual({ start: "2027-08-02", end: "2027-08-07", precision: "exact", year: 2027 });
    expect(occurrence({ when: { type: "season", start: "11-21", end: "03-31" } }, 2026)).toMatchObject({ start: "2026-11-21", end: "2027-03-31", precision: "season" });
  });

  it("takes the weekend nearest a date", () => {
    // May 15, 2027 is a Saturday; May 15, 2029 is a Tuesday, nearer the weekend of May 12.
    expect(occurrence({ when: { type: "nearest-weekend", date: "05-15", days: 2 } }, 2027)).toMatchObject({ start: "2027-05-15", end: "2027-05-16" });
    expect(occurrence({ when: { type: "nearest-weekend", date: "05-15", days: 2 } }, 2029)).toMatchObject({ start: "2029-05-12", end: "2029-05-13" });
  });

  it("skips years a biennial festival is not held", () => {
    const kanda: FestivalLike = { when: { type: "nearest-weekend", date: "05-15", days: 2 }, years: "odd" };
    expect(occurrence(kanda, 2026)).toBeNull();
    expect(whenLine(kanda, 2026)).toEqual({ date: "Not held in 2026", note: "Held in odd-numbered years. Next in 2027, probably May 15 to 16." });
  });

  it("finds festivals during a trip, including a winter season that began the year before", () => {
    const white: FestivalLike = { when: { type: "season", start: "11-21", end: "03-31" } };
    expect(occurrencesInRange(white, "2027-02-01", "2027-02-05")).toHaveLength(1);
    const atami: FestivalLike = { when: { type: "several", months: [2, 4, 7] } };
    expect(occurrencesInRange(atami, "2027-03-01", "2027-03-20")).toHaveLength(0);
    expect(occurrencesInRange(atami, "2027-03-25", "2027-04-02")).toHaveLength(1);
    const obon: FestivalLike = { when: { type: "fixed", start: "08-13", end: "08-16" } };
    expect(occurrencesInRange(obon, "2027-08-16", "2027-08-20")).toHaveLength(1);
    expect(occurrencesInRange(obon, "2027-08-17", "2027-08-20")).toHaveLength(0);
  });

  it("says how sure each date is", () => {
    expect(whenLine({ when: { type: "weekday", month: 7, weekday: 6, n: -1 } }, 2026)).toEqual({ date: "July 25, 2026", note: "Last Saturday of July, so probably these dates. Check the official site to confirm." });
    expect(whenLine({ when: { type: "approx", start: "08-11", end: "08-20" } }, 2026).date).toBe("Usually mid August");
    expect(whenLine({ when: { type: "fixed", start: "07-24", end: "07-25" } }, 2026)).toEqual({ date: "July 24 to 25, 2026", note: "Same dates every year." });
    expect(roughWindow("03-21", "04-10")).toBe("late March to early April");
  });
});

describe("festivals.json", () => {
  it("gives every festival a when, a place and a one-sentence summary that matches its months", async () => {
    const { readFileSync } = await import("fs");
    const data = JSON.parse(readFileSync(new URL("../../public/festivals.json", import.meta.url), "utf8"));
    for (const f of data.spots) {
      expect(f.when, f.id).toBeTruthy();
      expect(f.place, f.id).toBeTruthy();
      expect(f.summary.split(/(?<=\.)\s/).length, f.id).toBe(1);
      expect(f.summary, f.id).not.toMatch(/—|!/);
      const occ = occurrence(f, 2026) ?? occurrence(f, 2027);
      expect(occ, f.id).not.toBeNull();
      const startMonth = Number(occ!.start.slice(5, 7));
      expect(f.months, f.id).toContain(startMonth);
    }
  });
});
