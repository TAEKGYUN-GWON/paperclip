# Paperclip 종합 업그레이드 계획: Phase 9–22

## Context

Paperclip은 멀티 에이전트 오케스트레이션 플랫폼으로, Phase 1-7(토큰 최적화), Phase 8(훅 레지스트리), Phase 10(재시도/백오프), UI 한글화가 완료된 상태이다.

이 계획은 **두 가지 소스**를 통합한다:

1. **기존 Phase 9-17 로드맵** (iridescent-drifting-whale.md)
2. **Claude Code 소스코드에서 발견된 패턴** — Coordinator Mode, AutoDream(KAIROS), ULTRAPLAN, Message Bus, Task Graph, Forked Agent, Swarm Permission Sync

Claude Code 참조 경로: `F:\\Develop\\AI\\claude\_code\\src\\`
Paperclip 경로: `F:\\Develop\\AI\\paperclip\\`

\---

## 완료 현황

### 기존 완료

|Phase|핵심 산출물|커밋|
|-|-|-|
|1-7|토큰 최적화 전체|`5a4cdf34`|
|8|`hook-registry.ts` (8개 훅 포인트)|`ca0f3b55`|
|10|`retry-policy.ts` (지수 백오프)|`ca0f3b55`|
|UI|한글 로컬라이제이션|`4686eefa`|

### ✅ Wave 1 완료 — 기반 구축

|Phase|이름|커밋|핵심 파일|요약|
|-|-|-|-|-|
|9|3계층 컨텍스트 압축|`64f2d93b`|`context-compressor.ts` + test, heartbeat.ts|snip/compact/rotate 파이프라인으로 세션 회전 최소화|
|17|피처 플래그|`a71cad0d`|`feature-flags.ts` + test|12개 플래그 (`FeatureFlagKey`), instanceSettings JSONB 저장, 모든 Phase 안전망|
|14|스트리밍 실행 피드백|`a7085908`|`run-progress-tracker.ts` + test, `heartbeat_run_events` 스키마|`heartbeat.run.progress` 이벤트, phase/toolUseCount/activity 실시간 추적|

### ✅ Wave 2 완료 — 통신 인프라

|Phase|이름|커밋|핵심 파일|요약|
|-|-|-|-|-|
|18|메시지 버스|`ad8c0e22`|`message-bus.ts`, `shared-memory.ts`, `agent_messages` + `agent_shared_memory` 스키마, routes|now/next/later 우선순위 큐, direct/broadcast 모드, 공유 메모리 KV 저장소|
|12|태스크 그래프|`e4b64fb7`|`task-graph.ts` + test, `issue_dependencies` 스키마|DFS 순환 감지, Kahn 위상 정렬, `isBlocked()` heartbeat 게이트|
|15|DreamTask/KAIROS|`57432948`|`dream-task.ts` + test|순수 DB 집계 기반 메모리 통합 (LLM 호출 없음), namespace "kairos", 48h TTL|

\---

## 전체 의존성 그래프 (시너지 기반 재정렬)

3대 기둥 크리티컬 패스:

* **기둥 A**: 컨텍스트 관리 — Phase 9 → 15 (에이전트가 더 오래, 더 똑똑하게)
* **기둥 B**: 에이전트 통신 — Phase 18 → 12 → 11 (에이전트가 협력하는 기반)
* **기둥 C**: 멀티에이전트 오케스트레이션 — Phase 19 → 22 → 21 → 13 → 20 (진정한 팀 자동화)

```
═══ Wave 1: 기반 구축 ✅ 완료 ═════════════════════════════════
  Phase 9  (3계층 컨텍스트 압축)     ✅ 64f2d93b
  Phase 17 (피처 플래그)             ✅ a71cad0d
  Phase 14 (스트리밍 실행 피드백)    ✅ a7085908

═══ Wave 2: 통신 인프라 ✅ 완료 ═══════════════════════════════
  Phase 18 (메시지 버스)             ✅ ad8c0e22
  Phase 12 (태스크 그래프 + 의존성)  ✅ e4b64fb7
  Phase 15 (DreamTask / KAIROS)     ✅ 57432948

═══ Wave 3: 오케스트레이션 ⬅️ 현재 ════════════════════════════
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

\---

---

## ═══ Wave 3: 오케스트레이션 — 상세 구현 계획 ═══

### Wave 3 우선순위 및 의존성

```
Phase 19 (코디네이터 모드)  ←── 반드시 먼저 (메시지 버스 + 태스크 그래프 활용)
    │
    ├──→ Phase 11 (자율 태스크 클레임)  ←── Phase 19 완료 후 (병렬 가능)
    │
    └──→ Phase 22 (워크트리 격리)       ←── Phase 19 완료 후 (병렬 가능)
