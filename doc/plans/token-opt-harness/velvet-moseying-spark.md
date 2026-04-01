# Paperclip 종합 업그레이드 계획: Phase 9–22

## Context

Paperclip은 멀티 에이전트 오케스트레이션 플랫폼으로, Phase 1-7(토큰 최적화), Phase 8(훅 레지스트리), Phase 10(재시도/백오프), UI 한글화가 완료된 상태이다.

이 계획은 **두 가지 소스**를 통합한다:
1. **기존 Phase 9-17 로드맵** (iridescent-drifting-whale.md)
2. **Claude Code 소스코드에서 발견된 패턴** — Coordinator Mode, AutoDream(KAIROS), ULTRAPLAN, Message Bus, Task Graph, Forked Agent, Swarm Permission Sync

Claude Code 참조 경로: `F:\Develop\AI\claude_code\src\`
Paperclip 경로: `F:\Develop\AI\paperclip\`

---

## 완료 현황

| Phase | 핵심 산출물 | 커밋 |
|-------|-----------|------|
| 1-7 | 토큰 최적화 전체 | `5a4cdf34` |
| 8 | `hook-registry.ts` (8개 훅 포인트) | `ca0f3b55` |
| 10 | `retry-policy.ts` (지수 백오프) | `ca0f3b55` |
| UI | 한글 로컬라이제이션 | `4686eefa` |

---

## 전체 의존성 그래프 (시너지 기반 재정렬)

3대 기둥 크리티컬 패스:
- **기둥 A**: 컨텍스트 관리 — Phase 9 → 15 (에이전트가 더 오래, 더 똑똑하게)
- **기둥 B**: 에이전트 통신 — Phase 18 → 12 → 11 (에이전트가 협력하는 기반)
- **기둥 C**: 멀티에이전트 오케스트레이션 — Phase 19 → 22 → 21 → 13 → 20 (진정한 팀 자동화)

```
═══ Wave 1: 기반 구축 (병렬 착수) ═══════════════════════════
  Phase 9  (3계층 컨텍스트 압축)     ← 기둥A 시작, 기반 완료
  Phase 17 (피처 플래그)             ← 모든 Phase의 안전망
  Phase 14 (스트리밍 실행 피드백)    ← 이후 모든 Phase 디버깅에 필수

═══ Wave 2: 통신 인프라 (Wave 1 후) ══════════════════════════
  Phase 18 (메시지 버스)             ← 기둥B 시작, 통신 기반
  Phase 12 (태스크 그래프 + 의존성)  ← 메시지 버스와 시너지
  Phase 15 (DreamTask / KAIROS)     ← Phase 9 압축 + 메시지 버스 활용

═══ Wave 3: 오케스트레이션 (Wave 2 후) ═══════════════════════
  Phase 19 (코디네이터 모드)         ← 기둥C 시작, 메시지 버스 필수
  Phase 11 (자율 태스크 클레임)      ← 태스크 그래프 + 코디네이터 시너지
  Phase 22 (워크트리 격리)           ← 코디네이터 워커의 병렬 코드 작업

═══ Wave 4: 고급 자동화 (Wave 3 후) ══════════════════════════
  Phase 21 (권한 위임)               ← 코디네이터 워커의 안전 운영
  Phase 13 (선언적 워크플로우)       ← 코디네이터 + 태스크 그래프 위에 구축
  Phase 16 (MCP 동적 도구)          ← 워커 도구 확장

═══ Wave 5: 최종 고도화 ═══════════════════════════════════════
  Phase 20 (ULTRAPLAN 원격 계획)     ← 전체 시스템 성숙 후
