import test from "node:test";
import assert from "node:assert/strict";
import {
  daysFromTodayJst,
  formatMonthDayJst,
  isoDateInJst,
  parseDateRangeInputJst,
} from "../dist/lib/dates.js";

test("formats instants using Japan calendar dates", () => {
  assert.equal(isoDateInJst("2026-04-26T23:30:00Z"), "2026-04-27");
  assert.equal(formatMonthDayJst("2026-04-26T23:30:00Z"), "4/27");
});

test("computes relative days against today's Japan date", () => {
  const now = new Date("2026-04-26T15:30:00Z");

  assert.equal(daysFromTodayJst("2026-04-27T00:00:00+09:00", now), 0);
  assert.equal(daysFromTodayJst("2026-04-28T00:00:00+09:00", now), 1);
  assert.equal(daysFromTodayJst("2026-04-26T00:00:00+09:00", now), -1);
});

test("validates date ranges once for API and MCP callers", () => {
  assert.deepEqual(parseDateRangeInputJst("2026-04-26", "2026-04-28"), {
    startDate: new Date("2026-04-26T00:00:00+09:00"),
    endDate: new Date("2026-04-28T00:00:00+09:00"),
  });
  assert.equal(parseDateRangeInputJst("2026-04-28", "2026-04-26"), null);
  assert.equal(parseDateRangeInputJst("bad", "2026-04-26"), null);
});
