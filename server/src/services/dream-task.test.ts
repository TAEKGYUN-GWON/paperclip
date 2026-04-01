/**
 * dream-task.test.ts
 * Phase 15: Unit tests for DreamTaskService (KAIROS)
 *
 * Tests cover:
 *   - shouldConsolidate: flag disabled, never-run, interval not elapsed, no new issues
 *   - consolidate: builds digest with completed issues + active issues + failed runs
 *   - getDigest: flag disabled, missing key, expired TTL, valid digest
 */

import { describe, it, expect, vi } from "vitest";
import { dreamTaskService } from "./dream-task.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockRow = Record<string, unknown>;

/**
 * Row-queue based Drizzle mock.
 * Each `from()` call pops the next pre-loaded row set.
 * Use `pushRows(...sets)` to load results in the expected query order.
 */
function makeDb() {
  const rowQueue: MockRow[][] = [];
  const upserts: Array<Record<string, unknown>> = [];

  // `makeSelectChain` builds a fully-chained mock for a given row set
  const makeSelectChain = (rows: MockRow[]) => {
    const limitFn = vi.fn().mockResolvedValue(rows);
    const orderByFn = vi.fn().mockReturnValue({ limit: limitFn });
    const thenFn = vi.fn((cb: (r: MockRow[]) => unknown) => Promise.resolve(cb(rows)));

    return {
      where: vi.fn().mockReturnValue({
        orderBy: orderByFn,
        then: thenFn,
        // for Promise.resolve-like access
        [Symbol.toStringTag]: "Promise",
      }),
      then: thenFn,
    };
  };

  const db = {
    pushRows: (...sets: MockRow[][]) => rowQueue.push(...sets),
    _upserts: upserts,

    select: vi.fn(() => ({
      from: vi.fn(() => makeSelectChain(rowQueue.shift() ?? [])),
    })),

    insert: vi.fn((_table: unknown) => ({
      values: vi.fn((row: Record<string, unknown>) => {
        upserts.push(row);
        const returningFn = vi.fn().mockResolvedValue([row]);
        return {
          onConflictDoUpdate: vi.fn().mockReturnValue({ returning: returningFn }),
          returning: returningFn,
        };
      }),
    })),
  };

  return db as unknown as ReturnType<typeof import("@paperclipai/db").createDb> & {
    pushRows: (...sets: MockRow[][]) => void;
    _upserts: typeof upserts;
  };
}

// Shorthand row factories

const flagRow = (enabled: boolean) => ({
  experimental: { featureFlags: { dream_task: enabled } },
});

const consolidatedAtRow = (isoStr: string) => ({ value: isoStr });

const issueRow = (id: string, title: string, status: string, identifier?: string) => ({
  id,
  title,
  status,
  identifier: identifier ?? null,
  updatedAt: new Date(Date.now() - 3 * 86400_000), // 3 days ago
});

const runRow = (id: string, status: "completed" | "failed", error?: string) => ({
  id,
  status,
  finishedAt: new Date(),
  error: error ?? null,
  stdoutExcerpt: null,
});

// ---------------------------------------------------------------------------
// shouldConsolidate
// ---------------------------------------------------------------------------

