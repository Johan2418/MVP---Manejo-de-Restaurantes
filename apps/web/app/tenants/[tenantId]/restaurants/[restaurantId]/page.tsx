"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { CHANNEL_LABELS, RESERVATION_STATUS_LABELS } from "@reservas/shared";
import { api } from "@/lib/api";
import type { Reservation, Table } from "@/lib/types";

const START_HOUR = 12;
const END_HOUR = 23;
const SLOT_MINUTES = 30;
const TOTAL_SLOTS = ((END_HOUR - START_HOUR) * 60) / SLOT_MINUTES; // 22

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayKey(): string {
  return toDateKey(new Date());
}

function shiftDay(key: string, delta: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return toDateKey(new Date(y, m - 1, d + delta));
}

function slotIndex(date: Date): number {
  return (date.getHours() * 60 + date.getMinutes() - START_HOUR * 60) / SLOT_MINUTES;
}

const CARD_STYLES: Record<Reservation["status"], string> = {
  REQUESTED: "border-amber-300 bg-amber-50 text-amber-900",
  CONFIRMED: "border-emerald-300 bg-emerald-50 text-emerald-900",
  CANCELLED: "border-gray-300 bg-gray-50 text-gray-500",
  NO_SHOW: "border-gray-400 bg-gray-100 text-gray-600",
  COMPLETED: "border-sky-300 bg-sky-50 text-sky-900",
};

