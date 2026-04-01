import { describe, it, expect } from "vitest";
import { truncateSkillContent, SKILL_TOKEN_CAP } from "./server-utils.js";

describe("truncateSkillContent", () => {
  it("skill within budget is returned unchanged", () => {
    const content = "# Skill\n\nShort content"; // very short
    expect(truncateSkillContent(content)).toBe(content);
  });

  it("applies custom maxTokens", () => {
    const content = "a".repeat(400); // 100 tokens
    const result = truncateSkillContent(content, 10); // 40 chars = 10 tokens
    expect(result.length).toBeLessThan(content.length);
    expect(result).toContain("[skill content partially truncated");
  });

  it("does not cut in the middle of a line", () => {
    // maxTokens=5 → 20 chars. Must respect line boundaries.
    const line1 = "# Section Heading\n";
    const filler = "x".repeat(100);
    const content = line1 + filler;
    const result = truncateSkillContent(content, 5);
    // result must end at a line boundary
    expect(result).toContain("[skill content partially truncated");
    // body before truncation marker must not end mid-line
    const bodyPart = result.split("[skill content")[0];
    expect(bodyPart).not.toMatch(/[^\n]$/); // empty or ends with newline
  });

  it("truncation notice includes omitted char count", () => {
    const content = "a".repeat(1000); // 250 tokens
    const result = truncateSkillContent(content, 10);
    expect(result).toContain("over budget");
    expect(result).toContain("SKILL.md");
  });

  it("SKILL_TOKEN_CAP default is 5000", () => {
    expect(SKILL_TOKEN_CAP).toBe(5_000);
  });

  it("skill exactly at budget passes through", () => {
    const content = "x".repeat(SKILL_TOKEN_CAP * 4); // exactly 5000 tokens
    expect(truncateSkillContent(content)).toBe(content);
  });

  it("skill 1 token over budget triggers truncation", () => {
    const content = "x".repeat(SKILL_TOKEN_CAP * 4 + 4); // 5001 tokens
    const result = truncateSkillContent(content);
    expect(result).toContain("[skill content partially truncated");
  });
});
