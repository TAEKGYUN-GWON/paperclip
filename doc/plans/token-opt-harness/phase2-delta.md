# Phase 2: 컨텍스트 스냅샷 델타/디프

> **이 파일은 Claude Code 서브에이전트가 단독으로 읽고 실행하는 자기완결적 작업 지침입니다.**
> **선행 조건: Phase 1 완료 (`compaction-tiers.ts` 존재, typecheck 통과)**
> 완료 조건: 모든 파일 생성/수정 + `pnpm typecheck` + `pnpm test` 통과

## 목적

같은 태스크 세션 내 연속 런에서 컨텍스트 스냅샷의 변경된 부분만
프롬프트에 포함하고 나머지는 "이전과 동일" 한 줄 요약으로 대체합니다.

예상 효과: 반복 런에서 프롬프트 크기 20–40% 절감

---

## 컨텍스트 읽기 (시작 전 필수)

```
read_file packages/adapter-utils/src/server-utils.ts   # joinPromptSections 위치 확인
read_file packages/adapter-utils/src/index.ts
read_file server/src/services/heartbeat.ts             # executeRunWithWorkspace 위치 확인
```

---

## 작업 1: 신규 파일 생성

### `server/src/services/context-delta.ts`

```typescript
/**
 * context-delta.ts
 * 컨텍스트 스냅샷 간 델타(변경분) 계산
 *
 * 이전 런의 contextSnapshot과 현재 스냅샷을 비교해
 * 변경된 키만 반환하고, 나머지는 unchangedKeys로 표시합니다.
 * heartbeat.ts의 executeRunWithWorkspace()에서 호출됩니다.
 */

/**
 * 두 스냅샷을 비교하여 델타와 변경되지 않은 키 목록을 반환합니다.
 *
 * @param previousSnapshot - 이전 런의 컨텍스트 스냅샷 (null이면 전체 반환)
 * @param currentSnapshot  - 현재 빌드된 컨텍스트 스냅샷
 * @returns delta: 변경/추가된 키-값, unchangedKeys: 변경 없는 키 목록
 */
export function computeContextDelta(
  previousSnapshot: Record<string, unknown> | null,
  currentSnapshot: Record<string, unknown>,
): { delta: Record<string, unknown>; unchangedKeys: string[] } {
  // 이전 스냅샷이 없으면 전체를 델타로 반환
  if (previousSnapshot === null) {
    return { delta: currentSnapshot, unchangedKeys: [] };
  }

  const delta: Record<string, unknown> = {};
  const unchangedKeys: string[] = [];

  for (const [key, currentValue] of Object.entries(currentSnapshot)) {
    const previousValue = previousSnapshot[key];
    if (isDeepEqual(previousValue, currentValue)) {
      unchangedKeys.push(key);
    } else {
      delta[key] = currentValue;
    }
  }

  // 이전에 있었지만 현재에 없는 키 → 명시적으로 null 델타
  for (const key of Object.keys(previousSnapshot)) {
    if (!(key in currentSnapshot)) {
      delta[key] = null;
    }
  }

  return { delta, unchangedKeys };
}

/**
 * 깊은 동등성 비교 (JSON 직렬화 기반 — 성능보다 정확성 우선)
 * 순환 참조가 없는 단순 JSON 객체에 적합합니다.
 */
function isDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
```

---

## 작업 2: `server/src/services/context-delta.test.ts` 생성

```typescript
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
```

---

## 작업 3: `packages/adapter-utils/src/server-utils.ts` — joinPromptSectionsWithDelta 추가

`joinPromptSections` 함수 바로 아래에 다음 함수를 추가합니다:

```typescript
/**
 * 델타 컨텍스트를 반영한 프롬프트 섹션 조합
 *
 * unchangedKeys에 해당하는 섹션은 전체 내용 대신 한 줄 요약으로 대체하여
 * 반복 런에서 프롬프트 크기를 절감합니다.
 *
 * @param sections      - { key: string; content: string }[] 형태의 섹션 배열
 * @param unchangedKeys - 이전 런과 동일한 키 목록
 * @param separator     - 섹션 구분자 (기본 "\n\n")
 */
export function joinPromptSectionsWithDelta(
  sections: Array<{ key: string; content: string | null | undefined }>,
  unchangedKeys: Set<string>,
  separator = "\n\n",
): string {
  return sections
    .map(({ key, content }) => {
      const text = typeof content === "string" ? content.trim() : "";
      if (!text) return "";
      if (unchangedKeys.has(key)) {
        return `[${key}: 이전 런과 동일 — 생략됨]`;
      }
      return text;
    })
    .filter(Boolean)
    .join(separator);
}
```

---

## 작업 4: `packages/adapter-utils/src/index.ts` — export 추가

```typescript
export { joinPromptSectionsWithDelta } from "./server-utils.js";
```

> 이미 `server-utils`가 export되어 있다면 해당 export 블록에 추가합니다.

---

## 작업 5: `server/src/services/heartbeat.ts` — delta 연산 삽입

`executeRunWithWorkspace()` 함수 내부에서 컨텍스트 스냅샷을 빌드한 직후,
어댑터에 전달하기 전에 아래 코드를 삽입합니다:

```typescript
import { computeContextDelta } from "./context-delta.js";

// 이전 런의 스냅샷 조회 (같은 taskKey 세션 내)
const previousContextSnapshot =
  previousRun?.resultJson?.contextSnapshot as Record<string, unknown> | null ?? null;

const { delta: contextDelta, unchangedKeys } = computeContextDelta(
  previousContextSnapshot,
  currentContextSnapshot,
);

// context에 델타 정보 추가 → 어댑터 프롬프트 빌드에서 활용
context.contextDelta = contextDelta;
context.unchangedContextKeys = unchangedKeys;
```

> **참고**: `previousRun`, `currentContextSnapshot`, `context` 등의 실제 변수명은
> heartbeat.ts를 먼저 읽어 확인한 후 맞게 조정하세요.

---

## 완료 확인

```sh
pnpm typecheck
pnpm test --filter @paperclipai/adapter-utils
pnpm test server/src/services/context-delta.test.ts
```
