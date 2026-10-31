# Gates: serving and repository cleanup

OWNS: src/api.ts, src/api.test.ts, src/index.ts, src/lib/static-data.ts, scripts/**, .github/workflows/**, CLAUDE.md, GATES.md, scrape-*.py, playwright-verify.*, test-*.py, test-*.js, verify-festivals.mjs

Scope: Load shared datasets independently of the launch directory, run tests in CI, and move root maintenance scripts into scripts without changing public routes.

- [x] G1: Build succeeds after all module and workflow path changes.
  CHECK: npm run build
  EXPECT: site-copy check ok
  EVIDENCE: npm run build exited 0; site-copy check ok; server and both browser bundles compiled.

- [x] G2: The full automated test suite passes.
  CHECK: npm test -- --run
  EXPECT: Tests
  EVIDENCE: npm test -- --run exited 0; 10 files and 67 tests passed. The new launch-directory test was also run against the previous API implementation and failed with empty farm data.

- [x] G3: HTTP farm data and HTML work when the compiled server starts outside the repository; MCP initialization and an actual fruit tool call still work.
  EVIDENCE: Compiled server launched with /tmp as cwd. HTTP checks returned all 2121 packaged farms, nonempty season data, 200 for nine page/asset/sitemap routes, and 404 for an unknown route. MCP initialize, fruit_farms, and session deletion passed.

- [x] G4: Moved scripts retain their contents and every workflow reference resolves to an existing file.
  EVIDENCE: Compared all nine moved files against HEAD; only three invocation comments changed. All node/python3 scripts/ references in workflows resolve. git diff --check passed.

- [x] G5: The local fruit page passes the desktop and mobile persistent-popup browser journey after the cleanup.
  EVIDENCE: Chrome at 1280px and 390px against the rebuilt server launched from /tmp passed map click, pointer-away persistence, popup fitting inside the map, opening both external links, switching farms, and closing.
