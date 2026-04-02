# Paperclip 종합 업그레이드 계획: Phase 9–22

## Context

Paperclip은 멀티 에이전트 오케스트레이션 플랫폼으로, Phase 1-7(토큰 최적화), Phase 8(훅 레지스트리), Phase 10(재시도/백오프), UI 한글화가 완료된 상태이다.

이 계획은 **두 가지 소스**를 통합한다:

1. **기존 Phase 9-17 로드맵** (iridescent-drifting-whale.md)
2. **Claude Code 소스코드에서 발견된 패턴** — Coordinator Mode, AutoDream(KAIROS), ULTRAPLAN, Message Bus, Task Graph, Forked Agent, Swarm Permission Sync

Claude Code 참조 경로: `D:\Develop\AI\claude-code-source-code\src\`
Paperclip 경로: `D:\Develop\AI\paperclip\`

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

### ✅ Wave 3 완료 — 오케스트레이션

|Phase|이름|커밋|핵심 파일|요약|
|-|-|-|-|-|
|19|코디네이터 모드|`16e83110`|`coordinator.ts` + test, `coordinator_sessions` + `worker_tasks` 스키마, routes|코디네이터→워커 위임 엔진, round_robin/load_balance/capability_match 전략, 메시지 버스+태스크 그래프 통합|
|11|자율 태스크 클레임|`ac5c96e4`|`auto-claim.ts` + test|idle 에이전트 자동 이슈 클레임, SELECT FOR UPDATE 원자적 경합 해결, 의존성 필터링 연동|
|22|워크트리 격리|`9c6eeb31`|`worktree-lifecycle.ts` + test|워커 전용 git worktree 풀 관리, provision/release/cleanupStale 라이프사이클, 기존 execution_workspaces 재활용|

### ✅ Wave 4 완료 — 고급 자동화

|Phase|이름|커밋|핵심 파일|요약|
|-|-|-|-|-|
|21|권한 위임 프로토콜|`f3039a2c`|`permission-delegation.ts` + test, `permission_requests` 스키마, routes|Worker→Coordinator→User 에스컬레이션 체계, 세션 권한 승격, 8가지 세분화 권한 타입, 메시지 버스 연동|
|16|MCP 동적 도구|`c6733fb1`|`mcp-discovery.ts`, `mcp-session.ts`, `mcp_servers` 스키마, routes, AgentDetail MCP탭|MCP 서버 발견/연결/도구 등록, HTTP/SSE/Stdio 트랜스포트, plugin-tool-registry 네임스페이스 통합, 에이전트별 UI|
|13|선언적 워크플로우|`684bc40b`|`workflow-engine.ts` + test, `workflow_steps` 스키마|YAML/JSON 워크플로우 파서, DAG 순환 검사, 코디네이터 세션 자동 생성, 스텝별 조건부 실행(on_success/on_failure/always)|

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

═══ Wave 3: 오케스트레이션 ✅ 완료 ═════════════════════════════
  Phase 19 (코디네이터 모드)         ✅ 16e83110
  Phase 11 (자율 태스크 클레임)      ✅ ac5c96e4
  Phase 22 (워크트리 격리)           ✅ 9c6eeb31

═══ Wave 4: 고급 자동화 ✅ 완료 ══════════════════════════════
  Phase 21 (권한 위임)               ✅ f3039a2c
  Phase 16 (MCP 동적 도구)          ✅ c6733fb1
  Phase 13 (선언적 워크플로우)       ✅ 684bc40b

═══ Wave 5: 최종 고도화 ✅ 완료 ═══════════════════════════════
  Phase 20 (ULTRAPLAN 원격 계획)     ✅ 51f39e2a
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

## ═══ Wave 4: 고급 자동화 ✅ 완료 — 상세 구현 계획 (아카이브) ═══

### Wave 4 우선순위 및 의존성

```
Phase 21 (권한 위임 프로토콜)  ←── 반드시 먼저 (코디네이터 워커 안전 운영의 필수 전제)
    │
    ├──→ Phase 16 (MCP 동적 도구)      ←── Phase 21 후 (권한 체계 위에 도구 확장)
    │
    └──→ Phase 13 (선언적 워크플로우)    ←── Phase 21 + 16 후 (전체 파이프라인 정의)
```

**우선순위 근거:**
1. **Phase 21 최우선** — Wave 3에서 코디네이터 워커가 격리 워크트리에서 실행되지만, 위험한 도구(Bash, 파일 삭제 등)에 대한 권한 제어가 없음. 워커가 안전하게 운영되려면 권한 위임이 **즉시 필요**. Claude Code의 `swarm/permissionSync.ts`가 검증된 Worker→Leader→User 패턴을 제공.
2. **Phase 16 두 번째** — 워커에게 동적 도구(외부 API, DB 쿼리 등)를 부여하려면 먼저 권한 체계가 있어야 함. 기존 `plugin-tool-registry.ts`가 도구 등록/디스패치 인프라를 제공하므로 MCP 프로토콜 어댑터만 추가하면 됨.
3. **Phase 13 세 번째** — 선언적 워크플로우는 코디네이터(✅) + 태스크 그래프(✅) + 권한 위임 + 도구 확장이 모두 갖춰진 상태에서 이들을 **선언적으로 조합**하는 상위 레이어. 기존 `routines.ts`의 cron/webhook 시스템을 멀티에이전트 파이프라인으로 확장.

---

## Phase 21: 권한 위임 프로토콜 ⬅️ Wave 4 첫 번째

**목표**: 코디네이터 워커 에이전트가 위험한 도구 사용 시 코디네이터(리더)를 거쳐 사용자 승인을 받는 안전한 권한 에스컬레이션 체계 구축

**피처 플래그**: `permission_delegation` (신규 등록)
**전제**: Phase 18 ✅ (메시지 버스), Phase 19 ✅ (코디네이터 모드)

### 아키텍처 결정

Claude Code는 파일 시스템 기반 `permissionSync.ts`로 Worker→Leader→User 흐름을 구현한다. Paperclip은 DB 영속 엔티티이므로 다음과 같이 적응:

- **파일 시스템 → DB + 메시지 버스**: Claude Code의 `~/.claude/teams/{teamName}/permissions/pending/` 대신 `permission_requests` 테이블 + Phase 18 메시지 버스 활용
- **폴링 → 이벤트**: Claude Code의 `pollForResponse()`를 메시지 버스의 `direct` 모드로 대체 (실시간 알림)
- **기존 `approvals.ts` 확장**: 승인 시스템에 `permission_delegation` 타입 추가하여 UI/라우트 재사용

### Claude Code 참조

* `src/utils/swarm/permissionSync.ts` (929줄) — 핵심 권한 동기화 엔진
  - `SwarmPermissionRequest` — 워커→리더 요청 구조체 (toolName, toolUseId, description, input, permissionSuggestions)
  - `PermissionResolution` — 리더→워커 응답 (approved/rejected + feedback + updatedInput + permissionUpdates)
  - `pending/` → `resolved/` 디렉토리 이동으로 상태 전이
  - `cleanupOldResolutions()` — 1시간 TTL 자동 정리
* `src/utils/swarm/leaderPermissionBridge.ts` — 리더 측 ToolUseConfirm 다이얼로그 연동
* `PermissionUpdateSchema.ts` — addRules/replaceRules/removeRules/setMode/addDirectories 5가지 업데이트 타입

### Paperclip 기존 기반

* `server/src/services/approvals.ts` — 승인 워크플로우 (pending→approved/rejected, 코멘트, 이슈 연결)
* `server/src/services/agent-permissions.ts` — 현재 `canCreateAgents` 단일 권한만 존재 (10% 구현)
* `server/src/services/message-bus.ts` — direct 모드로 워커↔코디네이터 실시간 메시지 전달 (Phase 18 ✅)
* `packages/db/src/schema/approvals.ts` — 승인 테이블 (type, payload, status 필드로 확장 용이)

### 신규 생성 파일

|파일|목적|예상 LOC|
|-|-|-|
|`server/src/services/permission-delegation.ts`|권한 위임 엔진 (요청/해결/정책/에스컬레이션)|~350|
|`server/src/services/permission-delegation.test.ts`|유닛 테스트|~250|
|`packages/db/src/schema/permission_requests.ts`|권한 요청 테이블|~60|

### 수정 파일

|파일|변경 내용|
|-|-|
|`packages/db/src/schema/index.ts`|`permissionRequests` export 추가|
|`server/src/services/index.ts`|`permissionDelegationService` export 추가|
|`server/src/services/agent-permissions.ts`|세분화된 권한 타입 확장 (canUseBash, canEditFiles, canDeleteFiles, canAccessNetwork 등)|
|`server/src/services/heartbeat.ts`|2개 통합 포인트 (아래 상세)|
|`server/src/services/coordinator.ts`|워커 스폰 시 권한 프로파일 주입|
|`server/src/routes/coordinator.ts`|권한 요청 조회/승인/거부 엔드포인트 추가|
|`packages/shared/src/constants.ts`|`PermissionRequestStatus`, `PermissionType`, `DelegationScope` 타입 추가|
|`server/src/services/feature-flags.ts`|`permission_delegation` 플래그 등록|

### DB 스키마

**`permission_requests`**:
```typescript
{
  id: uuid PK,
  companyId: uuid FK → companies,
  coordinatorSessionId: uuid FK → coordinator_sessions,
  workerAgentId: uuid FK → agents,              // 요청자 (워커)
  resolverAgentId: uuid FK → agents (nullable),  // 해결자 (코디네이터)
  resolverUserId: uuid FK → users (nullable),    // 최종 해결자 (사용자)

  // 요청 내용 (Claude Code SwarmPermissionRequest 적응)
  toolName: text,                // "Bash", "Edit", "Write" 등
  description: text,             // 사람이 읽을 수 있는 설명
  toolInput: jsonb,              // 직렬화된 도구 입력
  permissionSuggestions: jsonb,  // 제안된 권한 규칙

  // 해결 결과
  status: text ("pending" | "approved" | "rejected" | "expired"),
  feedback: text (nullable),           // 거부 사유
  updatedInput: jsonb (nullable),      // 수정된 입력 (리더가 변경 가능)
  permissionUpdates: jsonb (nullable), // "항상 허용" 규칙 적용

  // 타임스탬프
  createdAt: timestamp,
  resolvedAt: timestamp (nullable),
  expiresAt: timestamp,               // TTL (기본 30분)
}
// 인덱스: (companyId, coordinatorSessionId, status), (companyId, workerAgentId, status)
```

### 세분화된 권한 모델

```typescript
/** Claude Code PermissionUpdate 패턴을 DB 영속 모델로 적응 */
export type PermissionType =
  | "bash_execute"        // 셸 명령 실행
  | "file_write"          // 파일 쓰기/생성
  | "file_delete"         // 파일 삭제
  | "network_access"      // 외부 네트워크 요청
  | "git_push"            // git push 실행
  | "tool_install"        // 도구/패키지 설치
  | "db_write"            // 데이터베이스 쓰기
  | "mcp_tool_use";       // MCP 도구 사용 (Phase 16 연동)

