import { readFileSync } from "node:fs";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { describe, expect, it, vi } from "vitest";
import { csvCell, neutralizeCell, toExportCsv, type Report } from "@/domain/report";

describe("export CSV", () => {
  it("neutralise les formules, y compris derrière espaces ou contrôles initiaux", () => {
    for (const value of ["=HYPERLINK(\"http://x\")", "+cmd|' /C calc'!A0", "-20 %", "@SUM(A1)", "  =1+1", "\t=1", "\r=1", "\u0001=1"]) {
      expect(neutralizeCell(value).startsWith("'")).toBe(true);
    }
    expect(neutralizeCell("Texte normal")).toBe("Texte normal");
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
  });

  it("une ligne par contrôle, alerte ou contrôle non effectué ; HTML conservé comme texte", () => {
    const report = {
      rows: [
        {
          rowId: "A1", adName: "<img src=x onerror=alert(1)>", locale: "fr-FR", placement: "instagram_feed", mediaFilename: "a.jpg",
          phase: "done", kitIssues: [], mediaError: null, facts: null,
          technical: [{ ruleId: "meta.req.min_width", origin: "meta_requirement", label: "Largeur", status: "pass", observed: "1440 px", expected: "≥ 500 px", action: "x", sourceUrl: "https://www.facebook.com/business/ads-guide/update/image/instagram-feed" }],
          ai: { status: "completed", observations: [], findings: [{ kind: "offer_mismatch", observedText: "=1+1", referenceField: "reference_offer", expected: "-20 %", explanation: "e", action: "a" }], notChecked: [{ check: "date", reason: "Aucune date" }], discarded: 0 },
        },
      ],
    } as unknown as Report;
    const csv = toExportCsv(report);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe('"row_id","ad_name","locale","placement","origin","status","rule_id","observed","expected","action","source_url"');
    expect(lines).toHaveLength(4);
    expect(csv).toContain('"<img src=x onerror=alert(1)>"');
    expect(csv).toContain(`"'=1+1"`);
    expect(csv).toContain(`"'-20 %"`);
  });
});

describe("composant", () => {
  it("le code du widget n'injecte jamais de HTML (textContent uniquement)", () => {
    for (const file of ["src/widget/main.ts", "src/widget/dom.ts", "src/widget/host.ts"]) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML\(|document\.write\(/);
    }
  });
});

describe("MCP (initialize / list / call / resource)", () => {
  it("expose deux outils publics annotés et la ressource UI, sans secret", async () => {
    vi.stubEnv("APP_ORIGIN", "https://campaign-preflight.example");
    vi.resetModules();
    const route = await import("@/app/mcp/route");
    const client = new Client({ name: "test", version: "0" });
    const transport = new StreamableHTTPClientTransport(new URL("https://campaign-preflight.example/mcp"), {
      fetch: (input, init) => route.POST(new Request(input as string | URL, init as RequestInit)),
    });
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(["get_meta_requirements", "open_campaign_preflight"]);
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.outputSchema).toBeTruthy();
    }
    const open = tools.find((tool) => tool.name === "open_campaign_preflight");
    expect((open?._meta as { ui?: { resourceUri?: string } })?.ui?.resourceUri).toBe("ui://campaign-preflight/widget-v1.html");

    const requirements = await client.callTool({ name: "get_meta_requirements", arguments: {} });
    const structured = requirements.structuredContent as { metaRules: Array<{ verified: boolean; sourceUrl: string }>; pocLimits: unknown[]; coverage: { metaTechnicalComplete: boolean } };
    expect(structured.metaRules.every((rule) => rule.verified && rule.sourceUrl.startsWith("https://"))).toBe(true);
    expect(structured.pocLimits.length).toBe(4);
    expect(structured.coverage.metaTechnicalComplete).toBe(true);

    const opened = await client.callTool({ name: "open_campaign_preflight", arguments: {} });
    expect(JSON.stringify(opened)).not.toMatch(/cps_|sk-/);

    const resource = await client.readResource({ uri: "ui://campaign-preflight/widget-v1.html" });
    const content = resource.contents[0] as { mimeType: string; text: string; _meta?: { ui?: { csp?: { connectDomains?: string[] } } } };
    expect(content.mimeType).toBe("text/html;profile=mcp-app");
    expect(content._meta?.ui?.csp?.connectDomains).toEqual(["https://campaign-preflight.example"]);
    expect(content.text).toContain('"apiBase":"https://campaign-preflight.example"');
    expect(content.text).not.toMatch(/cps_[A-Za-z0-9_-]{22}\.|sk-[A-Za-z0-9]{8}/);
    await client.close();
  });
});
