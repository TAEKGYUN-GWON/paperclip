import { useState } from "react";
import { useParams } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { remotePlanningApi } from "../api/remote-planning";
import { useCompany } from "../context/CompanyContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { MarkdownBody } from "../components/MarkdownBody";
import { CheckCircle2, XCircle, MessageSquare, Loader2, Clock, Play } from "lucide-react";
import type { PlanExecutionTarget } from "@paperclipai/shared";

// ---------------------------------------------------------------------------
// Phase badge helpers
// ---------------------------------------------------------------------------

function PhaseBadge({ phase }: { phase: "running" | "needs_input" | "plan_ready" }) {
  if (phase === "running") {
    return (
      <Badge variant="secondary" className="gap-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        계획 중
      </Badge>
    );
  }
  if (phase === "needs_input") {
    return (
      <Badge variant="outline" className="gap-1 border-yellow-500 text-yellow-600">
        <MessageSquare className="h-3 w-3" />
        입력 필요
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 border-green-500 text-green-600">
      <CheckCircle2 className="h-3 w-3" />
      계획 완료
    </Badge>
  );
}

function StatusBadgeForSession({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    planning: { label: "계획 중", variant: "secondary" },
    needs_input: { label: "입력 필요", variant: "outline" },
    plan_ready: { label: "검토 대기", variant: "outline" },
    approved: { label: "승인됨", variant: "default" },
    rejected: { label: "거부됨", variant: "destructive" },
    executing: { label: "실행 중", variant: "default" },
    completed: { label: "완료", variant: "default" },
    failed: { label: "실패", variant: "destructive" },
    expired: { label: "만료됨", variant: "secondary" },
    cancelled: { label: "취소됨", variant: "secondary" },
  };
  const info = map[status] ?? { label: status, variant: "secondary" };
  return <Badge variant={info.variant}>{info.label}</Badge>;
}

// ---------------------------------------------------------------------------
// PlanReview page
// ---------------------------------------------------------------------------

export function PlanReview() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { selectedCompanyId } = useCompany();
  const queryClient = useQueryClient();

  const [isEditing, setIsEditing] = useState(false);
  const [editedPlan, setEditedPlan] = useState("");
  const [feedback, setFeedback] = useState("");
  const [userInput, setUserInput] = useState("");
  const [selectedTarget, setSelectedTarget] = useState<PlanExecutionTarget>("coordinator");

  const companyId = selectedCompanyId ?? "";

  const { data: session, isLoading } = useQuery({
    queryKey: ["plan-session", sessionId],
    queryFn: () => remotePlanningApi.getSession(companyId, sessionId!),
    enabled: !!sessionId && !!companyId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      const activeStatuses = ["planning", "needs_input", "executing"];
      return activeStatuses.includes(data.status) ? 3000 : false;
    },
  });

  const approveMutation = useMutation({
    mutationFn: () =>
      remotePlanningApi.approvePlan(companyId, sessionId!, {
        editedPlan: isEditing ? editedPlan : undefined,
        executionTarget: selectedTarget,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["plan-session", sessionId] });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: () => remotePlanningApi.rejectPlan(companyId, sessionId!, feedback),
    onSuccess: () => {
      setFeedback("");
      void queryClient.invalidateQueries({ queryKey: ["plan-session", sessionId] });
    },
  });

  const inputMutation = useMutation({
    mutationFn: () => remotePlanningApi.provideInput(companyId, sessionId!, userInput),
    onSuccess: () => {
      setUserInput("");
      void queryClient.invalidateQueries({ queryKey: ["plan-session", sessionId] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => remotePlanningApi.cancelSession(companyId, sessionId!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["plan-session", sessionId] });
    },
  });

  if (isLoading || !session) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isPlanReady = session.status === "plan_ready";
  const isNeedsInput = session.status === "needs_input";
  const isTerminal = ["completed", "failed", "expired", "cancelled"].includes(session.status);
  const isActive = !isTerminal;

  const planContent = session.planText ?? "";

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">원격 계획 세션</h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono">{session.id}</p>
        </div>
        <div className="flex items-center gap-2">
          <PhaseBadge phase={session.phase} />
          <StatusBadgeForSession status={session.status} />
        </div>
      </div>

      {/* Expiry info */}
      {isActive && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="h-4 w-4" />
          <span>만료: {new Date(session.expiresAt).toLocaleString("ko-KR")}</span>
          {session.rejectCount > 0 && (
            <span className="ml-4 text-yellow-600">거부 횟수: {session.rejectCount}</span>
          )}
        </div>
      )}

      {/* Needs Input section */}
      {isNeedsInput && session.pendingQuestion && (
        <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-4 space-y-3">
          <div className="flex items-center gap-2 font-medium text-yellow-800">
            <MessageSquare className="h-4 w-4" />
            계획 에이전트가 추가 정보를 요청합니다
          </div>
          <p className="text-sm text-yellow-900">{session.pendingQuestion}</p>
          <Textarea
            placeholder="답변을 입력하세요..."
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            rows={3}
          />
          <Button
            onClick={() => inputMutation.mutate()}
            disabled={!userInput.trim() || inputMutation.isPending}
          >
            {inputMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : null}
            답변 전송
          </Button>
        </div>
      )}

      {/* Plan content */}
      {planContent && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">생성된 계획</h2>
            {isPlanReady && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setIsEditing(!isEditing);
                  if (!isEditing) setEditedPlan(planContent);
                }}
              >
                {isEditing ? "편집 취소" : "계획 수정"}
              </Button>
            )}
          </div>

          {isEditing ? (
            <Textarea
              value={editedPlan}
              onChange={(e) => setEditedPlan(e.target.value)}
              rows={20}
              className="font-mono text-sm"
            />
          ) : (
            <div className="rounded-lg border bg-card p-4 prose prose-sm max-w-none">
              <MarkdownBody>{planContent}</MarkdownBody>
            </div>
          )}
        </div>
      )}

      {/* Executing / Completed status */}
      {(session.status === "executing" || session.status === "completed") && (
        <div className="rounded-lg border border-blue-300 bg-blue-50 p-4 space-y-2">
          <div className="flex items-center gap-2 font-medium text-blue-800">
            <Play className="h-4 w-4" />
            {session.status === "executing" ? "계획 실행 중..." : "실행 완료"}
          </div>
          {session.coordinatorSessionId && (
            <p className="text-sm text-blue-700">
              코디네이터 세션: <span className="font-mono">{session.coordinatorSessionId}</span>
            </p>
          )}
          {session.completedAt && (
            <p className="text-sm text-blue-700">
              완료: {new Date(session.completedAt).toLocaleString("ko-KR")}
            </p>
          )}
        </div>
      )}

      {/* Approval section */}
      {isPlanReady && (
        <div className="space-y-4 rounded-lg border p-4">
          <h3 className="font-semibold">계획 검토</h3>

          {/* Execution target selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium">실행 방식</label>
            <div className="flex gap-3">
              {(["coordinator", "workflow", "single_agent"] as const).map((target) => (
                <label key={target} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="executionTarget"
                    value={target}
                    checked={selectedTarget === target}
                    onChange={() => setSelectedTarget(target)}
                  />
                  <span className="text-sm">
                    {target === "coordinator"
                      ? "코디네이터 (멀티 에이전트)"
                      : target === "workflow"
                        ? "워크플로우"
                        : "단일 에이전트"}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <Button
              onClick={() => approveMutation.mutate()}
              disabled={approveMutation.isPending}
              className="gap-2"
            >
              {approveMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              승인 및 실행
            </Button>
            {approveMutation.isError && (
              <p className="text-sm text-destructive">
                {approveMutation.error instanceof Error
                  ? approveMutation.error.message
                  : "승인 실패"}
              </p>
            )}
          </div>

          {/* Reject section */}
          <div className="space-y-2 pt-2 border-t">
            <label className="text-sm font-medium">거부 및 재계획</label>
            <Textarea
              placeholder="거부 사유를 입력하세요 (필수)..."
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={3}
            />
            <Button
              variant="destructive"
              onClick={() => rejectMutation.mutate()}
              disabled={!feedback.trim() || rejectMutation.isPending}
              className="gap-2"
            >
              {rejectMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              거부
            </Button>
          </div>
        </div>
      )}

      {/* Cancel button for active sessions */}
      {isActive && !isPlanReady && (
        <div className="pt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => cancelMutation.mutate()}
            disabled={cancelMutation.isPending}
            className="text-muted-foreground"
          >
            세션 취소
          </Button>
        </div>
      )}

      {/* Terminal state messages */}
      {session.status === "failed" && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4">
          <p className="text-sm font-medium text-destructive">계획 세션이 실패했습니다.</p>
        </div>
      )}
      {session.status === "expired" && (
        <div className="rounded-lg border border-muted p-4">
          <p className="text-sm text-muted-foreground">계획 세션이 만료되었습니다.</p>
        </div>
      )}
    </div>
  );
}
