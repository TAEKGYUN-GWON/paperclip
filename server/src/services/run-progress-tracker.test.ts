/**
 * run-progress-tracker.test.ts
 * Phase 14: RunProgressTracker unit tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RunProgressTracker, PROGRESS_LOG_INTERVAL } from "./run-progress-tracker.js";

describe("RunProgressTracker", () => {
  let tracker: RunProgressTracker;

  beforeEach(() => {
    vi.useFakeTimers();
    tracker = new RunProgressTracker("run-1", "agent-1");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("initializes with preparing phase and zero counts", () => {
    const snap = tracker.snapshot();
    expect(snap.runId).toBe("run-1");
    expect(snap.agentId).toBe("agent-1");
    expect(snap.phase).toBe("preparing");
    expect(snap.toolUseCount).toBe(0);
    expect(snap.logLineCount).toBe(0);
    expect(snap.inputTokens).toBe(0);
    expect(snap.outputTokens).toBe(0);
    expect(snap.recentActivities).toHaveLength(0);
  });

  it("tracks elapsed time", () => {
    vi.advanceTimersByTime(3_000);
    expect(tracker.snapshot().elapsedMs).toBeGreaterThanOrEqual(3_000);
  });

  describe("onLogChunk", () => {
    it("counts non-empty lines", () => {
      tracker.onLogChunk("stdout", "line one\nline two\n\n");
      expect(tracker.snapshot().logLineCount).toBe(2);
    });

    it("accumulates across multiple chunks", () => {
      tracker.onLogChunk("stdout", "a\nb\nc\n");
      tracker.onLogChunk("stderr", "error line\n");
      expect(tracker.snapshot().logLineCount).toBe(4);
    });

    it("detects tool use from ● prefix", () => {
      const detected = tracker.onLogChunk("stdout", "● Bash: ls -la\n");
      expect(detected).toBe(true);
      expect(tracker.snapshot().toolUseCount).toBe(1);
    });

    it("detects tool use from Tool: prefix", () => {
      const detected = tracker.onLogChunk("stdout", "Tool: write_file\n");
      expect(detected).toBe(true);
      expect(tracker.snapshot().toolUseCount).toBe(1);
    });

    it("returns false for regular output lines", () => {
      const detected = tracker.onLogChunk("stdout", "Normal log output\n");
      expect(detected).toBe(false);
      expect(tracker.snapshot().toolUseCount).toBe(0);
    });

    it("counts multiple tool uses in one chunk", () => {
      tracker.onLogChunk("stdout", "● Bash: ls\n● Write: file.ts\n");
      expect(tracker.snapshot().toolUseCount).toBe(2);
    });

    it("records tool use in recentActivities", () => {
      tracker.onLogChunk("stdout", "● Bash: cat README.md\n");
      const { recentActivities } = tracker.snapshot();
      expect(recentActivities.some((a) => a.kind === "tool_use")).toBe(true);
    });

    it("records output lines in recentActivities", () => {
      tracker.onLogChunk("stdout", "Processing files...\n");
      const { recentActivities } = tracker.snapshot();
      expect(recentActivities.some((a) => a.kind === "output")).toBe(true);
    });

    it("caps recentActivities at 5 entries", () => {
      for (let i = 0; i < 10; i++) {
        tracker.onLogChunk("stdout", `line ${i}\n`);
      }
      expect(tracker.snapshot().recentActivities).toHaveLength(5);
    });

    it("truncates long activity summaries to 120 chars", () => {
      tracker.onLogChunk("stdout", "x".repeat(200) + "\n");
      const { recentActivities } = tracker.snapshot();
      for (const a of recentActivities) {
        expect(a.summary.length).toBeLessThanOrEqual(120);
      }
    });
  });

  describe("setPhase", () => {
    it("updates phase", () => {
      tracker.setPhase("executing");
      expect(tracker.snapshot().phase).toBe("executing");
    });

    it("records phase change in recentActivities", () => {
      tracker.setPhase("finalizing");
      const { recentActivities } = tracker.snapshot();
      expect(recentActivities.some((a) => a.kind === "phase_change" && a.summary === "finalizing")).toBe(true);
    });

    it("does not record activity when phase is unchanged", () => {
      tracker.setPhase("preparing"); // same as initial
      expect(tracker.snapshot().recentActivities).toHaveLength(0);
    });
  });

  describe("setTokenCounts", () => {
    it("stores token counts in snapshot", () => {
      tracker.setTokenCounts(1500, 800);
      expect(tracker.snapshot().inputTokens).toBe(1500);
      expect(tracker.snapshot().outputTokens).toBe(800);
    });
  });

  describe("shouldPublishOnInterval", () => {
    it("returns true every PROGRESS_LOG_INTERVAL chunks", () => {
      let publishCount = 0;
      for (let i = 0; i < PROGRESS_LOG_INTERVAL * 3; i++) {
        tracker.onLogChunk("stdout", "line\n");
        if (tracker.shouldPublishOnInterval()) publishCount++;
      }
      expect(publishCount).toBe(3);
    });

    it("does not return true before the first interval", () => {
      for (let i = 0; i < PROGRESS_LOG_INTERVAL - 1; i++) {
        tracker.onLogChunk("stdout", "line\n");
      }
      expect(tracker.shouldPublishOnInterval()).toBe(false);
    });
  });
});
