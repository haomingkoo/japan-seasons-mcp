import { readFileSync } from "node:fs";

function loadJson(filename: string) {
  try {
    return JSON.parse(readFileSync(new URL(`../../public/${filename}`, import.meta.url), "utf-8"));
  } catch {
    return null;
  }
}

export const STATIC_DATA = {
  flowers: loadJson("flowers.json"),
  festivals: loadJson("festivals.json"),
  farms: loadJson("fruit-farms.json"),
  farmSeasons: loadJson("fruit-farm-seasons.json"),
};
