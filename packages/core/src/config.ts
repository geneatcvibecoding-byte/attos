import { z } from "zod";
import { AGENT_KEYS, AUTONOMY_LEVELS, PLATFORMS } from "./types.ts";

/**
 * Workspace config: `config/attentionos.config.ts` in a user's workspace.
 * Everything is optional with safe defaults so a fresh workspace validates.
 */

const providerChoice = <T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) =>
  z.enum(values).default(fallback as never);

export const budgetSchema = z.object({
  /** Hard ceiling per agent run, USD. */
  perRunUsd: z.number().positive().default(2),
  /** Daily ceiling across all LLM runs, USD. */
  dailyUsd: z.number().positive().default(5),
  /** Monthly ceiling for scraping providers (Apify), USD. Checked before every scrape. */
  scrapingMonthlyUsd: z.number().nonnegative().default(29),
  /** Max spend on generated images per day, USD. */
  imagesDailyUsd: z.number().nonnegative().default(2),
});

export const agentConfigSchema = z.object({
  autonomy: z.enum(AUTONOMY_LEVELS).default("review_all"),
  /** Model id for LLM jobs run by this agent in Autopilot mode. */
  model: z.string().optional(),
  maxTurns: z.number().int().positive().max(200).optional(),
  /** How hard the model thinks on this agent's jobs (overrides the job's own setting). Lower is faster. */
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
  enabled: z.boolean().default(true),
});

export const moduleToggleSchema = z.object({
  enabled: z.boolean().default(true),
  /** Cron expressions per job id, overriding module defaults. Empty string disables a schedule. */
  schedules: z.record(z.string(), z.string()).default({}),
  /** Module-specific settings, validated by the module's own config.schema.ts. */
  settings: z.record(z.string(), z.unknown()).default({}),
});

