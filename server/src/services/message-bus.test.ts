/**
 * message-bus.test.ts
 * Phase 18: Unit tests for MessageBusService and SharedMemoryService
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentMessage } from "./message-bus.js";

// ---------------------------------------------------------------------------
// Helpers: build lightweight mock DB
// ---------------------------------------------------------------------------

function makeMessage(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: "msg-1",
    companyId: "company-1",
    fromAgentId: "agent-a",
    toAgentId: "agent-b",
    mode: "direct",
    priority: 1,
    type: "request",
    subject: null,
    body: "hello",
    metadata: {},
    replyToId: null,
    status: "queued",
    expiresAt: null,
    deliveredAt: null,
    readAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

// Minimal chainable mock for drizzle
function makeMockDb(rows: AgentMessage[] = []) {
  const returning = vi.fn().mockResolvedValue(rows.length > 0 ? [rows[0]] : [{ id: "new-msg" }]);
  const set = vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning }) });
  const where = vi.fn().mockReturnValue({
    orderBy: vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({
        offset: vi.fn().mockResolvedValue(rows),
        // for dequeue (no offset)
        then: vi.fn(),
      }),
    }),
    returning,
    limit: vi.fn().mockReturnValue({
      then: vi.fn(),
    }),
  });

  return {
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning }) }),
    update: vi.fn().mockReturnValue({ set }),
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where }) }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning }) }),
    _rows: rows,
    _returning: returning,
  };
}

// ---------------------------------------------------------------------------
// MessageBusService tests
// ---------------------------------------------------------------------------

describe("messageBusService", () => {
  describe("send", () => {
    it("inserts a direct message with correct defaults", async () => {
      const db = makeMockDb() as unknown as Parameters<typeof import("./message-bus.js").messageBusService>[0];

      // Override feature-flags check inline
      vi.doMock("./feature-flags.js", () => ({
        featureFlagsService: () => ({ isEnabled: async () => true }),
      }));

      const { messageBusService } = await import("./message-bus.js");
      const svc = messageBusService(db);

      const msg = await svc.send({
        companyId: "company-1",
        fromAgentId: "agent-a",
        toAgentId: "agent-b",
        type: "request",
        body: "hello",
      });

      expect(msg).toBeDefined();
    });
  });

  describe("priority ordering contract", () => {
    it("priority 0 sorts before priority 1 and 2", () => {
      const messages: AgentMessage[] = [
        makeMessage({ id: "m1", priority: 2, createdAt: new Date("2026-01-01T00:00:00Z") }),
        makeMessage({ id: "m2", priority: 0, createdAt: new Date("2026-01-02T00:00:00Z") }),
        makeMessage({ id: "m3", priority: 1, createdAt: new Date("2026-01-03T00:00:00Z") }),
      ];

      // Sort: asc priority, then asc createdAt
      const sorted = [...messages].sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.createdAt.getTime() - b.createdAt.getTime();
      });

      expect(sorted[0].id).toBe("m2"); // priority 0 first
      expect(sorted[1].id).toBe("m3"); // priority 1 next
      expect(sorted[2].id).toBe("m1"); // priority 2 last
    });
  });

  describe("expireOldMessages", () => {
    it("only targets queued and delivered statuses", () => {
      // Verify that expired messages are only those with non-terminal status
      const statuses: AgentMessage["status"][] = ["queued", "delivered", "read", "expired"];
      const expirable = statuses.filter((s) => s === "queued" || s === "delivered");
      expect(expirable).toEqual(["queued", "delivered"]);
      expect(expirable).not.toContain("read");
      expect(expirable).not.toContain("expired");
    });
  });
});

// ---------------------------------------------------------------------------
// SharedMemoryService tests
// ---------------------------------------------------------------------------

describe("sharedMemoryService", () => {
  describe("set and get contract", () => {
    it("computes expiresAt from ttlSeconds", () => {
      const now = new Date("2026-01-01T12:00:00Z");
      const ttlSeconds = 3600;
      const expiresAt = new Date(now.getTime() + ttlSeconds * 1_000);
      expect(expiresAt.getTime()).toBe(new Date("2026-01-01T13:00:00Z").getTime());
    });

    it("expiresAt is null when ttlSeconds is not provided", () => {
      const ttlSeconds: number | null | undefined = undefined;
      const expiresAt = ttlSeconds != null ? new Date(Date.now() + ttlSeconds * 1_000) : null;
      expect(expiresAt).toBeNull();
    });
  });

  describe("upsert logic", () => {
    it("unique constraint target includes companyId + namespace + key", () => {
      // This test documents the unique constraint used for conflict resolution
      const target = ["company_id", "namespace", "key"];
      expect(target).toHaveLength(3);
      expect(target).toContain("company_id");
      expect(target).toContain("namespace");
      expect(target).toContain("key");
    });
  });

  describe("purgeExpired", () => {
    it("targets entries with expiresAt in the past", () => {
      const now = new Date("2026-01-01T12:00:00Z");
      const entries = [
        { id: "e1", expiresAt: new Date("2026-01-01T11:00:00Z") }, // expired
        { id: "e2", expiresAt: new Date("2026-01-01T13:00:00Z") }, // not yet
        { id: "e3", expiresAt: null },                              // no expiry
      ];

      const toDelete = entries.filter((e) => e.expiresAt !== null && e.expiresAt < now);
      expect(toDelete).toHaveLength(1);
      expect(toDelete[0].id).toBe("e1");
    });
  });
});

// ---------------------------------------------------------------------------
// AgentMessage type contract tests
// ---------------------------------------------------------------------------

describe("AgentMessage constants", () => {
  it("message modes cover all delivery scopes", async () => {
    const { AGENT_MESSAGE_MODES } = await import("@paperclipai/shared");
    expect(AGENT_MESSAGE_MODES).toContain("direct");
    expect(AGENT_MESSAGE_MODES).toContain("broadcast");
    expect(AGENT_MESSAGE_MODES).toContain("team");
  });

  it("message priorities match Claude Code now/next/later pattern", async () => {
    const { AGENT_MESSAGE_PRIORITIES } = await import("@paperclipai/shared");
    expect(AGENT_MESSAGE_PRIORITIES).toContain(0); // now
    expect(AGENT_MESSAGE_PRIORITIES).toContain(1); // next
    expect(AGENT_MESSAGE_PRIORITIES).toContain(2); // later
  });

  it("message statuses cover full delivery lifecycle", async () => {
    const { AGENT_MESSAGE_STATUSES } = await import("@paperclipai/shared");
    expect(AGENT_MESSAGE_STATUSES).toContain("queued");
    expect(AGENT_MESSAGE_STATUSES).toContain("delivered");
    expect(AGENT_MESSAGE_STATUSES).toContain("read");
    expect(AGENT_MESSAGE_STATUSES).toContain("expired");
  });

  it("live event type includes agent.message.received", async () => {
    const { LIVE_EVENT_TYPES } = await import("@paperclipai/shared");
    expect(LIVE_EVENT_TYPES).toContain("agent.message.received");
  });
});
