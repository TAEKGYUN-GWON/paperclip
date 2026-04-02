import fs from "node:fs/promises";
import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import {
  asString,
  asNumber,
  parseObject,
  joinPromptSections,
  renderTemplate,
} from "@paperclipai/adapter-utils/server-utils";

interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OllamaStreamChunk {
  model?: string;
  message?: { role?: string; content?: string };
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, runtime: _runtime, config, context, onLog, onMeta } = ctx;

  const baseUrl = asString(config.baseUrl, "http://localhost:11434").replace(/\/$/, "");
  const model = asString(config.model, "llama3.2").trim();
  const timeoutSec = asNumber(config.timeoutSec, 0);
  const promptTemplate = asString(
    config.promptTemplate,
    "You are agent {{agent.id}} ({{agent.name}}). Continue your Paperclip work.",
  );

  // Build template data
  const workspaceContext = parseObject(context.paperclipWorkspace);
  const workspaceCwd = asString(workspaceContext.cwd, process.cwd());
  const templateData = {
    agentId: agent.id,
    companyId: agent.companyId,
    runId,
    company: { id: agent.companyId },
    agent,
    run: { id: runId, source: "on_demand" },
    context,
  };

  // Compose user prompt
  const sessionHandoffNote = asString(context.paperclipSessionHandoffMarkdown, "").trim();
  const compressionNote = (
    asString(context.paperclipSessionCompactDigest, "").trim() ||
    asString(context.paperclipSessionSnipContext, "").trim() ||
    ""
  );
  const renderedPrompt = renderTemplate(promptTemplate, templateData);
  const userPrompt = joinPromptSections([sessionHandoffNote, compressionNote, renderedPrompt]);

  // Compose system prompt
  const instructionsFilePath = asString(config.instructionsFilePath, "").trim();
  let systemPrompt = asString(config.systemPrompt, "").trim();
  if (instructionsFilePath) {
    try {
      systemPrompt = await fs.readFile(instructionsFilePath, "utf8");
    } catch (err) {
      await onLog(
        "stderr",
        `[paperclip] Warning: could not read instructions file "${instructionsFilePath}": ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  const messages: OllamaMessage[] = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content: userPrompt });

  const promptMetrics = {
    systemPromptChars: systemPrompt.length,
    promptChars: userPrompt.length,
    compressionNoteChars: compressionNote.length,
    sessionHandoffChars: sessionHandoffNote.length,
    heartbeatPromptChars: renderedPrompt.length,
  };

  if (onMeta) {
    await onMeta({
      adapterType: "ollama_local",
      command: `${baseUrl}/api/chat`,
      cwd: workspaceCwd,
      commandNotes: [`Model: ${model}`, `Endpoint: ${baseUrl}`],
      commandArgs: [],
      env: {},
      prompt: userPrompt,
      promptMetrics,
      context,
    });
  }

  // Abort controller for timeout
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  if (timeoutSec > 0) {
    timer = setTimeout(() => controller.abort(), timeoutSec * 1000);
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let fullContent = "";
  let timedOut = false;
  let errorMessage: string | null = null;

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: true }),
      signal: controller.signal,
    });

    if (!response.ok) {
      let errorBody = "";
      try {
        errorBody = await response.text();
      } catch {
        // ignore
      }
      return {
        exitCode: 1,
        signal: null,
        timedOut: false,
        errorMessage: `Ollama API error ${response.status}: ${errorBody.slice(0, 300)}`,
      };
    }

    const body = response.body;
    if (!body) {
      return { exitCode: 1, signal: null, timedOut: false, errorMessage: "Ollama returned empty response body." };
    }

    const decoder = new TextDecoder();
    let lineBuffer = "";

    for await (const raw of body as unknown as AsyncIterable<Uint8Array>) {
      lineBuffer += decoder.decode(raw, { stream: true });
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const data = safeJsonParse(trimmed) as OllamaStreamChunk | null;
        if (!data) continue;

        if (data.error) {
          errorMessage = data.error;
          continue;
        }

        if (data.message?.content) {
          const chunk = data.message.content;
          fullContent += chunk;
          await onLog("stdout", chunk);
        }

        if (data.done) {
          inputTokens = data.prompt_eval_count ?? 0;
          outputTokens = data.eval_count ?? 0;
        }
      }
    }

    // Flush trailing buffer
    if (lineBuffer.trim()) {
      const data = safeJsonParse(lineBuffer.trim()) as OllamaStreamChunk | null;
      if (data?.done) {
        inputTokens = data.prompt_eval_count ?? inputTokens;
        outputTokens = data.eval_count ?? outputTokens;
      }
    }

    // Ensure output ends with newline for clean log display
    if (fullContent && !fullContent.endsWith("\n")) {
      await onLog("stdout", "\n");
    }
  } catch (err) {
    const name = (err as Error)?.name;
    if (name === "AbortError") {
      timedOut = true;
    } else {
      errorMessage = err instanceof Error ? err.message : String(err);
    }
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (timedOut) {
    return {
      exitCode: null,
      signal: null,
      timedOut: true,
      errorMessage: timeoutSec > 0 ? `Timed out after ${timeoutSec}s` : "Request aborted.",
    };
  }

  return {
    exitCode: errorMessage ? 1 : 0,
    signal: null,
    timedOut: false,
    errorMessage: errorMessage ?? null,
    usage: {
      inputTokens,
      outputTokens,
      cachedInputTokens: 0,
    },
    model,
    provider: "ollama",
    biller: "ollama",
    billingType: "unknown",
    costUsd: 0,
    resultJson: { content: fullContent },
    summary: fullContent.trim(),
  };
}