```

**재정렬 핵심 변경사항:**
1. **Phase 18 (메시지 버스)**: P1→Wave2로 승격 — 코디네이터의 필수 기반이므로 일찍 착수
2. **Phase 14 (스트리밍 피드백)**: Wave1로 승격 — 이후 모든 Phase 개발/디버깅 시 필수
3. **Phase 15 (DreamTask)**: Wave2로 승격 — Phase 9 압축 기술 재활용 + 메시지 버스로 dream 결과 전파
4. **Phase 19 (코디네이터)**: Wave3 첫 번째 — 멀티에이전트의 핵심, 대기하지 않고 빠르게 투입
5. **Phase 11 (자율 클레임)**: Wave3으로 이동 — 코디네이터가 있어야 진정한 자율성 발휘
6. **Phase 13 (워크플로우)**: Wave4로 이동 — 코디네이터+태스크 그래프 위에서야 의미 있음

---

## Phase 9: 3계층 컨텍스트 압축 ⬅️ 즉시 착수

**목표**: 세션 회전(핵옵션) 전에 snip → compact 단계를 먼저 시도

### Claude Code 참조
- `src/services/compact/compact.ts` — compact boundary messages, `buildPostCompactMessages()`
- `src/services/compact/sessionMemoryCompact.ts` — minTokens:10k, maxTokens:40k 임계값
- `src/services/autoDream/autoDream.ts` — forked agent로 요약 생성 패턴

### Paperclip 기존 기반
- `packages/adapter-utils/src/compaction-tiers.ts` — `selectCompactionTier()`: none/micro/auto/collapse
- `packages/adapter-utils/src/prompt-layers.ts` — static/semiStatic/dynamic 3계층
- `packages/adapter-utils/src/tool-result-budget.ts` — 단일 8k/집계 40k 상한
- `server/src/services/heartbeat.ts` — `evaluateSessionCompaction()` 호출부

### 수정/생성 파일
| 파일 | 작업 |
|------|------|
| `server/src/services/context-compressor.ts` | **신규** — 3단계 파이프라인 오케스트레이터 |
| `server/src/services/heartbeat.ts` | `executeRunWithWorkspace()` 내 파이프라인 통합 |
| `packages/adapter-utils/src/compaction-tiers.ts` | micro 티어 실제 snip 로직 구현 |
| `packages/adapter-utils/src/types.ts` | `summarizeMessages()` 옵셔널 메서드 추가 |
| `server/src/services/context-compressor.test.ts` | **신규** — 테스트 |

### 핵심 설계
```typescript
interface CompressionPipeline {
  /** Layer 1: 완료된 tool_result를 1줄 요약으로 축약 */
  snip(messages: SessionMessage[], budget: number): SnipResult;
  /** Layer 2: 이전 N턴을 LLM 요약으로 교체 */
  compact(messages: SessionMessage[], tier: CompactionTier): CompactResult;
  /** Layer 3: 세션 회전 (기존 로직, 최후 수단) */
  rotate(context: RunContext): RotateResult;
}
```

**훅 통합**: `pre:context`에서 압축 필요성 평가 → `on:session-rotate`는 Layer 3에서만 발동

**포팅 판단**: compact boundary message 패턴은 직접 포팅. 요약 생성은 어댑터의 `summarizeMessages()` 또는 별도 LLM 호출로 적응.

**복잡도**: 중-고 | **예상**: 2-3주

---

## Phase 17: 피처 플래그 시스템 (P0 병렬)

**목표**: 모든 신규 Phase의 안전망 — 런타임 기능 토글

### Claude Code 참조
- `feature('KAIROS')`, `feature('BRIDGE_MODE')` 등 compile-time gate
- GrowthBook 기반 `tengu_onyx_plover` 플래그로 autoDream 제어

### 수정/생성 파일
| 파일 | 작업 |
|------|------|
| `server/src/services/feature-flags.ts` | **신규** — 피처 플래그 평가 엔진 |
| `packages/db/src/schema/feature_flags.ts` | **신규** — 플래그 테이블 |
| `server/src/services/instance-settings.ts` | 기존 설정과 통합 |

### 핵심 설계
```typescript
interface FeatureFlag {
  key: string;                            // e.g. "dream_task", "coordinator_mode"
  enabled: boolean;
  scope: "instance" | "company" | "agent";
  rolloutPercent: number;
  overrides: Array<{ scopeId: string; enabled: boolean }>;
}

