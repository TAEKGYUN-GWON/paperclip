import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@/lib/router";
import { ClipboardList, Plus, Loader2, Clock, CheckCircle2, XCircle, Play, MessageSquare } from "lucide-react";
import { remotePlanningApi, type RemotePlanSession } from "../api/remote-planning";
import { agentsApi } from "../api/agents";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "../components/EmptyState";
import { relativeTime } from "../lib/utils";
import type { PlanExecutionTarget } from "@paperclipai/shared";

// ─── Status badge ─────────────────────────────────────────────────────────────

function PlanStatusBadge({ status }: { status: string }) {
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

function statusIcon(status: string) {
  if (status === "planning" || status === "executing") return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  if (status === "needs_input") return <MessageSquare className="h-4 w-4 text-yellow-500" />;
  if (status === "plan_ready") return <Clock className="h-4 w-4 text-blue-500" />;
  if (status === "approved" || status === "completed") return <CheckCircle2 className="h-4 w-4 text-green-500" />;
  if (status === "failed" || status === "expired") return <XCircle className="h-4 w-4 text-destructive" />;
  return <Play className="h-4 w-4 text-muted-foreground" />;
}

// ─── New Plan Dialog ──────────────────────────────────────────────────────────

function NewPlanDialog({
  companyId,
  onClose,
  onCreated,
}: {
  companyId: string;
  onClose: () => void;
  onCreated: (sessionId: string) => void;
}) {
  const [plannerAgentId, setPlannerAgentId] = useState("");
  const [sourceIssueId, setSourceIssueId] = useState("");
  const [executionTarget, setExecutionTarget] = useState<PlanExecutionTarget>("coordinator");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: agents } = useQuery({
    queryKey: ["agents-list", companyId],
    queryFn: () => agentsApi.list(companyId),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      remotePlanningApi.createSession(companyId, {
        plannerAgentId,
        sourceIssueId: sourceIssueId.trim() || undefined,
        executionTarget,
      }),
    onSuccess: (session) => {
      onCreated(session.id);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "세션 생성 실패");
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background border border-border rounded-xl shadow-lg w-full max-w-md p-6 space-y-5">
        <h2 className="text-base font-semibold">새 원격 계획 세션</h2>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">계획 에이전트 <span className="text-destructive">*</span></label>
          <select
            value={plannerAgentId}
            onChange={(e) => setPlannerAgentId(e.target.value)}
            className="w-full text-sm border border-border rounded-md px-3 py-1.5 bg-background"
          >
            <option value="">에이전트 선택...</option>
            {(agents ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} {a.role === "ceo" ? "(CEO)" : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">대상 이슈 ID (선택)</label>
          <Input
            placeholder="이슈 UUID (선택 사항)"
            value={sourceIssueId}
            onChange={(e) => setSourceIssueId(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">비워두면 범용 계획 세션으로 시작됩니다.</p>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">실행 방식</label>
          <div className="flex gap-4">
            {(["coordinator", "workflow", "single_agent"] as const).map((t) => (
              <label key={t} className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="execTarget"
                  value={t}
                  checked={executionTarget === t}
                  onChange={() => setExecutionTarget(t)}
                />
                {t === "coordinator" ? "코디네이터" : t === "workflow" ? "워크플로우" : "단일 에이전트"}
              </label>
            ))}
          </div>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>취소</Button>
          <Button
            size="sm"
            onClick={() => createMutation.mutate()}
            disabled={!plannerAgentId || createMutation.isPending}
          >
            {createMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
            계획 시작
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Plans page ───────────────────────────────────────────────────────────────

export function Plans() {
  const { selectedCompanyId, selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showNew, setShowNew] = useState(false);

  const prefix = selectedCompany?.issuePrefix ?? "";
  const companyId = selectedCompanyId ?? "";

  useEffect(() => {
    setBreadcrumbs([{ label: "Plans" }]);
  }, [setBreadcrumbs]);

  const { data: sessions, isLoading } = useQuery({
    queryKey: ["plan-sessions", companyId],
    queryFn: () => remotePlanningApi.listActiveSessions(companyId),
    enabled: !!companyId,
    refetchInterval: 5000,
  });

  function handleCreated(sessionId: string) {
    setShowNew(false);
    void queryClient.invalidateQueries({ queryKey: ["plan-sessions", companyId] });
    navigate(`/${prefix}/plans/${sessionId}`);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">원격 계획 (ULTRAPLAN)</h1>
          <p className="text-sm text-muted-foreground mt-1">
            에이전트가 이슈를 분석하고 실행 계획을 수립합니다. 승인 후 자동 실행됩니다.
          </p>
        </div>
        <Button onClick={() => setShowNew(true)} size="sm" className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          새 계획
        </Button>
      </div>

      {(!sessions || sessions.length === 0) ? (
        <EmptyState
          icon={ClipboardList}
          message="활성 계획 세션이 없습니다. 위 버튼으로 새 계획을 시작하세요."
        />
      ) : (
        <div className="space-y-2">
          {(sessions as RemotePlanSession[]).map((session) => (
            <Link
              key={session.id}
              to={`/${prefix}/plans/${session.id}`}
              className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 hover:bg-accent/40 transition-colors"
            >
              {statusIcon(session.status)}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate font-mono">
                  {session.id.slice(0, 8)}
                  {session.sourceIssueId ? <span className="text-muted-foreground ml-2 font-sans font-normal text-xs">이슈 연결됨</span> : null}
                </div>
                <div className="text-xs text-muted-foreground">
                  {relativeTime(session.createdAt)}
                </div>
              </div>
              <PlanStatusBadge status={session.status} />
            </Link>
          ))}
        </div>
      )}

      {showNew && (
        <NewPlanDialog
          companyId={companyId}
          onClose={() => setShowNew(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
