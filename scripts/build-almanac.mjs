#!/usr/bin/env node
// Bundles the fruit, festival and plan pages (MapLibre + almanac/ modules) into public/almanac/.
import { build } from "esbuild";
import { copyFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "almanac");
mkdirSync(out, { recursive: true });

const pages = ["fruit", "festivals", "plan"].filter((p) => existsSync(join(root, "almanac", `${p}.js`)));
await build({
  entryPoints: pages.map((p) => join(root, "almanac", `${p}.js`)),
  bundle: true,
  format: "esm",
  splitting: true,
  minify: true,
  target: "es2020",
  outdir: out,
  chunkNames: "chunk-[hash]",
  legalComments: "none",
  logLevel: "warning",
});

await build({
  entryPoints: [join(root, "almanac", "almanac.css")],
  bundle: true,
  minify: true,
  outfile: join(out, "almanac.css"),
  external: ["/fonts/*"],
  logLevel: "warning",
});

copyFileSync(join(root, "node_modules", "maplibre-gl", "dist", "maplibre-gl-worker.mjs"), join(out, "maplibre-gl-worker.mjs"));
