# Maintenance scripts

Run these commands from the repository root. Build output goes into `dist/`, `public/explore/` and `public/almanac/`; those generated folders are ignored by Git.

| Job | Command |
| --- | --- |
| Build server and browser assets | `npm run build` |
| Run automated tests | `npm test -- --run` |
| Refresh farm directory | `python3 scripts/scrape-jalan.py` |
| Refresh farm opening dates | `node scripts/scrape-farm-seasons.mjs` |
| Reparse saved opening dates without fetching | `node scripts/scrape-farm-seasons.mjs --reparse` |
| Check festival listings and links | `node scripts/verify-festivals.mjs` |
| Check bloom timeline interaction | `npm run test:slider` |

The `playwright-verify.*`, `test-audit.py`, and `test-popups.*` scripts are older manual checks of the original map UI, separate from the Vitest suite. They have their own target URLs. The `scrape-*-explore.py` scripts inspect Navitime pages and are not part of the weekly farm refresh.
