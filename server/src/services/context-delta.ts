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
