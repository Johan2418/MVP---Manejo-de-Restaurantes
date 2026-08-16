"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CHANNEL_LABELS, RESERVATION_STATUS_LABELS } from "@reservas/shared";
import { api } from "@/lib/api";
import type { GuestProfile, GuestSummary } from "@/lib/types";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-EC", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ComensalesPage() {
  const { tenantId, restaurantId } = useParams<{
    tenantId: string;
    restaurantId: string;
  }>();
  const base = `/tenants/${tenantId}/restaurants/${restaurantId}`;

  const [q, setQ] = useState("");
  const [guests, setGuests] = useState<GuestSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [profile, setProfile] = useState<GuestProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(
    async (query: string) => {
      setLoading(true);
      setError(null);
      try {
        const rows = await api<GuestSummary[]>(
          `${base}/guests${query ? `?q=${encodeURIComponent(query)}` : ""}`,
        );
        setGuests(rows);
        setSelectedId((id) => (id && rows.some((g) => g.id === id) ? id : null));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [base],
  );

  useEffect(() => {
    load("");
  }, [load]);

  const openProfile = useCallback(
    async (guestId: string) => {
      setSelectedId(guestId);
      setProfileLoading(true);
      setError(null);
      try {
        setProfile(await api<GuestProfile>(`${base}/guests/${guestId}`));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setProfileLoading(false);
      }
    },
    [base],
  );

  async function saveProfile(updates: Partial<Pick<GuestProfile, "notes" | "preferences" | "consent" | "email">>) {
    if (!profile) return;
    setError(null);
    setNotice(null);
    try {
      const updated = await api<GuestProfile>(
        `/tenants/${tenantId}/guests/${profile.id}`,
        {
          method: "PATCH",
          body: JSON.stringify(updates),
        },
      );
      setProfile({ ...profile, ...updated });
      setNotice("Perfil actualizado.");
      await load(q);
    } catch (e) {
      setError((e as Error).message);
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
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Comensales</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-600">
          CRM propio: perfil de cada comensal con historial de reservas y
          conversaciones, preferencias y consentimiento de contacto (LOPDP).
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

      <div className="flex max-w-3xl flex-col gap-5">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            load(e.target.value);
          }}
          placeholder="Buscar por nombre o teléfono…"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-500"
        />

        {loading ? (
          <p className="text-sm text-gray-400">Cargando…</p>
        ) : guests.length === 0 ? (
          <p className="text-sm text-gray-400">
            {q
              ? "Sin resultados para esa búsqueda."
              : "Aún no hay comensales con reservas en este restaurante."}
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2">Comensal</th>
                  <th className="px-4 py-2">Visitas</th>
                  <th className="px-4 py-2">Reservas</th>
                  <th className="px-4 py-2">Última reserva</th>
                </tr>
              </thead>
              <tbody>
                {guests.map((g) => (
                  <tr
                    key={g.id}
                    onClick={() => openProfile(g.id)}
                    className={`cursor-pointer border-t border-gray-100 transition hover:bg-gray-50 ${
                      selectedId === g.id ? "bg-gray-50" : ""
                    }`}
                  >
                    <td className="px-4 py-2.5">
                      <span className="font-medium">{g.name}</span>
                      <span className="ml-2 text-xs text-gray-500">
                        {g.phone}
                      </span>
                      {!g.consent && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                          sin consentimiento
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">{g.visits}</td>
                    <td className="px-4 py-2.5">{g._count.reservations}</td>
                    <td className="px-4 py-2.5">
                      {g.reservations[0]
                        ? `${RESERVATION_STATUS_LABELS[g.reservations[0].status]} · ${formatDate(g.reservations[0].startsAt)}`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Perfil del comensal */}
        {selectedId && (
          <section className="rounded-lg border border-gray-200 p-5">
            {profileLoading || !profile ? (
              <p className="text-sm text-gray-400">Cargando perfil…</p>
            ) : (
              <GuestProfileView
                profile={profile}
                onSave={saveProfile}
              />
            )}
          </section>
        )}
      </div>
    </main>
  );
}

function GuestProfileView({
  profile,
  onSave,
}: {
  profile: GuestProfile;
  onSave: (
    updates: Partial<Pick<GuestProfile, "notes" | "preferences" | "consent" | "email">>,
  ) => Promise<void>;
}) {
  const [notes, setNotes] = useState(profile.notes ?? "");
  const [preferences, setPreferences] = useState(profile.preferences ?? "");
  const [email, setEmail] = useState(profile.email ?? "");
  const [consent, setConsent] = useState(profile.consent);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    await onSave({
      notes: notes || undefined,
      preferences: preferences || undefined,
      email: email || undefined,
      consent,
    });
    setSaving(false);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-lg font-semibold">{profile.name}</p>
          <p className="text-sm text-gray-600">
            {profile.phone}
            {profile.email ? ` · ${profile.email}` : ""}
          </p>
          <p className="mt-0.5 text-sm text-gray-600">
            {profile.visits} visitas completadas ·{" "}
            {profile.reservations.length} reservas en total
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="h-4 w-4 accent-gray-900"
            />
            Consentimiento de contacto (LOPDP)
          </label>
          <button
            onClick={submit}
            disabled={saving}
            className="self-end rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Guardar perfil"}
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-gray-600">
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-gray-500"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-600">
          Preferencias
          <input
            value={preferences}
            onChange={(e) => setPreferences(e.target.value)}
            placeholder="Mesa junto a la ventana, vino tinto…"
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-gray-500"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-600 sm:col-span-2">
          Notas internas
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Alergias, cumpleaños, incidencias…"
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-gray-500"
          />
        </label>
      </div>

      {/* Historial */}
      {profile.reservations.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium text-gray-700">
            Historial de reservas
          </p>
          <div className="max-h-64 overflow-y-auto rounded-md border border-gray-200">
            <table className="w-full text-left text-sm">
              <tbody>
                {profile.reservations.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t border-gray-100 first:border-t-0"
                  >
                    <td className="px-3 py-2">{formatDate(r.startsAt)}</td>
                    <td className="px-3 py-2">{r.partySize} comensales</td>
                    <td className="px-3 py-2 text-gray-600">
                      {r.table ? `${r.table.name} · ${r.table.capacity}p` : "Sin mesa"}
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      vía {CHANNEL_LABELS[r.channel] ?? r.channel}
                    </td>
                    <td className="px-3 py-2 font-medium">
                      {RESERVATION_STATUS_LABELS[r.status]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Conversaciones */}
      {profile.conversations.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium text-gray-700">
            Conversaciones recientes
          </p>
          <div className="flex flex-col gap-2">
            {profile.conversations.map((c) => (
              <div
                key={c.id}
                className="rounded-md border border-gray-200 px-3 py-2"
              >
                <p className="text-xs font-medium text-gray-500">
                  {CHANNEL_LABELS[c.channel] ?? c.channel} · {formatDate(c.lastMessageAt)}
                </p>
                {c.messages.slice(0, 2).map((m) => (
                  <p key={m.id} className="mt-1 text-sm text-gray-700">
                    <span className="text-xs text-gray-400">
                      {m.direction === "OUTBOUND" ? "→" : "←"}{" "}
                    </span>
                    {m.body}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
