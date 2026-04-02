import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@paperclipai/adapter-utils";
import { asString, parseObject } from "@paperclipai/adapter-utils/server-utils";

interface OllamaTagsResponse {
  models?: Array<{ name?: string; model?: string }>;
}

interface OllamaStreamChunk {
  message?: { content?: string };
  done?: boolean;
  error?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

function summarizeStatus(checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((c) => c.level === "error")) return "fail";
  if (checks.some((c) => c.level === "warn")) return "warn";
  return "pass";
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const config = parseObject(ctx.config);
  const baseUrl = asString(config.baseUrl, "http://localhost:11434").replace(/\/$/, "");
  const configuredModel = asString(config.model, "").trim();

  // 1. Check if Ollama daemon is reachable
  let availableModels: string[] = [];
  try {
    const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
      checks.push({
        code: "ollama_daemon_unreachable",
        level: "error",
        message: `Ollama daemon returned HTTP ${response.status}.`,
        hint: `Check that Ollama is running at ${baseUrl}. Run \`ollama serve\` to start it.`,
      });
    } else {
      const data = (await response.json()) as OllamaTagsResponse;
      availableModels = (data.models ?? []).map((m) => m.name ?? m.model ?? "").filter(Boolean);
      checks.push({
        code: "ollama_daemon_reachable",
        level: "info",
        message: `Ollama daemon is running at ${baseUrl}. Found ${availableModels.length} model(s).`,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    checks.push({
      code: "ollama_daemon_unreachable",
      level: "error",
      message: `Cannot reach Ollama daemon at ${baseUrl}: ${message}`,
      hint: "Ensure Ollama is installed and running. Run `ollama serve` or check the OLLAMA_HOST env var.",
    });
  }

  const daemonReachable = checks.some((c) => c.code === "ollama_daemon_reachable");

  // 2. Check model configuration
  if (!configuredModel) {
    checks.push({
      code: "ollama_model_required",
      level: "error",
      message: "No model configured. Set adapterConfig.model (e.g., llama3.2).",
      hint: "Run `ollama list` to see available models, or `ollama pull <model>` to download one.",
    });
  } else if (daemonReachable) {
    // Ollama model names can have tags (llama3.2:latest). Normalize for comparison.
    const normalize = (n: string) => (n.includes(":") ? n : `${n}:latest`);
    const normalizedConfigured = normalize(configuredModel);
    const modelFound = availableModels.some(
      (m) => normalize(m) === normalizedConfigured || m === configuredModel,
    );

    if (modelFound) {
      checks.push({
        code: "ollama_model_found",
        level: "info",
        message: `Model "${configuredModel}" is available.`,
      });
    } else {
      checks.push({
        code: "ollama_model_not_found",
        level: "warn",
        message: `Model "${configuredModel}" was not found in the local Ollama library.`,
        hint: `Run \`ollama pull ${configuredModel}\` to download it.`,
      });
    }
  }

  // 3. Hello probe (only if daemon is up and model is configured)
  const canProbe =
    daemonReachable &&
    configuredModel.length > 0 &&
    !checks.some((c) => c.code === "ollama_model_not_found" && c.level === "warn");

  if (canProbe) {
    try {
      const probeResponse = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: configuredModel,
          messages: [{ role: "user", content: "Respond with exactly the word hello." }],
          stream: true,
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!probeResponse.ok) {
        checks.push({
          code: "ollama_hello_probe_failed",
          level: "warn",
          message: `Hello probe returned HTTP ${probeResponse.status}.`,
        });
      } else {
        const body = probeResponse.body;
        let probeContent = "";
        let probeError: string | null = null;

        if (body) {
          const decoder = new TextDecoder();
          let lineBuffer = "";
          for await (const raw of body as unknown as AsyncIterable<Uint8Array>) {
            lineBuffer += decoder.decode(raw, { stream: true });
            const lines = lineBuffer.split("\n");
            lineBuffer = lines.pop() ?? "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              const chunk = safeJsonParse(trimmed) as OllamaStreamChunk | null;
              if (chunk?.error) probeError = chunk.error;
              if (chunk?.message?.content) probeContent += chunk.message.content;
            }
          }
        }

        if (probeError) {
          checks.push({
            code: "ollama_hello_probe_failed",
            level: "error",
            message: `Hello probe error: ${probeError}`,
            hint: `Run \`ollama run ${configuredModel}\` manually to check for issues.`,
          });
        } else {
          const hasHello = /\bhello\b/i.test(probeContent);
          checks.push({
            code: hasHello ? "ollama_hello_probe_passed" : "ollama_hello_probe_unexpected",
            level: hasHello ? "info" : "warn",
            message: hasHello
              ? "Hello probe succeeded."
              : "Hello probe ran but response did not contain 'hello'.",
            ...(probeContent.trim()
              ? { detail: probeContent.trim().slice(0, 200) }
              : {}),
          });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const timedOut = message.includes("timed out") || message.includes("TimeoutError");
      checks.push({
        code: timedOut ? "ollama_hello_probe_timed_out" : "ollama_hello_probe_failed",
        level: "warn",
        message: timedOut ? "Hello probe timed out." : `Hello probe failed: ${message}`,
        hint: `Run \`ollama run ${configuredModel}\` manually to verify.`,
      });
    }
  }

  return {
    adapterType: ctx.adapterType,
    status: summarizeStatus(checks),
    checks,
    testedAt: new Date().toISOString(),
  };
}
