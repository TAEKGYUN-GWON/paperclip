import { api } from "./client";

export interface McpServerRecord {
  id: string;
  companyId: string;
  name: string;
  displayName: string;
  scope: "company" | "project" | "agent";
  scopeId: string | null;
  transportType: "http" | "sse" | "stdio";
  config: Record<string, unknown>;
  status: "active" | "disabled" | "error";
  lastConnectedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RegisterMcpServerInput {
  name: string;
  displayName?: string;
  scope?: "company" | "project" | "agent";
  scopeId?: string;
  transportType: "http" | "sse" | "stdio";
  config: Record<string, unknown>;
}

export const mcpApi = {
  listServers: (companyId: string) =>
    api.get<McpServerRecord[]>(`/companies/${companyId}/mcp-servers`),

  createServer: (companyId: string, data: RegisterMcpServerInput) =>
    api.post<McpServerRecord>(`/companies/${companyId}/mcp-servers`, data),

  getServer: (companyId: string, serverId: string) =>
    api.get<McpServerRecord>(`/companies/${companyId}/mcp-servers/${serverId}`),

  updateServer: (companyId: string, serverId: string, data: Partial<RegisterMcpServerInput>) =>
    api.patch<McpServerRecord>(`/companies/${companyId}/mcp-servers/${serverId}`, data),

  deleteServer: (companyId: string, serverId: string) =>
    api.delete<void>(`/companies/${companyId}/mcp-servers/${serverId}`),

  connectServer: (companyId: string, serverId: string) =>
    api.post<{ tools: unknown[] }>(`/companies/${companyId}/mcp-servers/${serverId}/connect`, {}),

  listAgentTools: (companyId: string, agentId: string, projectId?: string) =>
    api.get<unknown[]>(
      `/companies/${companyId}/agents/${agentId}/mcp-servers${projectId ? `?projectId=${projectId}` : ""}`,
    ),
};
