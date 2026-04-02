/**
 * mention-parser.ts — @에이전트 + #이슈 멘션 파서
 *
 * 메시지 body에서 @에이전트명과 #이슈번호/식별자를 추출하고
 * DB에서 실제 ID로 매핑한다.
 * LLM 호출 없음 — 순수 패턴 매칭 + DB 조회.
 */

import { and, eq, ilike, or } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, issues } from "@paperclipai/db";

export interface ParsedAgentMention {
  name: string;
  agentId: string;
}

export interface ParsedIssueMention {
  ref: string;       // 원본 #숫자 또는 #PREFIX-숫자
  issueId: string;
}

export interface ParsedMentions {
  agentMentions: ParsedAgentMention[];
  issueMentions: ParsedIssueMention[];
}

// @단어 패턴: 영문+숫자+밑줄, 한글 허용
const AGENT_MENTION_RE = /@([\w가-힣]+)/g;
// #숫자 또는 #PREFIX-숫자 패턴
const ISSUE_MENTION_RE = /#([A-Za-z0-9가-힣]+-\d+|\d+)/g;

/**
 * 메시지 body에서 @에이전트명, #이슈번호 파싱 후 DB로 ID 매핑.
 * 존재하지 않는 이름/번호는 결과에서 제외.
 */
export async function parseMentions(
  db: Db,
  companyId: string,
  body: string,
): Promise<ParsedMentions> {
  // 1. 패턴 추출
  const agentNames = new Set<string>();
  const issueRefs = new Set<string>();

  for (const match of body.matchAll(AGENT_MENTION_RE)) {
    agentNames.add(match[1]!);
  }
  for (const match of body.matchAll(ISSUE_MENTION_RE)) {
    issueRefs.add(match[1]!);
  }

  const agentMentions: ParsedAgentMention[] = [];
  const issueMentions: ParsedIssueMention[] = [];

  // 2. 에이전트 이름 → ID 매핑
  if (agentNames.size > 0) {
    const nameList = Array.from(agentNames);
    const agentRows = await db
      .select({ id: agents.id, name: agents.name, status: agents.status })
      .from(agents)
      .where(
        and(
          eq(agents.companyId, companyId),
          or(...nameList.map((name) => ilike(agents.name, name))),
        ),
      );

    for (const row of agentRows) {
      // terminated 에이전트는 멘션 가능하지만 wakeup은 막힘 (상위에서 처리)
      agentMentions.push({ name: row.name, agentId: row.id });
    }
  }

  // 3. 이슈 번호/식별자 → ID 매핑
  if (issueRefs.size > 0) {
    const refList = Array.from(issueRefs);
    // 숫자만인 경우 issueNumber, PREFIX-숫자인 경우 identifier로 조회
    for (const ref of refList) {
      const isNumeric = /^\d+$/.test(ref);
      let issueRow: { id: string } | null = null;

      if (isNumeric) {
        // 순수 숫자 → issueNumber (이슈 순번)
        issueRow = await db
          .select({ id: issues.id })
          .from(issues)
          .where(
            and(
              eq(issues.companyId, companyId),
              // issueNumber 필드가 없을 경우 identifier로 fallback
              ilike(issues.identifier, `%-${ref}`),
            ),
          )
          .limit(1)
          .then((rows) => rows[0] ?? null);
      } else {
        // PREFIX-숫자 형식 → identifier
        issueRow = await db
          .select({ id: issues.id })
          .from(issues)
          .where(
            and(
              eq(issues.companyId, companyId),
              ilike(issues.identifier, ref),
            ),
          )
          .limit(1)
          .then((rows) => rows[0] ?? null);
      }

      if (issueRow) {
        issueMentions.push({ ref, issueId: issueRow.id });
      }
    }
  }

  return { agentMentions, issueMentions };
}
