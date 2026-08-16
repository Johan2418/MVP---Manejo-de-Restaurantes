"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { DragEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
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

/** Lunes..domingo de la semana que contiene `key`. */
function weekDates(key: string): string[] {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const mondayOffset = (date.getDay() + 6) % 7; // lunes = 0
  const monday = new Date(y, m - 1, d - mondayOffset);
  return Array.from({ length: 7 }, (_, i) => toDateKey(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)));
}

function slotIndex(date: Date): number {
  return (date.getHours() * 60 + date.getMinutes() - START_HOUR * 60) / SLOT_MINUTES;
}

function slotTimeLabel(slot: number): string {
  const minutes = START_HOUR * 60 + slot * SLOT_MINUTES;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
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
  const [view, setView] = useState<"day" | "week">("day");
  const [tables, setTables] = useState<Table[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [weekReservations, setWeekReservations] = useState<Reservation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dragId, setDragId] = useState<string | null>(null);

  const base = `/tenants/${tenantId}/restaurants/${restaurantId}`;
  const week = useMemo(() => weekDates(date), [date]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tbls, res, ...weekRes] = await Promise.all([
        api<Table[]>(`${base}/tables`),
        api<Reservation[]>(`${base}/reservations?date=${date}`),
        ...week.map((d) => api<Reservation[]>(`${base}/reservations?date=${d}`)),
      ]);
      setTables(tbls);
      setReservations(res);
      setWeekReservations(weekRes.flat());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [base, date, week]);

  useEffect(() => {
    load();
  }, [load]);

  const allReservations = useMemo(
    () => [...reservations, ...weekReservations],
    [reservations, weekReservations],
  );
  const selected = useMemo(
    () => allReservations.find((r) => r.id === selectedId) ?? null,
    [allReservations, selectedId],
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

  async function autoAssign() {
    setError(null);
    setNotice(null);
    try {
      const { assigned } = await api<{ assigned: number }>(
        `${base}/reservations/auto-assign`,
        { method: "POST" },
      );
      setNotice(
        assigned > 0
          ? `${assigned} reserva(s) sin mesa asignadas automáticamente.`
          : "No hay reservas activas sin mesa que asignar.",
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  /**
   * Mueve una reserva (drag & drop): a una mesa + franja horaria, a una mesa
   * conservando la hora (drop en la cabecera) o sin mesa (drop en "Sin asignar").
   */
  async function moveReservation(id: string, tableId: string | null, slot?: number) {
    if (id === dragId) setDragId(null);
    setError(null);
    const res = allReservations.find((r) => r.id === id);
    if (!res) return;
    const body: Record<string, string> = {};
    if (slot !== undefined && tableId) {
      const span = Math.max(1, Math.round(res.durationMinutes / SLOT_MINUTES));
      const idx = Math.max(0, Math.min(slot, TOTAL_SLOTS - span));
      body.tableId = tableId;
      body.startsAt = `${date}T${slotTimeLabel(idx)}:00`;
    } else {
      // tableId null ⇒ sin mesa; tableId string ⇒ misma hora, otra mesa
      body.tableId = tableId ?? "";
    }
    try {
      await api(`${base}/reservations/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function timeLabel(iso: string): string {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(
      d.getMinutes(),
    ).padStart(2, "0")}`;
  }

  function dayLabel(key: string): string {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("es-EC", {
      weekday: "short",
      day: "numeric",
    });
  }

  const draggableStatuses: Reservation["status"][] = ["REQUESTED", "CONFIRMED"];

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

        <div className="flex flex-wrap items-center gap-2">
          {/* Vista día/semana */}
          <div className="flex overflow-hidden rounded-md border border-gray-300">
            {(["day", "week"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 text-sm font-medium ${
                  view === v
                    ? "bg-gray-900 text-white"
                    : "bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                {v === "day" ? "Día" : "Semana"}
              </button>
            ))}
          </div>

          <button
            onClick={() => setDate(shiftDay(date, view === "week" ? -7 : -1))}
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
            onClick={() => setDate(shiftDay(date, view === "week" ? 7 : 1))}
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
          <button
            onClick={autoAssign}
            className="rounded-md border border-emerald-600 px-4 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
            title="Asigna mesa a las reservas activas sin mesa"
          >
            Auto-asignar
          </button>
          <Link
            href={`${base}/conversaciones`}
            className="rounded-md border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Conversaciones
          </Link>
          <Link
            href={`${base}/comensales`}
            className="rounded-md border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Comensales
          </Link>
          <Link
            href={`${base}/analitica`}
            className="rounded-md border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Analítica
          </Link>
          <Link
            href={`${base}/integraciones`}
            className="rounded-md border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Integraciones
          </Link>
        </div>
      </header>

      {notice && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </p>
      )}
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
      ) : view === "day" ? (
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
                dragId={dragId}
                draggableStatuses={draggableStatuses}
                onDragStart={(id) => setDragId(id)}
                onDragEnd={() => setDragId(null)}
                onCellDrop={(slot) => moveReservation(dragId!, table.id, slot)}
                onLabelDrop={() => moveReservation(dragId!, table.id)}
                slotIndex={slotIndex}
                slotTimeLabel={slotTimeLabel}
                TOTAL_SLOTS={TOTAL_SLOTS}
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
                dragId={dragId}
                draggableStatuses={draggableStatuses}
                onDragStart={(id) => setDragId(id)}
                onDragEnd={() => setDragId(null)}
                onCellDrop={() => moveReservation(dragId!, null)}
                onLabelDrop={() => moveReservation(dragId!, null)}
                slotIndex={slotIndex}
                slotTimeLabel={slotTimeLabel}
                TOTAL_SLOTS={TOTAL_SLOTS}
              />
            )}
          </div>
        </div>
      ) : (
        <WeekView
          week={week}
          dayLabel={dayLabel}
          reservations={weekReservations}
          onSelect={setSelectedId}
          selectedId={selectedId}
          timeLabel={timeLabel}
        />
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
                {timeLabel(selected.startsAt)} · {selected.partySize} comensales ·{" "}
                {RESERVATION_STATUS_LABELS[selected.status]} · vía{" "}
                {CHANNEL_LABELS[selected.channel] ?? selected.channel}
                {selected.table ? ` · ${selected.table.name}` : " · sin mesa"}
                {selected.customerNotes ? ` · ${selected.customerNotes}` : ""}
                {selected.reminderSentAt
                  ? ` · Recordatorio enviado ${timeLabel(selected.reminderSentAt)}`
                  : ""}
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
  dragId,
  draggableStatuses,
  onDragStart,
  onDragEnd,
  onCellDrop,
  onLabelDrop,
  slotIndex,
  slotTimeLabel,
  TOTAL_SLOTS,
}: {
  label: string;
  sub: string | null;
  reservations: Reservation[];
  onSelect: (id: string) => void;
  selectedId: string | null;
  dragId: string | null;
  draggableStatuses: Reservation["status"][];
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onCellDrop: (slot: number) => void;
  onLabelDrop: () => void;
  slotIndex: (date: Date) => number;
  slotTimeLabel: (slot: number) => string;
  TOTAL_SLOTS: number;
}) {
  const isDropTarget = dragId !== null;
  const draggable = (r: Reservation) => draggableStatuses.includes(r.status);

  return (
    <>
      <div
        onDragOver={(e) => isDropTarget && e.preventDefault()}
        onDrop={() => isDropTarget && onLabelDrop()}
        className={`flex flex-col justify-center border-b border-r border-gray-200 bg-gray-50 px-2 py-1 ${
          isDropTarget ? "ring-1 ring-inset ring-emerald-400" : ""
        }`}
        title={isDropTarget ? "Soltar aquí: asignar mesa (misma hora)" : label}
      >
        <span className="truncate text-xs font-medium">{label}</span>
        {sub && <span className="text-[10px] text-gray-400">{sub}</span>}
      </div>
      {Array.from({ length: TOTAL_SLOTS }, (_, i) => (
        <div
          key={i}
          onDragOver={(e) => isDropTarget && e.preventDefault()}
          onDrop={() => isDropTarget && onCellDrop(i)}
          className={`border-b border-r border-gray-100 ${
            isDropTarget ? "bg-emerald-50/60" : ""
          }`}
          title={isDropTarget ? `Soltar a las ${slotTimeLabel(i)}` : undefined}
        />
      ))}
      {reservations.map((r) => {
        const start = new Date(r.startsAt);
        let idx = slotIndex(start);
        const span = Math.max(1, Math.round(r.durationMinutes / SLOT_MINUTES));
        idx = Math.max(0, Math.min(idx, TOTAL_SLOTS - span));
        return (
          <button
            key={r.id}
            draggable={draggable(r)}
            onDragStart={(e: DragEvent<HTMLButtonElement>) => {
              e.dataTransfer.setData("text/plain", r.id);
              e.dataTransfer.effectAllowed = "move";
              onDragStart(r.id);
            }}
            onDragEnd={onDragEnd}
            onClick={() => onSelect(r.id)}
            title={`${r.guest?.name ?? "Sin comensal"} · ${r.partySize}p${
              draggable(r) ? " · arrastra para mover" : ""
            }`}
            className={`z-10 m-0.5 overflow-hidden rounded border px-1.5 py-0.5 text-left text-[11px] leading-tight transition hover:brightness-95 ${
              CARD_STYLES[r.status]
            } ${selectedId === r.id ? "ring-2 ring-gray-800" : ""} ${
              dragId === r.id ? "opacity-40" : ""
            }`}
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

function WeekView({
  week,
  dayLabel,
  reservations,
  onSelect,
  selectedId,
  timeLabel,
}: {
  week: string[];
  dayLabel: (key: string) => string;
  reservations: Reservation[];
  onSelect: (id: string) => void;
  selectedId: string | null;
  timeLabel: (iso: string) => string;
}) {
  const today = todayKey();
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <div className="grid min-w-max grid-cols-7 divide-x divide-gray-200">
        {week.map((day) => {
          const dayRes = reservations
            .filter((r) => toDateKey(new Date(r.startsAt)) === day)
            .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
          const isToday = day === today;
          return (
            <div
              key={day}
              className={`min-w-[10rem] ${isToday ? "bg-emerald-50/40" : ""}`}
            >
              <div
                className={`sticky top-0 border-b border-gray-200 px-3 py-2 text-sm font-semibold capitalize ${
                  isToday ? "bg-emerald-100/70 text-emerald-900" : "bg-gray-50"
                }`}
              >
                {dayLabel(day)}
              </div>
              <div className="flex min-h-[20rem] flex-col gap-1.5 p-2">
                {dayRes.length === 0 ? (
                  <p className="text-xs text-gray-400">Sin reservas</p>
                ) : (
                  dayRes.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => onSelect(r.id)}
                      className={`rounded border px-2 py-1 text-left text-xs leading-tight transition hover:brightness-95 ${
                        CARD_STYLES[r.status]
                      } ${selectedId === r.id ? "ring-2 ring-gray-800" : ""}`}
                    >
                      <span className="block font-medium">
                        {timeLabel(r.startsAt)} · {r.partySize}p
                      </span>
                      <span className="block truncate">
                        {r.guest?.name ?? "Sin comensal"}
                      </span>
                      <span className="block truncate text-[10px] text-gray-500">
                        {r.table
                          ? `${r.table.name} (${r.table.capacity}p)`
                          : "sin mesa"}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
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
