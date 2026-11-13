import { defineRailway, github, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const japanSakuraKoyoMcpVolume = volume("japan-sakura-koyo-mcp-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "asia-southeast1-eqsg3a", sizeMB: 50000 });
  const japanSakuraKoyoMcp = service("japan-sakura-koyo-mcp", {
    source: github("haomingkoo/japan-seasons-mcp", { checkSuites: false }),
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    deploy: {
      healthcheckPath: "/health",
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 3,
    },
    replicas: { "asia-southeast1-eqsg3a": 1 },
    domains: ["sakura.kooexperience.com", "seasons.kooexperience.com"],
    volumeMounts: {
      "/data": japanSakuraKoyoMcpVolume,
    },
    env: {
      JAPAN_SEASONS_CACHE_DIR: preserve(),
    },
  });

  return project("incredible-renewal", {
    resources: [japanSakuraKoyoMcp, japanSakuraKoyoMcpVolume],
  });
});
