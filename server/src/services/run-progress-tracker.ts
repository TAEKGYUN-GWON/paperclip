/**
 * run-progress-tracker.ts
 * Phase 14: Accumulates structured run progress metrics from onLog callbacks.
 *
 * Publishes heartbeat.run.progress live events at meaningful moments:
 * - Phase transitions (preparing → executing → compacting → finalizing)
 * - Each detected tool use
 * - Every PROGRESS_LOG_INTERVAL log chunks (rate-limiting fallback)
 */

// ──────────────────────────────────────────────────────────────────────────────
// Public types (mirrored in LiveEvent payload)
// ──────────────────────────────────────────────────────────────────────────────

export type RunPhase = "preparing" | "executing" | "compacting" | "finalizing";

export interface RunProgressActivity {
  kind: "tool_use" | "output" | "phase_change";
  summary: string;
}

export interface RunProgressSnapshot {
  runId: string;
  agentId: string;
  phase: RunPhase;
  toolUseCount: number;
  logLineCount: number;
  inputTokens: number;
  outputTokens: number;
  recentActivities: RunProgressActivity[];
  elapsedMs: number;
}

// Maximum recent activities kept in the rolling window
const MAX_RECENT_ACTIVITIES = 5;

// Publish a progress event every N onLog calls regardless of tool use detection
export const PROGRESS_LOG_INTERVAL = 10;

// Heuristic patterns for detecting tool invocations in adapter stdout
const TOOL_USE_PATTERNS: RegExp[] = [
  /^[●◉▶►]\s+\w/,            // Claude Code bullet indicators: ● Tool, ◉ Running
  /^\s*Tool:\s+\w/i,           // "Tool: bash"
  /^Running tool:\s+\w/i,      // "Running tool: write_file"
  /^\[tool_use\]/,             // Generic marker
  /^> [A-Za-z_]+\(/,           // Function call pattern: "> bash("
];

// ──────────────────────────────────────────────────────────────────────────────
// RunProgressTracker
// ──────────────────────────────────────────────────────────────────────────────

export class RunProgressTracker {
  private readonly runId: string;
  private readonly agentId: string;
  private phase: RunPhase = "preparing";
  private toolUseCount = 0;
  private logLineCount = 0;
  private logChunkCount = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private recentActivities: RunProgressActivity[] = [];
  private readonly startedAt: number;

  constructor(runId: string, agentId: string) {
    this.runId = runId;
    this.agentId = agentId;
    this.startedAt = Date.now();
  }

  /**
   * Feed a log chunk. Returns true if a tool use was detected
   * (caller should publish a progress event when this happens).
   */
  onLogChunk(stream: "stdout" | "stderr", chunk: string): boolean {
    this.logChunkCount++;
    const lines = chunk.split("\n").filter((l) => l.trim().length > 0);
    this.logLineCount += lines.length;

    let toolUseDetected = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (TOOL_USE_PATTERNS.some((p) => p.test(trimmed))) {
        this.toolUseCount++;
        toolUseDetected = true;
        this.pushActivity({ kind: "tool_use", summary: trimmed.slice(0, 120) });
      } else if (stream === "stdout" && trimmed.length > 3) {
        this.pushActivity({ kind: "output", summary: trimmed.slice(0, 120) });
      }
    }
    return toolUseDetected;
  }

  /**
   * Returns true if a progress event should be published based on the
   * PROGRESS_LOG_INTERVAL threshold (call after onLogChunk).
   */
  shouldPublishOnInterval(): boolean {
    return this.logChunkCount % PROGRESS_LOG_INTERVAL === 0;
  }

  /** Advance the run phase. Always triggers a progress event. */
  setPhase(phase: RunPhase): void {
    if (phase === this.phase) return;
    this.phase = phase;
    this.pushActivity({ kind: "phase_change", summary: phase });
  }

  /** Populate final token counts from the adapter result (only known after completion). */
  setTokenCounts(inputTokens: number, outputTokens: number): void {
    this.inputTokens = inputTokens;
    this.outputTokens = outputTokens;
  }

  snapshot(): RunProgressSnapshot {
    return {
      runId: this.runId,
      agentId: this.agentId,
      phase: this.phase,
      toolUseCount: this.toolUseCount,
      logLineCount: this.logLineCount,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      recentActivities: [...this.recentActivities],
      elapsedMs: Date.now() - this.startedAt,
    };
  }

  private pushActivity(activity: RunProgressActivity): void {
    this.recentActivities.push(activity);
    if (this.recentActivities.length > MAX_RECENT_ACTIVITIES) {
      this.recentActivities.shift();
    }
  }
}
