import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

// Every list-jr-points call fails the way the live endpoint does for Okinawa
// (and for any malformed request): safeFetch throws on the HTTP 400.
const safeFetch = vi.fn(async (url: string) => {
  throw new Error(`API error 400: Bad Request (${url})`);
});
vi.mock("./lib/fetch.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/fetch.js")>()),
  safeFetch,
}));

// index.ts connects a stdio transport on import; hand it one end of an in-memory pair instead.
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: function StdioServerTransport() { return serverSide; },
}));

let base = "";
let httpServer: ReturnType<typeof createServer>;
const client = new Client({ name: "test", version: "0" });

beforeAll(async () => {
  const { handleApiRequest } = await import("./api.js");
  await import("./index.js");
  await client.connect(clientSide);
  httpServer = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost");
    if (!await handleApiRequest(req, res, url.pathname, url.searchParams)) res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP address");
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await client.close();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

function toolText(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return (result.content as { type: string; text: string }[]).map((c) => c.text).join("\n");
}

describe.each([
  { kind: "sakura", path: "/api/sakura/spots", tool: "sakura_spots" },
  { kind: "koyo", path: "/api/koyo/spots", tool: "koyo_spots" },
])("$kind spots for a prefecture JMC publishes no spot list for", ({ path, tool }) => {
  it("answers the API with an empty list and a note, while other upstream 400s stay errors", async () => {
    const okinawa = await fetch(`${base}${path}?pref=47`);
    expect(okinawa.status).toBe(200);
    const body = await okinawa.json();
    expect(body.prefecture).toBe("Okinawa");
    expect(body.spots).toEqual([]);
    expect(body.note).toMatch(/no .*spot list for Okinawa/i);

    const tokyo = await fetch(`${base}${path}?pref=13`);
    expect(tokyo.status).toBe(500);
  });

  it("answers the MCP tool with the note instead of an error, while other upstream 400s stay errors", async () => {
    const okinawa = await client.callTool({ name: tool, arguments: { prefecture: "Okinawa" } });
    expect(okinawa.isError).toBeFalsy();
    expect(toolText(okinawa)).toMatch(/no .*spot list for Okinawa/i);

    const tokyo = await client.callTool({ name: tool, arguments: { prefecture: "Tokyo" } });
    expect(tokyo.isError).toBe(true);
    expect(toolText(tokyo)).toContain("API error 400");
  });
});
