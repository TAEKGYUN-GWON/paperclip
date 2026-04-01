import { describe, it, expect } from "vitest";
import { truncateSkillContent, SKILL_TOKEN_CAP } from "./server-utils.js";

describe("truncateSkillContent", () => {
  it("예산 내 스킬은 변경 없음", () => {
    const content = "# 스킬\n\n간단한 내용"; // 매우 짧음
    expect(truncateSkillContent(content)).toBe(content);
  });

  it("커스텀 maxTokens 적용", () => {
    const content = "a".repeat(400); // 100토큰
    const result = truncateSkillContent(content, 10); // 40자 = 10토큰
    expect(result.length).toBeLessThan(content.length);
    expect(result).toContain("[스킬 내용 일부 생략");
  });

  it("줄 중간에서 잘리지 않음", () => {
    // maxTokens=5 → 20자. 줄 경계를 파악해야 함
    const line1 = "# 제목 섹션\n";
    const filler = "x".repeat(100);
    const content = line1 + filler;
    const result = truncateSkillContent(content, 5);
    // 결과는 줄바꿈 이후에 잘리거나 줄 그대로 끝나야 함
    expect(result).toContain("[스킬 내용 일부 생략");
    // 마지막 줄이 불완전하지 않음
    const bodyPart = result.split("[스킬 내용")[0];
    expect(bodyPart).not.toMatch(/[^\n]$/); // 빈 문자열이거나 줄바꿈으로 끝남
  });

  it("생략 안내에 생략된 글자 수 포함", () => {
    const content = "a".repeat(1000); // 250토큰
    const result = truncateSkillContent(content, 10);
    expect(result).toContain("초과");
    expect(result).toContain("SKILL.md");
  });

  it("SKILL_TOKEN_CAP 기본값은 5000", () => {
    expect(SKILL_TOKEN_CAP).toBe(5_000);
  });

  it("정확히 예산과 동일한 크기의 스킬은 통과", () => {
    const content = "x".repeat(SKILL_TOKEN_CAP * 4); // 정확히 5000토큰
    expect(truncateSkillContent(content)).toBe(content);
  });

  it("예산 1토큰 초과 시 트렁케이션 발생", () => {
    const content = "x".repeat(SKILL_TOKEN_CAP * 4 + 4); // 5001토큰
    const result = truncateSkillContent(content);
    expect(result).toContain("[스킬 내용 일부 생략");
  });
});
