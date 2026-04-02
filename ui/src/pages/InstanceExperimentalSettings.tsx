import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical } from "lucide-react";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";

// ─── Feature flag metadata ───────────────────────────────────────────────────
const FEATURE_FLAGS: { key: string; label: string; description: string }[] = [
  {
    key: "coordinator_mode",
    label: "Coordinator Mode (Phase 19)",
    description: "멀티 에이전트 코디네이터/워커 오케스트레이션. 코디네이터 에이전트가 여러 워커에게 태스크를 위임합니다.",
  },
  {
    key: "mcp_dynamic_tools",
    label: "MCP Dynamic Tools (Phase 16)",
    description: "런타임 MCP 서버 발견 및 도구 동적 등록. 에이전트 상세 → MCP 탭에서 서버를 추가할 수 있습니다.",
  },
  {
    key: "remote_planning",
    label: "Remote Planning / ULTRAPLAN (Phase 20)",
    description: "복잡한 이슈를 별도 계획 세션에 오프로드하여 고품질 실행 계획을 생성하고, 사용자 승인 후 자동 실행합니다.",
  },
  {
    key: "permission_delegation",
    label: "Permission Delegation (Phase 21)",
    description: "워커 에이전트가 위험한 도구 사용 시 코디네이터→사용자로 권한 에스컬레이션합니다.",
  },
  {
    key: "declarative_workflows",
    label: "Declarative Workflows (Phase 13)",
    description: "YAML/JSON으로 멀티 에이전트 파이프라인을 선언적으로 정의하고 Routines에서 실행합니다.",
  },
  {
    key: "worktree_isolation",
    label: "Worktree Isolation (Phase 22)",
    description: "코디네이터 워커마다 독립된 git worktree를 할당하여 코드 충돌 없이 병렬 작업합니다.",
  },
  {
    key: "auto_claim",
    label: "Auto Task Claim (Phase 11)",
    description: "유휴 에이전트가 할당되지 않은 이슈를 자동으로 감지하고 클레임합니다.",
  },
  {
    key: "context_compression",
    label: "Context Compression (Phase 9)",
    description: "snip/compact/rotate 3계층 파이프라인으로 에이전트 세션 컨텍스트를 자동 압축합니다.",
  },
  {
    key: "message_bus",
    label: "Message Bus (Phase 18)",
    description: "에이전트 간 now/next/later 우선순위 큐 기반 메시지 버스 및 공유 메모리 KV 저장소.",
  },
  {
    key: "task_graph",
    label: "Task Graph (Phase 12)",
    description: "이슈 의존성 DAG + 위상 정렬로 선행 태스크가 완료되기 전에 다음 태스크가 실행되지 않습니다.",
  },
  {
    key: "dream_task",
    label: "DreamTask / KAIROS (Phase 15)",
    description: "백그라운드에서 에이전트 활동을 집계하여 장기 메모리를 자동 통합합니다.",
  },
  {
    key: "streaming_feedback",
    label: "Streaming Feedback (Phase 14)",
    description: "실행 중 phase/toolUseCount/activity 실시간 스트리밍 피드백.",
  },
  {
    key: "ceo_chat",
    label: "CEO Chat",
    description: "CEO 1:1 채팅, 선제적 브리핑(BriefingAggregator), 단체 톡방(@멘션/#채널). 사이드바에 미읽음 배지 및 대시보드 브리핑 위젯 포함.",
  },
];

