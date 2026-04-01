/**
 * context-compressor.test.ts
 * Phase 9: 3계층 컨텍스트 압축 단위 테스트
 */

import { describe, it, expect } from "vitest";
import { buildSnipContext, buildCompactDigest, type RunRecord } from "./context-compressor.js";
import type { CompactionDecision } from "@paperclipai/adapter-utils";

const microDecision: CompactionDecision = {
  tier: "micro",
  utilizationPercent: 75,
  reason: "context 75% used — snip duplicate comments, session continues",
};

const autoDecision: CompactionDecision = {
  tier: "auto",
  utilizationPercent: 88,
  reason: "context 88% used — generate handoff digest, session rotation deferred",
};

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "run-1",
    createdAt: new Date("2026-04-01T10:00:00Z"),
    resultJson: { summary: "test task completed" },
    error: null,
    ...overrides,
  };
}

describe("buildSnipContext", () => {
  it("returns summary of the most recent 3 runs", () => {
    const runs: RunRecord[] = [
      makeRun({ id: "r1", resultJson: { summary: "first run done" } }),
      makeRun({ id: "r2", resultJson: { summary: "second run done" } }),
      makeRun({ id: "r3", resultJson: { summary: "third run done" } }),
      makeRun({ id: "r4", resultJson: { summary: "fourth run done — excluded" } }),
    ];
    const result = buildSnipContext(runs, microDecision);
    expect(result).toContain("Session Context Snapshot");
    expect(result).toContain("75%");
    expect(result).toContain("first run done");
    expect(result).toContain("second run done");
    expect(result).toContain("third run done");
    expect(result).not.toContain("fourth run done");
  });

  it("handles runs with error and no resultJson", () => {
    const runs = [makeRun({ resultJson: null, error: "timeout error" })];
    const result = buildSnipContext(runs, microDecision);
    expect(result).toContain("error");
    expect(result).toContain("timeout");
  });

  it("returns empty string when only runs with no summary exist", () => {
    const runs = [makeRun({ resultJson: null, error: null })];
    const result = buildSnipContext(runs, microDecision);
    expect(result).toBe("");
  });

  it("returns empty string for empty run list", () => {
    const result = buildSnipContext([], microDecision);
    expect(result).toBe("");
  });
});

describe("buildCompactDigest", () => {
  it("returns structured digest with session ID and issue ID", () => {
    const runs: RunRecord[] = [
      makeRun({ id: "r1", resultJson: { summary: "component refactor" } }),
      makeRun({ id: "r2", resultJson: { result: "tests passing" } }),
    ];
    const result = buildCompactDigest(runs, "session-abc", "issue-123", autoDecision);
    expect(result).toContain("Session Compact Digest");
    expect(result).toContain("session-abc");
    expect(result).toContain("issue-123");
    expect(result).toContain("88%");
    expect(result).toContain("component refactor");
    expect(result).toContain("tests passing");
    expect(result).toContain("session continuing");
  });

  it("works without an issue ID", () => {
    const runs = [makeRun()];
    const result = buildCompactDigest(runs, "session-xyz", null, autoDecision);
    expect(result).toContain("session-xyz");
    expect(result).not.toContain("Issue:");
  });

  it("includes at most 8 runs", () => {
    const runs = Array.from({ length: 10 }, (_, i) =>
      makeRun({ id: `r${i}`, resultJson: { summary: `run ${i} done` } }),
    );
    const result = buildCompactDigest(runs, "session-limit", null, autoDecision);
    expect(result).toContain("run 0 done");
    expect(result).toContain("run 7 done");
    // runs beyond index 7 must not appear
    expect(result).not.toContain("run 8 done");
  });

  it("shows no-summary placeholder when all runs lack summaries", () => {
    const runs = [makeRun({ resultJson: null, error: null })];
    const result = buildCompactDigest(runs, "session-empty", null, autoDecision);
    expect(result).toContain("no recent run summaries");
  });

  it("uses the result field as summary", () => {
    const runs = [makeRun({ resultJson: { result: "PR merged" } })];
    const result = buildCompactDigest(runs, "s", null, autoDecision);
    expect(result).toContain("PR merged");
  });

  it("uses the message field as summary", () => {
    const runs = [makeRun({ resultJson: { message: "code review requested" } })];
    const result = buildCompactDigest(runs, "s", null, autoDecision);
    expect(result).toContain("code review requested");
  });
});
