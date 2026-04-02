/**
 * CeoChat.tsx — CEO 1:1 채팅 페이지
 *
 * - 회사당 하나의 대화형 이슈를 통해 CEO 에이전트와 자연어 대화
 * - 코멘트 + heartbeat run 요약 + 선제적 브리핑을 통합 타임라인으로 표시
 * - 피처 플래그 비활성화 시: "기능이 비활성화됨" 안내
 * - CEO 에이전트 미설정 시: 에이전트 생성 안내 링크
 */

import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import {
  MessageSquare,
  Loader2,
  Send,
  Bot,
  User,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Bell,
} from "lucide-react";
import { ceoChatApi, type TimelineItem, type CommentTimelineItem, type RunTimelineItem, type BriefingTimelineItem } from "../api/ceo-chat";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { relativeTime } from "../lib/utils";

// ──────────────────────────────────────────────────────────────────────────────
// 타임라인 아이템 컴포넌트
// ──────────────────────────────────────────────────────────────────────────────

function CommentItem({ item }: { item: CommentTimelineItem }) {
  const isUser = item.authorUserId !== null && item.authorAgentId === null;
  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      <div className="flex-shrink-0">
        {isUser ? (
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
            <User className="h-4 w-4 text-primary" />
          </div>
        ) : (
          <div className="w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center dark:bg-violet-900">
            <Bot className="h-4 w-4 text-violet-600 dark:text-violet-300" />
          </div>
        )}
      </div>
      <div className={`flex flex-col gap-1 max-w-[70%] ${isUser ? "items-end" : "items-start"}`}>
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap break-words ${
            isUser
              ? "bg-primary text-primary-foreground rounded-tr-sm"
              : "bg-muted text-foreground rounded-tl-sm"
          }`}
        >
          {item.body}
        </div>
        <span className="text-[11px] text-muted-foreground">
          {relativeTime(item.createdAt)}
        </span>
      </div>
    </div>
  );
}

function RunItem({ item }: { item: RunTimelineItem }) {
  const isSuccess = item.status === "succeeded";
  const isFailed = item.status === "failed" || item.status === "error";
  return (
    <div className="flex gap-2 items-start py-1">
      <div className="mt-0.5 flex-shrink-0">
        {isSuccess ? (
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        ) : isFailed ? (
          <XCircle className="h-4 w-4 text-destructive" />
        ) : (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-xs text-muted-foreground">
          CEO 에이전트 실행 {isSuccess ? "완료" : isFailed ? "실패" : "중"}
          {item.finishedAt && ` · ${relativeTime(item.finishedAt)}`}
        </span>
        {item.summary && (
          <p className="mt-0.5 text-sm text-foreground/80 whitespace-pre-wrap break-words">
            {item.summary}
          </p>
        )}
      </div>
    </div>
  );
}

function BriefingItem({ item }: { item: BriefingTimelineItem }) {
  const typeLabel: Record<string, string> = {
    run_completed: "작업 완료",
    run_failed: "작업 실패",
    issue_created: "이슈 생성",
    issue_assigned: "이슈 배정",
    agent_report: "에이전트 보고",
    delegation: "업무 위임",
    error: "오류",
  };

  return (
    <div className="border border-border rounded-xl px-4 py-3 bg-card space-y-1">
      <div className="flex items-center gap-2">
        <Bell className="h-3.5 w-3.5 text-amber-500" />
        <span className="text-xs font-medium text-muted-foreground">
          {typeLabel[item.briefingType] ?? item.briefingType}
        </span>
        {item.readAt === null && (
          <Badge variant="secondary" className="text-[10px] py-0 px-1.5 h-4">
            미읽음
          </Badge>
        )}
        <span className="ml-auto text-[11px] text-muted-foreground">
          {relativeTime(item.createdAt)}
        </span>
      </div>
      <p className="text-sm font-medium">{item.title}</p>
      <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">{item.body}</p>
    </div>
  );
}

function TimelineItemView({ item }: { item: TimelineItem }) {
  if (item.kind === "comment") return <CommentItem item={item} />;
  if (item.kind === "run") return <RunItem item={item} />;
  return <BriefingItem item={item} />;
}

// ──────────────────────────────────────────────────────────────────────────────
// 메인 페이지
// ──────────────────────────────────────────────────────────────────────────────

export function CeoChat() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "CEO 채팅" }]);
  }, [setBreadcrumbs]);

  const companyId = selectedCompanyId ?? "";

  const convQuery = useQuery({
    queryKey: queryKeys.ceoChat.conversation(companyId),
    queryFn: () => ceoChatApi.getConversation(companyId),
    enabled: !!companyId,
  });

  const timelineQuery = useQuery({
    queryKey: queryKeys.ceoChat.timeline(companyId),
    queryFn: () => ceoChatApi.getTimeline(companyId, 100),
    enabled: !!companyId,
    refetchInterval: 8_000,
  });

  // 새 메시지 오면 스크롤 하단으로
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [timelineQuery.data]);

  const sendMutation = useMutation({
    mutationFn: (body: string) => ceoChatApi.sendMessage(companyId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.ceoChat.timeline(companyId) });
      setDraft("");
    },
  });

  const markReadMutation = useMutation({
    mutationFn: () => ceoChatApi.markAllRead(companyId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.ceoChat.unreadCount(companyId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.ceoChat.timeline(companyId) });
    },
  });

  // 피처 플래그 비활성화 (404)
  if (convQuery.error && (convQuery.error as { status?: number }).status === 404) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-6">
        <MessageSquare className="h-10 w-10 text-muted-foreground" />
        <h1 className="text-lg font-semibold">CEO 채팅 비활성화</h1>
        <p className="text-sm text-muted-foreground max-w-sm">
          인스턴스 설정 → 실험적 기능에서{" "}
          <code className="font-mono bg-muted px-1 rounded">ceo_chat</code> 플래그를 활성화하세요.
        </p>
        <Link to="/instance/settings/experimental">
          <Button variant="outline" size="sm">설정으로 이동</Button>
        </Link>
      </div>
    );
  }

  const ceoAgentId = convQuery.data?.ceoAgentId;
  const timeline = timelineQuery.data?.timeline ?? [];
  // 타임라인은 최신→구 순이므로 역순 렌더링
  const orderedTimeline = [...timeline].reverse();

  function handleSend() {
    const body = draft.trim();
    if (!body || sendMutation.isPending) return;
    sendMutation.mutate(body);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  }

  const unreadCount = timeline.filter(
    (item) => item.kind === "briefing" && item.readAt === null,
  ).length;

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto w-full">
      {/* 헤더 */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border shrink-0">
        <div className="w-9 h-9 rounded-full bg-violet-100 flex items-center justify-center dark:bg-violet-900">
          <Bot className="h-5 w-5 text-violet-600 dark:text-violet-300" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold">CEO 채팅</h1>
          {ceoAgentId ? (
            <Link to={`/agents/${ceoAgentId}`} className="text-xs text-muted-foreground hover:underline">
              CEO 에이전트 상세 보기
            </Link>
          ) : (
            <span className="text-xs text-amber-600">CEO 에이전트 미설정</span>
          )}
        </div>
        {unreadCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs"
            onClick={() => markReadMutation.mutate()}
            disabled={markReadMutation.isPending}
          >
            <Bell className="h-3.5 w-3.5 mr-1.5" />
            {unreadCount}개 읽음 처리
          </Button>
        )}
      </div>

      {/* CEO 에이전트 없음 배너 */}
      {!ceoAgentId && !convQuery.isLoading && (
        <div className="mx-6 mt-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>CEO 에이전트가 없습니다.</span>
          <Link to="/agents/new" className="ml-auto font-medium underline underline-offset-2">
            에이전트 생성
          </Link>
        </div>
      )}

      {/* 타임라인 */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4">
        {timelineQuery.isLoading && (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {!timelineQuery.isLoading && orderedTimeline.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <MessageSquare className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">아직 대화가 없습니다. 메시지를 보내보세요.</p>
          </div>
        )}
        {orderedTimeline.map((item) => (
          <TimelineItemView key={`${item.kind}-${item.id}`} item={item} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* 입력창 */}
      <div className="shrink-0 border-t border-border px-6 py-4">
        {sendMutation.isError && (
          <p className="text-xs text-destructive mb-2">
            {sendMutation.error instanceof Error ? sendMutation.error.message : "전송 실패"}
          </p>
        )}
        <div className="flex gap-2 items-end">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="CEO에게 메시지 보내기... (Ctrl+Enter로 전송)"
            rows={3}
            className="resize-none text-sm flex-1"
            disabled={sendMutation.isPending}
          />
          <Button
            onClick={handleSend}
            disabled={!draft.trim() || sendMutation.isPending}
            size="icon"
            className="self-end"
          >
            {sendMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
