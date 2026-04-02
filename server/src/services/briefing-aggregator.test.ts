/**
 * briefing-aggregator.test.ts
 * 선제적 브리핑 집계 서비스 유닛 테스트
 *
 * live-events, feature-flags, DB를 mock으로 대체.
 * 서비스가 start/stop 없이 throw하지 않는지와
 * 비활성 플래그 시 브리핑이 삽입되지 않는지 검증한다.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { briefingAggregatorService } from "./briefing-aggregator.js";

// ──────────────────────────────────────────────────────────────────────────────
// Mock: live-events
// ──────────────────────────────────────────────────────────────────────────────

const globalListeners: Array<(event: unknown) => void> = [];

vi.mock("./live-events.js", () => ({
  subscribeGlobalLiveEvents: (listener: (event: unknown) => void) => {
    globalListeners.push(listener);
    return () => {
      const idx = globalListeners.indexOf(listener);
      if (idx >= 0) globalListeners.splice(idx, 1);
    };
  },
  publishLiveEvent: vi.fn(),
}));

// ──────────────────────────────────────────────────────────────────────────────
// Mock: feature-flags
// ──────────────────────────────────────────────────────────────────────────────

const mockIsEnabled = vi.fn().mockResolvedValue(false);

vi.mock("./feature-flags.js", () => ({
  featureFlagsService: () => ({ isEnabled: mockIsEnabled }),
}));

// ──────────────────────────────────────────────────────────────────────────────
// Mock: heartbeat-run-summary
// ──────────────────────────────────────────────────────────────────────────────

vi.mock("./heartbeat-run-summary.js", () => ({
  summarizeHeartbeatRunResultJson: (json: Record<string, unknown> | null | undefined) => {
    if (!json) return null;
    if (json["summary"]) return { summary: json["summary"] };
    return null;
  },
}));

// ──────────────────────────────────────────────────────────────────────────────
// Mock DB
// ──────────────────────────────────────────────────────────────────────────────

function makeMockDb(agentRows: object[] = [], runRows: object[] = [], issueRows: object[] = []) {
  const insertReturning = vi.fn().mockResolvedValue([{ id: "briefing-1", createdAt: new Date(), briefingType: "run_completed", title: "test", agentId: null }]);

  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  };

  return {
    select: vi.fn().mockReturnValue(selectChain),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: insertReturning }),
    }),
    _insertReturning: insertReturning,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("briefingAggregatorService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalListeners.length = 0;
    mockIsEnabled.mockResolvedValue(false);
  });

  it("start() registers a global listener", () => {
    const svc = briefingAggregatorService(makeMockDb() as never);
    expect(globalListeners).toHaveLength(0);
    svc.start();
    expect(globalListeners).toHaveLength(1);
    svc.stop();
  });

  it("stop() removes the listener", () => {
    const svc = briefingAggregatorService(makeMockDb() as never);
    svc.start();
    svc.stop();
    expect(globalListeners).toHaveLength(0);
  });

  it("start() is idempotent — calling twice does not register duplicate listeners", () => {
    const svc = briefingAggregatorService(makeMockDb() as never);
    svc.start();
    svc.start();
    expect(globalListeners).toHaveLength(1);
    svc.stop();
  });

  it("does not insert briefings when ceo_chat flag is disabled", async () => {
    const db = makeMockDb() as never;
    const svc = briefingAggregatorService(db);
    svc.start();
    mockIsEnabled.mockResolvedValue(false);

    // 글로벌 채널(companyId="*") 이벤트는 무시됨
    const event = {
      id: 1,
      companyId: "company-1",
      type: "heartbeat.run.status",
      createdAt: new Date().toISOString(),
      payload: { runId: "run-1", agentId: "agent-1", status: "succeeded" },
    };

    for (const listener of globalListeners) listener(event);

    // 비동기 처리 대기
    await new Promise((resolve) => setTimeout(resolve, 50));

    // 플래그 비활성 → insert 호출 없음
    expect((db as ReturnType<typeof makeMockDb>).insert).not.toHaveBeenCalled();
    svc.stop();
  });

  it("ignores companyId='*' global events", async () => {
    const db = makeMockDb() as never;
    const svc = briefingAggregatorService(db);
    svc.start();
    mockIsEnabled.mockResolvedValue(true);

    const event = {
      id: 1,
      companyId: "*",
      type: "heartbeat.run.status",
      createdAt: new Date().toISOString(),
      payload: { runId: "run-1", agentId: "agent-1", status: "succeeded" },
    };

    for (const listener of globalListeners) listener(event);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((db as ReturnType<typeof makeMockDb>).insert).not.toHaveBeenCalled();
    svc.stop();
  });
});
