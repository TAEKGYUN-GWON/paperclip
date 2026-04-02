import { api } from "./client";

export interface ChannelInfo {
  projectId: string;
  name: string;
  createdAt: string;
}

export interface ChannelMessage {
  id: string;
  companyId: string;
  channelId: string | null;
  fromAgentId: string | null;
  fromUserId: string | null;
  toAgentId: string | null;
  mode: string;
  type: string;
  subject: string | null;
  body: string;
  metadata: {
    agentMentions?: { agentId: string; name: string }[];
    issueMentions?: { issueId: string; ref: string }[];
    sourceId?: string;
    [key: string]: unknown;
  };
  status: string;
  createdAt: string;
  updatedAt: string;
}

export const groupChatApi = {
  listChannels: (companyId: string) =>
    api.get<{ channels: ChannelInfo[] }>(
      `/companies/${companyId}/group-chat/channels`,
    ),

  getHistory: (companyId: string, channelId: string, limit = 50) =>
    api.get<{ messages: ChannelMessage[] }>(
      `/companies/${companyId}/group-chat/channels/${encodeURIComponent(channelId)}?limit=${encodeURIComponent(String(limit))}`,
    ),

  sendMessage: (companyId: string, channelId: string, body: string) =>
    api.post<{
      message: ChannelMessage;
      wakeupResults: { agentId: string; runId: string | null }[];
    }>(
      `/companies/${companyId}/group-chat/channels/${encodeURIComponent(channelId)}/messages`,
      { body },
    ),
};
