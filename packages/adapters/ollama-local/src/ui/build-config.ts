import type { CreateConfigValues } from "@paperclipai/adapter-utils";

function parseEnvVars(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    env[key] = value;
  }
  return env;
}

export function buildOllamaLocalConfig(v: CreateConfigValues): Record<string, unknown> {
  const ac: Record<string, unknown> = {};
  if (v.model) ac.model = v.model;
  if (v.url) ac.baseUrl = v.url;
  if (v.cwd) ac.cwd = v.cwd;
  if (v.instructionsFilePath) ac.instructionsFilePath = v.instructionsFilePath;
  if (v.promptTemplate) ac.promptTemplate = v.promptTemplate;
  if (v.bootstrapPrompt) ac.bootstrapPromptTemplate = v.bootstrapPrompt;
  ac.timeoutSec = 0;

  const env: Record<string, string> = parseEnvVars(v.envVars ?? "");
  if (Object.keys(env).length > 0) ac.env = env;

  return ac;
}
