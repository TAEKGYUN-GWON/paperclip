# 토큰 최적화 고도화 — 하네스 마스터 문서

날짜: 2026-04-01
선행 계획: `doc/plans/2026-03-13-TOKEN-OPTIMIZATION-PLAN.md`

## 개요

이 디렉토리는 Claude Code 서브에이전트가 순차적으로 실행하는 Phase별 작업 지침을 담고 있습니다.
각 파일은 단일 Claude Code 세션이 처음부터 끝까지 완주할 수 있도록 자기완결적으로 작성됩니다.

## 파일 목록

| 파일 | Phase | 우선도 | 예상 절감 |
|------|-------|--------|-----------|
| `phase1-compaction.md` | 멀티티어 세션 컴팩션 | 높음 | 장기 세션 30-50% |
| `phase2-delta.md` | 컨텍스트 스냅샷 델타 | 높음 | 반복 런 20-40% |
| `phase3-cache.md` | 프롬프트 캐시 정렬 | 높음 | Claude 비용 최대 90% |
| `phase4-budget.md` | 도구 결과 버젯팅 | 중간 | 도구 집약적 15-30% |

## 의존성

```
Phase 1 완료 필수 → Phase 2 시작 가능
Phase 2 완료 필수 → Phase 3 시작 가능
Phase 4 독립 실행 가능 (언제든)
```

## 검증 체크리스트 (각 Phase 완료 후)

- [ ] `pnpm typecheck` — TypeScript 오류 없음
- [ ] `pnpm test` — 기존 테스트 전부 통과
- [ ] 새로 추가한 테스트 파일 존재
- [ ] 새 타입/함수가 `index.ts`에서 export됨
- [ ] 한국어 JSDoc 주석 포함
