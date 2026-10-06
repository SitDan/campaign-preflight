import { z } from "zod";
import { ABUSE_DEFAULTS } from "./limits";

/**
 * Configuration serveur validée en un seul lieu. Rien ici n'est exposé au
 * navigateur (aucune variable NEXT_PUBLIC_*). Les secrets sont lus à l'usage,
 * jamais au build, et jamais journalisés.
 */

const origin = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return url.origin === value && (url.protocol === "https:" || url.hostname === "localhost");
  }, "doit être une origine exacte (schéma + hôte [+ port]), sans chemin");

const intFromEnv = (fallback: number) =>
  z.coerce.number().int().min(0).max(100_000).default(fallback);

const publicSchema = z.object({
  APP_ENV: z.enum(["development", "test", "preview", "production"]).default("development"),
  APP_ORIGIN: origin.default("http://localhost:3000"),
  /** Origines exactes du composant dans l'hôte, séparées par des virgules. */
  WIDGET_ALLOWED_ORIGIN: z.string().default(""),
  DEMO_ENABLED: z.enum(["true", "false"]).default("true"),
  OPENAI_MODEL: z.string().min(1).max(100).default("gpt-6-luna"),
  ABUSE_SESSION_CREATIONS_PER_HOUR_PER_IP: intFromEnv(ABUSE_DEFAULTS.sessionCreationsPerHourPerIp),
  ABUSE_SETUP_SUBMISSIONS_PER_HOUR_PER_IP: intFromEnv(ABUSE_DEFAULTS.setupSubmissionsPerHourPerIp),
  ABUSE_GLOBAL_SESSIONS_PER_DAY: intFromEnv(ABUSE_DEFAULTS.globalSessionsPerDay),
  ABUSE_GLOBAL_AI_ATTEMPTS_PER_DAY: intFromEnv(ABUSE_DEFAULTS.globalAiAttemptsPerDay),
});

export type PublicConfig = {
  appEnv: "development" | "test" | "preview" | "production";
  appOrigin: string;
  widgetAllowedOrigins: string[];
  demoEnabled: boolean;
  openaiModel: string;
  abuse: {
    sessionCreationsPerHourPerIp: number;
    setupSubmissionsPerHourPerIp: number;
    globalSessionsPerDay: number;
    globalAiAttemptsPerDay: number;
  };
};

let cachedPublic: PublicConfig | undefined;

export function getConfig(): PublicConfig {
  if (cachedPublic) return cachedPublic;
  const parsed = publicSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new ConfigError(`configuration invalide : ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
  }
  const env = parsed.data;
  const widgetAllowedOrigins = env.WIDGET_ALLOWED_ORIGIN.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  for (const value of widgetAllowedOrigins) {
    if (!origin.safeParse(value).success || value.includes("*")) {
      throw new ConfigError("WIDGET_ALLOWED_ORIGIN doit lister des origines exactes, sans joker");
    }
  }
  cachedPublic = {
    appEnv: env.APP_ENV,
    appOrigin: env.APP_ORIGIN,
    widgetAllowedOrigins,
    demoEnabled: env.DEMO_ENABLED === "true",
    openaiModel: env.OPENAI_MODEL,
    abuse: {
      sessionCreationsPerHourPerIp: env.ABUSE_SESSION_CREATIONS_PER_HOUR_PER_IP,
      setupSubmissionsPerHourPerIp: env.ABUSE_SETUP_SUBMISSIONS_PER_HOUR_PER_IP,
      globalSessionsPerDay: env.ABUSE_GLOBAL_SESSIONS_PER_DAY,
      globalAiAttemptsPerDay: env.ABUSE_GLOBAL_AI_ATTEMPTS_PER_DAY,
    },
  };
  return cachedPublic;
}

const secretSchema = z.object({
  REDIS_REST_URL: z.string().url().optional(),
  REDIS_REST_TOKEN: z.string().min(1).optional(),
  /** Noms injectés par l'intégration Vercel Marketplace d'Upstash. */
  KV_REST_API_URL: z.string().url().optional(),
  KV_REST_API_TOKEN: z.string().min(1).optional(),
  BYOK_ENCRYPTION_KEY_B64: z.string().min(1),
  BYOK_ENCRYPTION_KEY_ID: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
});

export type ServerSecrets = {
  redisUrl: string;
  redisToken: string;
  masterKey: Buffer;
  masterKeyId: string;
};

export function getServerSecrets(): ServerSecrets {
  const parsed = secretSchema.safeParse(process.env);
  if (!parsed.success) {
    // Ne jamais inclure les valeurs : uniquement les noms manquants.
    throw new ConfigError(`secrets serveur manquants ou invalides : ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
  }
  const env = parsed.data;
  const redisUrl = env.REDIS_REST_URL ?? env.KV_REST_API_URL;
  const redisToken = env.REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
  if (!redisUrl || !redisToken) throw new ConfigError("configuration Redis absente");
  const masterKey = Buffer.from(env.BYOK_ENCRYPTION_KEY_B64, "base64");
  if (masterKey.length !== 32) throw new ConfigError("BYOK_ENCRYPTION_KEY_B64 doit décoder 32 octets");
  return { redisUrl, redisToken, masterKey, masterKeyId: env.BYOK_ENCRYPTION_KEY_ID };
}

export class ConfigError extends Error {
  readonly code = "config_error";
}