export type DelegationScope =
  | "once"                // 이번 요청만
  | "session"             // 현재 코디네이터 세션 동안
  | "permanent";          // 영구적 (agent_permissions에 저장)

export interface PermissionProfile {
  /** 사전 승인된 권한 (에스컬레이션 없이 즉시 허용) */
  preApproved: PermissionType[];
  /** 명시적 차단 (에스컬레이션 불가) */
  denied: PermissionType[];
  /** 에스컬레이션 필요 (기본값 — preApproved/denied에 없는 모든 것) */
  requiresEscalation: PermissionType[];
}
```

### 핵심 서비스 인터페이스

```typescript
export function permissionDelegationService(db: Db) {
  const flags = featureFlagsService(db);
  const msgBus = messageBusService(db);

  /** 플래그 확인 */
  async function isEnabled(companyId: string): Promise<boolean>;

  /** 워커의 권한 프로파일 로드 (agent.runtimeConfig.permissionProfile 또는 기본값) */
  async function getProfile(companyId: string, agentId: string): Promise<PermissionProfile>;

  /** 도구 사용 전 권한 검사 — 즉시 허용/차단/에스컬레이션 필요 판단 */
  async function checkPermission(
    companyId: string,
    agentId: string,
    toolName: string,
    sessionId: string,
  ): Promise<"allowed" | "denied" | "needs_escalation">;

  /** 워커→코디네이터 권한 요청 생성 + 메시지 버스로 알림 */
  async function requestPermission(req: PermissionRequestInput): Promise<PermissionRequest>;

  /** 코디네이터/사용자가 권한 요청 해결 + 메시지 버스로 워커 알림 */
  async function resolvePermission(
    requestId: string,
    resolution: PermissionResolution,
  ): Promise<void>;

  /** 워커 측: 권한 요청 결과 대기 (메시지 버스 구독) */
  async function awaitResolution(
    companyId: string,
    agentId: string,
    requestId: string,
    timeoutMs?: number,  // 기본 30분 (Claude Code 동일)
  ): Promise<PermissionResolution>;

  /** 세션 권한 승격: "이번 세션 동안 항상 허용" 규칙 적용 */
  async function applySessionGrant(
    companyId: string,
    agentId: string,
    sessionId: string,
    permissionType: PermissionType,
  ): Promise<void>;

  /** 만료된 요청 정리 (유지보수 잡에서 호출) */
  async function cleanupExpired(companyId: string): Promise<number>;

  return { isEnabled, getProfile, checkPermission, requestPermission,
           resolvePermission, awaitResolution, applySessionGrant, cleanupExpired };
}
```

### 권한 에스컬레이션 흐름 (Claude Code Worker→Leader→User 적응)

```
┌─────────┐     ①요청      ┌──────────────┐    ②에스컬레이션   ┌──────┐
│  워커    │ ──────────────→│ 코디네이터   │ ───────────────→ │ 사용자│
│ (Worker) │               │  (Leader)     │                  │(User) │
│          │    ⑤결과       │              │    ③승인/거부     │       │
│          │ ←──────────── │              │ ←──────────────  │       │
└─────────┘               └──────────────┘                  └──────┘
                                │ ④세션 권한 승격 (선택)
                                │ "이번 세션 동안 항상 허용"
                                ↓
                          permission_requests
                          (status: approved + scope: session)
