export const SITE_CONFIG = {
  name: "Japan in Seasons",
  serverName: "japan-seasons-mcp",
  siteUrl: "https://seasons.kooexperience.com",
  mcpPath: "/mcp",
  sakuraForecastTextPath: "/sakura-forecast.txt",
  koyoForecastTextPath: "/autumn-leaves-forecast.txt",
  sakuraForecastApiPath: "/api/sakura/forecast",
  koyoForecastApiPath: "/api/koyo/forecast",
  connector: {
    name: "Japan in Seasons",
    description:
      "Use this for live Japan seasonal travel data: cherry blossom and sakura dates, autumn leaves, flowers, festivals, fruit picking, and weather. Best for current or date-specific Japan travel questions.",
  },
  locationExamples: {
    sakura: ["Tokyo", "Kyoto", "Hokkaido", "Kansai", "Tohoku"],
    koyo: ["Kyoto", "Tokyo", "Hokkaido", "Kansai", "Nikko", "Tohoku"],
  },
  seasonalTiming: {
    sakura:
      "Season: Okinawa Jan-Feb, Kyushu/Kansai late Mar, Kanto early Apr, Tohoku mid Apr, Hokkaido late Apr-May.",
    koyoGuide:
      "Hokkaido and high mountains usually peak first from September to October. Tohoku and Nikko often peak in October. Kyoto, Tokyo, and much of central Honshu usually peak in November. Kyushu often continues into late November or early December.",
    koyoShort:
      "Typical season: Hokkaido/mountains Sep-Oct, Tohoku/Nikko Oct, Kanto/Kyoto mid-Oct to Nov, Kyushu Nov-early Dec.",
  },
  toolGuidance: {
    koyoExactSpotsNextStep:
      "Use koyo_spots for exact temples, parks, and gardens if the user already has a destination.",
  },
  koyo: {
    viewingWindowBeforePeakDays: 3,
    viewingWindowAfterPeakDays: 10,
    filterAliases: {
      kansai: ["kinki", "kyoto", "osaka", "shiga", "nara", "hyogo", "wakayama"],
      kinki: ["kansai", "kyoto", "osaka", "shiga", "nara", "hyogo", "wakayama"],
      momiji: ["maple"],
      ichou: ["ginkgo"],
      icho: ["ginkgo"],
    },
    topPrefectures: [
      { code: "09", label: "Nikko (Tochigi)" },
      { code: "26", label: "Kyoto" },
      { code: "29", label: "Nara" },
      { code: "01", label: "Hokkaido" },
      { code: "06", label: "Yamagata" },
    ],
  },
} as const;

export const SITE_URL = SITE_CONFIG.siteUrl;
export const MCP_ENDPOINT = `${SITE_CONFIG.siteUrl}${SITE_CONFIG.mcpPath}`;
export const SAKURA_FORECAST_TEXT_URL = `${SITE_CONFIG.siteUrl}${SITE_CONFIG.sakuraForecastTextPath}`;
export const KOYO_FORECAST_TEXT_URL = `${SITE_CONFIG.siteUrl}${SITE_CONFIG.koyoForecastTextPath}`;
export const SAKURA_FORECAST_API_URL = `${SITE_CONFIG.siteUrl}${SITE_CONFIG.sakuraForecastApiPath}`;
export const KOYO_FORECAST_API_URL = `${SITE_CONFIG.siteUrl}${SITE_CONFIG.koyoForecastApiPath}`;

export const SITE_PUBLIC_CONFIG = {
  name: SITE_CONFIG.name,
  serverName: SITE_CONFIG.serverName,
  siteUrl: SITE_CONFIG.siteUrl,
  mcpEndpoint: MCP_ENDPOINT,
  sakuraForecastTextUrl: SAKURA_FORECAST_TEXT_URL,
  koyoForecastTextUrl: KOYO_FORECAST_TEXT_URL,
  sakuraForecastApiUrl: SAKURA_FORECAST_API_URL,
  koyoForecastApiUrl: KOYO_FORECAST_API_URL,
  connector: {
    ...SITE_CONFIG.connector,
    url: MCP_ENDPOINT,
  },
  locationExamples: SITE_CONFIG.locationExamples,
} as const;