```

**우선순위 근거:**
1. **Phase 19 최우선** — 코디네이터가 없으면 워커 스폰/관리 불가. 메시지 버스(✅)와 태스크 그래프(✅)를 직접 소비하는 첫 소비자.
2. **Phase 11 & 22 병렬** — 둘 다 Phase 19에 의존하지만 서로 독립. 코디네이터 완료 후 동시 착수 가능.
3. **Phase 11 먼저 완성 권장** — 워크트리 격리보다 구현량이 적고, 코디네이터와의 통합 테스트가 즉시 가능.

---

## Phase 19: 코디네이터 모드 ⬅️ Wave 3 첫 번째

**목표**: 메인 에이전트를 오케스트레이터로 변환 → 서브이슈 생성 + 워커 위임 + 결과 집계

**피처 플래그**: `coordinator_mode` (이미 등록됨)
**전제**: Phase 18 ✅ (메시지 버스), Phase 12 ✅ (태스크 그래프)

### 아키텍처 결정

Claude Code에서 코디네이터는 인프로세스 Agent Tool로 자식 에이전트를 스폰한다. Paperclip은 에이전트가 DB 영속 엔티티이므로 다음과 같이 적응:

- 코디네이터 에이전트가 **서브이슈**(자식)를 부모 이슈에 생성
- 각 서브이슈를 워커 에이전트에 `assigneeAgentId`로 할당
- 기존 wakeup request 시스템으로 워커 깨움
- **메시지 버스**(Phase 18)로 워커 상태 추적 + 결과 수신
- **태스크 그래프**(Phase 12)로 서브이슈 간 의존성 관리

### Claude Code 참조

* `src/coordinator/coordinatorMode.ts` — 시스템 프롬프트로 코디네이터 변환
* `isCoordinatorMode()` — `CLAUDE_CODE_COORDINATOR_MODE` env var
* Agent Tool + SendMessage Tool — 워커 스폰 + continuation
* Task notification XML: `<task-notification>` 포맷
* Workers: 제한된 도구 세트, 백그라운드 실행

### Paperclip 기존 기반

* `server/src/services/message-bus.ts` — 에이전트 간 통신 (Phase 18 ✅)
* `server/src/services/task-graph.ts` — 의존성 그래프 + 위상 정렬 (Phase 12 ✅)
* `server/src/services/shared-memory.ts` — 에이전트 공유 상태 (Phase 18 ✅)
* `server/src/services/issues.ts` — 이슈 CRUD + 할당 로직
* `server/src/routes/agent-messages.ts` — 라우트 패턴 참조

### 신규 생성 파일

|파일|목적|예상 LOC|
|-|-|-|
|`packages/db/src/schema/coordinator_sessions.ts`|코디네이터 세션 테이블|~50|
|`packages/db/src/schema/worker_tasks.ts`|워커 태스크 추적 테이블|~55|
|`server/src/services/coordinator.ts`|코디네이터 오케스트레이션 엔진|~400|
|`server/src/services/coordinator.test.ts`|유닛 테스트|~250|
|`server/src/routes/coordinator.ts`|REST API 엔드포인트|~120|

### 수정 파일

|파일|변경 내용|
|-|-|
|`packages/db/src/schema/index.ts`|`coordinatorSessions`, `workerTasks` export 추가|
|`server/src/services/index.ts`|`coordinatorService` export 추가|
|`server/src/services/heartbeat.ts`|3개 통합 포인트 (아래 상세)|
|`server/src/app.ts`|코디네이터 라우트 등록|
|`packages/shared/src/constants.ts`|`CoordinatorSessionStatus`, `WorkerTaskStatus` 타입 추가|

### DB 스키마

**`coordinator_sessions`**:
```typescript
{
  id: uuid PK,
  companyId: uuid FK → companies,
  coordinatorAgentId: uuid FK → agents,
  parentIssueId: uuid FK → issues (cascade delete),
  status: text ("active" | "completed" | "cancelled"),
  maxParallelWorkers: integer (default 5),
  delegationStrategy: text ("round_robin" | "capability_match" | "load_balance"),
  config: jsonb,
  startedAt: timestamp,
  completedAt: timestamp,
}
// 인덱스: (companyId, coordinatorAgentId), (companyId, parentIssueId), (companyId, status)
```

**`worker_tasks`**:
```typescript
{
  id: uuid PK,
  companyId: uuid FK → companies,
  coordinatorSessionId: uuid FK → coordinator_sessions (cascade),
  parentIssueId: uuid FK → issues,
  subIssueId: uuid FK → issues (nullable, set null on delete),
  workerAgentId: uuid FK → agents (nullable),
  status: text ("pending" | "spawned" | "running" | "completed" | "failed" | "cancelled"),
  summary: text,
  result: jsonb,
  delegatedAt: timestamp,
  completedAt: timestamp,
}
// 인덱스: (companyId, coordinatorSessionId), (companyId, parentIssueId, status), (companyId, workerAgentId, status)
```

### 핵심 서비스 인터페이스

```typescript
export function coordinatorService(db: Db) {
  const flags = featureFlagsService(db);
  const msgBus = messageBusService(db);
  const taskGraph = taskGraphService(db);

  /** 코디네이터 모드 활성화 여부 */
  async function isEnabled(companyId: string): Promise<boolean>;

  /** 에이전트가 활성 코디네이터 세션을 보유하는지 확인 */
  async function isCoordinatorAgent(companyId: string, agentId: string): Promise<boolean>;

  /** 코디네이터 세션 시작 (부모 이슈에 연결) */
  async function startCoordination(config: CoordinatorConfig): Promise<CoordinatorSession>;

  /** 위임 계획 실행: 서브이슈 생성 → 워커 할당 → 의존성 설정 → wakeup */
  async function delegate(
    companyId: string,
    parentIssueId: string,
    plan: DelegationPlan,
  ): Promise<WorkerTask[]>;

  /** 워커 완료 콜백: 상태 업데이트 → 전체 완료 시 코디네이터 wakeup */
  async function onWorkerComplete(
    companyId: string,
    issueId: string,
    outcome: "succeeded" | "failed",
  ): Promise<void>;

  /** 코디네이터 세션 상태 조회 */
  async function getStatus(companyId: string, parentIssueId: string): Promise<CoordinatorStatus>;

  /** 코디네이터 시스템 프롬프트 오버레이 빌드 */
  async function buildCoordinatorPrompt(
    companyId: string,
    agentId: string,
    parentIssueId: string,
  ): Promise<string | null>;

  return { isEnabled, isCoordinatorAgent, startCoordination, delegate,
           onWorkerComplete, getStatus, buildCoordinatorPrompt };
}
```

### Heartbeat 통합 (3개 포인트)

**1. `pre:context` 이후 (~line 2194)** — 코디네이터 프롬프트 주입:
```typescript
// Phase 19: Coordinator mode — inject orchestrator prompt
if (await coordinator.isCoordinatorAgent(agent.companyId, agent.id)) {
  const prompt = await coordinator.buildCoordinatorPrompt(agent.companyId, agent.id, issueId);
  if (prompt) context.paperclipCoordinatorPrompt = prompt;
  context.paperclipCoordinatorMode = true;
}
```

**2. `post:run` 이후 (~line 3160)** — 워커 완료 감지:
```typescript
// Phase 19: Worker completion — notify coordinator
if (issueId && outcome) {
  await coordinator.onWorkerComplete(agent.companyId, issueId, outcome);
}
```

**3. `startNextQueuedRunForAgent()` (~line 2121)** — 병렬 워커 수 제한:
```typescript
// Phase 19: Respect coordinator's maxParallelWorkers limit
```

### 위임 전략 (delegationStrategy)

- `round_robin`: `workerAgentIds` 리스트 순환
- `capability_match`: 에이전트 `capabilities` 필드와 태스크 설명 키워드 매칭 (LLM 없음)
- `load_balance`: `worker_tasks` 중 `status="running"` 개수가 가장 적은 에이전트 선택

### REST API

|메서드|경로|설명|
|-|-|-|
|POST|`/api/companies/:companyId/coordinator/sessions`|코디네이터 세션 시작|
|POST|`/api/companies/:companyId/coordinator/sessions/:id/delegate`|위임 계획 제출|
|GET|`/api/companies/:companyId/coordinator/sessions/:id/status`|세션 상태 조회|
|PATCH|`/api/companies/:companyId/coordinator/sessions/:id/cancel`|세션 취소|

### 위험 요소

1. **코디네이터-워커 교착**: 워커가 영원히 미완료 → **완화**: worker_tasks TTL + stale 감지, 자동 취소
2. **heartbeat.ts 비대화**: 이미 4337줄 → **완화**: coordinator.ts에 로직 집중, heartbeat는 3-4개 서비스 메서드 호출만
3. **서브이슈 폭증**: → **완화**: `maxParallelWorkers` (기본 5) + 세션당 총 서브이슈 제한 (기본 20)

**복잡도**: 매우 높 | **예상**: 5-6주

---

## Phase 11: 자율 태스크 자동 할당 ⬅️ Wave 3 두 번째

**목표**: 에이전트가 현재 작업을 완료하고 idle 상태일 때, 미할당 이슈를 자동으로 클레임

**피처 플래그**: `auto_claim` (이미 등록됨)
**전제**: Phase 12 ✅ (태스크 그래프 — blocked 이슈 필터링), Phase 19 (코디네이터 — 스마트 할당)

### Claude Code 참조

* `src/utils/tasks.ts` — `claimTask()` with `checkAgentBusy`, high-water mark ID
* `getAgentStatuses()` — 팀원 가용성 조회

### Paperclip 기존 기반

* `packages/db/src/schema/issues.ts` — `assigneeAgentId`, `executionRunId`, `executionLockedAt`
* `server/src/services/issues.ts` — 이슈 할당 로직, `SELECT ... FOR UPDATE` 실행 잠금 패턴
* `packages/shared/src/constants.ts` — wakeup request에 `claimed` 상태 이미 존재
* `doc/plans/2026-02-20-issue-run-orchestration-plan.md` — 이슈 실행 오케스트레이션 계획

### 신규 생성 파일

|파일|목적|예상 LOC|
|-|-|-|
|`server/src/services/auto-claim.ts`|클레임 정책 + 원자적 클레임 실행|~250|
|`server/src/services/auto-claim.test.ts`|유닛 테스트|~200|

### 수정 파일

|파일|변경 내용|
|-|-|
|`server/src/services/heartbeat.ts`|`post:run` + 타이머 wake에서 auto-claim 호출|
|`server/src/services/issues.ts`|`claimIssueForAgent()` 내부 메서드 추가|
|`server/src/services/index.ts`|`autoClaimService` export 추가|
|`packages/shared/src/constants.ts`|`AutoClaimPriorityOrder` 타입 추가|

### 핵심 서비스 인터페이스

```typescript
export interface AutoClaimPolicy {
  maxConcurrentClaims: number;          // default 1
  claimableStatuses: string[];          // default ["backlog", "todo"]
  priorityOrder: "priority_first" | "created_first" | "dependency_first";
  projectScope: string | null;          // null = 에이전트 접근 가능 모든 프로젝트
  respectDependencies: boolean;         // default true — blocked 이슈 스킵
}