function isFeatureEnabled(key: string, ctx: { companyId?: string; agentId?: string }): boolean;
```

**복잡도**: 저 | **예상**: 1주

---

## Phase 11: 자율 태스크 자동 할당

**목표**: 에이전트가 idle 시 미할당 이슈를 자동으로 클레임

### Claude Code 참조
- `src/utils/tasks.ts` — `claimTask()` with `checkAgentBusy`, high-water mark ID
- `getAgentStatuses()` — 팀원 가용성 조회

### Paperclip 기존 기반
- `packages/db/src/schema/issues.ts` — `assigneeAgentId`, `executionRunId`, `executionLockedAt`
- `doc/plans/2026-02-20-issue-run-orchestration-plan.md` — 이슈 실행 오케스트레이션 계획 (미구현)

### 수정/생성 파일
| 파일 | 작업 |
|------|------|
| `server/src/services/auto-claim.ts` | **신규** — 클레임 정책 + 실행 |
| `server/src/services/heartbeat.ts` | `startNextQueuedRunForAgent()` 전에 auto-claim 호출 |
| `server/src/services/issues.ts` | `claimIssue()` 트랜잭션 메서드 |

### 핵심 설계
```typescript
interface AutoClaimPolicy {
  enabled: boolean;
  maxConcurrentClaims: number;
  claimableStatuses: string[];           // ["backlog", "todo"]
  roleMatchRequired: boolean;
  priorityThreshold: "critical" | "high" | "medium" | "low";
}
```

**훅 통합**: `post:run` 훅에서 이슈 완료 후 다음 이슈 auto-claim 트리거

**복잡도**: 중 | **예상**: 2주

---

## Phase 12: 태스크 그래프 + 위상 정렬 의존성

**목표**: 이슈 간 blocks/blockedBy 관계를 DB에 영속화, 위상 정렬 기반 실행 순서

### Claude Code 참조
- `src/utils/tasks.ts` — `blocks: string[]`, `blockedBy: string[]` 그래프
- 위상 정렬로 ready tasks 추출

### 수정/생성 파일
| 파일 | 작업 |
|------|------|
| `packages/db/src/schema/issue_dependencies.ts` | **신규** — `blockingIssueId` → `blockedIssueId` 관계 테이블 |
| `server/src/services/task-graph.ts` | **신규** — 위상 정렬 + `getReadyIssues()` |
| `server/src/services/issues.ts` | 의존성 CRUD |
| `packages/db/src/schema/issues.ts` | 스키마 마이그레이션 |

**훅 통합**: `post:run` 훅에서 이슈 완료 시 downstream 이슈 자동 unblock → wakeup

**복잡도**: 중 | **예상**: 3주

---

## Phase 14: 스트리밍 실행 피드백

**목표**: 런 진행 상태를 실시간으로 UI에 스트리밍

### Claude Code 참조
- Multi-transport (SSE, WebSocket, Hybrid)
- `ProgressTracker`: toolUseCount, latestInputTokens, cumulativeOutputTokens, recentActivities
- `updateProgressFromMessage()` — 턴 단위 점진 업데이트

### Paperclip 기존 기반
- `server/src/services/live-events.ts` — EventEmitter pub/sub (55줄)
- `server/src/realtime/live-events-ws.ts` — WebSocket 서버

### 수정/생성 파일
| 파일 | 작업 |
|------|------|
| `server/src/services/run-progress-tracker.ts` | **신규** — 런 진행 상태 집계 |
| `server/src/services/live-events.ts` | 진행 이벤트 타입 추가 |
| `server/src/services/heartbeat.ts` | 어댑터 stdout 콜백에서 진행 이벤트 발행 |
| `packages/shared/src/constants.ts` | LiveEventType에 streaming 타입 추가 |

### 핵심 설계
```typescript
interface RunProgressEvent {
  runId: string;
  agentId: string;
  phase: "preparing" | "executing" | "compacting" | "finalizing";
  toolUseCount: number;
  inputTokens: number;
  outputTokens: number;
  recentActivities: Array<{ kind: string; summary: string }>;
  elapsedMs: number;
}
```

**복잡도**: 중 | **예상**: 2주

---

## Phase 18: 메시지 버스 [신규]

**목표**: 에이전트 간 구조화된 메시지 전달 + 우선순위 큐 + 공유 메모리

### Claude Code 참조
- `src/utils/messageQueueManager.ts` — priority: now(0)/next(1)/later(2), `enqueue()`, `dequeue()`
- `src/tools/SendMessageTool/` — teammate/broadcast/UDS/bridge 모드
- `src/bridge/bridgeMessaging.ts` — transport helpers

### Paperclip 기존 기반
- `server/src/services/plugin-event-bus.ts` — 플러그인 이벤트 라우팅 (86줄)
- `server/src/services/plugin-stream-bus.ts` — 스트림 버스
- `packages/db/src/schema/agent_wakeup_requests.ts` — 단방향 wakeup만 가능

### 수정/생성 파일
| 파일 | 작업 |
|------|------|
| `packages/db/src/schema/agent_messages.ts` | **신규** — 메시지 테이블 |
| `server/src/services/message-bus.ts` | **신규** — 메시지 버스 코어 |
| `server/src/services/shared-memory.ts` | **신규** — 에이전트 공유 메모리 |
| `server/src/routes/agent-messages.ts` | **신규** — API 엔드포인트 |

### 핵심 설계
```typescript
interface AgentMessage {
  id: string;
  companyId: string;
  fromAgentId: string;
  toAgentId: string | null;             // null = broadcast
  mode: "direct" | "broadcast" | "team";
  priority: 0 | 1 | 2;                 // Claude Code 패턴: now/next/later
  payload: {
    type: "task_handoff" | "status_update" | "request" | "response";
    content: string;
    metadata: Record<string, unknown>;
  };
  status: "queued" | "delivered" | "read" | "expired";
  expiresAt: Date | null;
}
```

**훅 통합**: `post:run`에서 수신 메시지 확인, `pre:context`에서 미읽은 메시지를 컨텍스트 주입

**포팅 판단**: 우선순위 큐 모델(now/next/later) 직접 포팅. 인프로세스 큐 → PostgreSQL `LISTEN/NOTIFY` + 테이블 영속화로 적응.

**복잡도**: 고 | **예상**: 3-4주

---

## Phase 15: DreamTask / KAIROS 백그라운드 메모리

**목표**: 에이전트 비활성 시 과거 세션 분석 → 학습 인사이트 자동 생성

### Claude Code 참조
- `src/services/autoDream/autoDream.ts` — minHours:24, minSessions:5, forked agent 실행
- `src/services/autoDream/consolidationLock.ts` — 파일 기반 mutex, PID 추적, 60분 stale
- `src/services/autoDream/config.ts` — GrowthBook 피처 게이팅
- `src/tasks/DreamTask/DreamTask.ts` — sessionsReviewing, filesTouched, turns 추적

### Paperclip 기존 기반
- `doc/memory-landscape.md` — 메모리 시스템 조사 완료
- `doc/plans/2026-03-17-memory-service-surface-api.md` — API 계획
- `packages/db/src/schema/agent_runtime_state.ts` — stateJson에 메타데이터 저장 가능

### 수정/생성 파일
| 파일 | 작업 |
|------|------|
| `server/src/services/dream-task.ts` | **신규** — KAIROS 데몬 |
| `server/src/services/dream-lock.ts` | **신규** — PostgreSQL advisory lock 기반 mutex |
| `packages/db/src/schema/agent_memories.ts` | **신규** — 메모리 테이블 |
| `packages/db/src/schema/dream_runs.ts` | **신규** — Dream 실행 기록 |

### 핵심 설계
```typescript
interface DreamPolicy {
  enabled: boolean;
  minHoursSinceLastDream: number;       // 기본 24 (Claude Code 동일)
  minSessionsSinceLastDream: number;    // 기본 5  (Claude Code 동일)
  maxDreamDurationMinutes: number;      // 기본 60
}

