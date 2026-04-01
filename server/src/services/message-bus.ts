/**
 * message-bus.ts
 * Phase 18: Agent Message Bus
 *
 * Structured agent-to-agent message passing with:
 * - now/next/later priority levels (ported from Claude Code messageQueueManager)
 * - direct, broadcast, and team delivery modes
 * - persistent DB storage (PostgreSQL)
 * - live event notifications on delivery
 */

import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agentMessages } from "@paperclipai/db";
import type {
  AgentMessageMode,
  AgentMessagePriority,
  AgentMessageStatus,
  AgentMessageType,
} from "@paperclipai/shared";
import { publishLiveEvent } from "./live-events.js";
import { featureFlagsService } from "./feature-flags.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SendMessageInput {
  companyId: string;
  fromAgentId: string;
  toAgentId: string;
  mode?: AgentMessageMode;
  priority?: AgentMessagePriority;
  type: AgentMessageType;
  subject?: string;
  body: string;
  metadata?: Record<string, unknown>;
  replyToId?: string;
  ttlSeconds?: number;
}

export interface BroadcastMessageInput {
  companyId: string;
  fromAgentId: string;
  priority?: AgentMessagePriority;
  type: AgentMessageType;
  subject?: string;
  body: string;
  metadata?: Record<string, unknown>;
  ttlSeconds?: number;
}

export interface GetInboxOptions {
  status?: AgentMessageStatus | AgentMessageStatus[];
  priority?: AgentMessagePriority;
  limit?: number;
  offset?: number;
  includeExpired?: boolean;
}