export interface ClaimResult {
  claimed: boolean;
  issueId: string | null;
  reason: string;                       // "claimed" | "no_eligible" | "all_blocked" | "max_reached" | "disabled"
}

export function autoClaimService(db: Db) {
  const flags = featureFlagsService(db);
  const taskGraph = taskGraphService(db);

  /** 플래그 확인 */
  async function isEnabled(companyId: string): Promise<boolean>;

  /** 에이전트의 auto-claim 정책 로드 (agent.runtimeConfig.autoClaim 또는 기본값) */
  async function getPolicy(companyId: string, agentId: string): Promise<AutoClaimPolicy>;

  /** 다음 클레임 후보 찾기 (미할당 + 미차단 + 정책 필터) */
  async function findNextCandidate(
    companyId: string, agentId: string, policy: AutoClaimPolicy,
  ): Promise<ClaimCandidate | null>;

  /** 원자적 클레임: SELECT ... FOR UPDATE → 할당 → 상태 전이 */
  async function claimIssue(
    companyId: string, agentId: string, issueId: string,
  ): Promise<boolean>;

  /** 전체 흐름: 정책 → 후보 → 클레임 → wakeup */
  async function tryAutoClaim(companyId: string, agentId: string): Promise<ClaimResult>;

  return { isEnabled, getPolicy, findNextCandidate, claimIssue, tryAutoClaim };
}
```

### 원자적 클레임 트랜잭션

```typescript
await db.transaction(async (tx) => {
  // 이슈 행 잠금
  const [issue] = await tx.execute(
    sql`SELECT id, assignee_agent_id, status FROM issues
        WHERE id = ${issueId} AND company_id = ${companyId}
        FOR UPDATE`
  );
  // 여전히 클레임 가능한지 검증
  if (!issue || issue.assignee_agent_id || !claimableStatuses.includes(issue.status)) {
    return false;
  }
  // 할당 + 상태 전이
  await tx.update(issues).set({
    assigneeAgentId: agentId,
    status: issue.status === "backlog" ? "todo" : issue.status,
    updatedAt: new Date(),
  }).where(eq(issues.id, issueId));
  return true;
});
```

> heartbeat.ts의 기존 실행 잠금 패턴 (lines 3554-3568)과 동일한 `SELECT ... FOR UPDATE` 방식

### 후보 선택 쿼리 (핵심)

```sql
SELECT i.id, i.priority, i.status, i.created_at
FROM issues i
WHERE i.company_id = :companyId
  AND i.assignee_agent_id IS NULL
  AND i.status IN ('backlog', 'todo')
  -- Phase 12 통합: blocked 이슈 제외
  AND NOT EXISTS (
    SELECT 1 FROM issue_dependencies d
    JOIN issues blocker ON blocker.id = d.depends_on_issue_id
    WHERE d.issue_id = i.id AND d.kind = 'blocks'
      AND blocker.status NOT IN ('done', 'cancelled')
  )
