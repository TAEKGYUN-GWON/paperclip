# CLAUDE.md — Paperclip Claude Code 하네스

이 파일은 Claude Code가 Paperclip 저장소에서 작업할 때 참조하는 핵심 지침서입니다.

## 저장소 개요

Paperclip은 멀티 에이전트 오케스트레이션 플랫폼입니다. 주요 레이어:

- `server/src/services/heartbeat.ts` — 에이전트 실행 루프 핵심 (가장 중요)
- `packages/adapter-utils/src/` — 모든 어댑터 공유 유틸리티
- `packages/adapters/claude-local/src/server/execute.ts` — Claude 어댑터 실행
- `packages/db/src/schema/` — Drizzle 스키마

## 완료된 주요 작업 이력

| 범주 | 완료 항목 |
|------|-----------|
| 토큰 최적화 (Phase 1–7) | 멀티티어 컴팩션, 컨텍스트 델타, 프롬프트 캐시, 도구 결과 버젯 등 |
| 멀티에이전트 인프라 (Phase 9–22) | 코디네이터 모드, 메시지 버스, 태스크 그래프, 워크트리 격리, ULTRAPLAN 등 |
| CEO Chat | CEO 1:1 채팅, 선제적 브리핑(BriefingAggregator), 단체 톡방 (2026-04-02) |

## 현재 진행 중인 작업

### CEO Chat Phase E — UI 마무리 (소규모)

방금 완료된 CEO Chat 기능에서 보류된 UI 개선 항목:

| 항목 | 파일 위치 | 설명 |
|------|-----------|------|
| 사이드바 미읽음 배지 | `ui/src/components/Sidebar.tsx` | CEO 채팅 메뉴에 미읽음 브리핑 수 배지 |
| 대시보드 위젯 | `ui/src/pages/Dashboard.tsx` | 최근 브리핑 미리보기 카드 |

### 다음 우선순위 피처 — `doc/plans/2026-03-13-features.md` 참조

#### P0 (즉시 착수 권장)

1. **비용 안전 + heartbeat 강화** — 80% 경고, 100% 차단 서킷 브레이커
2. **가이드 온보딩 + 첫 번째 작업 마법** — 인터뷰 기반 온보딩, `GET /api/onboarding/recommendation`
3. **공유/클라우드 배포 기반** — shared_private / shared_public 배포 모드 완성
4. **아티팩트 Phase 1** — 비이미지 첨부파일 + 결과물 서피싱

#### P1 (P0 이후)

5. **보드 커맨드 서피스** — 자연어 명령으로 에이전트 제어
6. **가시성/설명가능성 레이어** — 에이전트 실행 이유 시각화
7. **자동 모드 + 인터럽트/재개** — 완전 자율 실행 + 사람이 끼어들기
8. **최소 멀티유저 협업** — 팀원 초대 + 공동 대시보드

## 핵심 엔지니어링 규칙 (AGENTS.md 요약)

1. **도메인 격리**: 모든 변경은 company-scoped 유지
2. **계층 동기화**: schema → shared types → server → ui 순으로 일관성 유지
3. **테스트 필수**: 새 파일마다 `*.test.ts` 작성, 기존 테스트 회귀 없어야 함
4. **TypeScript 엄격**: `pnpm typecheck` 통과 필수

## 개발 명령어

```sh
pnpm install          # 의존성 설치
pnpm dev              # 개발 서버 (API: localhost:3100)
pnpm build            # 전체 빌드
pnpm test             # 전체 테스트 (npx vitest run)
pnpm typecheck        # TypeScript 검사
```

## 파일 작성 컨벤션

- 새 계획 문서: `doc/plans/YYYY-MM-DD-slug.md`
- 새 TypeScript 소스: `packages/` 또는 `server/src/services/` 아래 적절한 위치
- 한국어 JSDoc 주석 사용 권장
