/**
 * ceo-chat.ts — CEO Chat REST 엔드포인트
 *
 * GET    /api/companies/:companyId/ceo-chat             — 대화 이슈 조회/생성
 * POST   /api/companies/:companyId/ceo-chat/messages    — 메시지 전송 + CEO wakeup
 * GET    /api/companies/:companyId/ceo-chat/timeline    — 통합 타임라인
 * GET    /api/companies/:companyId/ceo-chat/briefings/unread-count — 미읽음 수
 * POST   /api/companies/:companyId/ceo-chat/briefings/mark-read   — 전체 읽음 처리
 */

import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { ceoChatService } from "../services/ceo-chat.js";
import { heartbeatService } from "../services/index.js";
import { assertCompanyAccess } from "./authz.js";

export function ceoChatRoutes(db: Db) {
  const router = Router();
  const chat = ceoChatService(db);
  const heartbeat = heartbeatService(db);

  // ──────────────────────────────────────────────────────────────────────────
  // GET /api/companies/:companyId/ceo-chat
  // 대화 이슈 메타데이터 + CEO 에이전트 ID 반환
  // ──────────────────────────────────────────────────────────────────────────
  router.get("/companies/:companyId/ceo-chat", async (req, res) => {
    const { companyId } = req.params as { companyId: string };
    assertCompanyAccess(req, companyId);

    if (!(await chat.isEnabled(companyId))) {
      res.status(404).json({ error: "ceo_chat feature is not enabled" });
      return;
    }

    const conversation = await chat.getOrCreateConversation(companyId);
    const ceoAgentId = await chat.getCeoAgentId(companyId);

    res.json({ conversation, ceoAgentId });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // POST /api/companies/:companyId/ceo-chat/messages
  // 사용자 메시지 전송 → 이슈 코멘트 추가 → CEO 에이전트 wakeup
  // ──────────────────────────────────────────────────────────────────────────
  router.post("/companies/:companyId/ceo-chat/messages", async (req, res) => {
    const { companyId } = req.params as { companyId: string };
    assertCompanyAccess(req, companyId);

    if (!(await chat.isEnabled(companyId))) {
      res.status(404).json({ error: "ceo_chat feature is not enabled" });
      return;
    }

    const body = (req.body as { body?: string }).body?.trim();
    if (!body) {
      res.status(400).json({ error: "body is required" });
      return;
    }

    const userId =
      req.actor.type === "board" ? (req.actor.userId ?? "board") : "system";

    const { comment, issueId, ceoAgentId } = await chat.sendMessage(
      companyId,
      userId,
      body,
    );

    // CEO 에이전트 wakeup (실패해도 메시지 전송은 성공으로 처리)
    let run: Awaited<ReturnType<typeof heartbeat.wakeup>> | null = null;
    if (ceoAgentId) {
      try {
        run = await heartbeat.wakeup(ceoAgentId, {
          source: "automation",
          triggerDetail: "system",
          reason: "ceo_chat_message",
          requestedByActorType: "user",
          requestedByActorId: userId,
          contextSnapshot: {
            triggeredBy: "ceo_chat",
            issueId,
            commentId: comment.id,
            messageBody: body.slice(0, 200),
          },
        });
      } catch {
        // wakeup 실패는 로그 없이 무시 — 메시지는 이미 저장됨
      }
    }

    res.status(201).json({ comment, issueId, ceoAgentId, run: run ?? null });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GET /api/companies/:companyId/ceo-chat/timeline
  // 코멘트 + heartbeat run + 브리핑 통합 타임라인
  // ──────────────────────────────────────────────────────────────────────────
  router.get("/companies/:companyId/ceo-chat/timeline", async (req, res) => {
    const { companyId } = req.params as { companyId: string };
    assertCompanyAccess(req, companyId);

    if (!(await chat.isEnabled(companyId))) {
      res.status(404).json({ error: "ceo_chat feature is not enabled" });
      return;
    }

    const limit = Math.min(
      Number((req.query as { limit?: string }).limit ?? "50"),
      200,
    );

    const timeline = await chat.getTimeline(companyId, { limit });
    res.json({ timeline });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GET /api/companies/:companyId/ceo-chat/briefings/unread-count
  // ──────────────────────────────────────────────────────────────────────────
  router.get(
    "/companies/:companyId/ceo-chat/briefings/unread-count",
    async (req, res) => {
      const { companyId } = req.params as { companyId: string };
      assertCompanyAccess(req, companyId);

      if (!(await chat.isEnabled(companyId))) {
        res.json({ count: 0 });
        return;
      }

      const count = await chat.getUnreadBriefingCount(companyId);
      res.json({ count });
    },
  );

  // ──────────────────────────────────────────────────────────────────────────
  // POST /api/companies/:companyId/ceo-chat/briefings/mark-read
  // ──────────────────────────────────────────────────────────────────────────
  router.post(
    "/companies/:companyId/ceo-chat/briefings/mark-read",
    async (req, res) => {
      const { companyId } = req.params as { companyId: string };
      assertCompanyAccess(req, companyId);

      if (!(await chat.isEnabled(companyId))) {
        res.json({ ok: true });
        return;
      }

      await chat.markAllBriefingsRead(companyId);
      res.json({ ok: true });
    },
  );

  return router;
}