interface DreamResult {
  sessionsReviewed: number;
  insightsGenerated: Array<{
    category: "pattern" | "preference" | "skill" | "context";
    content: string;
    confidence: number;
    sourceRunIds: string[];
  }>;
  tokenCost: number;
}
```

**포팅 판단**: 시간 기반 게이팅 + stale lock 감지 직접 포팅. 파일 기반 mutex → PostgreSQL advisory lock 적응. MEMORY.md → DB 영속화.

**훅 통합**: `post:run`에서 dream 조건 평가, wakeup `source: "dream"` 추가

**복잡도**: 고 | **예상**: 4주

---

## Phase 13: 선언적 워크플로우

**목표**: YAML로 멀티 에이전트 파이프라인 정의/재사용

### Paperclip 기존 기반
- `server/src/services/routines.ts` — cron 루틴 (단일 에이전트)
- `packages/db/src/schema/routines.ts` — routines + routineTriggers

### 수정/생성 파일
| 파일 | 작업 |
|------|------|
| `server/src/services/workflow-engine.ts` | **신규** — YAML 파서 + 실행기 |
| `packages/db/src/schema/workflows.ts` | **신규** — 워크플로우 정의 |
| `packages/db/src/schema/workflow_runs.ts` | **신규** — 실행 인스턴스 |

**복잡도**: 고 | **예상**: 4주 | **전제**: Phase 12

---

## Phase 19: 코디네이터 모드 [신규]

**목표**: 메인 에이전트를 오케스트레이터로 변환 → 병렬 워커 스폰/관리

### Claude Code 참조
- `src/coordinator/coordinatorMode.ts` — 시스템 프롬프트로 코디네이터 변환
- `isCoordinatorMode()` — `CLAUDE_CODE_COORDINATOR_MODE` env var
- Agent Tool + SendMessage Tool — 워커 스폰 + continuation
- Task notification XML: `<task-notification>` 포맷
- Workers: 제한된 도구 세트, 백그라운드 실행

### 수정/생성 파일
| 파일 | 작업 |
|------|------|
| `server/src/services/coordinator.ts` | **신규** — 코디네이터 엔진 |
| `server/src/services/worker-spawn.ts` | **신규** — 워커 스폰 관리자 |
| `server/src/services/coordinator-prompt.ts` | **신규** — 시스템 프롬프트 빌더 |

### 핵심 설계
```typescript
interface CoordinatorConfig {
  enabled: boolean;
  coordinatorAgentId: string;
  maxParallelWorkers: number;           // 기본 5
  workerToolRestrictions: string[];
  delegationStrategy: "round_robin" | "capability_match" | "load_balance";
}

