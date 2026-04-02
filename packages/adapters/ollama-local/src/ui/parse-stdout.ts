import type { TranscriptEntry } from "@paperclipai/adapter-utils";

/**
 * Ollama streams raw text chunks (the assistant response content) via stdout.
 * Each chunk is a fragment of the final response — we emit them as streaming
 * assistant delta entries so the UI renders the response as it arrives.
 */
export function parseOllamaStdoutLine(line: string, ts: string): TranscriptEntry[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  return [{ kind: "assistant", ts, text: line, delta: true }];
}
