"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Integration } from "@/lib/types";

const PROVIDER_LABELS: Record<string, string> = {
  GOOGLE_CALENDAR: "Google Calendar",
  CALDAV: "CalDAV",
  CRM_HUBSPOT: "CRM",
};

const STATUS_LABELS: Record<string, string> = {
  CONNECTED: "Conectado",
  DISCONNECTED: "Desconectado",
  ERROR: "Error",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("es-EC", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function IntegracionesPage() {
  const { tenantId, restaurantId } = useParams<{
    tenantId: string;
    restaurantId: string;
  }>();
  const searchParams = useSearchParams();

  const base = `/tenants/${tenantId}/restaurants/${restaurantId}`;
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await api<Integration[]>(`${base}/integrations`);
      setIntegrations(rows);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (searchParams.get("connected") === "google") {
      setNotice(
        "Google Calendar conectado. La sincronización inicial ya está en marcha.",
      );
    }
  }, [searchParams]);

  const google = integrations.find(
    (i) => i.provider === "GOOGLE_CALENDAR",
  );

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const { url } = await api<{ url: string }>(
        `${base}/integrations/google/connect`,
        { method: "POST" },
      );
      window.location.href = url;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function sync() {
    if (!google) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api<{ pushed: number; pulled: number; deleted: number }>(
        `${base}/integrations/${google.id}/sync`,
        { method: "POST" },
      );
      setNotice(
        `Sincronización completada: ${res.pushed} reservas al calendario, ` +
          `${res.pulled} cambios del calendario, ${res.deleted} eventos limpiados.`,
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!google) return;
    setBusy(true);
    setError(null);
    try {
      await api(`${base}/integrations/google/disconnect`, { method: "POST" });
      setNotice("Integración desconectada.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex w-full flex-1 flex-col gap-5 p-8">
      <header>
        <Link
          href={base}
          className="text-sm text-gray-500 underline-offset-2 hover:underline"
        >
          ← Agenda
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Integraciones
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-600">
          Sincronización 2-way con Google Calendar: las reservas confirmadas se
          reflejan como eventos y los cambios hechos en el calendario se aplican
          a la agenda (reprogramación y cancelaciones). Se sincroniza
          automáticamente cada 15 minutos y ante cada cambio de reserva.
        </p>
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

      {loading ? (
        <p className="text-sm text-gray-400">Cargando…</p>
      ) : google ? (
        <section className="max-w-2xl rounded-lg border border-gray-200 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-medium">{PROVIDER_LABELS[google.provider]}</p>
              <p className="mt-0.5 text-sm text-gray-600">
                Estado:{" "}
                <span
                  className={
                    google.status === "CONNECTED"
                      ? "font-medium text-emerald-700"
                      : google.status === "ERROR"
                        ? "font-medium text-red-700"
                        : ""
                  }
                >
                  {STATUS_LABELS[google.status] ?? google.status}
                </span>
              </p>
              <p className="mt-0.5 text-sm text-gray-600">
                Última sincronización: {formatDate(google.lastSyncedAt)}
              </p>
              {google.lastError && (
                <p className="mt-0.5 text-sm text-red-700">
                  Último error: {google.lastError}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={sync}
                disabled={busy}
                className="rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
              >
                {busy ? "Sincronizando…" : "Sincronizar ahora"}
              </button>
              <button
                onClick={disconnect}
                disabled={busy}
                className="rounded-md border border-red-300 px-4 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                Desconectar
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section className="max-w-2xl rounded-lg border border-gray-200 p-5">
          <p className="font-medium">Google Calendar</p>
          <p className="mt-1 text-sm text-gray-600">
            Conecta el calendario del restaurante para ver cada reserva
            confirmada como un evento y mantener la agenda en sincronía desde
            cualquier dispositivo.
          </p>
          <button
            onClick={connect}
            disabled={busy}
            className="mt-4 rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {busy ? "Redirigiendo…" : "Conectar Google Calendar"}
          </button>
          <p className="mt-2 text-xs text-gray-400">
            Requiere GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en las API Keys del
            proyecto, y la redirect URI registrada en Google Cloud Console.
          </p>
        </section>
      )}
    </main>
  );
}