interface WorkerTaskNotification {
  taskId: string;
  status: "spawned" | "running" | "completed" | "failed";
  summary: string;
  result: unknown | null;
  workerAgentId: string;
  parentIssueId: string;
}
```

**포팅 판단**: 코디네이터 시스템 프롬프트 패턴 직접 포팅. 인프로세스 Agent Tool → Paperclip wakeup + 서브이슈 위임으로 적응.

**훅 통합**: `pre:run`에서 코디네이터 모드 확인, `pre:context`에서 시스템 프롬프트 주입

**복잡도**: 매우 높 | **예상**: 5-6주 | **전제**: Phase 18

---

## Phase 16: MCP 동적 도구 등록

### Paperclip 기존 기반
- `server/src/services/plugin-tool-registry.ts` — 도구 레지스트리
- `server/src/services/plugin-tool-dispatcher.ts` — 도구 디스패처

### 수정/생성 파일
| 파일 | 작업 |
|------|------|
| `server/src/services/mcp-discovery.ts` | **신규** — MCP 서버 발견/등록 |
| `server/src/services/mcp-session.ts` | **신규** — 세션 관리 |

**복잡도**: 중 | **예상**: 3주

---

## Phase 20: ULTRAPLAN 원격 계획 오프로드 [신규]

**목표**: 복잡한 계획을 원격 컨테이너에 오프로드

### Claude Code 참조
- `src/utils/ultraplan/ccrSession.ts` — Cloud Container Runtime
- `ExitPlanModeScanner` — 상태 머신: running → needs_input → plan_ready → approved/rejected
- Poll loop: 3초 간격, 30분 타임아웃

### 수정/생성 파일
| 파일 | 작업 |
|------|------|
| `server/src/services/remote-planner.ts` | **신규** — 원격 오프로드 엔진 |
| `server/src/services/plan-scanner.ts` | **신규** — 계획 상태 머신 |

### 핵심 설계
```typescript
type PlanState = "idle" | "planning" | "needs_input" | "plan_ready" | "approved" | "rejected";