ORDER BY /* priorityOrder에 따라 동적 */
LIMIT 1
```

### Heartbeat 통합 (2개 포인트)

**1. `post:run` 이후 (~line 3167)** — 이슈 완료 후 다음 이슈 클레임:
```typescript
// Phase 11: Auto-claim — agent finished, claim next issue
if (outcome === "succeeded" && issueId) {
  const autoClaim = autoClaimService(db);
  if (await autoClaim.isEnabled(agent.companyId)) {
    const result = await autoClaim.tryAutoClaim(agent.companyId, agent.id);
    if (result.claimed && result.issueId) {
      await requestWakeup({ source: "auto_claim", issueId: result.issueId, ... });
    }
  }
}
```

**2. 타이머 idle wake (~line 3534, KAIROS 체크 이후)** — idle 에이전트도 클레임 시도:
```typescript
// Phase 11: Auto-claim on idle timer wake
if (source === "timer" && !issueId) {
  const autoClaim = autoClaimService(db);
  if (await autoClaim.isEnabled(agent.companyId)) {
    const result = await autoClaim.tryAutoClaim(agent.companyId, agentId);
    if (result.claimed) { /* wakeup for claimed issue */ }
  }
}
```

### 위험 요소

1. **경합 조건**: 두 idle 에이전트가 동시 클레임 → **완화**: `SELECT ... FOR UPDATE`로 하나만 성공, 실패한 쪽은 다음 후보 재시도
2. **능력 불일치**: 에이전트가 처리 못하는 이슈 클레임 → **완화**: `projectScope`로 범위 제한, 향후 capability 매칭 추가
3. **Thundering herd**: 타이머 동시 wake → **완화**: 각 에이전트가 서로 다른 후보 행을 잠금, 위상 정렬 순서로 클레임

**복잡도**: 중 | **예상**: 2주

---

## Phase 22: 워크트리 격리 ⬅️ Wave 3 세 번째

**목표**: 코디네이터 워커 에이전트에 격리된 git worktree 자동 프로비저닝 + 라이프사이클 관리

**피처 플래그**: `worktree_isolation` (이미 등록됨)
**전제**: Phase 19 (코디네이터 워커가 격리 필요)

### Claude Code 참조

* `src/utils/worktree.ts` — `.claude/worktrees/<slug>/`, sparse checkout
* Enter/Exit tools, worktreeCreateHook/worktreeRemoveHook

### Paperclip 기존 기반 (이미 상당히 구축됨)

* `packages/db/src/schema/execution_workspaces.ts` — `providerType="git_worktree"`, `status`, `branchName`, `baseRef`, `cleanupEligibleAt` 필드 이미 존재
* `server/src/services/execution-workspaces.ts` — CRUD + close readiness 체크
* `server/src/services/workspace-runtime.ts` — `realizeExecutionWorkspace()` (line 569-668)에서 워크트리 생성 이미 구현
* `server/src/worktree-config.ts` — 인스턴스 격리 (포트, DB, 스토리지 경로)
* `doc/plans/2026-03-10-workspace-strategy-and-git-worktrees.md` — 상세 전략 계획

### 핵심 인사이트: 새 스키마 불필요

기존 `execution_workspaces` 테이블이 이미 모든 필요 필드를 보유:
- `providerType`: `"git_worktree"` 지원
- `status`: `"active"` / `"idle"` / `"closed"`
- `branchName`, `baseRef`, `providerRef` (워크트리 경로)
- `cleanupEligibleAt`, `cleanupReason`
- `sourceIssueId`: 이슈 연결

유일한 스키마 변경: 풀 쿼리 최적화 인덱스 추가 (마이그레이션으로 처리)

### 신규 생성 파일

|파일|목적|예상 LOC|
|-|-|-|
|`server/src/services/worktree-lifecycle.ts`|워크트리 프로비저닝 + 풀 관리 + 정리|~300|
|`server/src/services/worktree-lifecycle.test.ts`|유닛 테스트|~200|

### 수정 파일

|파일|변경 내용|
|-|-|
|`server/src/services/heartbeat.ts`|워크스페이스 결정 시 워커 워크트리 자동 프로비저닝 + post:run 릴리스|
|`server/src/services/coordinator.ts`|`delegate()` 시 `context.paperclipCoordinatorWorker = true` 설정|
|`server/src/services/execution-workspaces.ts`|`findReusableForProject()` 메서드 추가|
|`server/src/services/index.ts`|`worktreeLifecycleService` export 추가|

### 핵심 서비스 인터페이스

```typescript
export interface WorktreeCleanupPolicy {
  maxIdleMinutes: number;             // default 1440 (24시간)
  maxStaleWorktrees: number;          // default 10 per project
  cleanupOnIssueClose: boolean;       // default true
  preserveUnmergedBranches: boolean;  // default true
}