describe("dreamTaskService — shouldConsolidate", () => {
  it("returns false when dream_task flag is disabled", async () => {
    const db = makeDb();
    // Query order: 1) instance_settings (flag check — returns empty → disabled)
    db.pushRows([]);
    const svc = dreamTaskService(db);
    expect(await svc.shouldConsolidate("co-1", "agent-1")).toBe(false);
  });

  it("returns true when never consolidated and completed issues exist", async () => {
    const db = makeDb();
    // Query order: 1) instance_settings, 2) agent_shared_memory (no timestamp), 3) issues (completed)
    db.pushRows(
      [flagRow(true)],
      [], // no last_consolidated_at
      [issueRow("i-1", "Done task", "done")],
    );
    const svc = dreamTaskService(db);
    expect(await svc.shouldConsolidate("co-1", "agent-1")).toBe(true);
  });

  it("returns false when no completed issues since last consolidation", async () => {
    const db = makeDb();
    const longAgo = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString(); // 10h ago
    db.pushRows(
      [flagRow(true)],
      [consolidatedAtRow(longAgo)],
      [], // no completed issues
    );
    const svc = dreamTaskService(db);
    expect(await svc.shouldConsolidate("co-1", "agent-1")).toBe(false);
  });

  it("returns false when last consolidation was within 4 hours", async () => {
    const db = makeDb();
    const recent = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2h ago
    db.pushRows(
      [flagRow(true)],
      [consolidatedAtRow(recent)],
      // issue row doesn't matter — interval check short-circuits
    );
    const svc = dreamTaskService(db);
    expect(await svc.shouldConsolidate("co-1", "agent-1")).toBe(false);
  });

  it("returns true when last consolidation was over 4 hours ago and new issues exist", async () => {
    const db = makeDb();
    const old = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(); // 6h ago
    db.pushRows(
      [flagRow(true)],
      [consolidatedAtRow(old)],
      [issueRow("i-1", "Fixed bug", "done")],
    );
    const svc = dreamTaskService(db);
    expect(await svc.shouldConsolidate("co-1", "agent-1")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// consolidate
// ---------------------------------------------------------------------------

describe("dreamTaskService — consolidate", () => {
  it("builds a digest containing completed and active issues", async () => {
    const db = makeDb();
    // consolidate queries: 1) completed issues, 2) active issues, 3) heartbeat_runs
    db.pushRows(
      [
        issueRow("i-1", "Build auth", "done", "PROJ-1"),
        issueRow("i-2", "Fix bug", "cancelled", "PROJ-2"),
      ],
      [issueRow("i-3", "Add OAuth", "in_progress", "PROJ-3")],
      [runRow("run-abc123", "failed", "timeout error")],
    );
    const svc = dreamTaskService(db);
    const result = await svc.consolidate("co-1", "agent-1");

    expect(result.agentId).toBe("agent-1");
    expect(result.issueCount).toBe(2);
    expect(result.runCount).toBe(1);
    expect(result.digestMarkdown).toContain("KAIROS Memory Digest");
    expect(result.digestMarkdown).toContain("PROJ-1");
    expect(result.digestMarkdown).toContain("Build auth");
    expect(result.digestMarkdown).toContain("PROJ-3");
    expect(result.digestMarkdown).toContain("in_progress");
    expect(result.digestMarkdown).toContain("Recent Failures");
    expect(result.digestMarkdown).toContain("timeout error");
  });

  it("omits Active and Failures sections when there are none", async () => {
    const db = makeDb();
    db.pushRows(
      [issueRow("i-1", "Build auth", "done", "PROJ-1")],
      [], // no active issues
      [], // no failed runs
    );
    const svc = dreamTaskService(db);
    const result = await svc.consolidate("co-1", "agent-1");

    expect(result.digestMarkdown).not.toContain("Active / Pending");
    expect(result.digestMarkdown).not.toContain("Recent Failures");
    expect(result.issueCount).toBe(1);
  });

  it("stores digest and timestamp via upsert", async () => {
    const db = makeDb();
    db.pushRows(
      [issueRow("i-1", "Done", "done", "X-1")],
      [],
      [],
    );
    const svc = dreamTaskService(db);
    await svc.consolidate("co-1", "agent-1");

    // Should have two upserts: digest + consolidated_at
    expect(db._upserts).toHaveLength(2);
    const keys = db._upserts.map((u) => u["key"]);
    expect(keys).toContain("digest:agent-1");
    expect(keys).toContain("consolidated_at:agent-1");
  });
});

// ---------------------------------------------------------------------------
// getDigest
// ---------------------------------------------------------------------------

describe("dreamTaskService — getDigest", () => {
  it("returns null when flag is disabled", async () => {
    const db = makeDb();
    db.pushRows([]); // empty = flag disabled
    const svc = dreamTaskService(db);
    expect(await svc.getDigest("co-1", "agent-1")).toBeNull();
  });

  it("returns null when no digest row exists", async () => {
    const db = makeDb();
    db.pushRows([flagRow(true)], []); // flag on, no digest row
    const svc = dreamTaskService(db);
    expect(await svc.getDigest("co-1", "agent-1")).toBeNull();
  });

  it("returns null when digest is expired", async () => {
    const db = makeDb();
    const pastExpiry = new Date(Date.now() - 1000); // expired 1s ago
    db.pushRows(
      [flagRow(true)],
      [{ value: "# old", expiresAt: pastExpiry }],
    );
    const svc = dreamTaskService(db);
    expect(await svc.getDigest("co-1", "agent-1")).toBeNull();
  });

  it("returns digest string when valid and not expired", async () => {
    const db = makeDb();
    const futureExpiry = new Date(Date.now() + 86400_000);
    db.pushRows(
      [flagRow(true)],
      [{ value: "## KAIROS Memory Digest\n...", expiresAt: futureExpiry }],
    );
    const svc = dreamTaskService(db);
    expect(await svc.getDigest("co-1", "agent-1")).toBe("## KAIROS Memory Digest\n...");
  });
});

// ---------------------------------------------------------------------------
// evaluateFlag — dream_task
// ---------------------------------------------------------------------------

describe("evaluateFlag — dream_task", () => {
  it("defaults dream_task to false", async () => {
    const { evaluateFlag } = await import("./feature-flags.js");
    expect(evaluateFlag("dream_task", null)).toBe(false);
    expect(evaluateFlag("dream_task", {})).toBe(false);
  });

  it("respects stored override to true", async () => {
    const { evaluateFlag } = await import("./feature-flags.js");
    expect(evaluateFlag("dream_task", { dream_task: true })).toBe(true);
  });
});
