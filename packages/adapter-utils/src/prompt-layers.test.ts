import { describe, it, expect } from "vitest";
import {
  joinLayeredPromptSections,
  deterministicStringify,
} from "./prompt-layers.js";

describe("joinLayeredPromptSections", () => {
  it("3계층이 순서대로 조합됨", () => {
    const result = joinLayeredPromptSections({
      static: ["STATIC"],
      semiStatic: ["SEMI"],
      dynamic: ["DYNAMIC"],
    });
    const parts = result.split("\n\n");
    expect(parts[0]).toBe("STATIC");
    expect(parts[1]).toBe("SEMI");
    expect(parts[2]).toBe("DYNAMIC");
  });

  it("null/undefined/빈 문자열 섹션은 무시됨", () => {
    const result = joinLayeredPromptSections({
      static: [null, undefined, ""],
      semiStatic: ["CONTENT"],
      dynamic: [],
    });
    expect(result).toBe("CONTENT");
  });

  it("빈 계층은 건너뜀", () => {
    const result = joinLayeredPromptSections({
      static: ["A"],
      semiStatic: [],
      dynamic: ["B"],
    });
    expect(result).toBe("A\n\nB");
  });
});

describe("deterministicStringify", () => {
  it("키 순서가 달라도 동일한 문자열 반환", () => {
    const a = deterministicStringify({ z: 1, a: 2 });
    const b = deterministicStringify({ a: 2, z: 1 });
    expect(a).toBe(b);
  });

  it("알파벳 순 키 정렬 확인", () => {
    const result = deterministicStringify({ c: 3, a: 1, b: 2 });
    expect(result).toBe('{"a":1,"b":2,"c":3}');
  });
});
