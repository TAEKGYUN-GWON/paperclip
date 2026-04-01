# CLAUDE.md — Paperclip Claude Code 하네스

이 파일은 Claude Code가 Paperclip 저장소에서 작업할 때 참조하는 핵심 지침서입니다.

## 저장소 개요

Paperclip은 멀티 에이전트 오케스트레이션 플랫폼입니다. 주요 레이어:

- `server/src/services/heartbeat.ts` — 에이전트 실행 루프 핵심 (가장 중요)
- `packages/adapter-utils/src/` — 모든 어댑터 공유 유틸리티
- `packages/adapters/claude-local/src/server/execute.ts` — Claude 어댑터 실행
- `packages/db/src/schema/` — Drizzle 스키마

## 현재 진행 중인 작업: 토큰 최적화 고도화

전체 계획: `doc/plans/token-opt-harness/HARNESS.md`

### 의존성 그래프 및 실행 순서

```
Phase 1 (멀티티어 컴팩션)   ←── 먼저 실행
Phase 4 (도구 결과 버젯)    ←── Phase 1과 병렬 가능
    ↓
Phase 2 (컨텍스트 델타)     ←── Phase 1 완료 후
    ↓
Phase 3 (프롬프트 캐시 정렬) ←── Phase 2 완료 후
```

### 서브에이전트 실행 커맨드

**각 Phase를 독립 세션으로 실행합니다. 프로젝트 루트에서:**

```sh
# Phase 1 (먼저 실행)
claude "doc/plans/token-opt-harness/phase1-compaction.md 파일을 읽고 지시사항을 전부 실행하세요. 완료 후 pnpm typecheck와 pnpm test를 실행하여 결과를 보고하세요."

# Phase 4 (Phase 1과 병렬 가능 — 별도 터미널)
claude "doc/plans/token-opt-harness/phase4-budget.md 파일을 읽고 지시사항을 전부 실행하세요. 완료 후 pnpm typecheck와 pnpm test를 실행하여 결과를 보고하세요."

# Phase 2 (Phase 1 완료 후)
claude "doc/plans/token-opt-harness/phase2-delta.md 파일을 읽고 지시사항을 전부 실행하세요. 완료 후 pnpm typecheck와 pnpm test를 실행하여 결과를 보고하세요."

# Phase 3 (Phase 2 완료 후)
claude "doc/plans/token-opt-harness/phase3-cache.md 파일을 읽고 지시사항을 전부 실행하세요. 완료 후 pnpm typecheck와 pnpm test를 실행하여 결과를 보고하세요."
```

## 핵심 엔지니어링 규칙 (AGENTS.md 요약)

1. **도메인 격리**: 모든 변경은 company-scoped 유지
2. **계층 동기화**: schema → shared types → server → ui 순으로 일관성 유지
3. **테스트 필수**: 새 파일마다 `*.test.ts` 작성, 기존 테스트 회귀 없어야 함
4. **TypeScript 엄격**: `pnpm typecheck` 통과 필수
5. **린트**: `pnpm lint` 통과 필수

## 개발 명령어

```sh
pnpm install          # 의존성 설치
pnpm dev              # 개발 서버 (API: localhost:3100)
pnpm build            # 전체 빌드
pnpm test             # 전체 테스트
pnpm typecheck        # TypeScript 검사
pnpm lint             # ESLint
```

## 파일 작성 컨벤션

- 새 계획 문서: `doc/plans/YYYY-MM-DD-slug.md`
- 새 TypeScript 소스: `packages/` 또는 `server/src/services/` 아래 적절한 위치
- 한국어 JSDoc 주석 사용 권장
