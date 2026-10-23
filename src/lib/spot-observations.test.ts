import { afterEach, describe, expect, it, vi } from "vitest";

const safeFetch = vi.fn();
vi.mock("./fetch.js", () => ({ safeFetch }));
const { refreshSpotObservations } = await import("./sakura-forecast.js");

const regionReply = { result_list: { update_datetime: "2026-10-23T00:00:00+09:00", data: [{ map_spot: [{ code: "26360011", state: "0" }] }] } };

describe("refreshSpotObservations", () => {
  afterEach(() => safeFetch.mockReset());

  it("keeps the last good reports when a refresh fails", async () => {
    safeFetch.mockResolvedValue({ json: async () => regionReply });
    await refreshSpotObservations("koyo");
    safeFetch.mockRejectedValue(new Error("Upstream timeout"));

    const map = await refreshSpotObservations("koyo");

    expect(map.get("26360011")?.state).toBe(0);
  });

  it("throws when there are no earlier reports to keep", async () => {
    safeFetch.mockRejectedValue(new Error("Upstream timeout"));

    await expect(refreshSpotObservations("sakura")).rejects.toThrow("Upstream timeout");
  });
});
