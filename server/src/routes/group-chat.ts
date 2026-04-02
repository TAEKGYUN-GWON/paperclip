/**
 * group-chat.ts — 단체 톡방 REST 엔드포인트
 *
 * GET  /api/companies/:companyId/group-chat/channels              — 채널(프로젝트) 목록
 * GET  /api/companies/:companyId/group-chat/channels/:channelId   — 채널 히스토리
 * POST /api/companies/:companyId/group-chat/channels/:channelId/messages — 사용자 메시지 전송
 */

import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { groupChatService } from "../services/group-chat.js";
import { heartbeatService } from "../services/index.js";
import { assertCompanyAccess } from "./authz.js";
import { agents } from "@paperclipai/db";
import { and, eq, ne } from "drizzle-orm";

export function groupChatRoutes(db: Db) {
  const router = Router();
  const groupChat = groupChatService(db);
  const heartbeat = heartbeatService(db);

  // ──────────────────────────────────────────────────────────────────────────
  // GET /api/companies/:companyId/group-chat/channels
  // ──────────────────────────────────────────────────────────────────────────
  router.get("/companies/:companyId/group-chat/channels", async (req, res) => {
    const { companyId } = req.params as { companyId: string };
    assertCompanyAccess(req, companyId);

    const channels = await groupChat.listChannels(companyId);
    res.json({ channels });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GET /api/companies/:companyId/group-chat/channels/:channelId
  // ──────────────────────────────────────────────────────────────────────────
  router.get(
    "/companies/:companyId/group-chat/channels/:channelId",
    async (req, res) => {
      const { companyId, channelId } = req.params as {
        companyId: string;
        channelId: string;
      };
      assertCompanyAccess(req, companyId);

      const limit = Math.min(
        Number((req.query as { limit?: string }).limit ?? "50"),
        200,
      );

      const messages = await groupChat.getHistory(companyId, channelId, { limit });
      res.json({ messages });
    },
  );

  // ──────────────────────────────────────────────────────────────────────────
  // POST /api/companies/:companyId/group-chat/channels/:channelId/messages
  // 사용자 메시지 전송 → @에이전트 멘션 처리 → wakeup
  // ──────────────────────────────────────────────────────────────────────────
  router.post(
    "/companies/:companyId/group-chat/channels/:channelId/messages",
    async (req, res) => {
      const { companyId, channelId } = req.params as {
        companyId: string;
        channelId: string;
      };
      assertCompanyAccess(req, companyId);

      const body = (req.body as { body?: string }).body?.trim();
      if (!body) {
        res.status(400).json({ error: "body is required" });
        return;
      }

      const userId =
        req.actor.type === "board" ? (req.actor.userId ?? "board") : "system";

      const { message, agentMentionIds } = await groupChat.sendUserMessage({
        companyId,
        channelId,
        userId,
        body,
      });

      // @에이전트 멘션 → wakeup (terminated 에이전트는 제외)
      const wakeupResults: { agentId: string; runId: string | null }[] = [];
      for (const agentId of agentMentionIds) {
        // terminated 에이전트 확인
        const agent = await db
          .select({ id: agents.id, status: agents.status })
          .from(agents)
          .where(and(eq(agents.id, agentId), ne(agents.status, "terminated")))
          .limit(1)
          .then((rows) => rows[0] ?? null);

        if (!agent) {
          wakeupResults.push({ agentId, runId: null });
          continue;
        }

        try {
          const run = await heartbeat.wakeup(agentId, {
            source: "automation",
            triggerDetail: "system",
            reason: "group_chat_mention",
            requestedByActorType: "user",
            requestedByActorId: userId,
            contextSnapshot: {
              triggeredBy: "group_chat",
              groupChatChannelId: channelId,
              mentionBody: body.slice(0, 200),
              messageId: message.id,
            },
          });
          wakeupResults.push({ agentId, runId: run?.id ?? null });
        } catch {
          wakeupResults.push({ agentId, runId: null });
        }
      }

      res.status(201).json({ message, wakeupResults });
    },
  );

  return router;
}