interface RemotePlanSession {
  id: string;
  state: PlanState;
  pollIntervalMs: number;               // 3000 (Claude Code 동일)
  timeoutMs: number;                    // 1800000 (30분)
  maxConsecutiveFailures: number;        // 5
  executionTarget: "local" | "remote";
}
```

**포팅 판단**: 상태 머신 + poll loop 직접 포팅. CCR → Paperclip execution workspace 또는 외부 API 적응.

**복잡도**: 매우 높 | **예상**: 5-6주 | **전제**: Phase 19

---

## Phase 21: 권한 위임 프로토콜 [신규]

### Claude Code 참조
- `src/utils/swarm/permissionSync.ts` — Worker → Leader → User → Worker 흐름
- `SwarmPermissionRequest` — pending/approved/rejected

### Paperclip 기존 기반
- `server/src/services/approvals.ts` — 승인 시스템
- `server/src/services/agent-permissions.ts` — 권한 서비스

### 수정/생성 파일
| 파일 | 작업 |
|------|------|
| `server/src/services/permission-delegation.ts` | **신규** |
| `server/src/services/approvals.ts` | 위임 승인 타입 추가 |

**복잡도**: 중 | **예상**: 2-3주 | **전제**: Phase 18 + 19

---

## Phase 22: 워크트리 격리 [신규]

### Claude Code 참조
- `src/utils/worktree.ts` — `.claude/worktrees/<slug>/`, sparse checkout
- Enter/Exit tools, worktreeCreateHook/worktreeRemoveHook

### Paperclip 기존 기반
- `server/src/worktree-config.ts` — 워크트리 설정
- `server/src/services/execution-workspaces.ts` — git_worktree 전략 지원
- `doc/plans/2026-03-10-workspace-strategy-and-git-worktrees.md` — 전략 계획

**수정 파일**: `execution-workspaces.ts`, `workspace-runtime.ts`, `worktree-config.ts`

**복잡도**: 중 | **예상**: 2주 | **전제**: Phase 19

---

## 실행 순서 총괄표 (시너지 기반)

| Wave | 순서 | Phase | 이름 | 기둥 | 임팩트 | 복잡도 | 전제 | 상태 |
|------|------|-------|------|------|--------|--------|------|------|
| **W1** | 1 | **9** | 3계층 컨텍스트 압축 | A | 🟢 높 | 중-고 | Phase 1-7 | ⬜ |
| **W1** | 1 | **17** | 피처 플래그 | 공통 | 🟢 기반 | 저 | 없음 | ⬜ |
| **W1** | 1 | **14** | 스트리밍 실행 피드백 | 공통 | 🟢 높 | 중 | 없음 | ⬜ |
| **W2** | 2 | **18** | 메시지 버스 | B | 🟢 높 | 고 | W1 | ⬜ |
| **W2** | 2 | **12** | 태스크 그래프 의존성 | B | 🔵 중 | 중 | W1 | ⬜ |
| **W2** | 3 | **15** | DreamTask / KAIROS | A | 🔵 중 | 고 | Phase 9 | ⬜ |
| **W3** | 4 | **19** | 코디네이터 모드 | C | 🟢 높 | 매우높 | Phase 18 | ⬜ |
| **W3** | 4 | **11** | 자율 태스크 클레임 | B+C | 🔵 중 | 중 | Phase 12+19 | ⬜ |
| **W3** | 4 | **22** | 워크트리 격리 | C | 🔵 중 | 중 | Phase 19 | ⬜ |
| **W4** | 5 | **21** | 권한 위임 프로토콜 | C | 🔵 중 | 중 | Phase 18+19 | ⬜ |
| **W4** | 5 | **13** | 선언적 워크플로우 | C | 🔵 중 | 고 | Phase 12+19 | ⬜ |
| **W4** | 5 | **16** | MCP 동적 도구 | 공통 | 🟡 낮 | 중 | 없음 | ⬜ |
| **W5** | 6 | **20** | ULTRAPLAN 원격 계획 | C | 🟡 중 | 매우높 | Phase 19 | ⬜ |

---

## Claude Code → Paperclip 포팅 매핑

| Claude Code 소스 | Paperclip 대응 | 포팅 방식 | Phase |
|------------------|---------------|----------|-------|
| `services/compact/` | `context-compressor.ts` + compaction-tiers | 확장 | 9 |
| `utils/tasks.ts` (claimTask) | `auto-claim.ts` + issues 테이블 | 적응 | 11 |
| `utils/tasks.ts` (blocking graph) | `issue_dependencies` + `task-graph.ts` | 적응 | 12 |
| `utils/messageQueueManager.ts` | `message-bus.ts` + `agent_messages` | 적응 | 18 |
| `coordinator/coordinatorMode.ts` | `coordinator.ts` + `worker-spawn.ts` | 적응 | 19 |
| `utils/ultraplan/ccrSession.ts` | `remote-planner.ts` + `plan-scanner.ts` | 적응 | 20 |
| `services/autoDream/` | `dream-task.ts` + `agent_memories` | 적응 | 15 |
| `utils/swarm/permissionSync.ts` | `permission-delegation.ts` | 적응 | 21 |
| `utils/worktree.ts` | `execution-workspaces.ts` 확장 | 확장 | 22 |
| GrowthBook feature gates | `feature-flags.ts` | 새로 구현 | 17 |

---

## 위험 요소 및 완화

1. **heartbeat.ts 비대화 (4228줄)**: Phase 9에서 context-compressor 분리를 시작으로, 점진적 모듈화
2. **메시지 버스 지연**: PostgreSQL `LISTEN/NOTIFY` 활용, 폴링 대신 이벤트 기반
3. **코디네이터 비용 폭발**: Phase 17 피처 플래그 + `on:budget-alert` 훅으로 안전망
4. **Dream 가치 불확실**: 피처 플래그 뒤에 배치, A/B 테스트 후 확대

---

## 검증 전략

1. **Phase 9**: 세션 회전 빈도 50%+ 감소 확인 (costEvents 전후 비교)
2. **Phase 17**: 플래그 토글 시 기능 활성화/비활성화 확인
3. **Phase 11**: 에이전트 idle 시간 측정 → auto-claim 후 30%+ 감소
4. **Phase 18**: 에이전트 간 메시지 왕복 지연 < 500ms
5. **Phase 19**: 코디네이터가 3+ 워커를 병렬 관리하는 E2E 시나리오
6. **모든 Phase**: `pnpm typecheck && pnpm test && pnpm lint` 통과 필수