export function worktreeLifecycleService(db: Db) {
  const flags = featureFlagsService(db);

  /** 플래그 확인 */
  async function isEnabled(companyId: string): Promise<boolean>;

  /**
   * 워커 에이전트의 이슈에 대해 워크트리 프로비저닝.
   * 1) 동일 프로젝트의 idle 워크트리 재사용 시도
   * 2) 없으면 realizeExecutionWorkspace() 래핑으로 신규 생성
   */
  async function provision(req: WorktreeProvisionRequest): Promise<WorktreeProvisionResult>;

  /** 워커 완료 시 워크트리를 "idle"로 전환 (즉시 삭제 아님) */
  async function release(executionWorkspaceId: string): Promise<void>;

  /** 정책 기반 stale 워크트리 정리 (유지보수 잡에서 주기적 호출) */
  async function cleanupStale(companyId: string, policy: WorktreeCleanupPolicy): Promise<number>;

  /** 이슈 터미널 상태 도달 시 정리 예약 */
  async function markForCleanup(companyId: string, issueId: string, reason: string): Promise<void>;

  return { isEnabled, provision, release, cleanupStale, markForCleanup };
}
```

### 워크트리 풀 재사용 전략

1. **풀 검색**: `execution_workspaces`에서 `status='idle'` + 동일 `projectId` + `providerType='git_worktree'` 조회
2. **브랜치 리셋**: 재사용 시 현재 baseRef로 리셋: `git checkout -B <new-branch> <baseRef>`
3. **정리 적격성**: 이슈 done 시 `cleanupEligibleAt` 설정. 기존 `closedAt` + `cleanupEligibleAt` 필드가 이미 지원
4. **안전 검사**: `inspectGitCloseReadiness()` (execution-workspaces.ts:52-178)가 dirty 상태 확인 후 삭제

### Heartbeat 통합 (2개 포인트)

**1. 워크스페이스 결정 (~line 2440-2500)** — 워커에 격리 워크트리 프로비저닝:
```typescript
// Phase 22: Worktree isolation for coordinator workers
if (await worktreeLifecycle.isEnabled(agent.companyId) && context.paperclipCoordinatorWorker) {
  const result = await worktreeLifecycle.provision({
    companyId: agent.companyId, projectId: issue.projectId,
    issueId, agentId: agent.id, baseRef: projectPolicy?.workspaceStrategy?.baseRef,
  });
  effectiveCwd = result.worktreePath;
  executionWorkspaceId = result.executionWorkspaceId;
}
```

**2. `post:run` 이후 (~line 3160)** — 워크트리 릴리스/정리:
```typescript
// Phase 22: Release worktree when worker finishes
if (executionWorkspaceId && await worktreeLifecycle.isEnabled(agent.companyId)) {
  if (outcome === "succeeded" && issueStatus === "done") {
    await worktreeLifecycle.markForCleanup(agent.companyId, issueId, "issue_completed");
  } else {
    await worktreeLifecycle.release(executionWorkspaceId);
  }
}
```

### 위험 요소

1. **디스크 공간**: 다수 병렬 워커 → 다수 체크아웃 → **완화**: `maxStaleWorktrees` 상한 + 정리 정책
2. **브랜치 충돌**: 두 워커가 동일 브랜치 생성 시도 → **완화**: 브랜치명에 issue identifier 포함 (이슈별 유니크)
3. **dirty 워크트리 삭제**: 커밋되지 않은 변경 손실 → **완화**: `preserveUnmergedBranches` + `inspectGitCloseReadiness()` 안전 검사
4. **Windows 경로 길이**: → **완화**: 짧은 slug 사용, 기존 `sanitizeBranchName` 활용

**복잡도**: 중 | **예상**: 2주

\---

## Phase 13: 선언적 워크플로우

**목표**: YAML로 멀티 에이전트 파이프라인 정의/재사용

### Paperclip 기존 기반

* `server/src/services/routines.ts` — cron 루틴 (단일 에이전트)
* `packages/db/src/schema/routines.ts` — routines + routineTriggers

### 수정/생성 파일

|파일|작업|
|-|-|
|`server/src/services/workflow-engine.ts`|**신규** — YAML 파서 + 실행기|
|`packages/db/src/schema/workflows.ts`|**신규** — 워크플로우 정의|
|`packages/db/src/schema/workflow\_runs.ts`|**신규** — 실행 인스턴스|

**복잡도**: 고 | **예상**: 4주 | **전제**: Phase 12

\---

## Phase 19: 코디네이터 모드

> ⬆️ Wave 3 상세 구현 계획 섹션 참조

\---

## Phase 16: MCP 동적 도구 등록

### Paperclip 기존 기반

* `server/src/services/plugin-tool-registry.ts` — 도구 레지스트리
* `server/src/services/plugin-tool-dispatcher.ts` — 도구 디스패처

### 수정/생성 파일

|파일|작업|
|-|-|
|`server/src/services/mcp-discovery.ts`|**신규** — MCP 서버 발견/등록|
|`server/src/services/mcp-session.ts`|**신규** — 세션 관리|

**복잡도**: 중 | **예상**: 3주

\---

## Phase 20: ULTRAPLAN 원격 계획 오프로드 \[신규]

**목표**: 복잡한 계획을 원격 컨테이너에 오프로드

### Claude Code 참조

* `src/utils/ultraplan/ccrSession.ts` — Cloud Container Runtime
* `ExitPlanModeScanner` — 상태 머신: running → needs\_input → plan\_ready → approved/rejected
* Poll loop: 3초 간격, 30분 타임아웃

### 수정/생성 파일

|파일|작업|
|-|-|
|`server/src/services/remote-planner.ts`|**신규** — 원격 오프로드 엔진|
|`server/src/services/plan-scanner.ts`|**신규** — 계획 상태 머신|

### 핵심 설계

```typescript
type PlanState = "idle" | "planning" | "needs\_input" | "plan\_ready" | "approved" | "rejected";

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

