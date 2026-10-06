import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from "openai";
import { LIMITS } from "@/config/limits";
import { OUTPUT_JSON_SCHEMA, modelOutputSchema, type ModelOutput } from "@/domain/ai-contract";
import { INSTRUCTIONS, buildRowData } from "@/domain/prompt";
import type { AiErrorCode, AiUsage, KitRow } from "@/domain/types";
import type { AiCopy } from "./image";

/**
 * Frontière IA (une seule implémentation en production). Un client par appel,
 * construit avec la clé de LA session ; domaine fournisseur fixé côté serveur ;
 * aucun retry ; timeout fournisseur 30 s + AbortSignal applicatif.
 */
export type VisionInput = { apiKey: string; model: string; image: AiCopy; row: KitRow };

export type VisionOutcome =
  | { ok: true; output: ModelOutput; usage: AiUsage; model: string; latencyMs: number }
  | { ok: false; errorCode: AiErrorCode; outcomeKnown: boolean; usage?: AiUsage; model?: string; latencyMs: number };

export interface VisionAnalyzer {
  analyze(input: VisionInput, signal: AbortSignal): Promise<VisionOutcome>;
}

export const OPENAI_BASE_URL = "https://api.openai.com/v1";

type ResponseLike = {
  status?: string | null;
  model?: string;
  output_text?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string }> }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number } | null;
    output_tokens_details?: { reasoning_tokens?: number } | null;
  } | null;
};

export function mapUsage(usage: ResponseLike["usage"]): AiUsage {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    reasoningTokens: usage?.output_tokens_details?.reasoning_tokens ?? 0,
    cachedTokens: usage?.input_tokens_details?.cached_tokens ?? 0,
  };
}

/** Interprète une réponse Responses : refus, incomplet ou JSON invalide = revue non achevée. */
export function interpretResponse(response: ResponseLike, started: number, now: number): VisionOutcome {
  const usage = mapUsage(response.usage);
  const base = { usage, model: response.model, latencyMs: now - started };
  if (response.status === "incomplete") return { ok: false, errorCode: "incomplete", outcomeKnown: true, ...base };
  if (response.status !== "completed") return { ok: false, errorCode: "provider_error", outcomeKnown: true, ...base };
  const refused = response.output?.some((item) => item.content?.some((part) => part.type === "refusal"));
  if (refused) return { ok: false, errorCode: "refusal", outcomeKnown: true, ...base };
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.output_text ?? "");
  } catch {
    return { ok: false, errorCode: "invalid_output", outcomeKnown: true, ...base };
  }
  const validated = modelOutputSchema.safeParse(parsed);
  if (!validated.success) return { ok: false, errorCode: "invalid_output", outcomeKnown: true, ...base };
  return { ok: true, output: validated.data, usage, model: response.model ?? "inconnu", latencyMs: base.latencyMs };
}

export function classifyError(error: unknown): { errorCode: AiErrorCode; outcomeKnown: boolean } {
  if (error instanceof APIUserAbortError || error instanceof APIConnectionTimeoutError) return { errorCode: "timeout", outcomeKnown: false };
  if (error instanceof APIConnectionError) return { errorCode: "network_error", outcomeKnown: false };
  if (error instanceof AuthenticationError) return { errorCode: "invalid_key", outcomeKnown: true };
  if (error instanceof NotFoundError || error instanceof PermissionDeniedError) return { errorCode: "model_unavailable", outcomeKnown: true };
  if (error instanceof RateLimitError) {
    return { errorCode: error.code === "insufficient_quota" ? "quota_exceeded" : "rate_limited", outcomeKnown: true };
  }
  if (error instanceof BadRequestError) {
    return { errorCode: error.code === "model_not_found" ? "model_unavailable" : "provider_error", outcomeKnown: true };
  }
  if (error instanceof APIError) return { errorCode: "provider_error", outcomeKnown: true };
  if (error instanceof Error && error.name === "AbortError") return { errorCode: "timeout", outcomeKnown: false };
  return { errorCode: "provider_error", outcomeKnown: false };
}

export function createOpenAiVisionAnalyzer(): VisionAnalyzer {
  return {
    async analyze(input, signal) {
      const client = new OpenAI({
        apiKey: input.apiKey,
        baseURL: OPENAI_BASE_URL,
        organization: null,
        project: null,
        maxRetries: 0,
        timeout: LIMITS.providerTimeoutMs,
        fetchOptions: { redirect: "error" },
      });
      const started = Date.now();
      try {
        const response = await client.responses.create(
          {
            model: input.model,
            store: false,
            max_output_tokens: LIMITS.modelMaxOutputTokens,
            reasoning: { effort: "low" },
            instructions: INSTRUCTIONS,
            input: [
              {
                role: "user",
                content: [
                  { type: "input_text", text: buildRowData(input.row) },
                  { type: "input_image", image_url: `data:${input.image.mimeType};base64,${input.image.base64}`, detail: "high" },
                ],
              },
            ],
            text: { format: { type: "json_schema", name: "preflight_review", schema: OUTPUT_JSON_SCHEMA as unknown as Record<string, unknown>, strict: true } },
          },
          { signal, maxRetries: 0, timeout: LIMITS.providerTimeoutMs },
        );
        return interpretResponse(response as unknown as ResponseLike, started, Date.now());
      } catch (error) {
        return { ok: false, ...classifyError(error), latencyMs: Date.now() - started };
      }
    },
  };
}