export function InstanceExperimentalSettings() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([
      { label: "Instance Settings" },
      { label: "Experimental" },
    ]);
  }, [setBreadcrumbs]);

  const experimentalQuery = useQuery({
    queryKey: queryKeys.instance.experimentalSettings,
    queryFn: () => instanceSettingsApi.getExperimental(),
  });

  const toggleMutation = useMutation({
    mutationFn: async (patch: { enableIsolatedWorkspaces?: boolean; autoRestartDevServerWhenIdle?: boolean }) =>
      instanceSettingsApi.updateExperimental(patch),
    onSuccess: async () => {
      setActionError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.instance.experimentalSettings }),
        queryClient.invalidateQueries({ queryKey: queryKeys.health }),
      ]);
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : "Failed to update experimental settings.");
    },
  });

  const flagMutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: boolean }) => {
      const existing = experimentalQuery.data?.featureFlags ?? {};
      return instanceSettingsApi.updateExperimental({
        featureFlags: { ...existing, [key]: value },
      });
    },
    onSuccess: async () => {
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.instance.experimentalSettings });
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : "Failed to update feature flag.");
    },
  });

  if (experimentalQuery.isLoading) {
    return <div className="text-sm text-muted-foreground">Loading experimental settings...</div>;
  }

  if (experimentalQuery.error) {
    return (
      <div className="text-sm text-destructive">
        {experimentalQuery.error instanceof Error
          ? experimentalQuery.error.message
          : "Failed to load experimental settings."}
      </div>
    );
  }

  const enableIsolatedWorkspaces = experimentalQuery.data?.enableIsolatedWorkspaces === true;
  const autoRestartDevServerWhenIdle = experimentalQuery.data?.autoRestartDevServerWhenIdle === true;
  const featureFlags = experimentalQuery.data?.featureFlags ?? {};

  return (
    <div className="max-w-4xl space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Experimental</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Opt into features that are still being evaluated before they become default behavior.
        </p>
      </div>

      {actionError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {actionError}
        </div>
      )}

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <h2 className="text-sm font-semibold">Enable Isolated Workspaces</h2>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Show execution workspace controls in project configuration and allow isolated workspace behavior for new
              and existing issue runs.
            </p>
          </div>
          <button
            type="button"
            data-slot="toggle"
            aria-label="Toggle isolated workspaces experimental setting"
            disabled={toggleMutation.isPending}
            className={cn(
              "relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60",
              enableIsolatedWorkspaces ? "bg-green-600" : "bg-muted",
            )}
            onClick={() => toggleMutation.mutate({ enableIsolatedWorkspaces: !enableIsolatedWorkspaces })}
          >
            <span
              className={cn(
                "inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform",
                enableIsolatedWorkspaces ? "translate-x-4.5" : "translate-x-0.5",
              )}
            />
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <h2 className="text-sm font-semibold">Auto-Restart Dev Server When Idle</h2>
            <p className="max-w-2xl text-sm text-muted-foreground">
              In `pnpm dev:once`, wait for all queued and running local agent runs to finish, then restart the server
              automatically when backend changes or migrations make the current boot stale.
            </p>
          </div>
          <button
            type="button"
            data-slot="toggle"
            aria-label="Toggle guarded dev-server auto-restart"
            disabled={toggleMutation.isPending}
            className={cn(
              "relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60",
              autoRestartDevServerWhenIdle ? "bg-green-600" : "bg-muted",
            )}
            onClick={() =>
              toggleMutation.mutate({ autoRestartDevServerWhenIdle: !autoRestartDevServerWhenIdle })
            }
          >
            <span
              className={cn(
                "inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform",
                autoRestartDevServerWhenIdle ? "translate-x-4.5" : "translate-x-0.5",
              )}
            />
          </button>
        </div>
      </section>

      {/* Feature flags */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold">Feature Flags (Phase 9–22)</h2>
        <p className="text-sm text-muted-foreground">
          각 기능을 독립적으로 활성화/비활성화합니다. 구현 완료된 기능은 기본값 활성입니다.
        </p>
      </div>

      {FEATURE_FLAGS.map((flag) => {
        const enabled = featureFlags[flag.key] === true;
        const saving = flagMutation.isPending && (flagMutation.variables as { key: string } | undefined)?.key === flag.key;
        return (
          <section key={flag.key} className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1.5">
                <h2 className="text-sm font-semibold">{flag.label}</h2>
                <p className="max-w-2xl text-sm text-muted-foreground">{flag.description}</p>
              </div>
              <button
                type="button"
                data-slot="toggle"
                aria-label={`Toggle ${flag.key}`}
                disabled={saving || flagMutation.isPending}
                className={cn(
                  "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                  enabled ? "bg-green-600" : "bg-muted",
                )}
                onClick={() => flagMutation.mutate({ key: flag.key, value: !enabled })}
              >
                <span
                  className={cn(
                    "inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform",
                    enabled ? "translate-x-4.5" : "translate-x-0.5",
                  )}
                />
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}