\---

## Phase 21: 권한 위임 프로토콜 \[신규]

### Claude Code 참조

* `src/utils/swarm/permissionSync.ts` — Worker → Leader → User → Worker 흐름
* `SwarmPermissionRequest` — pending/approved/rejected

### Paperclip 기존 기반

* `server/src/services/approvals.ts` — 승인 시스템
* `server/src/services/agent-permissions.ts` — 권한 서비스

### 수정/생성 파일

|파일|작업|
|-|-|
|`server/src/services/permission-delegation.ts`|**신규**|
|`server/src/services/approvals.ts`|위임 승인 타입 추가|

**복잡도**: 중 | **예상**: 2-3주 | **전제**: Phase 18 + 19

\---

## Phase 22: 워크트리 격리

> ⬆️ Wave 3 상세 구현 계획 섹션 참조

\---

## 실행 순서 총괄표 (시너지 기반)

|Wave|순서|Phase|이름|기둥|임팩트|복잡도|전제|상태|
|-|-|-|-|-|-|-|-|-|
|**W1**|1|**9**|3계층 컨텍스트 압축|A|🟢 높|중-고|Phase 1-7|✅ `64f2d93b`|
|**W1**|1|**17**|피처 플래그|공통|🟢 기반|저|없음|✅ `a71cad0d`|
|**W1**|1|**14**|스트리밍 실행 피드백|공통|🟢 높|중|없음|✅ `a7085908`|
|**W2**|2|**18**|메시지 버스|B|🟢 높|고|W1|✅ `ad8c0e22`|
|**W2**|2|**12**|태스크 그래프 의존성|B|🔵 중|중|W1|✅ `e4b64fb7`|
|**W2**|3|**15**|DreamTask / KAIROS|A|🔵 중|고|Phase 9|✅ `57432948`|
|**W3**|4|**19**|코디네이터 모드|C|🟢 높|매우높|Phase 18|⬅️ 착수|
|**W3**|5|**11**|자율 태스크 클레임|B+C|🔵 중|중|Phase 12+19|⬜ Phase 19 후|
|**W3**|5|**22**|워크트리 격리|C|🔵 중|중|Phase 19|⬜ Phase 19 후|
|**W4**|6|**21**|권한 위임 프로토콜|C|🔵 중|중|Phase 18+19|⬜|
|**W4**|6|**13**|선언적 워크플로우|C|🔵 중|고|Phase 12+19|⬜|
|**W4**|6|**16**|MCP 동적 도구|공통|🟡 낮|중|없음|⬜|
|**W5**|7|**20**|ULTRAPLAN 원격 계획|C|🟡 중|매우높|Phase 19|⬜|