```

1. **워커 도구 호출 전**: `checkPermission()` → preApproved면 즉시 진행, denied면 즉시 차단
2. **needs_escalation**: `requestPermission()` → `permission_requests` 삽입 + 메시지 버스 `direct` 모드로 코디네이터 알림
3. **코디네이터 판단**: 자동 승인 규칙 확인 → 없으면 사용자에게 에스컬레이션 (approvals 시스템 활용)
4. **해결**: `resolvePermission()` → 상태 업데이트 + 메시지 버스로 워커 알림
5. **세션 승격**: scope="session"이면 `applySessionGrant()` → 이후 동일 도구는 자동 허용

### Heartbeat 통합 (2개 포인트)

**1. 도구 실행 전 (~어댑터 execute 직전)** — 워커 도구 권한 게이트:
```typescript
// Phase 21: Permission delegation — check before tool execution
if (context.paperclipCoordinatorWorker && await permissionDelegation.isEnabled(agent.companyId)) {
  const check = await permissionDelegation.checkPermission(
    agent.companyId, agent.id, toolName, coordinatorSessionId,
  );
  if (check === "denied") throw new ToolPermissionDeniedError(toolName);
  if (check === "needs_escalation") {
    const req = await permissionDelegation.requestPermission({ ... });
    const resolution = await permissionDelegation.awaitResolution(
      agent.companyId, agent.id, req.id,
    );
    if (resolution.decision === "rejected") throw new ToolPermissionDeniedError(toolName, resolution.feedback);
    if (resolution.permissionUpdates) await permissionDelegation.applySessionGrant(...);
  }
}
```

**2. 코디네이터 wake 시 (~코디네이터 컨텍스트 빌드)** — 대기 중인 권한 요청 주입:
```typescript
// Phase 21: Inject pending permission requests into coordinator context
const pendingRequests = await permissionDelegation.getPendingForSession(
  agent.companyId, coordinatorSessionId,
);
if (pendingRequests.length > 0) {
  context.paperclipPendingPermissions = pendingRequests;
}
```

### 위험 요소

1. **권한 요청 타임아웃**: 워커가 무한 대기 → **완화**: 30분 TTL + `expiresAt` 필드, 만료 시 자동 거부
2. **권한 폭주**: 워커마다 매 도구 호출에 에스컬레이션 → **완화**: `scope="session"` 승격으로 반복 요청 제거, 코디네이터 자동 승인 규칙
3. **코디네이터 부재**: 코디네이터 에이전트가 비활성 → **완화**: 사용자에게 직접 에스컬레이션 (approvals 시스템 폴백)
4. **보안 우회**: 워커가 권한 체크 없이 도구 직접 호출 → **완화**: heartbeat 레벨에서 게이트하므로 우회 불가

**복잡도**: 중-고 | **예상**: 3주

---

## Phase 16: MCP 동적 도구 등록 ⬅️ Wave 4 두 번째

**목표**: 코디네이터 워커 에이전트에 MCP(Model Context Protocol) 서버 발견/연결/도구 동적 등록 기능 부여

**피처 플래그**: `mcp_dynamic_tools` (신규 등록)
**전제**: Phase 21 (권한 체계 — MCP 도구 실행 권한 관리), Phase 19 ✅ (코디네이터)

### 아키텍처 결정

Claude Code는 `services/mcp/client.ts`에서 Stdio/SSE/HTTP/WebSocket 4가지 트랜스포트로 MCP 서버에 연결한다. Paperclip은 서버사이드 오케스트레이터이므로:

- **Stdio + SSE 우선**: 로컬 MCP 서버(Stdio)와 원격 MCP 서버(SSE/HTTP) 양쪽 지원
- **기존 Plugin Tool 인프라 재활용**: `plugin-tool-registry.ts`의 네임스페이스 도구 등록 + `plugin-tool-dispatcher.ts`의 실행 라우팅을 MCP 도구에도 적용
- **에이전트별 MCP 구성**: Claude Code의 `initializeAgentMcpServers()`처럼 에이전트/프로젝트별 MCP 서버 설정 지원
- **Phase 21 연동**: MCP 도구 실행 시 `mcp_tool_use` 권한 타입으로 권한 위임 체계 통과

### Claude Code 참조

* `src/services/mcp/client.ts` (1000+ 줄) — MCP 클라이언트 라이프사이클
  - `connectToServer(name, config)` — 트랜스포트별 연결 (메모이제이션)
  - `fetchToolsForClient(client)` — `listTools()` RPC로 도구 발견
  - 재연결: MAX_RECONNECT_ATTEMPTS=5, 지수 백오프 (1s→30s)
  - 세션 만료 감지: HTTP 404 + JSON-RPC -32001 → 캐시 클리어 + 재연결
* `src/services/mcp/types.ts` — `McpStdioServerConfig`, `McpSSEServerConfig`, `McpHTTPServerConfig`, `ScopedMcpServerConfig`
* `src/services/mcp/config.ts` — 다계층 설정 로딩 (user/project/enterprise/dynamic/managed)
* `src/tools/MCPTool/MCPTool.ts` — MCP 도구를 Claude API 도구로 래핑 (inputSchema passthrough)
* `src/services/mcp/useManageMCPConnections.ts` — 연결 라이프사이클 + 자동 재연결

### Paperclip 기존 기반

* `server/src/services/plugin-tool-registry.ts` — 도구 레지스트리 (RegisteredTool, 네임스페이스 관리, executeTool)
* `server/src/services/plugin-tool-dispatcher.ts` — 디스패처 (AgentToolDescriptor, 플러그인→도구 라우팅)
* `server/src/services/plugin-worker-manager.ts` — 플러그인 워커 프로세스 관리
* 기존 네임스페이스 패턴: `"pluginId:toolName"` (MCP 서버에도 동일 적용 가능)

### 신규 생성 파일

|파일|목적|예상 LOC|
|-|-|-|
|`server/src/services/mcp-discovery.ts`|MCP 서버 발견 + 연결 + 도구 목록 수집|~350|
|`server/src/services/mcp-session.ts`|MCP 세션 관리 (연결 풀, 재연결, 헬스체크)|~250|
|`server/src/services/mcp-discovery.test.ts`|유닛 테스트|~200|
|`packages/db/src/schema/mcp_servers.ts`|MCP 서버 등록 테이블|~50|

### 수정 파일

|파일|변경 내용|
|-|-|
|`packages/db/src/schema/index.ts`|`mcpServers` export 추가|
|`server/src/services/index.ts`|`mcpDiscoveryService`, `mcpSessionService` export 추가|
|`server/src/services/plugin-tool-registry.ts`|MCP 도구를 RegisteredTool로 변환하는 어댑터 추가|
|`server/src/services/plugin-tool-dispatcher.ts`|MCP 도구 실행 라우트 추가 (플러그인과 동일 인터페이스)|
|`server/src/services/heartbeat.ts`|1개 통합 포인트 (워커 MCP 도구 주입)|
|`server/src/services/coordinator.ts`|`delegate()` 시 워커별 MCP 서버 목록 전달|
|`server/src/routes/coordinator.ts`|MCP 서버 CRUD 엔드포인트 추가|
|`server/src/services/feature-flags.ts`|`mcp_dynamic_tools` 플래그 등록|

### DB 스키마

**`mcp_servers`**:
```typescript
{
  id: uuid PK,
  companyId: uuid FK → companies,
  name: text,                          // "github-tools", "slack-connector"
  displayName: text,
  scope: text ("company" | "project" | "agent"),
  scopeId: uuid (nullable),           // projectId 또는 agentId

  // 연결 설정 (Claude Code McpServerConfig 적응)
  transportType: text ("stdio" | "sse" | "http"),
  config: jsonb,                       // { command, args, env } 또는 { url, headers }

  // 상태
  status: text ("active" | "disabled" | "error"),
  lastConnectedAt: timestamp (nullable),
  lastError: text (nullable),

  createdAt: timestamp,
  updatedAt: timestamp,
}
// 인덱스: (companyId, scope, scopeId), (companyId, status)
```

### 핵심 서비스 인터페이스

```typescript
export function mcpDiscoveryService(db: Db) {
  const flags = featureFlagsService(db);
  const registry = pluginToolRegistry;

  /** 플래그 확인 */
  async function isEnabled(companyId: string): Promise<boolean>;

  /**
   * MCP 서버 등록 — DB에 저장 + 연결 시도 + 도구 발견
   * Claude Code의 connectToServer() + fetchToolsForClient() 적응
   */
  async function registerServer(config: McpServerRegistration): Promise<McpServerRecord>;

  /**
   * 서버 연결 + 도구 목록 수집 → plugin-tool-registry에 등록
   * 네임스페이스: "mcp.{serverName}:{toolName}"
   */
  async function connectAndDiscoverTools(serverId: string): Promise<DiscoveredTool[]>;

  /** 에이전트에 사용 가능한 MCP 도구 목록 반환 (scope 필터링) */
  async function listToolsForAgent(
    companyId: string,
    agentId: string,
    projectId?: string,
  ): Promise<AgentToolDescriptor[]>;

  /** MCP 도구 실행 — plugin-tool-dispatcher를 통해 라우팅 */
  async function executeTool(
    namespacedName: string,
    parameters: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult>;

  /** 서버 비활성화 — 연결 해제 + 도구 등록 해제 */
  async function disableServer(serverId: string): Promise<void>;

  return { isEnabled, registerServer, connectAndDiscoverTools,
           listToolsForAgent, executeTool, disableServer };
}

export function mcpSessionService(db: Db) {
  /** 연결 풀 관리 (Claude Code의 메모이제이션 패턴 적응) */
  async function getOrCreateConnection(serverId: string): Promise<McpConnection>;

  /** 헬스체크 — 연결 상태 확인 + 자동 재연결 */
  async function healthCheck(serverId: string): Promise<HealthStatus>;

  /**
   * 자동 재연결 (Claude Code 패턴)
   * MAX_RECONNECT_ATTEMPTS=5, 지수 백오프 1s→30s
   */
  async function reconnect(serverId: string): Promise<boolean>;

  /** 세션 만료 감지 + 복구 (Claude Code의 isMcpSessionExpiredError 적응) */
  async function handleSessionExpiry(serverId: string, error: Error): Promise<void>;

  /** 전체 연결 정리 (서버 종료 시) */
  async function teardownAll(): Promise<void>;

  return { getOrCreateConnection, healthCheck, reconnect, handleSessionExpiry, teardownAll };
}
```

### MCP 도구 → Plugin Tool 브릿지

```typescript
/** Claude Code MCPTool.ts 패턴 — MCP 도구를 기존 RegisteredTool 인터페이스로 변환 */
function mcpToolToRegisteredTool(serverName: string, mcpTool: McpListToolsResult): RegisteredTool {
  return {
    pluginId: `mcp.${serverName}`,
    pluginDbId: serverId,
    name: mcpTool.name,
    namespacedName: `mcp.${serverName}:${mcpTool.name}`,
    displayName: mcpTool.name,
    description: mcpTool.description ?? "",
    parametersSchema: mcpTool.inputSchema ?? {},  // passthrough (Claude Code 동일)
  };
}
```

### Heartbeat 통합 (1개 포인트)

**워커 컨텍스트 빌드 시** — MCP 도구 목록 주입:
```typescript
// Phase 16: MCP dynamic tools — inject available tools for worker
if (await mcpDiscovery.isEnabled(agent.companyId) && context.paperclipCoordinatorWorker) {
  const mcpTools = await mcpDiscovery.listToolsForAgent(
    agent.companyId, agent.id, issue?.projectId,
  );
  context.paperclipAvailableTools = [
    ...(context.paperclipAvailableTools ?? []),
    ...mcpTools,
  ];
}
```

### 위험 요소

1. **MCP 서버 불안정**: 외부 서버 다운/타임아웃 → **완화**: 헬스체크 + 5회 재연결 + circuit breaker 패턴
2. **도구 스키마 불일치**: MCP 서버가 잘못된 스키마 반환 → **완화**: passthrough (Claude Code 동일) + 런타임 에러 캐치
3. **보안 위험**: 악의적 MCP 서버 등록 → **완화**: Phase 21 권한 체계 + company scope 제한 + admin만 등록 가능
4. **리소스 누수**: MCP 연결 누적 → **완화**: 연결 풀 + `teardownAll()` + idle 타임아웃

**복잡도**: 중 | **예상**: 3주

---

## Phase 13: 선언적 워크플로우 ⬅️ Wave 4 세 번째

**목표**: 기존 Routines 시스템을 멀티에이전트 파이프라인으로 확장하여, YAML/JSON으로 코디네이터 워크플로우를 선언적으로 정의/재사용

**피처 플래그**: `declarative_workflows` (신규 등록)
**전제**: Phase 12 ✅ (태스크 그래프), Phase 19 ✅ (코디네이터), Phase 21 (권한 위임)

### 아키텍처 결정

Claude Code는 `skills/bundled/batch.ts`에서 프롬프트 기반 3-Phase 워크플로우(Plan→Spawn→Track)를 구현한다. Paperclip은 기존 `routines.ts`가 cron/webhook 기반 단일 에이전트 실행을 이미 지원하므로:

- **Routines 확장**: 기존 `routines` + `routineTriggers` + `routineRuns` 테이블/서비스를 재활용
- **멀티스텝 파이프라인**: `workflow_steps` 테이블 추가로 순차/병렬/조건부 스텝 정의
- **코디네이터 통합**: 워크플로우 실행 시 코디네이터 세션 자동 생성 → 각 스텝을 워커 태스크로 위임
- **태스크 그래프 활용**: 스텝 간 의존성을 `issue_dependencies`로 표현 → 위상 정렬로 실행 순서 결정

### Claude Code 참조

* `src/skills/bundled/batch.ts` (125줄) — 3-Phase 병렬 오케스트레이션
  - Phase 1: Plan Mode에서 5-30 작업 단위 분해
  - Phase 2: 각 단위를 `isolation: "worktree"` + `run_in_background: true`로 에이전트 스폰
  - Phase 3: 상태 테이블 렌더링 + PR URL 수집
  - 핵심 원칙: 각 작업 단위는 **독립 구현/머지 가능** (형제 PR 의존 없음)
* Worker Instructions 패턴: simplify → test → commit → push → report

### Paperclip 기존 기반

* `server/src/services/routines.ts` — 루틴 CRUD + 실행 + cron/webhook 트리거
  - `concurrencyPolicy`: coalesce_if_active / queue_if_active / always_run
  - `catchUpPolicy`: skip_missed / coalesce_missed / run_all
  - `routineRuns`: 실행 추적 (received→queued→running→completed/failed)
* `packages/db/src/schema/routines.ts` — routines + routineTriggers + routineRuns 테이블
* `server/src/services/coordinator.ts` — 코디네이터 세션 + 워커 태스크 위임 (Phase 19 ✅)
* `server/src/services/task-graph.ts` — 의존성 그래프 + 위상 정렬 (Phase 12 ✅)

### 신규 생성 파일

|파일|목적|예상 LOC|
|-|-|-|
|`server/src/services/workflow-engine.ts`|워크플로우 파서 + 실행 엔진 + 코디네이터 연동|~450|
|`server/src/services/workflow-engine.test.ts`|유닛 테스트|~300|
|`packages/db/src/schema/workflow_steps.ts`|워크플로우 스텝 정의 테이블|~55|

### 수정 파일

|파일|변경 내용|
|-|-|
|`packages/db/src/schema/index.ts`|`workflowSteps` export 추가|
|`packages/db/src/schema/routines.ts`|`routines` 테이블에 `workflowDefinition: jsonb` 필드 추가 (멀티스텝 정의)|
|`server/src/services/index.ts`|`workflowEngineService` export 추가|
|`server/src/services/routines.ts`|`run()` 메서드에 워크플로우 실행 분기 추가|
|`server/src/services/coordinator.ts`|워크플로우 기반 코디네이터 세션 자동 생성 지원|
|`server/src/services/heartbeat.ts`|1개 통합 포인트 (워크플로우 스텝 완료 시 다음 스텝 트리거)|
|`server/src/routes/coordinator.ts`|워크플로우 CRUD + 실행 엔드포인트 추가|
|`server/src/services/feature-flags.ts`|`declarative_workflows` 플래그 등록|

### DB 스키마

**`workflow_steps`** (루틴의 워크플로우 정의를 정규화):
```typescript
{
  id: uuid PK,
  companyId: uuid FK → companies,
  routineId: uuid FK → routines,

  // 스텝 정의
  stepIndex: integer,                    // 실행 순서 (0-based)
  name: text,                            // "lint-check", "run-tests", "deploy"
  description: text,
  agentSelector: jsonb,                  // { strategy: "capability_match", capabilities: ["testing"] }

  // 실행 조건
  dependsOnSteps: integer[],            // stepIndex 참조 (DAG)
  condition: jsonb (nullable),           // { type: "on_success" | "on_failure" | "always" | "expression", expr?: string }

  // 도구/권한
  requiredPermissions: text[],          // Phase 21 PermissionType[]
  mcpServers: text[],                   // Phase 16 MCP 서버 이름[]

  // 설정
  timeoutMinutes: integer (default 60),
  retryPolicy: jsonb (nullable),        // { maxRetries: 3, backoffMs: 1000 }

  createdAt: timestamp,
  updatedAt: timestamp,
}
// 인덱스: (companyId, routineId, stepIndex)
```

### 워크플로우 정의 형식

```yaml
# YAML 형식 워크플로우 정의 (routines.workflowDefinition에 저장)
name: "PR 리뷰 파이프라인"
description: "코드 리뷰 → 테스트 → 머지 자동화"
trigger:
  type: webhook
  event: pull_request.opened

steps:
  - name: lint-check
    description: "ESLint + Prettier 검사"
    agent: { strategy: capability_match, capabilities: [linting] }
    permissions: [bash_execute, file_write]
    timeout: 10m

  - name: unit-tests
    description: "단위 테스트 실행"
    agent: { strategy: capability_match, capabilities: [testing] }
    permissions: [bash_execute]
    depends_on: [lint-check]
    timeout: 30m
    retry: { max: 2, backoff: 5s }

  - name: security-scan
    description: "보안 취약점 스캔"
    agent: { strategy: round_robin }
    permissions: [bash_execute, network_access]
    depends_on: [lint-check]  # unit-tests와 병렬 실행
    mcp_servers: [snyk-scanner]
    timeout: 15m

  - name: deploy-staging
    description: "스테이징 배포"
    agent: { strategy: load_balance }
    permissions: [bash_execute, network_access, git_push]
    depends_on: [unit-tests, security-scan]  # 둘 다 완료 후
    condition: { type: on_success }
    timeout: 20m
```

### 핵심 서비스 인터페이스

```typescript
export interface WorkflowDefinition {
  name: string;
  description: string;
  steps: WorkflowStepDef[];
}

export interface WorkflowStepDef {
  name: string;
  description: string;
  agentSelector: AgentSelector;
  permissions?: PermissionType[];
  mcpServers?: string[];
  dependsOn?: string[];          // 스텝 이름 참조
  condition?: StepCondition;
  timeoutMinutes?: number;
  retryPolicy?: RetryPolicy;
}

export type StepCondition =
  | { type: "on_success" }       // 모든 의존 스텝 성공 시만
  | { type: "on_failure" }       // 의존 스텝 중 하나라도 실패 시
  | { type: "always" };          // 항상 실행

export function workflowEngineService(db: Db) {
  const flags = featureFlagsService(db);
  const coordinator = coordinatorService(db);
  const taskGraph = taskGraphService(db);

  /** 플래그 확인 */
  async function isEnabled(companyId: string): Promise<boolean>;

  /** YAML/JSON 워크플로우 정의 파싱 + 검증 (DAG 순환 검사 포함) */
  async function parseAndValidate(definition: unknown): Promise<WorkflowDefinition>;

  /**
   * 워크플로우 실행 시작:
   * 1) 코디네이터 세션 자동 생성
   * 2) 각 스텝을 서브이슈로 변환
   * 3) 태스크 그래프에 의존성 등록
   * 4) 루트 스텝(의존성 없음)부터 워커 위임
   */
  async function execute(
    companyId: string,
    routineId: string,
    routineRunId: string,
    definition: WorkflowDefinition,
  ): Promise<WorkflowExecutionResult>;

  /** 스텝 완료 콜백: 의존 스텝 해제 → 다음 스텝 트리거 */
  async function onStepComplete(
    companyId: string,
    routineRunId: string,
    stepName: string,
    outcome: "succeeded" | "failed",
  ): Promise<void>;

  /** 워크플로우 실행 상태 조회 */
  async function getExecutionStatus(
    companyId: string,
    routineRunId: string,
  ): Promise<WorkflowExecutionStatus>;

  /** 워크플로우 중단 */
  async function cancel(companyId: string, routineRunId: string): Promise<void>;

  return { isEnabled, parseAndValidate, execute, onStepComplete,
           getExecutionStatus, cancel };
}
```

### 실행 흐름 (Routines → Coordinator → Workers)

```
┌──────────┐    트리거     ┌──────────┐   워크플로우   ┌──────────────┐
│ Routine   │ ──────────→ │ Routine   │ ───실행────→ │ Workflow     │
│ Trigger   │  (cron/     │ Run       │              │ Engine       │
│           │  webhook)   │           │              │              │
└──────────┘             └──────────┘              └──────┬───────┘
                                                          │
                                            ┌─────────────┼─────────────┐
                                            ↓             ↓             ↓
                                     ┌──────────┐  ┌──────────┐  ┌──────────┐
                                     │ Step 1   │  │ Step 2   │  │ Step 3   │
                                     │ (Worker) │  │ (Worker) │  │ (Worker) │
                                     └──────────┘  └──────────┘  └──────────┘
                                            │             │
                                            └─ 태스크 그래프 의존성 ─┘
```

### Heartbeat 통합 (1개 포인트)

**워커 완료 시 (~코디네이터 onWorkerComplete 이후)** — 다음 워크플로우 스텝 트리거:
```typescript
// Phase 13: Declarative workflow — trigger next steps on completion
if (routineRunId && await workflowEngine.isEnabled(agent.companyId)) {
  await workflowEngine.onStepComplete(
    agent.companyId, routineRunId, stepName, outcome,
  );
}
```

### 위험 요소

1. **워크플로우 DAG 순환**: 스텝 의존성에 순환 → **완화**: `parseAndValidate()`에서 DFS 순환 검사 (task-graph.ts 재활용)
2. **스텝 타임아웃 연쇄**: 한 스텝 지연이 전체 파이프라인 차단 → **완화**: 스텝별 `timeoutMinutes` + 조건부 실행 (on_failure 경로)
3. **에이전트 부족**: capability_match에 맞는 에이전트 없음 → **완화**: fallback to round_robin + 에러 메시지
4. **YAML 보안**: 악의적 YAML 주입 → **완화**: 스키마 검증 + 허용된 필드만 파싱

**복잡도**: 고 | **예상**: 4주

\---

## Phase 19: 코디네이터 모드

> ✅ Wave 3에서 완료 — `coordinator.ts` + `coordinator_sessions` + `worker_tasks` 스키마

\---

## Phase 16: MCP 동적 도구 등록

> ⬆️ Wave 4 상세 구현 계획 섹션 참조

\---

## ═══ Wave 5: 최종 고도화 — 상세 구현 계획 ═══

## Phase 20: ULTRAPLAN 원격 계획 오프로드 ⬅️ Wave 5

**목표**: 복잡한 이슈를 에이전트가 직접 풀지 않고, 별도의 "계획 전용 세션"에 오프로드하여 고품질 실행 계획을 생성한 뒤, 사용자 승인 후 코디네이터 세션으로 자동 실행

**피처 플래그**: `remote_planning` (이미 등록됨)
**전제**: Phase 19 ✅ (코디네이터), Phase 12 ✅ (태스크 그래프), Phase 13 ✅ (선언적 워크플로우), Phase 21 ✅ (권한 위임)

### ULTRAPLAN이란?

Claude Code에서 ULTRAPLAN은 복잡한 작업을 원격 클라우드 컨테이너(CCR)에 오프로드하여 **계획만 전문적으로 수립**하는 기능이다. 핵심 아이디어:

1. **계획과 실행의 분리**: 복잡한 작업은 "어떻게 할 것인가"(계획)와 "실제로 한다"(실행)를 분리하면 품질이 높아진다
2. **원격 오프로드**: 계획 수립을 별도 환경에서 진행하므로, 로컬 에이전트는 다른 작업을 계속할 수 있다
3. **사용자 승인 게이트**: 계획이 완성되면 사용자에게 보여주고 승인/거부/수정 후 실행 — 위험한 작업의 안전망
4. **상태 머신 기반 폴링**: 원격 세션의 진행 상태를 주기적으로 확인하며, UI에 실시간 피드백 제공

Paperclip에서는 CCR(Cloud Container Runtime) 대신 **기존 코디네이터 시스템 + 전용 계획 에이전트**를 활용하여 동일한 패턴을 구현한다.

### 아키텍처 결정

Claude Code는 `ccrSession.ts`(350줄)에서 CCR 기반 원격 세션 + `ExitPlanModeScanner` 상태 머신으로 구현한다. Paperclip은 서버사이드 오케스트레이터이므로:

- **CCR → 코디네이터 계획 세션**: Claude Code의 원격 컨테이너 대신, 기존 코디네이터 시스템을 "계획 모드"로 확장. 전용 계획 에이전트가 이슈를 분석하고 워크플로우 정의를 생성
- **ExitPlanModeScanner → DB 상태 머신**: 파일 시스템 기반 상태 추적 대신 `remote_plan_sessions` 테이블로 영속적 상태 전이 관리
- **폴 루프 → 서버 내부 폴링 + WebSocket 알림**: Claude Code의 3초 간격 HTTP 폴링을 서버 내부 setInterval + 프론트엔드 WebSocket(또는 SSE) 실시간 알림으로 대체
- **승인 UI → 기존 approvals 시스템 확장**: Claude Code의 브라우저 PlanModal 대신 Paperclip의 approvals 워크플로우 + 전용 계획 리뷰 UI
- **기존 인프라 최대 재활용**: `execution_workspaces` (providerType 확장), `coordinator_sessions` (계획 세션 모드), `workflow_steps` (계획 결과 → 워크플로우 변환)

### Claude Code 참조

* `src/utils/ultraplan/ccrSession.ts` (350줄) — 핵심 폴링/상태 머신 엔진
  - `ExitPlanModeScanner` — 6가지 ScanResult 타입 (approved/teleport/rejected/pending/terminated/unchanged)
  - `pollForApprovedExitPlanMode()` — 3초 폴링 루프, 30분 타임아웃, MAX_CONSECUTIVE_FAILURES=5
  - `extractApprovedPlan()` / `extractTeleportPlan()` — 계획 텍스트 추출
  - `UltraplanPollError` — 6가지 실패 사유 (terminated/timeout_pending/timeout_no_plan/extract_marker_missing/network_or_unknown/stopped)
* `src/utils/ultraplan/keyword.ts` (128줄) — "ultraplan" 키워드 감지/트리거
  - 따옴표/백틱/경로 내부 제외, 단어 경계 매칭
* `src/commands/ultraplan.tsx` — 명령 진입점 + detached poll 시작
  - `launchUltraplan()` — 세션 생성 → 태스크 등록 → 비동기 폴링 시작
  - `startDetachedPoll()` — 비차단 폴링 + 결과 처리 (remote 실행 vs local 텔레포트)
* `src/utils/teleport.tsx` — `teleportToRemote()` CCR 세션 생성 + `permissionMode: 'plan'`

### Paperclip 기존 기반 (재활용 대상)

* `server/src/services/coordinator.ts` — 코디네이터 세션 + 워커 위임 (계획 실행 단계에서 재활용)
* `server/src/services/workflow-engine.ts` — 워크플로우 파서/실행 (계획 결과를 워크플로우로 변환)
* `server/src/services/execution-workspaces.ts` — 실행 워크스페이스 관리 (`providerType` 확장)
* `server/src/services/approvals.ts` — 승인 워크플로우 (계획 승인/거부 UI 재활용)
* `server/src/services/message-bus.ts` — 실시간 알림 (계획 상태 변경 알림)
* `server/src/services/feature-flags.ts` — `remote_planning` 플래그 (이미 등록됨)
* `packages/db/src/schema/execution_workspaces.ts` — `providerType`, `metadata` 필드 확장 가능
* `packages/db/src/schema/coordinator_sessions.ts` — 계획 세션 추적 기반
* `packages/db/src/schema/worker_tasks.ts` — 계획 스텝 추적

### 신규 생성 파일

|파일|목적|예상 LOC|
|-|-|-|
|`server/src/services/remote-planner.ts`|원격 계획 오프로드 엔진 — 세션 생성/폴링/승인/실행 오케스트레이션|~450|
|`server/src/services/plan-scanner.ts`|계획 상태 머신 — ExitPlanModeScanner DB 적응 버전|~200|
|`server/src/services/remote-planner.test.ts`|유닛 테스트|~300|
|`packages/db/src/schema/remote_plan_sessions.ts`|원격 계획 세션 테이블|~65|
|`server/src/routes/remote-planning.ts`|계획 API 엔드포인트|~150|
|`ui/src/pages/PlanReview.tsx`|계획 리뷰/승인 UI 컴포넌트|~250|
|`ui/src/api/remote-planning.ts`|프론트엔드 API 클라이언트|~60|

### 수정 파일

|파일|변경 내용|
|-|-|
|`packages/db/src/schema/index.ts`|`remotePlanSessions` export 추가|
|`server/src/services/index.ts`|`remotePlannerService`, `planScannerService` export 추가|
|`server/src/routes/index.ts`|`remotePlanningRoutes` export 추가|
|`server/src/app.ts`|`remotePlanningRoutes` 마운트|
|`server/src/services/coordinator.ts`|계획 모드 세션 생성 지원 (`sessionType: "planning"` 분기)|
|`server/src/services/heartbeat.ts`|2개 통합 포인트 (아래 상세)|
|`packages/shared/src/constants.ts`|`PlanSessionStatus`, `PlanPhase`, `PlanExecutionTarget` 타입 추가|
|`ui/src/pages/AgentDetail.tsx`|계획 세션 목록/상태 표시 섹션 추가 (선택)|
|`ui/src/components/Sidebar.tsx`|계획 리뷰 배지 표시 (pending 계획 수)|

### DB 스키마

**`remote_plan_sessions`**:
```typescript
{
  id: uuid PK,
  companyId: uuid FK → companies,

  // 요청 컨텍스트
  requestedByAgentId: uuid FK → agents (nullable),  // 계획 요청 에이전트
  requestedByUserId: text (nullable),                // 사용자 직접 요청 시
  sourceIssueId: uuid FK → issues (nullable),        // 계획 대상 이슈

  // 계획 에이전트
  plannerAgentId: uuid FK → agents,                  // 계획 수립 전담 에이전트

  // 상태 머신 (Claude Code ExitPlanModeScanner 적응)
  status: text ("planning" | "needs_input" | "plan_ready" | "approved" | "rejected" | "executing" | "completed" | "failed" | "expired" | "cancelled"),
  phase: text ("running" | "needs_input" | "plan_ready"),  // UI 표시용 (Claude Code UltraplanPhase)

  // 계획 내용
  planText: text (nullable),                         // 생성된 계획 원문 (마크다운)
  planWorkflow: jsonb (nullable),                    // 파싱된 워크플로우 정의 (WorkflowDefinition)
  userFeedback: text (nullable),                     // 사용자 피드백 (거부 시)
  editedPlan: text (nullable),                       // 사용자 수정 계획 (승인 시 수정된 경우)

  // 실행 연결
  executionTarget: text ("coordinator" | "workflow" | "single_agent"),  // 실행 방식
  coordinatorSessionId: uuid FK → coordinator_sessions (nullable),     // 승인 후 생성된 세션
  routineRunId: uuid FK → routine_runs (nullable),                     // 워크플로우 실행 시

  // 폴링/타임아웃 설정 (Claude Code 상수 적응)
  pollIntervalMs: integer (default 3000),
  timeoutMs: integer (default 1800000),              // 30분
  maxConsecutiveFailures: integer (default 5),

  // 추적
  rejectCount: integer (default 0),                  // 거부 횟수 (Claude Code rejectCount)
  consecutiveFailures: integer (default 0),          // 연속 폴링 실패
  lastPolledAt: timestamp (nullable),
  lastEventCursor: text (nullable),                  // 이벤트 스트림 커서

  // 타임스탬프
  createdAt: timestamp,
  updatedAt: timestamp,
  approvedAt: timestamp (nullable),
  completedAt: timestamp (nullable),
  expiresAt: timestamp,                              // createdAt + timeoutMs
}
// 인덱스: (companyId, status), (companyId, requestedByAgentId), (plannerAgentId, status)
```

### 상태 머신 (Claude Code ExitPlanModeScanner → DB 적응)

```
┌─────────────┐
│   planning   │ ← 초기 상태: 계획 에이전트가 이슈 분석 중
└──────┬──────┘
       │
       ├─── 에이전트가 질문 → ┌──────────────┐
       │                     │ needs_input   │ ← 사용자 추가 정보 필요
       │                     └──────┬───────┘
       │                            │ 사용자 응답
       │                            ↓
       │                     ┌─────────────┐
       │                     │  planning    │ ← 추가 정보로 계획 재개
       │                     └─────────────┘
       │
       ├─── 계획 완성 ──→ ┌──────────────┐
       │                  │  plan_ready   │ ← 사용자 리뷰 대기
       │                  └──────┬───────┘
       │                         │
       │          ┌──────────────┼──────────────┐
       │          ↓              ↓              ↓
       │   ┌───────────┐  ┌───────────┐  ┌───────────┐
       │   │ approved   │  │ rejected  │  │ (수정후   │
       │   │            │  │           │  │  approved) │
       │   └─────┬─────┘  └─────┬─────┘  └─────┬─────┘
       │         │              │               │
       │         │              ↓               │
       │         │       ┌─────────────┐        │
       │         │       │  planning    │ ←─────┘
       │         │       │ (재계획)     │  rejectCount++
       │         │       └─────────────┘
       │         │
       │         ↓
       │   ┌───────────┐
       │   │ executing  │ ← 코디네이터 세션/워크플로우 자동 생성
       │   └─────┬─────┘
       │         │
       │    ┌────┴────┐
       │    ↓         ↓
       │ ┌────────┐ ┌────────┐
       │ │completed│ │ failed │
       │ └────────┘ └────────┘
       │
       ├─── 타임아웃 ──→ ┌───────────┐
       │                 │  expired   │
       │                 └───────────┘
       │
       └─── 사용자 취소 → ┌───────────┐
                          │ cancelled  │
                          └───────────┘
```

### 핵심 서비스 인터페이스

```typescript
// ─── plan-scanner.ts ─── (Claude Code ExitPlanModeScanner DB 적응)

export type PlanPhase = "running" | "needs_input" | "plan_ready";

export type ScanResult =
  | { kind: "approved"; plan: string; editedPlan?: string }
  | { kind: "rejected"; feedback: string }
  | { kind: "pending" }         // plan_ready 상태, 사용자 응답 대기
  | { kind: "needs_input"; question: string }
  | { kind: "planning" }        // 계획 진행 중
  | { kind: "expired" }
  | { kind: "failed"; error: string };

export function planScannerService(db: Db) {
  /** 계획 에이전트의 출력을 분석하여 현재 상태 판단 */
  async function scan(sessionId: string): Promise<ScanResult>;

  /** 상태 전이 실행 (DB 업데이트 + 메시지 버스 알림) */
  async function transition(
    sessionId: string,
    newStatus: PlanSessionStatus,
    data?: { plan?: string; feedback?: string; error?: string },
  ): Promise<void>;

  /** 현재 UI 표시 Phase 계산 (Claude Code UltraplanPhase) */
  function derivePhase(session: RemotePlanSession): PlanPhase;

  return { scan, transition, derivePhase };
}

// ─── remote-planner.ts ─── (메인 오케스트레이션 서비스)

export type PlanExecutionTarget = "coordinator" | "workflow" | "single_agent";

export interface CreatePlanRequest {
  companyId: string;
  sourceIssueId?: string;
  plannerAgentId: string;
  requestedByAgentId?: string;
  requestedByUserId?: string;
  prompt: string;                  // 계획 수립 지시
  executionTarget?: PlanExecutionTarget;
  timeoutMs?: number;              // 기본 30분
}

export interface PlanResult {
  plan: string;
  rejectCount: number;
  executionTarget: PlanExecutionTarget;
  coordinatorSessionId?: string;   // 자동 실행 시
}

export function remotePlannerService(db: Db) {
  const flags = featureFlagsService(db);
  const scanner = planScannerService(db);
  const coordinator = coordinatorService(db);
  const workflow = workflowEngineService(db);
  const msgBus = messageBusService(db);

  /** 플래그 확인 */
  async function isEnabled(companyId: string): Promise<boolean>;

  /**
   * 원격 계획 세션 생성
   * Claude Code의 launchUltraplan() → teleportToRemote() 적응
   *
   * 1) remote_plan_sessions 레코드 삽입
   * 2) 계획 에이전트에게 이슈 분석 + 계획 수립 지시 (heartbeat 트리거)
   * 3) 폴링 루프 시작 (서버 내부 setInterval)
   */
  async function createPlanSession(req: CreatePlanRequest): Promise<RemotePlanSession>;

  /**
   * 폴링 루프 — Claude Code pollForApprovedExitPlanMode() 적응
   * 서버 내부에서 3초 간격으로 계획 에이전트 상태 확인
   *
   * 타임아웃: 30분 (ULTRAPLAN_TIMEOUT_MS)
   * 연속 실패 허용: 5회 (MAX_CONSECUTIVE_FAILURES)
   */
  async function startPolling(sessionId: string): Promise<void>;

  /** 폴링 1회 실행 (scan → 상태 전이 → UI 알림) */
  async function pollOnce(sessionId: string): Promise<ScanResult>;

  /**
   * 사용자 계획 승인
   * Claude Code의 "approved" ScanResult 처리 적응
   *
   * 1) 상태 → "approved" 전이
   * 2) planText 파싱 → WorkflowDefinition 변환
   * 3) executionTarget에 따라:
   *    - "coordinator": 코디네이터 세션 자동 생성 + 워커 위임
   *    - "workflow": 루틴 트리거로 워크플로우 실행
   *    - "single_agent": 단일 에이전트에 직접 이슈 할당
   * 4) 상태 → "executing" 전이
   */
  async function approvePlan(
    sessionId: string,
    opts?: { editedPlan?: string; executionTarget?: PlanExecutionTarget },
  ): Promise<PlanResult>;

  /**
   * 사용자 계획 거부
   * Claude Code의 "rejected" ScanResult 처리 적응
   *
   * 1) rejectCount 증가
   * 2) 사용자 피드백 저장
   * 3) 상태 → "planning" 복귀 (재계획)
   * 4) 계획 에이전트에 피드백 전달 (메시지 버스)
   */
  async function rejectPlan(sessionId: string, feedback: string): Promise<void>;

  /**
   * 사용자 추가 정보 제공 (needs_input 상태에서)
   * Claude Code의 브라우저 텍스트 입력 적응
   */
  async function provideInput(sessionId: string, input: string): Promise<void>;

  /** 계획 세션 취소 */
  async function cancelPlan(sessionId: string): Promise<void>;

  /** 계획 세션 상태 조회 */
  async function getSession(sessionId: string): Promise<RemotePlanSession | null>;

  /** 회사의 활성 계획 세션 목록 */
  async function listActiveSessions(companyId: string): Promise<RemotePlanSession[]>;

  /** 만료 세션 정리 (Claude Code cleanupOldResolutions 적응) */
  async function cleanupExpired(): Promise<number>;

  return {
    isEnabled, createPlanSession, startPolling, pollOnce,
    approvePlan, rejectPlan, provideInput, cancelPlan,
    getSession, listActiveSessions, cleanupExpired,
  };
}
```

### 계획 에이전트 시스템 프롬프트

계획 에이전트는 일반 에이전트와 동일하되, heartbeat 실행 시 다음 시스템 프롬프트 오버레이가 주입된다:

```
You are a planning agent. Your task is to analyze the given issue and produce
a detailed execution plan — NOT to execute it yourself.

Your plan MUST follow this structure:
1. **Analysis**: What the issue requires, key technical decisions
2. **Steps**: Ordered list of concrete work items (each becomes a worker task)
3. **Dependencies**: Which steps depend on others (DAG)
4. **Agent Requirements**: What capabilities each step needs
5. **Risk Assessment**: What could go wrong and mitigations

Output format: A structured YAML workflow definition that can be parsed by
the workflow engine.

When you need clarification from the user, clearly state your question and
wait for a response.

When your plan is complete, output it with the marker:
## Plan Ready
[your plan here]
```

### 폴링 루프 상세 구현

```typescript
// Claude Code pollForApprovedExitPlanMode() 적응
async function startPolling(sessionId: string): Promise<void> {
  const session = await getSession(sessionId);
  if (!session) throw new Error(`Plan session ${sessionId} not found`);

  const deadline = session.createdAt.getTime() + session.timeoutMs;
  let consecutiveFailures = 0;

  const intervalId = setInterval(async () => {
    // 타임아웃 체크
    if (Date.now() >= deadline) {
      clearInterval(intervalId);
      await scanner.transition(sessionId, "expired");
      await msgBus.send({
        companyId: session.companyId,
        type: "direct",
        targetAgentId: session.requestedByAgentId,
        payload: { type: "plan_expired", sessionId },
      });
      return;
    }

    try {
      const result = await pollOnce(sessionId);
      consecutiveFailures = 0;

      // 상태별 처리
      if (result.kind === "approved") {
        clearInterval(intervalId);
        // 자동 실행은 approvePlan()에서 처리
      } else if (result.kind === "failed") {
        clearInterval(intervalId);
      } else if (result.kind === "needs_input") {
        // UI 알림 — 사용자 응답 필요
        await msgBus.send({
          companyId: session.companyId,
          type: "broadcast",
          payload: { type: "plan_needs_input", sessionId, question: result.question },
        });
      } else if (result.kind === "pending") {
        // UI 알림 — 계획 준비 완료, 승인 대기
        await msgBus.send({
          companyId: session.companyId,
          type: "broadcast",
          payload: { type: "plan_ready", sessionId },
        });
      }
    } catch (err) {
      consecutiveFailures++;
      if (consecutiveFailures >= session.maxConsecutiveFailures) {
        clearInterval(intervalId);
        await scanner.transition(sessionId, "failed", {
          error: `${consecutiveFailures} consecutive polling failures`,
        });
      }
    }
  }, session.pollIntervalMs);

  // 세션 메타데이터에 intervalId 저장 (취소용)
  activePollIntervals.set(sessionId, intervalId);
}
```

### API 엔드포인트 (routes/remote-planning.ts)

```typescript
// 계획 세션 CRUD
POST   /api/companies/:companyId/plans                    // 계획 세션 생성
GET    /api/companies/:companyId/plans                    // 활성 세션 목록
GET    /api/companies/:companyId/plans/:sessionId         // 세션 상태 조회
DELETE /api/companies/:companyId/plans/:sessionId         // 세션 취소

// 사용자 상호작용
POST   /api/companies/:companyId/plans/:sessionId/approve // 계획 승인 (+ 수정)
POST   /api/companies/:companyId/plans/:sessionId/reject  // 계획 거부 (+ 피드백)
POST   /api/companies/:companyId/plans/:sessionId/input   // 추가 정보 제공

// 실행 상태
GET    /api/companies/:companyId/plans/:sessionId/execution // 실행 진행 상태
```

### 프론트엔드 UI (ui/src/pages/PlanReview.tsx)

계획 리뷰 페이지는 다음 요소로 구성:

1. **상태 표시 배너**: planning(스피너) → needs_input(경고) → plan_ready(승인 버튼) → executing(진행바)
2. **계획 본문 뷰어**: 마크다운 렌더링, 수정 가능한 에디터 모드 전환
3. **워크플로우 시각화**: 계획의 DAG 구조를 그래프로 표시 (스텝 간 의존성)
4. **승인/거부 버튼**: 승인 시 실행 방식 선택 (coordinator/workflow/single_agent)
5. **피드백 입력**: 거부 시 또는 needs_input 시 사용자 텍스트 입력
6. **실행 추적**: 승인 후 코디네이터 세션/워크플로우 진행 상태 실시간 표시

### Heartbeat 통합 (2개 포인트)

**1. 계획 에이전트 실행 시** — 계획 모드 컨텍스트 주입:
```typescript
// Phase 20: Remote planning — inject planning mode context
if (await remotePlanner.isEnabled(agent.companyId)) {
  const planSession = await remotePlanner.getActiveSessionForAgent(agent.id);
  if (planSession && planSession.status === "planning") {
    context.paperclipPlanningMode = {
      sessionId: planSession.id,
      sourceIssueId: planSession.sourceIssueId,
      userFeedback: planSession.userFeedback,  // 거부 후 재계획 시 피드백 포함
    };
    // 계획 전용 시스템 프롬프트 오버레이 주입
    context.systemPromptOverlay = PLANNING_AGENT_SYSTEM_PROMPT;
  }
}
```

**2. 계획 에이전트 완료 시** — 계획 결과 스캔 + 상태 전이:
```typescript
// Phase 20: Remote planning — scan agent output for plan completion
if (context.paperclipPlanningMode) {
  const result = await planScanner.scan(context.paperclipPlanningMode.sessionId);
  if (result.kind === "pending") {
    // 계획 완성됨 → plan_ready 상태로 전이
    await planScanner.transition(
      context.paperclipPlanningMode.sessionId, "plan_ready",
      { plan: result.plan },
    );
  } else if (result.kind === "needs_input") {
    await planScanner.transition(
      context.paperclipPlanningMode.sessionId, "needs_input",
    );
  }
}
```

### 승인 후 자동 실행 흐름

```
계획 승인 (approvePlan)
    │
    ├─── executionTarget === "coordinator"
    │    │
    │    ├─ planText → WorkflowDefinition 파싱
    │    ├─ coordinator.startCoordination() 호출
    │    ├─ 각 스텝 → worker_tasks로 위임
    │    └─ coordinatorSessionId를 plan 세션에 연결
    │
    ├─── executionTarget === "workflow"
    │    │
    │    ├─ planText → WorkflowDefinition 파싱
    │    ├─ 임시 routine 생성 + 워크플로우 정의 저장
    │    ├─ workflowEngine.execute() 호출
    │    └─ routineRunId를 plan 세션에 연결
    │
    └─── executionTarget === "single_agent"
         │
         ├─ sourceIssueId의 에이전트에 직접 할당
         └─ 일반 heartbeat 사이클로 실행
```

### 위험 요소

1. **계획 품질**: 계획 에이전트가 실행 불가능한 계획 생성 → **완화**: 워크플로우 파서의 `parseAndValidate()`로 DAG/스키마 검증, 파싱 실패 시 재계획 요청
2. **폴링 리소스**: 다수의 활성 세션이 동시에 폴링 → **완화**: 세션 수 제한 (회사당 최대 5개 활성), setInterval 효율적 관리
3. **타임아웃 30분**: 복잡한 이슈에서 계획 수립에 30분 부족 → **완화**: `timeoutMs` 설정 가능 (최대 2시간)
4. **상태 머신 불일치**: 계획 에이전트 출력 파싱 실패 → **완화**: "## Plan Ready" 마커 기반 구조화, 마커 없을 시 needs_input 상태로 폴백
5. **거부 무한 루프**: 사용자가 계속 거부 → **완화**: rejectCount 제한 (최대 5회), 초과 시 세션 자동 만료
6. **코디네이터 연동**: 승인된 계획이 코디네이터 세션으로 전환 실패 → **완화**: 트랜잭션으로 원자적 전환, 실패 시 "approved" 상태 유지 + 재시도 가능

**복잡도**: 매우 높 | **예상**: 5-6주 | **전제**: Phase 19 ✅ + Wave 4 전체 ✅

\---

## Phase 21: 권한 위임 프로토콜 \[신규]

> ⬆️ Wave 4 상세 구현 계획 섹션 참조

\---

## Phase 22: 워크트리 격리

> ✅ Wave 3에서 완료 — `worktree-lifecycle.ts` + `execution_workspaces` 재활용

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
|**W3**|4|**19**|코디네이터 모드|C|🟢 높|매우높|Phase 18|✅ `16e83110`|
|**W3**|5|**11**|자율 태스크 클레임|B+C|🔵 중|중|Phase 12+19|✅ `ac5c96e4`|
|**W3**|5|**22**|워크트리 격리|C|🔵 중|중|Phase 19|✅ `9c6eeb31`|
|**W4**|6|**21**|권한 위임 프로토콜|C|🟢 높|중-고|Phase 18+19|✅ `f3039a2c`|
|**W4**|7|**16**|MCP 동적 도구|공통|🔵 중|중|Phase 21|✅ `c6733fb1`|
|**W4**|8|**13**|선언적 워크플로우|C|🔵 중|고|Phase 12+19+21|✅ `684bc40b`|
|**W5**|9|**20**|ULTRAPLAN 원격 계획|C|🟡 중|매우높|Phase 19+W4|✅ `51f39e2a`|

\---

## Claude Code → Paperclip 포팅 매핑

|Claude Code 소스|Paperclip 대응|포팅 방식|Phase|
|-|-|-|-|
|`services/compact/`|`context-compressor.ts` + compaction-tiers|확장|9|
|`utils/tasks.ts` (claimTask)|`auto-claim.ts` + issues 테이블|적응|11|
|`utils/tasks.ts` (blocking graph)|`issue\_dependencies` + `task-graph.ts`|적응|12|
|`utils/messageQueueManager.ts`|`message-bus.ts` + `agent\_messages`|적응|18|
|`coordinator/coordinatorMode.ts`|`coordinator.ts` + `worker-spawn.ts`|적응|19|
|`utils/ultraplan/ccrSession.ts` + `keyword.ts`|`remote-planner.ts` + `plan-scanner.ts` + routes + PlanReview UI|적응|20|
|`services/autoDream/`|`dream-task.ts` + `agent\_memories`|적응|15|
|`utils/swarm/permissionSync.ts`|`permission-delegation.ts`|적응|21|
|`utils/worktree.ts`|`execution-workspaces.ts` 확장|확장|22|
|GrowthBook feature gates|`feature-flags.ts`|새로 구현|17|
|`services/mcp/client.ts` + `config.ts`|`mcp-discovery.ts` + `mcp-session.ts`|적응|16|
|`skills/bundled/batch.ts`|`workflow-engine.ts` + routines 확장|적응|13|

\---

## 위험 요소 및 완화

1. **heartbeat.ts 비대화 (4228줄)**: Phase 9에서 context-compressor 분리를 시작으로, 점진적 모듈화
2. **메시지 버스 지연**: PostgreSQL `LISTEN/NOTIFY` 활용, 폴링 대신 이벤트 기반
3. **코디네이터 비용 폭발**: Phase 17 피처 플래그 + `on:budget-alert` 훅으로 안전망
4. **Dream 가치 불확실**: 피처 플래그 뒤에 배치, A/B 테스트 후 확대
5. **권한 에스컬레이션 병목**: Phase 21 세션 권한 승격으로 반복 에스컬레이션 최소화
6. **MCP 서버 불안정**: Phase 16 헬스체크 + circuit breaker + 5회 재연결 정책
7. **워크플로우 복잡도 폭발**: Phase 13 DAG 순환 검사 + 스텝별 타임아웃 + 최대 스텝 수 제한
8. **ULTRAPLAN 폴링 리소스**: 다수 동시 계획 세션의 setInterval 부하 → 회사당 최대 5개 활성 세션 제한 + 폴링 주기 동적 조절
9. **계획→실행 변환 실패**: 생성된 계획이 워크플로우 스키마에 맞지 않음 → 구조화된 출력 형식 + parseAndValidate() 검증 + 실패 시 재계획

\---

## 검증 전략

### ✅ Wave 1-2 (검증 완료)
1. **Phase 9**: 세션 회전 빈도 50%+ 감소 확인 ✅
2. **Phase 17**: 플래그 토글 시 기능 활성화/비활성화 확인 ✅
3. **Phase 14**: 런 진행 이벤트 실시간 수신 확인 ✅
4. **Phase 18**: 에이전트 간 메시지 왕복 지연 < 500ms ✅
5. **Phase 12**: 순환 감지 + 위상 정렬 정확성 ✅
6. **Phase 15**: KAIROS 다이제스트 생성 + 컨텍스트 주입 ✅

### ✅ Wave 3 (검증 완료)
7. **Phase 19**: 코디네이터가 3+ 워커를 병렬 관리하는 E2E 시나리오 ✅
8. **Phase 11**: 에이전트 idle 시간 측정 → auto-claim 후 30%+ 감소 ✅
9. **Phase 22**: 병렬 워커가 워크트리 격리 상태에서 코드 충돌 없이 작업 ✅

### ✅ Wave 4 (검증 완료)
10. **Phase 21**: 워커 위험 도구 호출 시 코디네이터 에스컬레이션 → 사용자 승인/거부 E2E 흐름 ✅
11. **Phase 21**: 세션 권한 승격 후 동일 도구 재호출 시 에스컬레이션 없이 즉시 허용 ✅
12. **Phase 16**: MCP 서버 등록 → 도구 발견 → 워커 도구 목록 주입 → 도구 실행 E2E ✅
13. **Phase 16**: MCP 서버 장애 시 재연결 + 헬스체크 자동 복구 ✅
14. **Phase 13**: YAML 워크플로우 정의 → 루틴 트리거 → 코디네이터 세션 자동 생성 → 스텝 병렬/순차 실행 E2E ✅
15. **Phase 13**: 스텝 실패 시 조건부 경로(on_failure) 정상 분기 확인 ✅

### ⬅️ Wave 5 (현재 검증 대상)
16. **Phase 20**: 원격 계획 세션 생성 → 상태 머신 전이(planning→needs_input→plan_ready→approved) E2E 흐름
17. **Phase 20**: 폴 루프 3초 간격 + 30분 타임아웃 + 5회 연속 실패 시 중단
18. **Phase 20**: 계획 승인 시 코디네이터 세션 자동 생성 → 워커 위임 자동 실행
19. **Phase 20**: 계획 거부/수정 시 재계획 → 재승인 흐름
20. **Phase 20**: 네트워크 장애 시 일시적 에러 복구 + 세션 만료 감지

### 공통
21. **모든 Phase**: `pnpm typecheck && pnpm test && pnpm lint` 통과 필수
