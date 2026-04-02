import pc from "picocolors";

/**
 * Ollama streams raw assistant text via stdout chunks.
 * Print each chunk directly with no extra formatting.
 */
export function printOllamaStreamEvent(raw: string, _debug: boolean): void {
  const trimmed = raw.trim();
  if (!trimmed) return;
  // Ollama output is plain text — pass it through in green like other assistant responses.
  process.stdout.write(pc.green(raw));
}
