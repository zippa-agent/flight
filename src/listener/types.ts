export type ListenerAdapter = "email" | "phone" | "slack";

export interface ListenerThreadState {
  target: string;
  adapter: ListenerAdapter;
  read: boolean;
  lastEventId?: string;
  lastInboundAt?: string;
  readAt?: string;
  readBy?: "agent" | "admin" | "system";
  label?: string;
  lastPreview?: string;
  participants?: string[];
  updatedAt: string;
}

export type ListenerReadMark = "unchanged" | "read" | "unread";
