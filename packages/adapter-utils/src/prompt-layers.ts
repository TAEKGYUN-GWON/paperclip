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
   * (이슈 설명, 워크스페이스 설정, 목표, 세션 핸드오프)
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

/**
 * key/content 섹션 배열을 하나의 문자열로 조합합니다.
 * unchangedKeys에 포함된 섹션은 "[key: 이전 런과 동일 — 생략됨]" 플레이스홀더로 대체합니다.
 *
 * @param sections      - { key, content } 섹션 배열
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
        return `[${key}: unchanged from previous run — omitted]`;
      }
      return text;
    })
    .filter(Boolean)
    .join(separator);
}
