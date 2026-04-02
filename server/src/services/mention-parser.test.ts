/**
 * mention-parser.test.ts
 * @에이전트 + #이슈 멘션 파서 유닛 테스트
 */

import { describe, it, expect, vi } from "vitest";
import { parseMentions } from "./mention-parser.js";

// ──────────────────────────────────────────────────────────────────────────────
// Helper: build a mock DB chain that is correctly awaitable
// ──────────────────────────────────────────────────────────────────────────────

function makeChain(rows: object[]) {
  const chain: {
    from: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
    orderBy: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    then: (resolve: (v: object[]) => void) => void;
  } = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
    // Makes `await db.select().from().where()` resolve to rows (no .limit needed)
    then: (resolve) => resolve(rows),
  };
  // Ensure mockReturnThis() returns chain, not the mock fn object
  (chain.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  (chain.where as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  (chain.orderBy as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  return chain;
}

// ──────────────────────────────────────────────────────────────────────────────
// Pure pattern tests (no DB needed)
// ──────────────────────────────────────────────────────────────────────────────

describe("parseMentions — DB integration (mocked)", () => {
  it("extracts @agent and #issue patterns correctly", async () => {
    const chain = makeChain([]);
    const mockDb = { select: vi.fn().mockReturnValue(chain) };

    const result = await parseMentions(mockDb as never, "company-1", "@김개발 #42 안녕");

    // DB가 빈 배열을 반환하므로 매핑 없음
    expect(result.agentMentions).toHaveLength(0);
    expect(result.issueMentions).toHaveLength(0);
  });

  it("returns matched agent when DB has a matching agent", async () => {
    const agentChain = makeChain([{ id: "agent-1", name: "김개발", status: "active" }]);
    const emptyChain = makeChain([]);

    const mockDb = {
      select: vi.fn()
        .mockReturnValueOnce(agentChain)  // agent lookup
        .mockReturnValue(emptyChain),      // issue lookup
    };

    const result = await parseMentions(mockDb as never, "company-1", "@김개발 안녕하세요");

    expect(result.agentMentions).toHaveLength(1);
    expect(result.agentMentions[0]?.agentId).toBe("agent-1");
  });

  it("handles body with no mentions", async () => {
    const mockDb = { select: vi.fn() };

    const result = await parseMentions(mockDb as never, "company-1", "아무 멘션 없음");

    expect(result.agentMentions).toHaveLength(0);
    expect(result.issueMentions).toHaveLength(0);
    // DB select가 호출되지 않아야 함
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("handles PREFIX-number issue mentions", async () => {
    // Body has no @mention, so only issues are queried
    const issueChain = makeChain([{ id: "issue-abc" }]);

    const mockDb = {
      select: vi.fn().mockReturnValue(issueChain),
    };

    const result = await parseMentions(mockDb as never, "company-1", "#ABC-42 이슈 참조");

    expect(result.issueMentions).toHaveLength(1);
    expect(result.issueMentions[0]?.issueId).toBe("issue-abc");
    expect(result.issueMentions[0]?.ref).toBe("ABC-42");
  });
});
