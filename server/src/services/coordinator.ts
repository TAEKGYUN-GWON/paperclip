/**
 * coordinator.ts
 * Phase 19: Coordinator Mode — Multi-agent orchestration engine
 *
 * Transforms a designated agent into an orchestrator that:
 *   - Creates sub-issues from a parent issue and assigns them to worker agents
 *   - Tracks worker task progress via DB status updates
 *   - Notifies the coordinator when all workers complete
 *   - Builds a coordinator system prompt overlay for context injection
 *
 * Architectural adaptation from Claude Code:
 *   Claude Code → in-process Agent Tool spawns child agents
 *   Paperclip  → coordinator creates sub-issues, assigns them to persistent
 *                 worker agents, and uses wakeup requests + message bus
 *
 * Feature-flagged under "coordinator_mode" — safe to import regardless.
 */

import { and, eq, inArray, sql, count } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { coordinatorSessions, workerTasks, issues, agents } from "@paperclipai/db";
import type {
  CoordinatorSessionStatus,
  WorkerTaskStatus,
  DelegationStrategy,
} from "@paperclipai/shared";
import { featureFlagsService } from "./feature-flags.js";
import { publishLiveEvent } from "./live-events.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CoordinatorConfig {
  companyId: string;
  coordinatorAgentId: string;
  parentIssueId: string;
  maxParallelWorkers?: number;
  delegationStrategy?: DelegationStrategy;
  workerAgentIds?: string[];
  config?: Record<string, unknown>;
}

export interface DelegationTask {
  title: string;
  description: string;
  assignToAgentId?: string | null;
  dependsOnTaskIndices?: number[];
}

export interface DelegationPlan {
  tasks: DelegationTask[];
}

export interface CoordinatorStatus {
  sessionId: string;
  parentIssueId: string;
  coordinatorAgentId: string;
  status: CoordinatorSessionStatus;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  runningTasks: number;
  pendingTasks: number;
  isComplete: boolean;
}

