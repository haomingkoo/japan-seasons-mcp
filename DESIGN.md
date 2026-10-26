# Japan in Seasons: design

Inherits the kooexperience design core (`~/.agent-memory/design/DESIGN-core.md`). This file adds what is specific to Seasons.

## Audience and job
Travellers planning a Japan trip around cherry blossom, autumn leaves, flowers, fruit or festivals. The map is the product: the first screen is the map plus a list of what is in season, nothing above it but the header.

## Mood
A calm seasonal almanac on warm paper. The map carries the colour; the chrome stays quiet.

## Tokens (public/app.css `:root`)
- Paper `#f6f1e8` page, `#fffcf7` surface, `#f0e9dd` section heads and notes, hairline `#e3d9c9`.
- Ink `#1f1c18`, secondary `#5a534b` (6.3:1 on the darkest surface). No lighter grey for text.
- One accent at a time, set by `body[data-mode]`, or by `data-season` (from the month) on mixed views:
  sakura `#b4325a`, koyo `#ad3b0c`, fruit `#2e6534`, flowers `#65489a`. All pass 4.5:1 on every surface and with white text.
- Danger `#a1281f`, for errors only.
- Type: Shippori Mincho (self-hosted, latin, 500/700) for the wordmark and headings; system sans for UI. Sizes 12, 13, 15, 20, 28 (40 on subpages).
- Radius 6 controls, 10 cards and popups. One shadow (`--float`) for legend, popups and map notices.

## Map
- Base map is OpenFreeMap vector tiles (keyless) drawn by MapLibre inside Leaflet with a paper style in `BASE_STYLE`: English labels only, cities from zoom 6, towns from 10, roads from 7. OSM.de raster with a sepia filter is the fallback when WebGL or the libraries are missing.
- Cluster bubbles sit on their anchor spot, not the centroid, and never exceed `CLUSTER_MAX_SIZE` (44px) with `CLUSTER_RADIUS` 52px, so they cannot overlap at any zoom.
- Markers are plain shapes: dots for spots, squares for festivals and Kawazu cherry. No emoji or glyph icons.
- Cluster numbers pick white or ink with `inkOn()` so every count passes 4.5:1.
- Leaflet attribution, zoom and popups are themed from the tokens.

## Fruit, festival and plan pages (`almanac/`)
- Same shell as `/explore`: map, a year timeline under it, a side panel of cards. MapLibre directly, with the paper style plus soft hillshade.
- 3D terrain only on per-fruit pages, where orchards sit on basin floors; everything else is 2D.
- Farms are solid dots when the farm lists its own dates and rings when the season is estimated. Calendar cells are hatched when mostly estimated.
- Each fruit has a fixed colour (`COLORS` in `almanac/fruit.js`), all 3:1 or better on the land colour.

## Copy
- Plain sentence case. No em dashes, no exclamation marks, no "JMC spot report" jargon in the UI.
- Live counts (spots on the map, filter counts) come from the loaded data. Static copy uses `{{FLOWER_SPOT_COUNT}}`, `{{FESTIVAL_COUNT}}` and `{{FRUIT_FARM_COUNT}}` filled from `public/*.json`, and rounds upstream counts ("about 1,000").

## States
Every list has a skeleton while loading, `stateHtml()` for empty results, and `errorState()` with a retry button. Raw error text never reaches the page.

## Chrome
Header: wordmark, six season views (a select below 769px), Near me. Space is left after the season tabs for a future Explore link. Footer is the shared kooexperience footer; developer and MCP docs live at `/developers`.
