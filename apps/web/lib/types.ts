import type {
  ReservationStatus,
  Channel,
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
  guest: Guest | null;
  table: Table | null;
}
