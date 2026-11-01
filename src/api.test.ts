import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";

it("serves packaged farm data when launched outside the repository", async () => {
  vi.resetModules();
  const cwd = vi.spyOn(process, "cwd").mockReturnValue(tmpdir());
  let server: ReturnType<typeof createServer> | undefined;
  try {
    const { handleApiRequest } = await import("./api.js");
    server = createServer(async (req, res) => {
      const url = new URL(req.url!, "http://localhost");
      if (!await handleApiRequest(req, res, url.pathname, url.searchParams)) res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP address");
    const base = `http://127.0.0.1:${address.port}`;
    const expected = JSON.parse(readFileSync(new URL("../public/fruit-farms.json", import.meta.url), "utf-8"));
    const farms = await fetch(`${base}/api/fruit/farms`);
    expect(farms.status).toBe(200);
    const farmData = await farms.json();
    expect(farmData.spots.length).toBe(expected.spots.length);
    expect(farmData).toEqual(expected);
    const seasons = await fetch(`${base}/api/fruit/seasons`);
    expect(seasons.status).toBe(200);
    const data = await seasons.json();
    expect(data.totalListed).toBe(expected.spots.length);
    expect(data.farms.length).toBeGreaterThan(0);
  } finally {
    cwd.mockRestore();
    if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  }
});
