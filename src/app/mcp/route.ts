import { createMcpHandler } from "mcp-handler";
import { getConfig } from "@/config/env";
import { INSTAGRAM_FEED_RULESET } from "@/domain/ruleset";
import { registerCampaignPreflight } from "@/mcp/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const handler = createMcpHandler(
  (server) => {
    const config = getConfig();
    registerCampaignPreflight(server, {
      appOrigin: config.appOrigin,
      widgetDomain: process.env.WIDGET_DOMAIN || config.appOrigin,
      ruleset: INSTAGRAM_FEED_RULESET,
    });
  },
  { serverInfo: { name: "campaign-preflight", version: "1.0.0" }, verboseLogs: false },
);

export { handler as GET, handler as POST, handler as DELETE };
