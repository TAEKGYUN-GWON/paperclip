# Phase 3: 프롬프트 캐시 정렬 (Claude 어댑터 전용)

> **이 파일은 Claude Code 서브에이전트가 단독으로 읽고 실행하는 자기완결적 작업 지침입니다.**
> **선행 조건: Phase 2 완료 (`joinPromptSectionsWithDelta` 존재, typecheck 통과)**
> 완료 조건: 모든 파일 생성/수정 + `pnpm typecheck` + `pnpm test` 통과

## 목적

Claude API의 `cache_read_input_tokens` 기능 활용을 극대화하기 위해
프롬프트를 3계층으로 분리합니다.

- **정적 프리픽스**: 에이전트 정체성, 회사 컨텍스트, 인스트럭션, 스킬 (모든 런에서 동일)
- **준정적 중간**: 이슈 설명, 워크스페이스 설정 (태스크 변경 시만 바뀜)
- **동적 접미사**: runId, wake 이유, 델타 컨텍스트 (매 런 고유)

정적 프리픽스 바이트가 완전히 동일하면 Claude API 캐시 히트 → 비용 최대 90% 절감

---

## 컨텍스트 읽기 (시작 전 필수)

```
read_file packages/adapters/claude-local/src/server/execute.ts   # renderTemplate, joinPromptSections 사용 위치
read_file packages/adapter-utils/src/server-utils.ts             # joinPromptSections 현재 구현
read_file packages/adapter-utils/src/index.ts
```

---

## 작업 1: 신규 파일 생성

### `packages/adapter-utils/src/prompt-layers.ts`

```typescript
/**
 * prompt-layers.ts
 * 프롬프트 3계층 분리 — Claude API 캐시 정렬 최적화
 *
 * 정적 프리픽스가 바이트 단위로 동일하면 Claude API가
 * cache_read_input_tokens를 반환하여 비용을 최대 90% 절감합니다.
 */

/** 프롬프트 3계층 정의 */
export interface LayeredPromptSections {
  /**
   * 정적 프리픽스 — 모든 런에서 변하지 않는 내용
   * (에이전트 정체성, 회사 컨텍스트, 인스트럭션 파일, 스킬)
   * 결정론적 키 정렬 필수
   */
  static: Array<string | null | undefined>;

  /**
   * 준정적 중간 — 태스크/이슈가 바뀔 때만 변경
   * (이슈 설명, 워크스페이스 설정, 목표)
   */
  semiStatic: Array<string | null | undefined>;

  /**
   * 동적 접미사 — 매 런마다 고유
   * (runId, wake 이유, 델타 컨텍스트, 현재 시각)
   */
  dynamic: Array<string | null | undefined>;
}

/**
 * 3계층 프롬프트를 하나의 문자열로 조합합니다.
 *
 * 정적 → 준정적 → 동적 순으로 배치하여
 * Claude API 프롬프트 캐시 히트율을 최대화합니다.
 *
 * @param layers    - 3계층 섹션 배열
 * @param separator - 섹션 내부 구분자 (기본 "\n\n")
 * @returns 조합된 최종 프롬프트 문자열
 */
export function joinLayeredPromptSections(
  layers: LayeredPromptSections,
  separator = "\n\n",
): string {
  const joinLayer = (sections: Array<string | null | undefined>) =>
    sections
      .map((s) => (typeof s === "string" ? s.trim() : ""))
      .filter(Boolean)
      .join(separator);

  const parts = [
    joinLayer(layers.static),
    joinLayer(layers.semiStatic),
    joinLayer(layers.dynamic),
  ].filter(Boolean);

  return parts.join(separator);
}

/**
 * JSON 객체를 결정론적(키 정렬) 문자열로 직렬화합니다.
 * 정적 프리픽스의 바이트 동일성을 보장하는 데 사용합니다.
 */
export function deterministicStringify(obj: Record<string, unknown>): string {
  return JSON.stringify(obj, Object.keys(obj).sort());
}
```

---

## 작업 2: `packages/adapter-utils/src/index.ts` — export 추가

```typescript
export {
  joinLayeredPromptSections,
  deterministicStringify,
} from "./prompt-layers.js";
export type { LayeredPromptSections } from "./prompt-layers.js";
```

---

## 작업 3: `packages/adapters/claude-local/src/server/execute.ts` — 프롬프트 3계층 분리

`execute.ts`에서 프롬프트를 빌드하는 부분을 찾아 아래와 같이 리팩터링합니다.

**찾아야 할 패턴**: `joinPromptSections(` 또는 `renderTemplate(` 이 모여 있는 블록

**변경 전 (예시):**
```typescript
const prompt = joinPromptSections([
  agentIdentity,
  companyContext,
  instructions,
  skillContent,
  issueDescription,
  workspaceSetup,
  runId,
  wakeReason,
  deltaContext,
]);
```

**변경 후:**
```typescript
import {
  joinLayeredPromptSections,
  deterministicStringify,
} from "@paperclipai/adapter-utils";

// 정적 프리픽스: 에이전트 ID + 인스트럭션 + 스킬 (키 정렬로 바이트 동일성 보장)
const staticSections = [
  agentIdentity,
  companyContext,
  instructions,
  skillContent,
];

// 준정적 중간: 이슈/워크스페이스 (태스크 변경 시만 변경)
const semiStaticSections = [
  issueDescription,
  workspaceSetup,
];

// 동적 접미사: 매 런 고유값
const dynamicSections = [
  `Run ID: ${runId}`,
  wakeReason ? `Wake reason: ${wakeReason}` : null,
  deltaContext ? deterministicStringify(deltaContext as Record<string, unknown>) : null,
];

const prompt = joinLayeredPromptSections({
  static: staticSections,
  semiStatic: semiStaticSections,
  dynamic: dynamicSections,
});
```

> **참고**: 실제 변수명은 execute.ts를 먼저 읽어 확인하세요.
> `agentIdentity`, `issueDescription` 등은 예시 이름입니다.
> 실제 프롬프트 빌딩 로직에서 각각 어떤 변수가 어느 계층인지 판단하여 배치하세요.

---

## 작업 4: 테스트 파일 생성

### `packages/adapter-utils/src/prompt-layers.test.ts`

```typescript
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
```

---

## 완료 확인

```sh
pnpm typecheck
pnpm test --filter @paperclipai/adapter-utils
pnpm test --filter @paperclipai/claude-local
```

### 추가 검증 (선택)

캐시 히트율 확인을 위해 Claude 런 실행 후 로그에서 확인:
```
cachedInputTokens / inputTokens > 0.6  →  목표 60% 이상
```