export default function AgendaPage() {
  const { tenantId, restaurantId } = useParams<{
    tenantId: string;
    restaurantId: string;
  }>();

  const [date, setDate] = useState(todayKey());
  const [tables, setTables] = useState<Table[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const base = `/tenants/${tenantId}/restaurants/${restaurantId}`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tbls, res] = await Promise.all([
        api<Table[]>(`${base}/tables`),
        api<Reservation[]>(`${base}/reservations?date=${date}`),
      ]);
      setTables(tbls);
      setReservations(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [base, date]);

  useEffect(() => {
    load();
  }, [load]);

  const selected = useMemo(
    () => reservations.find((r) => r.id === selectedId) ?? null,
    [reservations, selectedId],
  );

  const rows = useMemo(() => {
    const unassigned = reservations.filter((r) => r.tableId === null);
    return { tables, unassigned };
  }, [tables, reservations]);

  async function transition(r: Reservation, status: Reservation["status"]) {
    setError(null);
    try {
      await api(`${base}/reservations/${r.id}/transition`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      setSelectedId(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function timeLabel(r: Reservation): string {
    const d = new Date(r.startsAt);
    return `${String(d.getHours()).padStart(2, "0")}:${String(
      d.getMinutes(),
    ).padStart(2, "0")}`;
  }

  return (
    <main className="flex w-full flex-1 flex-col gap-5 p-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            href={`/tenants/${tenantId}`}
            className="text-sm text-gray-500 underline-offset-2 hover:underline"
          >
            ← Restaurantes
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Agenda</h1>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setDate(shiftDay(date, -1))}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            ←
          </button>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          />
          <button
            onClick={() => setDate(shiftDay(date, 1))}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            →
          </button>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-700"
          >
            Nueva reserva
          </button>
        </div>
      </header>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {showForm && (
        <CreateReservationForm
          base={base}
          date={date}
          tables={tables}
          onDone={async () => {
            setShowForm(false);
            await load();
          }}
          onError={setError}
        />
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Cargando…</p>
      ) : tables.length === 0 ? (
        <p className="text-sm text-gray-400">
          Este restaurante no tiene mesas. Crea mesas primero (endpoint de mesas) o
          ejecuta el seed.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <div
            className="grid min-w-max"
            style={{
              gridTemplateColumns: `7rem repeat(${TOTAL_SLOTS}, minmax(3.25rem, 1fr))`,
            }}
          >
            {/* Cabecera de horas */}
            <div className="border-b border-r border-gray-200 bg-gray-50" />
            {Array.from({ length: TOTAL_SLOTS / 2 }, (_, i) => (
              <div
                key={i}
                className="col-span-2 border-b border-r border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-500"
              >
                {String(START_HOUR + i).padStart(2, "0")}:00
              </div>
            ))}

            {/* Filas por mesa */}
            {rows.tables.map((table) => (
              <TableRow
                key={table.id}
                label={`${table.name} · ${table.capacity}p`}
                sub={table.zone}
                reservations={reservations.filter(
                  (r) => r.tableId === table.id,
                )}
                onSelect={setSelectedId}
                selectedId={selectedId}
              />
            ))}

            {/* Reservas sin mesa asignada */}
            {rows.unassigned.length > 0 && (
              <TableRow
                label="Sin asignar"
                sub={null}
                reservations={rows.unassigned}
                onSelect={setSelectedId}
                selectedId={selectedId}
              />
            )}
          </div>
        </div>
      )}

      {/* Panel de detalles / acciones */}
      {selected && (
        <section className="rounded-lg border border-gray-200 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-medium">
                {selected.guest?.name ?? "Comensal desconocido"}{" "}
                <span className="ml-1 text-xs font-normal text-gray-500">
                  {selected.guest?.phone ?? ""}
                </span>
              </p>
              <p className="mt-0.5 text-sm text-gray-600">
                {timeLabel(selected)} · {selected.partySize} comensales ·{" "}
                {RESERVATION_STATUS_LABELS[selected.status]} · vía{" "}
                {CHANNEL_LABELS[selected.channel] ?? selected.channel}
                {selected.customerNotes ? ` · ${selected.customerNotes}` : ""}
              </p>
            </div>
            <div className="flex gap-2">
              {selected.status === "REQUESTED" && (
                <button
                  onClick={() => transition(selected, "CONFIRMED")}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
                >
                  Confirmar
                </button>
              )}
              {selected.status === "CONFIRMED" && (
                <button
                  onClick={() => transition(selected, "COMPLETED")}
                  className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500"
                >
                  Completar
                </button>
              )}
              {(selected.status === "REQUESTED" ||
                selected.status === "CONFIRMED") && (
                <button
                  onClick={() => transition(selected, "CANCELLED")}
                  className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
                >
                  Cancelar
                </button>
              )}
              <button
                onClick={() => setSelectedId(null)}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
              >
                Cerrar
              </button>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

function TableRow({
  label,
  sub,
  reservations,
  onSelect,
  selectedId,
}: {
  label: string;
  sub: string | null;
  reservations: Reservation[];
  onSelect: (id: string) => void;
  selectedId: string | null;
}) {
  return (
    <>
      <div className="flex flex-col justify-center border-b border-r border-gray-200 bg-gray-50 px-2 py-1">
        <span className="truncate text-xs font-medium">{label}</span>
        {sub && <span className="text-[10px] text-gray-400">{sub}</span>}
      </div>
      {Array.from({ length: TOTAL_SLOTS }, (_, i) => (
        <div key={i} className="border-b border-r border-gray-100" />
      ))}
      {reservations.map((r) => {
        const start = new Date(r.startsAt);
        let idx = slotIndex(start);
        const span = Math.max(1, Math.round(r.durationMinutes / SLOT_MINUTES));
        idx = Math.max(0, Math.min(idx, TOTAL_SLOTS - span));
        return (
          <button
            key={r.id}
            onClick={() => onSelect(r.id)}
            title={`${r.guest?.name ?? "Sin comensal"} · ${r.partySize}p`}
            className={`z-10 m-0.5 overflow-hidden rounded border px-1.5 py-0.5 text-left text-[11px] leading-tight transition hover:brightness-95 ${
              CARD_STYLES[r.status]
            } ${selectedId === r.id ? "ring-2 ring-gray-800" : ""}`}
            style={{
              gridColumnStart: idx + 2,
              gridColumnEnd: idx + 2 + span,
            }}
          >
            <span className="block truncate font-medium">
              {String(start.getHours()).padStart(2, "0")}:
              {String(start.getMinutes()).padStart(2, "0")} {r.guest?.name}
            </span>
            <span className="block truncate">{r.partySize} comensales</span>
          </button>
        );
      })}
    </>
  );
}

function CreateReservationForm({
  base,
  date,
  tables,
  onDone,
  onError,
}: {
  base: string;
  date: string;
  tables: Table[];
  onDone: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [partySize, setPartySize] = useState(2);
  const [time, setTime] = useState("19:00");
  const [tableId, setTableId] = useState(tables[0]?.id ?? "");
  const [status, setStatus] = useState<"REQUESTED" | "CONFIRMED">("REQUESTED");
  const [submitting, setSubmitting] = useState(false);

  const timeOptions = useMemo(() => {
    const options: string[] = [];
    for (let m = START_HOUR * 60; m < END_HOUR * 60; m += SLOT_MINUTES) {
      options.push(
        `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(
          m % 60,
        ).padStart(2, "0")}`,
      );
    }
    return options;
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    onError("");
    try {
      await api(`${base}/reservations`, {
        method: "POST",
        body: JSON.stringify({
          guestName,
          guestPhone: guestPhone || undefined,
          startsAt: `${date}T${time}:00`,
          partySize,
          tableId: tableId || undefined,
          status,
        }),
      });
      await onDone();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 sm:grid-cols-2 lg:grid-cols-6"
    >
      <label className="flex flex-col gap-1 text-xs text-gray-600">
        Nombre
        <input
          required
          value={guestName}
          onChange={(e) => setGuestName(e.target.value)}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-gray-500"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-gray-600">
        Teléfono (opcional)
        <input
          value={guestPhone}
          onChange={(e) => setGuestPhone(e.target.value)}
          placeholder="+593999999999"
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-gray-500"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-gray-600">
        Comensales
        <select
          value={partySize}
          onChange={(e) => setPartySize(Number(e.target.value))}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        >
          {[1, 2, 3, 4, 5, 6, 7, 8, 10, 12].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-gray-600">
        Hora
        <select
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        >
          {timeOptions.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-gray-600">
        Mesa
        <select
          value={tableId}
          onChange={(e) => setTableId(e.target.value)}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        >
          <option value="">Sin asignar</option>
          {tables.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.capacity}p)
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-gray-600">
        Estado
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as "REQUESTED" | "CONFIRMED")}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        >
          <option value="REQUESTED">Solicitada</option>
          <option value="CONFIRMED">Confirmada</option>
        </select>
      </label>
      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:opacity-50 sm:col-span-2 lg:col-span-6"
      >
        {submitting ? "Creando…" : "Crear reserva"}
      </button>
    </form>
  );
}