export const configSchema = z.object({
  workspace: z.object({
    /** Stable id; generated when the workspace is created (`attentionos create`). */
    id: z.string().uuid().optional(),
    name: z.string().min(1).default("My brand"),
    preset: z.string().default("coach-consultant"),
    timezone: z.string().default("America/New_York"),
  }).default({ name: "My brand", preset: "coach-consultant", timezone: "America/New_York" }),

  /** Copilot = the user's own Claude Code drives; Autopilot = background worker with ANTHROPIC_API_KEY. */
  mode: z.enum(["copilot", "autopilot"]).default("copilot"),

  platforms: z.array(z.enum(PLATFORMS)).default(["instagram", "tiktok", "youtube", "linkedin"]),

  modules: z.record(z.string(), moduleToggleSchema).default({}),

  agents: z.partialRecord(z.enum(AGENT_KEYS), agentConfigSchema).default({}),

  providers: z.object({
    publisher: providerChoice(["zernio", "blotato", "manual"] as const, "zernio"),
    inbox: providerChoice(["zernio", "blotato", "none"] as const, "zernio"),
    ownAnalytics: providerChoice(["zernio", "iggraph", "blotato", "csv"] as const, "zernio"),
    scraper: providerChoice(["apify", "iggraph", "ytdlp", "none"] as const, "apify"),
    asr: providerChoice(["whispercpp", "parakeet", "openai"] as const, "whispercpp"),
    renderer: providerChoice(["cut", "motion"] as const, "cut"),
    imageGen: providerChoice(["none", "openai", "gemini"] as const, "none"),
    notifier: providerChoice(["telegram", "discord", "email", "console"] as const, "telegram"),
    crm: providerChoice(["lite", "webhook", "sheets", "gohighlevel", "hubspot"] as const, "lite"),
    storage: providerChoice(["local", "supabase", "s3"] as const, "local"),
  }).default({
    publisher: "zernio", inbox: "zernio", ownAnalytics: "zernio", scraper: "apify", asr: "whispercpp",
    renderer: "cut", imageGen: "none", notifier: "telegram", crm: "lite", storage: "local",
  }),

  /**
   * How AI jobs run in the background (worker / Studio "Run now"):
   * - "claude-code" (default): your own logged-in Claude Code (`claude -p`), on your Claude plan, on your machine.
   * - "api": the Claude Agent SDK with ANTHROPIC_API_KEY, billed per use.\n   * - "hermes": Hermes Agent via ACP; requires a dedicated profile with native ACP toolsets disabled.
   */
  runner: z.object({
    engine: z.enum(["claude-code", "api", "hermes"]).default("claude-code"),
    /** Path to the `claude` binary when it isn't on PATH. */
    claudeBin: z.string().optional(),
    /** Path to the Hermes CLI when it isn't on PATH. */
    hermesBin: z.string().optional(),
    /** Dedicated Hermes profile. Configure its platform_toolsets.acp to ["no_mcp"] before use. */
    hermesProfile: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/).optional(),
    /** Jobs the worker runs at once (default 2). */
    concurrency: z.number().int().min(1).max(16).optional(),
    /**
     * Extra slots only work you asked for may use (chat, uploads, "Ask the AI"), so it starts right away even while
     * long background jobs fill the others. Default 1; 0 turns it off.
     */
    userSlots: z.number().int().min(0).max(4).optional(),
    /** Heavy jobs (renders, transcription) at once, across all slots. Default: the same as concurrency. */
    maxHeavy: z.number().int().min(1).max(16).optional(),
  }).default({ engine: "claude-code" }),

  /** Model ids behind the aliases jobs use. Override when new models ship. */
  models: z.object({
    opus: z.string().default("claude-opus-5"),
    sonnet: z.string().default("claude-sonnet-5"),
    haiku: z.string().default("claude-haiku-4-5"),
  }).default({ opus: "claude-opus-5", sonnet: "claude-sonnet-5", haiku: "claude-haiku-4-5" }),

  /**
   * The knowledge store (ADR-15): your Brand Kit, posts, scripts and research, searchable by meaning and keywords,
   * inside your own Postgres (pgvector). "local" embeds on this machine (no key); "openai" / "voyage" use
   * OPENAI_API_KEY / VOYAGE_API_KEY. Changing the embedder re-embeds everything on the next index run.
   */
  knowledge: z.object({
    embeddings: z.enum(["local", "openai", "voyage"]).default("local"),
    /** Model id for the chosen embedder. Defaults: BAAI/bge-small-en-v1.5, text-embedding-3-small, voyage-3.5. */
    model: z.string().min(1).optional(),
  }).default({ embeddings: "local" }),

  budgets: budgetSchema.default({ perRunUsd: 2, dailyUsd: 5, scrapingMonthlyUsd: 29, imagesDailyUsd: 2 }),

  /** One metric every agent judges against. */
  northStar: z.object({
    metric: z.enum(["leads_per_week", "follows_per_post", "booked_calls_per_week", "skip_rate", "revenue_per_week"]).default("leads_per_week"),
    target: z.number().optional(),
  }).default({ metric: "leads_per_week" }),

  /** Quiet hours for notifications, local time "HH:MM". */
  quietHours: z.object({ start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) }).optional(),

  /** Acknowledgements required before opt-in features run. */
  acknowledgements: z.object({
    scrapingTerms: z.boolean().default(false),
    trialReelsRisk: z.boolean().default(false),
    automatedDmRisk: z.boolean().default(false),
    remotionLicense: z.boolean().default(false),
  }).default({ scrapingTerms: false, trialReelsRisk: false, automatedDmRisk: false, remotionLicense: false }),
});

export type AttentionOSConfig = z.output<typeof configSchema>;
export type AttentionOSConfigInput = z.input<typeof configSchema>;

/** Used in `config/attentionos.config.ts`: `export default defineConfig({ ... })`. */
export function defineConfig(config: AttentionOSConfigInput): AttentionOSConfigInput {
  return config;
}

export function parseConfig(input: unknown): AttentionOSConfig {
  return configSchema.parse(input ?? {});
}

/** Effective settings for one module: defaults from module.json merged with the workspace override. */
export function moduleSettings(config: AttentionOSConfig, moduleId: string) {
  return config.modules[moduleId] ?? moduleToggleSchema.parse({});
}

export function agentSettings(config: AttentionOSConfig, agent: (typeof AGENT_KEYS)[number]) {
  return config.agents[agent] ?? agentConfigSchema.parse({});
}
