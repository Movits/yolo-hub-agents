import "dotenv/config";
import { resolve } from "node:path";
import { z } from "zod";

const booleanValue = (fallback: "true" | "false") =>
  z
    .enum(["true", "false"])
    .default(fallback)
    .transform((value) => value === "true");

const optionalSecret = z
  .string()
  .optional()
  .transform((value) => value?.trim() || undefined);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  COMPANY_CONFIG_PATH: z.string().default("./config/company.example.json"),
  ENABLE_SIMULATOR: booleanValue("false"),
  ENABLE_DEBUG_ENDPOINTS: booleanValue("false"),
  WEBHOOK_PROCESSING_MODE: z.enum(["sync", "async"]).default("sync"),
  OPENAI_API_KEY: optionalSecret,
  OPENAI_MODEL: z.string().default("gpt-5.4-mini"),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(12_000),
  META_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v25.0"),
  META_APP_SECRET: optionalSecret,
  WHATSAPP_VERIFY_TOKEN: optionalSecret,
  WHATSAPP_ACCESS_TOKEN: optionalSecret,
  WHATSAPP_PHONE_NUMBER_ID: optionalSecret,
  WHATSAPP_WABA_ID: optionalSecret,
  WHATSAPP_SEND_ENABLED: booleanValue("false"),
  REQUIRE_WEBHOOK_SIGNATURE: booleanValue("false")
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const env = envSchema.parse(source);
  return {
    ...env,
    COMPANY_CONFIG_PATH: resolve(env.COMPANY_CONFIG_PATH)
  };
}