\---

## Claude Code → Paperclip 포팅 매핑

|Claude Code 소스|Paperclip 대응|포팅 방식|Phase|
|-|-|-|-|
|`services/compact/`|`context-compressor.ts` + compaction-tiers|확장|9|
|`utils/tasks.ts` (claimTask)|`auto-claim.ts` + issues 테이블|적응|11|
|`utils/tasks.ts` (blocking graph)|`issue\_dependencies` + `task-graph.ts`|적응|12|
|`utils/messageQueueManager.ts`|`message-bus.ts` + `agent\_messages`|적응|18|
|`coordinator/coordinatorMode.ts`|`coordinator.ts` + `worker-spawn.ts`|적응|19|
|`utils/ultraplan/ccrSession.ts`|`remote-planner.ts` + `plan-scanner.ts`|적응|20|
|`services/autoDream/`|`dream-task.ts` + `agent\_memories`|적응|15|
|`utils/swarm/permissionSync.ts`|`permission-delegation.ts`|적응|21|
|`utils/worktree.ts`|`execution-workspaces.ts` 확장|확장|22|
|GrowthBook feature gates|`feature-flags.ts`|새로 구현|17|

\---

## 위험 요소 및 완화

1. **heartbeat.ts 비대화 (4228줄)**: Phase 9에서 context-compressor 분리를 시작으로, 점진적 모듈화
2. **메시지 버스 지연**: PostgreSQL `LISTEN/NOTIFY` 활용, 폴링 대신 이벤트 기반
3. **코디네이터 비용 폭발**: Phase 17 피처 플래그 + `on:budget-alert` 훅으로 안전망
4. **Dream 가치 불확실**: 피처 플래그 뒤에 배치, A/B 테스트 후 확대

\---

## 검증 전략

### ✅ Wave 1-2 (검증 완료)
1. **Phase 9**: 세션 회전 빈도 50%+ 감소 확인 ✅
2. **Phase 17**: 플래그 토글 시 기능 활성화/비활성화 확인 ✅
3. **Phase 14**: 런 진행 이벤트 실시간 수신 확인 ✅
4. **Phase 18**: 에이전트 간 메시지 왕복 지연 < 500ms ✅
5. **Phase 12**: 순환 감지 + 위상 정렬 정확성 ✅
6. **Phase 15**: KAIROS 다이제스트 생성 + 컨텍스트 주입 ✅

### ⬅️ Wave 3 (현재 검증 대상)
7. **Phase 19**: 코디네이터가 3+ 워커를 병렬 관리하는 E2E 시나리오
8. **Phase 11**: 에이전트 idle 시간 측정 → auto-claim 후 30%+ 감소
9. **Phase 22**: 병렬 워커가 워크트리 격리 상태에서 코드 충돌 없이 작업

### 공통
10. **모든 Phase**: `pnpm typecheck && pnpm test && pnpm lint` 통과 필수

