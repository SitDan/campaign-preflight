import type { McpServer } from "@modelcontextprotocol/server";
import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { LIMITS } from "@/config/limits";
import { describeCoverage, isVerified, type Ruleset } from "@/domain/rules";
import { renderWidgetHtml } from "./widget-html";

/**
 * L'hôte met le composant en cache par URI (constaté dans ChatGPT) : changer
 * l'URI à chaque évolution visible. Les anciennes URI restent servies (même HTML).
 */
export const WIDGET_URI = "ui://campaign-preflight/widget-v2.html";
const LEGACY_WIDGET_URIS = ["ui://campaign-preflight/widget-v1.html"];

export type McpDeps = {
  appOrigin: string;
  /** Origine dédiée demandée à l'hôte pour le composant (format propre à l'hôte). */
  widgetDomain?: string;
  ruleset: Ruleset;
};

const openOutput = z.object({
  product: z.string(),
  scope: z.object({ placement: z.string(), mediaType: z.string(), maxAds: z.number(), locales: z.array(z.string()) }),
  billing: z.string(),
  nextStep: z.string(),
});

const ruleOutput = z.object({
  id: z.string(),
  nature: z.enum(["meta_requirement", "meta_recommendation", "poc_limit"]),
  label: z.string(),
  metric: z.string(),
  operator: z.string(),
  value: z.union([z.number(), z.array(z.string()), z.array(z.number())]),
  unit: z.string(),
  tolerance: z.number().optional(),
  verified: z.boolean(),
  sourceUrl: z.string().nullable(),
  section: z.string().nullable(),
  verifiedAt: z.string().nullable(),
});

const requirementsOutput = z.object({
  placement: z.literal("instagram_feed"),
  mediaType: z.literal("image"),
  rulesetVersion: z.string(),
  metaRules: z.array(ruleOutput),
  pocLimits: z.array(ruleOutput),
  coverage: z.object({
    metaTechnicalComplete: z.boolean(),
    missing: z.array(z.string()),
    notes: z.array(z.string()),
  }),
  kitContract: z.array(z.string()),
  disclaimer: z.string(),
});

export function registerCampaignPreflight(server: McpServer, deps: McpDeps): void {
  const uiMeta = {
    csp: { connectDomains: [deps.appOrigin] },
    prefersBorder: true,
    ...(deps.widgetDomain ? { domain: deps.widgetDomain } : {}),
  };

  for (const uri of [WIDGET_URI, ...LEGACY_WIDGET_URIS]) {
    registerAppResource(
      server,
      uri === WIDGET_URI ? "Campaign Preflight" : `Campaign Preflight (${uri.split("/").pop()})`,
      uri,
      {
        description: "Composant de vérification d'un kit d'annonces Instagram Feed (images).",
        mimeType: RESOURCE_MIME_TYPE,
        _meta: { ui: uiMeta },
      },
      async () => ({
        contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: renderWidgetHtml({ apiBase: deps.appOrigin }), _meta: { ui: uiMeta } }],
      }),
    );
  }

  registerAppTool(
    server,
    "open_campaign_preflight",
    {
      title: "Ouvrir Campaign Preflight",
      description:
        "Ouvre le composant Campaign Preflight pour vérifier un kit d'annonces Instagram Feed (images JPEG/PNG, 3 annonces maximum) avant transmission à l'agence média. N'ouvre aucune session et n'engage aucune dépense : la configuration de la clé OpenAI de l'utilisateur et l'analyse se font ensuite dans le composant, sur action explicite.",
      inputSchema: z.object({}),
      outputSchema: openOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: { ui: { resourceUri: WIDGET_URI } },
    },
    async () => {
      const output = {
        product: "Campaign Preflight",
        scope: {
          placement: LIMITS.placement,
          mediaType: LIMITS.mediaType,
          maxAds: LIMITS.maxRowsPerKit,
          locales: [...LIMITS.locales],
        },
        billing:
          "Les analyses IA utilisent la clé API OpenAI de l'utilisateur, facturée séparément de l'abonnement ChatGPT. La clé se configure sur une page externe, jamais dans la conversation.",
        nextStep: "Suivre les étapes affichées dans le composant.",
      };
      return {
        content: [{ type: "text", text: "Campaign Preflight est ouvert. Les étapes (configuration, kit, analyse, rapport) se déroulent dans le composant." }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "get_meta_requirements",
    {
      title: "Règles Instagram Feed couvertes",
      description:
        "Retourne les règles techniques publiques vérifiées pour les images Instagram Feed (source officielle Meta, date de lecture) et, séparément, les limites propres à ce POC. Ne contacte aucun service externe.",
      inputSchema: z.object({
        placement: z.literal("instagram_feed").default("instagram_feed"),
        mediaType: z.literal("image").default("image"),
      }),
      outputSchema: requirementsOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const output = describeRequirements(deps.ruleset);
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );
}

export function describeRequirements(ruleset: Ruleset): z.infer<typeof requirementsOutput> {
  const toOutput = (rule: Ruleset["rules"][number]) => ({
    id: rule.id,
    nature: rule.nature,
    label: rule.label,
    metric: rule.metric,
    operator: rule.operator,
    value: rule.value as number | string[] | number[],
    unit: rule.unit,
    ...(rule.tolerance !== undefined ? { tolerance: rule.tolerance } : {}),
    verified: isVerified(rule),
    sourceUrl: rule.source?.url ?? null,
    section: rule.source?.section ?? null,
    verifiedAt: rule.source?.verifiedAt ?? null,
  });
  const coverage = describeCoverage(ruleset);
  return {
    placement: "instagram_feed",
    mediaType: "image",
    rulesetVersion: ruleset.version,
    metaRules: ruleset.rules.filter((rule) => rule.nature !== "poc_limit").map(toOutput),
    pocLimits: ruleset.rules.filter((rule) => rule.nature === "poc_limit").map(toOutput),
    coverage: { metaTechnicalComplete: coverage.metaTechnicalComplete, missing: coverage.missing, notes: coverage.notes },
    kitContract: [
      "row_id, ad_name, locale, placement, media_filename, primary_text et cta sont obligatoires selon le contrat de kit de ce POC (pas une obligation Meta universelle).",
      "landing_url : HTTPS, sans identifiants intégrés ; syntaxe contrôlée, page jamais visitée.",
      "Références facultatives (collection, offre, date + libellé) : comparées au texte visible par l'IA, résultats « à confirmer ».",
    ],
    disclaimer:
      "Aide à la vérification d'un kit : ne certifie ni la conformité juridique ni l'approbation par Meta. Les limites POC ne sont pas des règles Meta.",
  };
}
