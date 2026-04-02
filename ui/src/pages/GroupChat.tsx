/**
 * GroupChat.tsx — 프로젝트 단위 단체 톡방
 *
 * - 좌측: 프로젝트별 채널 목록
 * - 우측: 선택된 채널의 메시지 히스토리 + 입력창
 * - @에이전트 자동완성 (기본 브라우저 suggest — MentionAutocomplete는 Phase E)
 * - #이슈 멘션 → metadata에서 이슈 링크 렌더링
 */

import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@/lib/router";
import {
  Hash,
  Send,
  Loader2,
  Bot,
  User,
  MessageSquare,
} from "lucide-react";
import { groupChatApi, type ChannelMessage } from "../api/group-chat";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { relativeTime } from "../lib/utils";

// ──────────────────────────────────────────────────────────────────────────────
// 메시지 렌더링
// ──────────────────────────────────────────────────────────────────────────────

function renderBodyWithMentions(
  body: string,
  issueMentions: { issueId: string; ref: string }[],
) {
  if (issueMentions.length === 0) return body;

  // #ref를 이슈 링크로 교체
  let result = body;
  for (const mention of issueMentions) {
    result = result.replace(
      `#${mention.ref}`,
      `[#${mention.ref}](/issues/${mention.issueId})`,
    );
  }
  return result;
}

function MessageRow({ msg }: { msg: ChannelMessage }) {
  const isAgent = !!msg.fromAgentId;
  const issueMentions = (msg.metadata?.issueMentions as { issueId: string; ref: string }[] | undefined) ?? [];

  const bodyWithLinks = renderBodyWithMentions(msg.body, issueMentions);

  // 간단한 마크다운 링크 파싱 ([text](href))
  const parts: React.ReactNode[] = [];
  const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(bodyWithLinks)) !== null) {
    if (match.index > lastIdx) {
      parts.push(bodyWithLinks.slice(lastIdx, match.index));
    }
    parts.push(
      <Link
        key={match.index}
        to={match[2]!}
        className="text-primary underline underline-offset-2 hover:no-underline"
      >
        {match[1]}
      </Link>,
    );
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < bodyWithLinks.length) {
    parts.push(bodyWithLinks.slice(lastIdx));
  }

  return (
    <div className="flex gap-3 py-1">
      <div className="flex-shrink-0 mt-0.5">
        {isAgent ? (
          <div className="w-7 h-7 rounded-full bg-violet-100 flex items-center justify-center dark:bg-violet-900">
            <Bot className="h-3.5 w-3.5 text-violet-600 dark:text-violet-300" />
          </div>
        ) : (
          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
            <User className="h-3.5 w-3.5 text-primary" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        {msg.subject && (
          <span className="text-xs font-medium text-muted-foreground mr-2">{msg.subject}</span>
        )}
        <span className="text-sm break-words whitespace-pre-wrap">{parts}</span>
        <span className="ml-2 text-[11px] text-muted-foreground">
          {relativeTime(msg.createdAt)}
        </span>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// 메인 페이지
// ──────────────────────────────────────────────────────────────────────────────

export function GroupChat() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { channelId } = useParams<{ channelId?: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const companyId = selectedCompanyId ?? "";

  useEffect(() => {
    setBreadcrumbs([{ label: "단체 톡방" }]);
  }, [setBreadcrumbs]);

  const channelsQuery = useQuery({
    queryKey: queryKeys.groupChat.channels(companyId),
    queryFn: () => groupChatApi.listChannels(companyId),
    enabled: !!companyId,
  });

  const channels = channelsQuery.data?.channels ?? [];

  // 채널 미선택 시 첫 번째 채널로 자동 이동
  useEffect(() => {
    if (!channelId && channels.length > 0) {
      navigate(`/group-chat/${channels[0]!.projectId}`, { replace: true });
    }
  }, [channelId, channels, navigate]);

  const activeChannel = channels.find((c) => c.projectId === channelId);

  const historyQuery = useQuery({
    queryKey: queryKeys.groupChat.history(companyId, channelId ?? ""),
    queryFn: () => groupChatApi.getHistory(companyId, channelId!, 100),
    enabled: !!companyId && !!channelId,
    refetchInterval: 8_000,
  });

  const messages = [...(historyQuery.data?.messages ?? [])].reverse();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const sendMutation = useMutation({
    mutationFn: (body: string) =>
      groupChatApi.sendMessage(companyId, channelId!, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.groupChat.history(companyId, channelId ?? ""),
      });
      setDraft("");
    },
  });

  function handleSend() {
    const body = draft.trim();
    if (!body || !channelId || sendMutation.isPending) return;
    sendMutation.mutate(body);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex h-full">
      {/* 채널 목록 */}
      <aside className="w-52 shrink-0 border-r border-border flex flex-col">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            채널
          </h2>
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          {channelsQuery.isLoading && (
            <div className="flex justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}
          {channels.map((ch) => (
            <Link
              key={ch.projectId}
              to={`/group-chat/${ch.projectId}`}
              className={`flex items-center gap-2 px-4 py-2 text-[13px] transition-colors ${
                ch.projectId === channelId
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              }`}
            >
              <Hash className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="truncate">{ch.name}</span>
            </Link>
          ))}
          {!channelsQuery.isLoading && channels.length === 0 && (
            <p className="px-4 py-3 text-xs text-muted-foreground">
              프로젝트가 없습니다.
            </p>
          )}
        </nav>
      </aside>

      {/* 채널 콘텐츠 */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* 채널 헤더 */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-border shrink-0">
          {activeChannel ? (
            <>
              <Hash className="h-4 w-4 text-muted-foreground" />
              <h1 className="text-sm font-semibold">{activeChannel.name}</h1>
            </>
          ) : (
            <h1 className="text-sm font-semibold text-muted-foreground">채널 선택</h1>
          )}
        </div>

        {/* 메시지 */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3 space-y-1">
          {historyQuery.isLoading && (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {!channelId && !historyQuery.isLoading && (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <MessageSquare className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">좌측에서 채널을 선택하세요.</p>
            </div>
          )}
          {channelId && !historyQuery.isLoading && messages.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <Hash className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">아직 메시지가 없습니다.</p>
            </div>
          )}
          {messages.map((msg) => (
            <MessageRow key={msg.id} msg={msg} />
          ))}
          <div ref={bottomRef} />
        </div>

        {/* 입력창 */}
        {channelId && (
          <div className="shrink-0 border-t border-border px-5 py-3">
            {sendMutation.isError && (
              <p className="text-xs text-destructive mb-2">
                {sendMutation.error instanceof Error
                  ? sendMutation.error.message
                  : "전송 실패"}
              </p>
            )}
            <div className="flex gap-2 items-end">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="@에이전트 또는 #이슈번호 멘션... (Ctrl+Enter 전송)"
                rows={2}
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
        )}
      </div>
    </div>
  );
}
