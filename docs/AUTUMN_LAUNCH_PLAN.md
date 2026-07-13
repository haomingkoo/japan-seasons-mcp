# Autumn Launch Plan

Goal: make Japan in Seasons discoverable before the autumn leaves season, then convert planner traffic into MCP usage when live JMC koyo data becomes valuable.

## Positioning

Primary promise:

> Plan Japan autumn leaves with live JMC forecast data when available, and honest planning windows before the season opens.

Avoid positioning this as only an MCP directory listing. Most users do not wake up wanting an MCP server. They want to know whether to book Kyoto, Nikko, Hokkaido, Tokyo, or Kyushu for specific autumn dates.

## Search Surfaces

Core pages:

- `https://seasons.kooexperience.com/japan-autumn-leaves-trip-planner`
- `https://seasons.kooexperience.com/autumn-leaves-forecast`
- `https://seasons.kooexperience.com/autumn-leaves-forecast.txt`
- `https://seasons.kooexperience.com/kyoto-autumn-leaves-forecast`
- `https://seasons.kooexperience.com/nikko-autumn-leaves-forecast`

Target queries:

- `Japan autumn leaves forecast 2026`
- `Japan autumn leaves trip planner`
- `Kyoto autumn leaves forecast`
- `best dates Kyoto autumn leaves`
- `Nikko autumn leaves forecast`
- `Japan fall foliage itinerary November`
- `when to visit Japan for autumn leaves`
- `koyo forecast Japan`
- `momiji forecast Kyoto`

## Timeline

May-June:

- Publish the autumn planner pages and submit sitemap in Google Search Console and Bing Webmaster Tools.
- If using IndexNow, host the key file at the site root and run `INDEXNOW_KEY=... npm run submit:indexnow` after deploy.
- Add repo topics on GitHub: `mcp`, `japan`, `japan-travel`, `autumn-leaves`, `fall-foliage`, `koyo`, `sakura`, `travel-planning`, `ai-travel`.
- Ask ChatGPT, Claude, Perplexity, and Google AI Mode test questions and record whether they find the pages.

July-August:

- Share the planner as a future-trip resource, not as a developer tool.
- Post examples: "I am visiting Japan Nov 18-Dec 2. Should I choose Kyoto, Nikko, or Kyushu?"
- Add more destination pages only where there is real search demand: Tokyo, Hokkaido, Nara, Osaka, Tohoku.

September:

- Switch marketing copy from planning windows to "forecast season is opening".
- Publish a short update whenever JMC releases or refreshes the current autumn feed.
- Re-submit changed URLs in Search Console and Bing Webmaster Tools.

October-November:

- Post weekly "where is koyo good now" examples with source links.
- Promote the MCP workflow: connect once, then ask with travel dates and destinations.
- Track tool calls by route and client so conversion can be measured.

## Distribution

Developer channels:

- Smithery update post.
- Glama / MCP directories.
- GitHub README and topics.
- Hacker News "Show HN" only when the autumn pages and live forecast are demonstrably useful.

Traveler channels:

- Reddit: r/JapanTravel, r/JapanTravelTips, r/JapanTravelPlanning. Lead with the planner and data source, not "MCP".
- X/Threads/Bluesky: weekly map/status snippets during season.
- Travel bloggers and itinerary writers: pitch as a free live data source they can cite.
- Personal site/newsletter: explain the difference between typical windows and live forecast dates.

AI-search channels:

- Keep `robots.txt` open for search/user fetch bots.
- Keep `llms.txt` current and concise.
- Keep text endpoints plain, source-labeled, and citation-friendly.
- Ensure every page links to the text endpoint, JSON endpoint, and MCP endpoint.

## Measurement

Track weekly:

- Google Search Console impressions and clicks for `autumn leaves`, `koyo`, `Kyoto`, `Nikko`.
- Bing Webmaster Tools impressions and indexed URL count.
- Npm downloads for `japan-seasons-mcp`.
- Smithery tool calls.
- Direct MCP `tools/call` count on `/health`.
- Site requests to `/autumn-leaves-forecast.txt`, `/japan-autumn-leaves-trip-planner`, and destination pages.

The practical conversion funnel is:

1. Search user lands on planning page.
2. Page gets cited by AI search or shared by traveler communities.
3. Developer or power user connects MCP.
4. Live autumn season makes repeated tool calls useful.

## Copy Rules

Use:

- "future-trip planning"
- "live JMC forecast when available"
- "typical planning window"
- "current-year forecast"
- "prior-season reference"

Avoid:

- "real-time" when the upstream feed is not current.
- "guaranteed peak dates".
- Generic "AI travel assistant" language without a concrete travel question.
- Directory-first copy like "MCP server for agents" on traveler-facing pages.