export type CoordinatorSession = typeof coordinatorSessions.$inferSelect;
export type WorkerTask = typeof workerTasks.$inferSelect;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_SUB_ISSUES_PER_SESSION = 20;
const DEFAULT_MAX_PARALLEL_WORKERS = 5;

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export function coordinatorService(db: Db) {
  const flags = featureFlagsService(db);

  /** 피처 플래그 확인 */
  async function isEnabled(): Promise<boolean> {
    return flags.isEnabled("coordinator_mode");
  }

  /**
   * 에이전트가 활성 코디네이터 세션을 보유하는지 확인.
   * Heartbeat pre:context에서 호출하여 코디네이터 프롬프트 주입 여부 결정.
   */
  async function isCoordinatorAgent(
    companyId: string,
    agentId: string,
  ): Promise<boolean> {
    if (!(await isEnabled())) return false;

    const rows = await db
      .select({ id: coordinatorSessions.id })
      .from(coordinatorSessions)
      .where(
        and(
          eq(coordinatorSessions.companyId, companyId),
          eq(coordinatorSessions.coordinatorAgentId, agentId),
          eq(coordinatorSessions.status, "active"),
        ),
      )
      .limit(1);

    return rows.length > 0;
  }

  /**
   * 특정 부모 이슈에 대한 활성 세션 조회.
   */
  async function getActiveSession(
    companyId: string,
    parentIssueId: string,
  ): Promise<CoordinatorSession | null> {
    const rows = await db
      .select()
      .from(coordinatorSessions)
      .where(
        and(
          eq(coordinatorSessions.companyId, companyId),
          eq(coordinatorSessions.parentIssueId, parentIssueId),
          eq(coordinatorSessions.status, "active"),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * 코디네이터 세션을 시작한다.
   * 이미 활성 세션이 있으면 에러를 던진다.
   */
  async function startCoordination(
    config: CoordinatorConfig,
  ): Promise<CoordinatorSession> {
    if (!(await isEnabled())) {
      throw new Error("coordinator_mode feature flag is not enabled");
    }

    // Check for existing active session on this parent issue
    const existing = await getActiveSession(
      config.companyId,
      config.parentIssueId,
    );
    if (existing) {
      throw new Error(
        `Active coordinator session already exists for issue ${config.parentIssueId}`,
      );
    }

    const [session] = await db
      .insert(coordinatorSessions)
      .values({
        companyId: config.companyId,
        coordinatorAgentId: config.coordinatorAgentId,
        parentIssueId: config.parentIssueId,
        maxParallelWorkers:
          config.maxParallelWorkers ?? DEFAULT_MAX_PARALLEL_WORKERS,
        delegationStrategy: config.delegationStrategy ?? "round_robin",
        config: config.config ?? {},
      })
      .returning();

    return session!;
  }

  /**
   * 위임 계획을 실행한다:
   *   1) 각 task를 worker_tasks 테이블에 삽입
   *   2) 워커 에이전트 할당 (delegationStrategy에 따라)
   *   3) 상태를 "spawned"로 전이
   *
   * 서브이슈 생성은 호출자(heartbeat/route)가 issues 서비스를 통해 별도 수행.
   * 이 메서드는 worker_tasks 추적만 담당한다.
   */
  async function delegate(
    companyId: string,
    sessionId: string,
    plan: DelegationPlan,
  ): Promise<WorkerTask[]> {
    if (!(await isEnabled())) {
      throw new Error("coordinator_mode feature flag is not enabled");
    }

    // Validate session
    const [session] = await db
      .select()
      .from(coordinatorSessions)
      .where(
        and(
          eq(coordinatorSessions.id, sessionId),
          eq(coordinatorSessions.companyId, companyId),
          eq(coordinatorSessions.status, "active"),
        ),
      )
      .limit(1);

    if (!session) {
      throw new Error(`No active coordinator session found: ${sessionId}`);
    }

    // Enforce sub-issue limit
    const [existingCount] = await db
      .select({ cnt: count() })
      .from(workerTasks)
      .where(
        and(
          eq(workerTasks.companyId, companyId),
          eq(workerTasks.coordinatorSessionId, sessionId),
        ),
      );

    const currentCount = Number(existingCount?.cnt ?? 0);
    if (currentCount + plan.tasks.length > MAX_SUB_ISSUES_PER_SESSION) {
      throw new Error(
        `Exceeds maximum sub-issues per session (${MAX_SUB_ISSUES_PER_SESSION}). ` +
          `Current: ${currentCount}, Requested: ${plan.tasks.length}`,
      );
    }

    // Resolve worker assignments
    const workerAgentIds = await resolveWorkerAssignments(
      companyId,
      session,
      plan,
    );

    // Insert worker tasks
    const now = new Date();
    const insertValues = plan.tasks.map((task, i) => ({
      companyId,
      coordinatorSessionId: sessionId,
      parentIssueId: session.parentIssueId,
      workerAgentId: workerAgentIds[i] ?? null,
      status: (workerAgentIds[i] ? "spawned" : "pending") as WorkerTaskStatus,
      summary: `${task.title}: ${task.description}`.slice(0, 2000),
      delegatedAt: workerAgentIds[i] ? now : null,
    }));

    const inserted = await db
      .insert(workerTasks)
      .values(insertValues)
      .returning();

    return inserted;
  }

  /**
   * delegationStrategy에 따라 워커를 할당한다.
   */
  async function resolveWorkerAssignments(
    companyId: string,
    session: CoordinatorSession,
    plan: DelegationPlan,
  ): Promise<(string | null)[]> {
    const strategy = session.delegationStrategy as DelegationStrategy;

    // Get eligible workers from config or all agents in company
    const configWorkerIds = (
      session.config as Record<string, unknown>
    )?.workerAgentIds;
    let eligibleAgentIds: string[];

    if (Array.isArray(configWorkerIds) && configWorkerIds.length > 0) {
      eligibleAgentIds = configWorkerIds as string[];
    } else {
      // All non-coordinator agents in the company
      const companyAgents = await db
        .select({ id: agents.id })
        .from(agents)
        .where(eq(agents.companyId, companyId));
      eligibleAgentIds = companyAgents
        .map((a) => a.id)
        .filter((id) => id !== session.coordinatorAgentId);
    }

    if (eligibleAgentIds.length === 0) {
      return plan.tasks.map(() => null);
    }

    switch (strategy) {
      case "round_robin":
        return plan.tasks.map(
          (task, i) =>
            task.assignToAgentId ??
            eligibleAgentIds[i % eligibleAgentIds.length]!,
        );

      case "load_balance": {
        // Pick agent with fewest active worker_tasks
        const loadCounts = await db
          .select({
            workerAgentId: workerTasks.workerAgentId,
            cnt: count(),
          })
          .from(workerTasks)
          .where(
            and(
              eq(workerTasks.companyId, companyId),
              inArray(workerTasks.status, ["spawned", "running"]),
            ),
          )
          .groupBy(workerTasks.workerAgentId);

        const loadMap = new Map<string, number>();
        for (const row of loadCounts) {
          if (row.workerAgentId) {
            loadMap.set(row.workerAgentId, Number(row.cnt));
          }
        }

        return plan.tasks.map((task) => {
          if (task.assignToAgentId) return task.assignToAgentId;

          let bestAgent = eligibleAgentIds[0]!;
          let bestLoad = loadMap.get(bestAgent) ?? 0;
          for (const agentId of eligibleAgentIds) {
            const load = loadMap.get(agentId) ?? 0;
            if (load < bestLoad) {
              bestAgent = agentId;
              bestLoad = load;
            }
          }
          // Update load for next iteration
          loadMap.set(bestAgent, bestLoad + 1);
          return bestAgent;
        });
      }

      case "capability_match":
        // Simple fallback: use explicit assignment or round-robin
        return plan.tasks.map(
          (task, i) =>
            task.assignToAgentId ??
            eligibleAgentIds[i % eligibleAgentIds.length]!,
        );

      default:
        return plan.tasks.map(
          (task, i) =>
            task.assignToAgentId ??
            eligibleAgentIds[i % eligibleAgentIds.length]!,
        );
    }
  }

  /**
   * 워커 태스크의 서브이슈 ID를 연결한다.
   * delegate() 후 호출자가 서브이슈를 생성하면 이 메서드로 연결.
   */
  async function linkSubIssue(
    companyId: string,
    workerTaskId: string,
    subIssueId: string,
  ): Promise<void> {
    await db
      .update(workerTasks)
      .set({ subIssueId, updatedAt: new Date() })
      .where(
        and(
          eq(workerTasks.id, workerTaskId),
          eq(workerTasks.companyId, companyId),
        ),
      );
  }

  /**
   * 워커 태스크 상태를 업데이트한다.
   */
  async function updateWorkerStatus(
    companyId: string,
    workerTaskId: string,
    status: WorkerTaskStatus,
    result?: Record<string, unknown>,
  ): Promise<void> {
    const now = new Date();
    const updates: Partial<typeof workerTasks.$inferInsert> = {
      status,
      updatedAt: now,
    };
    if (status === "completed" || status === "failed" || status === "cancelled") {
      updates.completedAt = now;
    }
    if (result !== undefined) {
      updates.result = result;
    }

    await db
      .update(workerTasks)
      .set(updates)
      .where(
        and(
          eq(workerTasks.id, workerTaskId),
          eq(workerTasks.companyId, companyId),
        ),
      );
  }

  /**
   * 서브이슈가 완료되면 호출 — 해당 worker_task를 찾아 상태 업데이트.
   * 모든 워커가 완료되면 세션도 완료로 전이.
   *
   * @returns true if the entire coordination session is now complete
   */
  async function onWorkerComplete(
    companyId: string,
    subIssueId: string,
    outcome: "succeeded" | "failed",
  ): Promise<boolean> {
    if (!(await isEnabled())) return false;

    // Find the worker_task linked to this sub-issue
    const [task] = await db
      .select()
      .from(workerTasks)
      .where(
        and(
          eq(workerTasks.companyId, companyId),
          eq(workerTasks.subIssueId, subIssueId),
        ),
      )
      .limit(1);

    if (!task) return false;

    // Update worker task status
    const newStatus: WorkerTaskStatus =
      outcome === "succeeded" ? "completed" : "failed";
    await updateWorkerStatus(companyId, task.id, newStatus);

    // Check if all tasks in the session are terminal
    const sessionTasks = await db
      .select({ status: workerTasks.status })
      .from(workerTasks)
      .where(
        and(
          eq(workerTasks.companyId, companyId),
          eq(workerTasks.coordinatorSessionId, task.coordinatorSessionId),
        ),
      );

    const terminal: WorkerTaskStatus[] = ["completed", "failed", "cancelled"];
    const allDone = sessionTasks.every((t) =>
      terminal.includes(t.status as WorkerTaskStatus),
    );

    if (allDone) {
      // Mark session as completed
      await db
        .update(coordinatorSessions)
        .set({
          status: "completed",
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(coordinatorSessions.id, task.coordinatorSessionId),
            eq(coordinatorSessions.companyId, companyId),
          ),
        );

      // Publish live event
      publishLiveEvent({
        companyId,
        type: "coordinator.session.completed" as any,
        payload: {
          sessionId: task.coordinatorSessionId,
          parentIssueId: task.parentIssueId,
        },
      });
    }

    return allDone;
  }

  /**
   * 코디네이터 세션의 집계 상태를 반환한다.
   */
  async function getStatus(
    companyId: string,
    parentIssueId: string,
  ): Promise<CoordinatorStatus | null> {
    const [session] = await db
      .select()
      .from(coordinatorSessions)
      .where(
        and(
          eq(coordinatorSessions.companyId, companyId),
          eq(coordinatorSessions.parentIssueId, parentIssueId),
        ),
      )
      .limit(1);

    if (!session) return null;

    const taskRows = await db
      .select({ status: workerTasks.status })
      .from(workerTasks)
      .where(
        and(
          eq(workerTasks.companyId, companyId),
          eq(workerTasks.coordinatorSessionId, session.id),
        ),
      );

    const counts = { pending: 0, spawned: 0, running: 0, completed: 0, failed: 0, cancelled: 0 };
    for (const t of taskRows) {
      const s = t.status as WorkerTaskStatus;
      if (s in counts) counts[s]++;
    }

    const totalTasks = taskRows.length;
    const terminal = counts.completed + counts.failed + counts.cancelled;

    return {
      sessionId: session.id,
      parentIssueId: session.parentIssueId,
      coordinatorAgentId: session.coordinatorAgentId,
      status: session.status as CoordinatorSessionStatus,
      totalTasks,
      completedTasks: counts.completed,
      failedTasks: counts.failed,
      runningTasks: counts.running + counts.spawned,
      pendingTasks: counts.pending,
      isComplete: totalTasks > 0 && terminal === totalTasks,
    };
  }

  /**
   * 코디네이터 시스템 프롬프트 오버레이를 빌드한다.
   * Heartbeat pre:context에서 호출하여 context.paperclipCoordinatorPrompt에 주입.
   *
   * @param pendingPermissionsContext - Phase 21: pending permission escalations from
   *   permissionDelegationService.buildPendingPermissionsContext(). Pass empty string if none.
   */
  async function buildCoordinatorPrompt(
    companyId: string,
    agentId: string,
    parentIssueId: string,
    pendingPermissionsContext?: string,
  ): Promise<string | null> {
    const status = await getStatus(companyId, parentIssueId);
    if (!status) return null;

    const taskRows = await db
      .select({
        id: workerTasks.id,
        status: workerTasks.status,
        summary: workerTasks.summary,
        workerAgentId: workerTasks.workerAgentId,
      })
      .from(workerTasks)
      .where(
        and(
          eq(workerTasks.companyId, companyId),
          eq(workerTasks.coordinatorSessionId, status.sessionId),
        ),
      );

    const lines: string[] = [
      "## Coordinator Status",
      "",
      `Total tasks: ${status.totalTasks} | Completed: ${status.completedTasks} | Failed: ${status.failedTasks} | Running: ${status.runningTasks} | Pending: ${status.pendingTasks}`,
      "",
    ];

    if (taskRows.length > 0) {
      lines.push("### Worker Tasks");
      for (const t of taskRows) {
        const statusIcon =
          t.status === "completed"
            ? "[DONE]"
            : t.status === "failed"
              ? "[FAIL]"
              : t.status === "running" || t.status === "spawned"
                ? "[RUNNING]"
                : "[PENDING]";
        lines.push(
          `- ${statusIcon} ${(t.summary ?? "untitled").slice(0, 120)} (worker: ${t.workerAgentId ?? "unassigned"})`,
        );
      }
    }

    // Phase 21: inject pending permission escalations
    if (pendingPermissionsContext) {
      lines.push("", pendingPermissionsContext);
    }

    return lines.join("\n");
  }

  /**
   * 코디네이터 세션을 취소한다.
   * 모든 pending/spawned/running 워커 태스크도 cancelled로 전이.
   */
  async function cancelSession(
    companyId: string,
    sessionId: string,
  ): Promise<void> {
    const now = new Date();

    // Cancel all non-terminal worker tasks
    await db
      .update(workerTasks)
      .set({ status: "cancelled", completedAt: now, updatedAt: now })
      .where(
        and(
          eq(workerTasks.companyId, companyId),
          eq(workerTasks.coordinatorSessionId, sessionId),
          inArray(workerTasks.status, ["pending", "spawned", "running"]),
        ),
      );

    // Cancel the session itself
    await db
      .update(coordinatorSessions)
      .set({ status: "cancelled", completedAt: now, updatedAt: now })
      .where(
        and(
          eq(coordinatorSessions.id, sessionId),
          eq(coordinatorSessions.companyId, companyId),
        ),
      );
  }

  /**
   * 특정 에이전트의 활성 세션에서 현재 running 중인 워커 수를 반환.
   * Heartbeat에서 maxParallelWorkers 제한 체크에 사용.
   */
  async function getActiveWorkerCount(
    companyId: string,
    sessionId: string,
  ): Promise<number> {
    const [result] = await db
      .select({ cnt: count() })
      .from(workerTasks)
      .where(
        and(
          eq(workerTasks.companyId, companyId),
          eq(workerTasks.coordinatorSessionId, sessionId),
          inArray(workerTasks.status, ["spawned", "running"]),
        ),
      );

    return Number(result?.cnt ?? 0);
  }

  /**
   * 에이전트의 활성 세션을 조회한다 (coordinatorAgentId 기준).
   */
  async function getActiveSessionForAgent(
    companyId: string,
    agentId: string,
  ): Promise<CoordinatorSession | null> {
    const rows = await db
      .select()
      .from(coordinatorSessions)
      .where(
        and(
          eq(coordinatorSessions.companyId, companyId),
          eq(coordinatorSessions.coordinatorAgentId, agentId),
          eq(coordinatorSessions.status, "active"),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Phase 20: ULTRAPLAN — 세션이 계획 세션 모드인지 확인.
   * config.sessionType === "planning"으로 식별한다.
   * 계획 세션은 워커를 생성하지 않고 계획만 수립한다.
   */
  async function isPlanningSession(
    companyId: string,
    sessionId: string,
  ): Promise<boolean> {
    const rows = await db
      .select({ config: coordinatorSessions.config })
      .from(coordinatorSessions)
      .where(
        and(
          eq(coordinatorSessions.id, sessionId),
          eq(coordinatorSessions.companyId, companyId),
        ),
      )
      .limit(1);

    const cfg = rows[0]?.config as Record<string, unknown> | undefined;
    return cfg?.sessionType === "planning";
  }

  return {
    isEnabled,
    isCoordinatorAgent,
    getActiveSession,
    getActiveSessionForAgent,
    startCoordination,
    delegate,
    linkSubIssue,
    updateWorkerStatus,
    onWorkerComplete,
    getStatus,
    buildCoordinatorPrompt,
    cancelSession,
    getActiveWorkerCount,
    isPlanningSession,
  };
}

export type CoordinatorServiceType = ReturnType<typeof coordinatorService>;