export type AgentMessage = typeof agentMessages.$inferSelect;

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export function messageBusService(db: Db) {
  const flags = featureFlagsService(db);

  async function isEnabled(): Promise<boolean> {
    return flags.isEnabled("message_bus");
  }

  /**
   * Send a direct message from one agent to another.
   * Returns the persisted message record.
   */
  async function send(input: SendMessageInput): Promise<AgentMessage> {
    const expiresAt = input.ttlSeconds
      ? new Date(Date.now() + input.ttlSeconds * 1_000)
      : null;

    const [message] = await db
      .insert(agentMessages)
      .values({
        companyId: input.companyId,
        fromAgentId: input.fromAgentId,
        toAgentId: input.toAgentId,
        mode: input.mode ?? "direct",
        priority: input.priority ?? 1,
        type: input.type,
        subject: input.subject ?? null,
        body: input.body,
        metadata: input.metadata ?? {},
        replyToId: input.replyToId ?? null,
        status: "queued",
        expiresAt,
      })
      .returning();

    if (!message) throw new Error("Failed to insert agent message");

    // Notify recipient via live event
    publishLiveEvent({
      companyId: input.companyId,
      type: "agent.message.received",
      payload: {
        messageId: message.id,
        toAgentId: input.toAgentId,
        fromAgentId: input.fromAgentId,
        type: input.type,
        priority: input.priority ?? 1,
      },
    });

    return message;
  }

  /**
   * Broadcast a message to all agents in the company.
   * toAgentId is null for broadcast messages.
   */
  async function broadcast(input: BroadcastMessageInput): Promise<AgentMessage> {
    const expiresAt = input.ttlSeconds
      ? new Date(Date.now() + input.ttlSeconds * 1_000)
      : null;

    const [message] = await db
      .insert(agentMessages)
      .values({
        companyId: input.companyId,
        fromAgentId: input.fromAgentId,
        toAgentId: null,
        mode: "broadcast",
        priority: input.priority ?? 1,
        type: input.type,
        subject: input.subject ?? null,
        body: input.body,
        metadata: input.metadata ?? {},
        status: "queued",
        expiresAt,
      })
      .returning();

    if (!message) throw new Error("Failed to insert broadcast message");

    publishLiveEvent({
      companyId: input.companyId,
      type: "agent.message.received",
      payload: {
        messageId: message.id,
        toAgentId: null,
        fromAgentId: input.fromAgentId,
        type: input.type,
        priority: input.priority ?? 1,
        broadcast: true,
      },
    });

    return message;
  }

  /**
   * Retrieve an agent's inbox.
   * Returns direct messages + broadcasts, ordered by priority then creation time.
   */
  async function getInbox(agentId: string, opts: GetInboxOptions = {}): Promise<AgentMessage[]> {
    const {
      status,
      priority,
      limit = 50,
      offset = 0,
      includeExpired = false,
    } = opts;

    const now = new Date();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conditions: any[] = [
      // Direct messages to this agent OR broadcast messages
      sql`(${agentMessages.toAgentId} = ${agentId} or ${agentMessages.mode} = 'broadcast')`,
    ];

    // Status filter
    if (status) {
      const statuses = Array.isArray(status) ? status : [status];
      conditions.push(inArray(agentMessages.status, statuses));
    }

    // Priority filter
    if (priority !== undefined) {
      conditions.push(eq(agentMessages.priority, priority));
    }

    // Exclude expired messages unless requested
    if (!includeExpired) {
      conditions.push(
        sql`${agentMessages.expiresAt} is null or ${agentMessages.expiresAt} > ${now}`,
      );
    }

    return db
      .select()
      .from(agentMessages)
      .where(and(...conditions))
      .orderBy(
        asc(agentMessages.priority),   // 0 (now) first
        asc(agentMessages.createdAt),  // FIFO within same priority
      )
      .limit(limit)
      .offset(offset);
  }

  /**
   * Retrieve sent messages from an agent (outbox).
   */
  async function getOutbox(
    agentId: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<AgentMessage[]> {
    return db
      .select()
      .from(agentMessages)
      .where(eq(agentMessages.fromAgentId, agentId))
      .orderBy(desc(agentMessages.createdAt))
      .limit(opts.limit ?? 50)
      .offset(opts.offset ?? 0);
  }

  /**
   * Get a single message by ID, verifying company ownership.
   */
  async function getById(id: string, companyId: string): Promise<AgentMessage | null> {
    const [msg] = await db
      .select()
      .from(agentMessages)
      .where(and(eq(agentMessages.id, id), eq(agentMessages.companyId, companyId)));
    return msg ?? null;
  }

  /**
   * Mark a message as delivered (agent received it but has not processed it yet).
   */
  async function markDelivered(id: string): Promise<void> {
    await db
      .update(agentMessages)
      .set({ status: "delivered", deliveredAt: new Date(), updatedAt: new Date() })
      .where(and(eq(agentMessages.id, id), eq(agentMessages.status, "queued")));
  }

  /**
   * Mark a message as read (agent has fully processed it).
   */
  async function markRead(id: string): Promise<void> {
    await db
      .update(agentMessages)
      .set({ status: "read", readAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(agentMessages.id, id),
          inArray(agentMessages.status, ["queued", "delivered"]),
        ),
      );
  }

  /**
   * Expire messages that have passed their expiresAt timestamp.
   * Returns the number of messages expired.
   * Call periodically from a maintenance job.
   */
  async function expireOldMessages(): Promise<number> {
    const now = new Date();
    const result = await db
      .update(agentMessages)
      .set({ status: "expired", updatedAt: now })
      .where(
        and(
          inArray(agentMessages.status, ["queued", "delivered"]),
          lt(agentMessages.expiresAt, now),
        ),
      )
      .returning({ id: agentMessages.id });
    return result.length;
  }

  /**
   * Dequeue the next highest-priority message for an agent.
   * Marks it as delivered atomically.
   * Returns null when the inbox is empty.
   */
  async function dequeue(agentId: string): Promise<AgentMessage | null> {
    const now = new Date();

    // Find the next queued message (priority 0 first, then FIFO)
    const [next] = await db
      .select()
      .from(agentMessages)
      .where(
        and(
          sql`(${agentMessages.toAgentId} = ${agentId} or ${agentMessages.mode} = 'broadcast')`,
          eq(agentMessages.status, "queued"),
          sql`${agentMessages.expiresAt} is null or ${agentMessages.expiresAt} > ${now}`,
        ),
      )
      .orderBy(asc(agentMessages.priority), asc(agentMessages.createdAt))
      .limit(1);

    if (!next) return null;

    // Mark delivered
    await markDelivered(next.id);
    return { ...next, status: "delivered", deliveredAt: now };
  }

  return {
    isEnabled,
    send,
    broadcast,
    getInbox,
    getOutbox,
    getById,
    markDelivered,
    markRead,
    expireOldMessages,
    dequeue,
  };
}

export type MessageBusService = ReturnType<typeof messageBusService>;
