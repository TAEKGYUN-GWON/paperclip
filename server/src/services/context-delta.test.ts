import { describe, it, expect } from "vitest";
import { computeContextDelta } from "./context-delta.js";

describe("computeContextDelta", () => {
  it("previousSnapshot=null 이면 전체를 delta로 반환", () => {
    const current = { a: 1, b: "hello" };
    const { delta, unchangedKeys } = computeContextDelta(null, current);
    expect(delta).toEqual(current);
    expect(unchangedKeys).toEqual([]);
  });

  it("변경 없는 키는 unchangedKeys에 포함", () => {
    const prev = { a: 1, b: "hello" };
    const curr = { a: 1, b: "hello" };
    const { delta, unchangedKeys } = computeContextDelta(prev, curr);
    expect(Object.keys(delta)).toHaveLength(0);
    expect(unchangedKeys).toContain("a");
    expect(unchangedKeys).toContain("b");
  });

  it("변경된 키는 delta에 포함", () => {
    const prev = { a: 1, b: "old" };
    const curr = { a: 1, b: "new" };
    const { delta, unchangedKeys } = computeContextDelta(prev, curr);
    expect(delta.b).toBe("new");
    expect(unchangedKeys).toContain("a");
  });

  it("이전에 있고 현재 없는 키 → delta에 null로 표시", () => {
    const prev = { a: 1, b: "removed" };
    const curr = { a: 1 };
    const { delta } = computeContextDelta(prev, curr);
    expect(delta.b).toBeNull();
  });

  it("중첩 객체 비교 정상 동작", () => {
    const prev = { config: { x: 1, y: 2 } };
    const curr = { config: { x: 1, y: 3 } };
    const { delta } = computeContextDelta(prev, curr);
    expect(delta.config).toEqual({ x: 1, y: 3 });
  });
});
