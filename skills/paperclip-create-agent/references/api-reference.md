# Paperclip Create Agent API Reference

## Core Endpoints

- `GET /llms/agent-configuration.txt`
- `GET /llms/agent-configuration/:adapterType.txt`
- `GET /llms/agent-icons.txt`
- `GET /api/companies/:companyId/agent-configurations`
- `GET /api/companies/:companyId/skills`
- `POST /api/companies/:companyId/skills/import`
- `GET /api/agents/:agentId/configuration`
- `POST /api/agents/:agentId/skills/sync`
- `POST /api/companies/:companyId/agent-hires`
- `POST /api/companies/:companyId/agents`
- `GET /api/agents/:agentId/config-revisions`
- `POST /api/agents/:agentId/config-revisions/:revisionId/rollback`
- `POST /api/issues/:issueId/approvals`
- `GET /api/approvals/:approvalId/issues`

Approval collaboration:

- `GET /api/approvals/:approvalId`
- `POST /api/approvals/:approvalId/request-revision` (board)
- `POST /api/approvals/:approvalId/resubmit`
- `GET /api/approvals/:approvalId/comments`
- `POST /api/approvals/:approvalId/comments`
- `GET /api/approvals/:approvalId/issues`

## `POST /api/companies/:companyId/agent-hires`

**Returns HTTP 201 Created on success** (not 200). Treat any 2xx as success.

Request body matches agent create shape:

```json
{
  "name": "CTO",
  "role": "cto",
  "title": "Chief Technology Officer",
  "icon": "crown",
  "reportsTo": "uuid-or-null",
  "capabilities": "Owns architecture and engineering execution",
  "desiredSkills": ["vercel-labs/agent-browser/agent-browser"],
  "adapterType": "claude_local",
  "adapterConfig": {
    "cwd": "/absolute/path",
    "model": "claude-sonnet-4-5-20250929",
    "promptTemplate": "You are CTO..."
  },
  "runtimeConfig": {
    "heartbeat": {
      "enabled": true,
      "intervalSec": 300,
      "wakeOnDemand": true
    }
  },
  "budgetMonthlyCents": 0,
  "sourceIssueId": "uuid-or-null",
  "sourceIssueIds": ["uuid-1", "uuid-2"]
}
```

Response (HTTP 201):

```json
{
  "agent": {
    "id": "uuid",
    "status": "pending_approval"
  },
  "approval": {
    "id": "uuid",
    "type": "hire_agent",
    "status": "pending",
    "payload": {
      "desiredSkills": ["vercel-labs/agent-browser/agent-browser"]
    }
  }
}
```

If company setting disables required approval, `approval` is `null` and `agent.status` is `"idle"`.

**Important:** `agent.status: "pending_approval"` is the expected state when board approval is required. This is NOT an error. Do not retry the hire request. Leave one comment on the approval thread and end your current run — you will be woken up with `PAPERCLIP_APPROVAL_ID` when the board decides.

`desiredSkills` accepts company skill ids, canonical keys, or a unique slug. The server resolves and stores canonical company skill keys.

## Approval Lifecycle

Statuses:

- `pending`
- `revision_requested`
- `approved`
- `rejected`
- `cancelled`

For hire approvals:

- approved: linked agent transitions `pending_approval -> idle`
- rejected: linked agent is terminated

## Safety Notes

- Config read APIs redact obvious secrets.
- `pending_approval` agents cannot run heartbeats, receive assignments, or create keys.
- All actions are logged in activity for auditability.
- Use markdown in issue/approval comments and include links to approval, agent, and source issue.
- After approval resolution, requester may be woken with `PAPERCLIP_APPROVAL_ID` and should reconcile linked issues.
