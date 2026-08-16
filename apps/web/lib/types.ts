import type {
  Channel,
  ConversationStatus,
  MessageDirection,
  MessageStatus,
  ReservationStatus,
} from "@reservas/shared";

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  _count?: { restaurants: number };
}

export interface Restaurant {
  id: string;
  name: string;
  timezone: string;
  defaultDurationMinutes: number;
  reminderHoursBefore: number;
  reminderChannel: Channel;
  _count?: { tables: number; reservations: number };
}

export interface Table {
  id: string;
  name: string;
  capacity: number;
  zone: string | null;
  isActive: boolean;
}

export interface Guest {
  id: string;
  name: string;
  phone: string;
}

export interface Reservation {
  id: string;
  tableId: string | null;
  startsAt: string;
  durationMinutes: number;
  partySize: number;
  status: ReservationStatus;
  channel: Channel;
  customerNotes: string | null;
  reminderSentAt: string | null;
  guest: Guest | null;
  table: Table | null;
}

export interface Message {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  body: string;
  mediaUrl: string | null;
  providerSid: string | null;
  status: MessageStatus;
  sentAt: string;
}

export interface Conversation {
  id: string;
  channel: Channel;
  guest: Guest | null;
  status: ConversationStatus;
  unread: number;
  lastMessageAt: string | null;
  lastMessage: Message | null;
}

export interface Integration {
  id: string;
  provider: "GOOGLE_CALENDAR" | "CALDAV" | "CRM_HUBSPOT";
  status: "CONNECTED" | "DISCONNECTED" | "ERROR";
  config: Record<string, unknown> | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}
