import Anthropic from "@anthropic-ai/sdk";
import { createAnthropicModel } from "./anthropic";
import { createDeepSeekModel } from "./deepseek";
import type { LanguageModel } from "./language-model";

export interface ModelOption {
  id: string;
  label: string;
  provider: string;
  available: boolean;
}

interface CatalogEntry {
  id: string;
  label: string;
  provider: string;
  keyName: string;
  create: (apiKey: string) => LanguageModel;
}

type Env = Record<string, string | undefined>;

export const DEFAULT_MODEL_ID = "claude-sonnet-5-5";

const CATALOG: CatalogEntry[] = [
  {
    id: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    provider: "Anthropic",
    keyName: "ANTHROPIC_API_KEY",
    create: (apiKey) => createAnthropicModel(new Anthropic({ apiKey }), "claude-sonnet-5-5"),
  },
  {
    id: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    provider: "DeepSeek",
    keyName: "DEEPSEEK_API_KEY",
    create: (apiKey) => createDeepSeekModel(apiKey, "deepseek-v4-pro"),
  },
];

export function listModels(env: Env = process.env): ModelOption[] {
  return CATALOG.map(({ id, label, provider, keyName }) => ({ id, label, provider, available: Boolean(env[keyName]) }));
}

export function createModel(id: string, env: Env = process.env): LanguageModel | null {
  const entry = CATALOG.find((candidate) => candidate.id === id);
  const apiKey = entry && env[entry.keyName];
  return entry && apiKey ? entry.create(apiKey) : null;
}
