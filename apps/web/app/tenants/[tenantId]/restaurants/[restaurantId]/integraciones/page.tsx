"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Integration } from "@/lib/types";

const PROVIDER_LABELS: Record<string, string> = {
  GOOGLE_CALENDAR: "Google Calendar",
  CALDAV: "CalDAV (Nextcloud, iCloud, Zimbra…)",
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
    } else if (searchParams.get("connected") === "caldav") {
      setNotice("CalDAV conectado. La sincronización inicial ya está en marcha.");
    }
  }, [searchParams]);

  const google = integrations.find((i) => i.provider === "GOOGLE_CALENDAR");
  const caldav = integrations.find((i) => i.provider === "CALDAV");

  async function connectGoogle() {
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

  async function sync(integration: Integration) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api<{ pushed: number; pulled: number; deleted: number }>(
        `${base}/integrations/${integration.id}/sync`,
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

  async function disconnect(provider: "google" | "caldav") {
    setBusy(true);
    setError(null);
    try {
      await api(`${base}/integrations/${provider}/disconnect`, {
        method: "POST",
      });
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
          Sincronización 2-way con tu calendario: las reservas confirmadas se
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
      ) : (
        <div className="flex max-w-3xl flex-col gap-5">
          {/* ---- Google Calendar ---- */}
          {google ? (
            <ConnectedCard
              integration={google}
              busy={busy}
              onSync={() => sync(google)}
              onDisconnect={() => disconnect("google")}
            />
          ) : (
            <section className="rounded-lg border border-gray-200 p-5">
              <p className="font-medium">Google Calendar</p>
              <p className="mt-1 text-sm text-gray-600">
                Conecta el calendario del restaurante para ver cada reserva
                confirmada como un evento y mantener la agenda en sincronía
                desde cualquier dispositivo.
              </p>
              <button
                onClick={connectGoogle}
                disabled={busy}
                className="mt-4 rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
              >
                {busy ? "Redirigiendo…" : "Conectar Google Calendar"}
              </button>
              <p className="mt-2 text-xs text-gray-400">
                Requiere GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en las API Keys
                del proyecto, y la redirect URI registrada en Google Cloud
                Console.
              </p>
            </section>
          )}

          {/* ---- CalDAV ---- */}
          {caldav ? (
            <ConnectedCard
              integration={caldav}
              busy={busy}
              onSync={() => sync(caldav)}
              onDisconnect={() => disconnect("caldav")}
            />
          ) : (
            <CalDavConnectCard
              base={base}
              busy={busy}
              onConnected={async () => {
                await load();
              }}
              onBusy={setBusy}
              onError={setError}
            />
          )}
        </div>
      )}
    </main>
  );
}

function ConnectedCard({
  integration,
  busy,
  onSync,
  onDisconnect,
}: {
  integration: Integration;
  busy: boolean;
  onSync: () => Promise<void>;
  onDisconnect: () => Promise<void>;
}) {
  return (
    <section className="rounded-lg border border-gray-200 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium">
            {PROVIDER_LABELS[integration.provider] ?? integration.provider}
          </p>
          <p className="mt-0.5 text-sm text-gray-600">
            Estado:{" "}
            <span
              className={
                integration.status === "CONNECTED"
                  ? "font-medium text-emerald-700"
                  : integration.status === "ERROR"
                    ? "font-medium text-red-700"
                    : ""
              }
            >
              {STATUS_LABELS[integration.status] ?? integration.status}
            </span>
          </p>
          <p className="mt-0.5 text-sm text-gray-600">
            Última sincronización: {formatDate(integration.lastSyncedAt)}
          </p>
          {integration.lastError && (
            <p className="mt-0.5 text-sm text-red-700">
              Último error: {integration.lastError}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onSync}
            disabled={busy}
            className="rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {busy ? "Sincronizando…" : "Sincronizar ahora"}
          </button>
          <button
            onClick={onDisconnect}
            disabled={busy}
            className="rounded-md border border-red-300 px-4 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            Desconectar
          </button>
        </div>
      </div>
    </section>
  );
}

function CalDavConnectCard({
  base,
  busy,
  onConnected,
  onBusy,
  onError,
}: {
  base: string;
  busy: boolean;
  onConnected: () => Promise<void>;
  onBusy: (b: boolean) => void;
  onError: (msg: string | null) => void;
}) {
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    onBusy(true);
    onError(null);
    try {
      await api(`${base}/integrations/caldav/connect`, {
        method: "POST",
        body: JSON.stringify({ url, username: username || undefined, password: password || undefined }),
      });
      setUrl("");
      setUsername("");
      setPassword("");
      await onConnected();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      onBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-gray-200 p-5">
      <p className="font-medium">CalDAV (Nextcloud, iCloud, Zimbra…)</p>
      <p className="mt-1 text-sm text-gray-600">
        Conecta cualquier servidor CalDAV con su URL y credenciales. La
        sincronización es idéntica a Google Calendar: cada reserva confirmada
        es un evento y los cambios externos se aplican a la agenda.
      </p>
      <form onSubmit={onSubmit} className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs text-gray-600 sm:col-span-3">
          URL del calendario
          <input
            required
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://dav.example.com/calendars/reservas/"
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-gray-500"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-600">
          Usuario
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="off"
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-gray-500"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-600">
          Contraseña / app-password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-gray-500"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="self-end rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {busy ? "Conectando…" : "Conectar CalDAV"}
        </button>
      </form>
    </section>
  );
}
