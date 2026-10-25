#!/usr/bin/env node
// Bundles the /explore page (MapLibre + our modules) into public/explore/.
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "explore");
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [join(root, "explore", "main.js")],
  bundle: true,
  format: "esm",
  minify: true,
  target: "es2020",
  outfile: join(out, "explore.js"),
  legalComments: "none",
  logLevel: "warning",
});

await build({
  entryPoints: [join(root, "explore", "explore.css")],
  bundle: true,
  minify: true,
  outfile: join(out, "explore.css"),
  logLevel: "warning",
});

// MapLibre loads its worker from next to the bundle (import.meta.url), same origin.
copyFileSync(join(root, "node_modules", "maplibre-gl", "dist", "maplibre-gl-worker.mjs"), join(out, "maplibre-gl-worker.mjs"));
