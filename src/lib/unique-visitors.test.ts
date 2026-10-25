import { describe, expect, it } from "vitest";
import { DailyUniqueVisitors } from "./unique-visitors.js";

describe("DailyUniqueVisitors", () => {
  it("counts distinct IPs within a day", () => {
    const visitors = new DailyUniqueVisitors();
    const now = new Date("2026-10-25T03:00:00Z");

    visitors.add("203.0.113.5", now);
    visitors.add("203.0.113.5", now);
    visitors.add("198.51.100.7", now);

    expect(visitors.count(now)).toBe(2);
  });

  it("never stores the raw IP", () => {
    const visitors = new DailyUniqueVisitors();

    visitors.add("203.0.113.5", new Date("2026-10-25T03:00:00Z"));

    expect(visitors.storedValues().join(" ")).not.toContain("203.0.113.5");
  });

  it("clears the set when the UTC day changes", () => {
    const visitors = new DailyUniqueVisitors();
    visitors.add("203.0.113.5", new Date("2026-10-25T23:59:00Z"));

    const nextDay = new Date("2026-10-26T00:01:00Z");

    expect(visitors.count(nextDay)).toBe(0);
  });

  it("re-salts daily so the same IP hashes differently", () => {
    const visitors = new DailyUniqueVisitors();
    visitors.add("203.0.113.5", new Date("2026-10-25T12:00:00Z"));
    const [dayOne] = visitors.storedValues();

    visitors.add("203.0.113.5", new Date("2026-10-26T12:00:00Z"));

    expect(visitors.storedValues()).not.toContain(dayOne);
  });
});
