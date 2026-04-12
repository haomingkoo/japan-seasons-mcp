#!/usr/bin/env node
// Syncs the version in server.json to match package.json.
// Run automatically via the `version` npm lifecycle hook (npm version patch/minor/major).
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
const { version } = pkg;

const serverJsonPath = join(root, "server.json");
const server = JSON.parse(readFileSync(serverJsonPath, "utf-8"));

server.version = version;
for (const pkg of server.packages ?? []) {
  pkg.version = version;
}

writeFileSync(serverJsonPath, JSON.stringify(server, null, 2) + "\n");
console.log(`server.json synced to ${version}`);
