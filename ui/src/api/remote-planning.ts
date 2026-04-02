import { api } from "./client";
import type { PlanExecutionTarget } from "@paperclipai/shared";

export interface RemotePlanSession {
  id: string;
  companyId: string;
  plannerAgentId: string;
  requestedByAgentId: string | null;
  requestedByUserId: string | null;
  sourceIssueId: string | null;
  status:
    | "planning"
    | "needs_input"
    | "plan_ready"
    | "approved"
    | "rejected"
    | "executing"
    | "completed"
    | "failed"
    | "expired"
    | "cancelled";
  phase: "running" | "needs_input" | "plan_ready";
  planText: string | null;
  editedPlan: string | null;
  userFeedback: string | null;
  pendingQuestion: string | null;
  executionTarget: PlanExecutionTarget | null;
  coordinatorSessionId: string | null;
  routineRunId: string | null;
  rejectCount: number;
  expiresAt: string;
  approvedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePlanSessionInput {
  plannerAgentId: string;
  sourceIssueId?: string;
  requestedByAgentId?: string;
  executionTarget?: PlanExecutionTarget;
  timeoutMs?: number;
}

export interface ApprovePlanInput {
  editedPlan?: string;
  executionTarget?: PlanExecutionTarget;
}

export interface PlanResult {
  sessionId: string;
  plan: string;
  rejectCount: number;
  executionTarget: PlanExecutionTarget;
  coordinatorSessionId?: string;
}

export interface PlanExecutionStatus {
  sessionId: string;
  status: RemotePlanSession["status"];
  executionTarget: PlanExecutionTarget | null;
  coordinatorSessionId: string | null;
  routineRunId: string | null;
  completedAt: string | null;
}

export const remotePlanningApi = {
  createSession: (companyId: string, data: CreatePlanSessionInput) =>
    api.post<RemotePlanSession>(`/companies/${companyId}/plans`, data),

  listActiveSessions: (companyId: string) =>
    api.get<RemotePlanSession[]>(`/companies/${companyId}/plans`),

  getSession: (companyId: string, sessionId: string) =>
    api.get<RemotePlanSession>(`/companies/${companyId}/plans/${sessionId}`),

  cancelSession: (companyId: string, sessionId: string) =>
    api.delete<{ cancelled: boolean }>(`/companies/${companyId}/plans/${sessionId}`),

  approvePlan: (companyId: string, sessionId: string, data?: ApprovePlanInput) =>
    api.post<PlanResult>(`/companies/${companyId}/plans/${sessionId}/approve`, data ?? {}),

  rejectPlan: (companyId: string, sessionId: string, feedback: string) =>
    api.post<{ rejected: boolean }>(`/companies/${companyId}/plans/${sessionId}/reject`, {
      feedback,
    }),

  provideInput: (companyId: string, sessionId: string, input: string) =>
    api.post<{ inputReceived: boolean }>(`/companies/${companyId}/plans/${sessionId}/input`, {
      input,
    }),

  getExecutionStatus: (companyId: string, sessionId: string) =>
    api.get<PlanExecutionStatus>(`/companies/${companyId}/plans/${sessionId}/execution`),
};
