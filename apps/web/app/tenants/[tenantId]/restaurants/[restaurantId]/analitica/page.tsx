"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CHANNEL_LABELS } from "@reservas/shared";
import { api } from "@/lib/api";
import type { AnalyticsOverview } from "@/lib/types";

function pctColor(pct: number): string {
  if (pct >= 90) return "bg-red-500";
  if (pct >= 70) return "bg-amber-500";
  if (pct >= 40) return "bg-emerald-500";
  return "bg-sky-500";
}

export default function AnaliticaPage() {
  const { tenantId, restaurantId } = useParams<{
    tenantId: string;
    restaurantId: string;
  }>();
  const base = `/tenants/${tenantId}/restaurants/${restaurantId}`;

  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api<AnalyticsOverview>(`${base}/analytics/overview?days=14`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <main className="flex w-full flex-1 flex-col gap-5 p-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            href={base}
            className="text-sm text-gray-500 underline-offset-2 hover:underline"
          >
            ← Agenda
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Analítica
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">
            Previsión de ocupación para los próximos días e informe de canales
            de los últimos 30 días.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="rounded-md border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? "Actualizando…" : "Actualizar"}
        </button>
      </header>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {loading && !data ? (
        <p className="text-sm text-gray-400">Cargando…</p>
      ) : data ? (
        <div className="flex max-w-3xl flex-col gap-5">
          {/* Métricas principales */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Capacidad total"
              value={String(data.capacity)}
              sub="comensales simultáneos"
            />
            <StatCard
              label="Hoy"
              value={`${data.today.count}`}
              sub={`${data.today.covers} comensales reservados`}
            />
            <StatCard
              label="Próximos 7 días"
              value={`${data.upcoming.count}`}
              sub={`${data.upcoming.covers} comensales reservados`}
            />
            <div className="rounded-lg border border-gray-200 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500">
                Tasas (30 días)
              </p>
              <div className="mt-2 flex flex-col gap-1 text-sm">
                <p>
                  Confirmación:{" "}
                  <span className="font-medium text-emerald-700">
                    {data.rates.confirmationRate}%
                  </span>
                </p>
                <p>
                  Cancelación:{" "}
                  <span className="font-medium text-red-700">
                    {data.rates.cancellationRate}%
                  </span>
                </p>
                <p>
                  No-show:{" "}
                  <span className="font-medium text-amber-700">
                    {data.rates.noShowRate}%
                  </span>
                </p>
              </div>
            </div>
          </div>

          {/* Previsión de ocupación */}
          <section className="rounded-lg border border-gray-200 p-5">
            <p className="font-medium">Previsión de ocupación (14 días)</p>
            <div className="mt-4 flex flex-col gap-2">
              {data.occupancy.map((d) => (
                <div
                  key={d.date}
                  className="grid items-center gap-2 sm:grid-cols-[9rem_1fr_9rem]"
                >
                  <span className="text-sm capitalize text-gray-700">
                    {d.label}
                  </span>
                  <div className="h-5 overflow-hidden rounded bg-gray-100">
                    <div
                      className={`h-full rounded ${pctColor(d.occupancyPct)}`}
                      style={{ width: `${Math.min(d.occupancyPct, 100)}%` }}
                      title={`${d.count} reservas · ${d.covers} comensales`}
                    />
                  </div>
                  <span className="text-right text-xs text-gray-500">
                    {d.covers}/{data.capacity} · {d.occupancyPct}%
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Informe de canales */}
          <section className="rounded-lg border border-gray-200 p-5">
            <p className="font-medium">Reservas por canal (30 días)</p>
            {data.channels.length === 0 ? (
              <p className="mt-2 text-sm text-gray-400">
                Sin reservas en el período.
              </p>
            ) : (
              <div className="mt-3 flex flex-col gap-3">
                {data.channels.map((c) => (
                  <div key={c.channel}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">
                        {CHANNEL_LABELS[c.channel] ?? c.channel}
                      </span>
                      <span className="text-gray-500">
                        {c.total} ({c.sharePct}%)
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-gray-600">
                      <span className="text-amber-700">
                        {c.requested} solicitadas
                      </span>
                      <span className="text-emerald-700">
                        {c.confirmed} confirmadas
                      </span>
                      <span className="text-sky-700">{c.completed} completadas</span>
                      <span className="text-red-700">{c.cancelled} canceladas</span>
                      <span className="text-gray-500">{c.noShow} no-show</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <p className="mt-5 font-medium">Conversaciones por canal (30 días)</p>
            {data.conversationsByChannel.length === 0 ? (
              <p className="mt-2 text-sm text-gray-400">
                Sin conversaciones en el período.
              </p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {data.conversationsByChannel.map((c) => (
                  <span
                    key={c.channel}
                    className="rounded-full border border-gray-300 px-3 py-1 text-sm"
                  >
                    {CHANNEL_LABELS[c.channel] ?? c.channel}:{" "}
                    <span className="font-medium">{c.count}</span>
                  </span>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : null}
    </main>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-0.5 text-xs text-gray-500">{sub}</p>
    </div>
  );
}
