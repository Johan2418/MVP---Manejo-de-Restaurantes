"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Restaurant, Tenant } from "@/lib/types";

export default function TenantPage() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [tenants, rests] = await Promise.all([
        api<Tenant[]>("/tenants"),
        api<Restaurant[]>(`/tenants/${tenantId}/restaurants`),
      ]);
      setTenant(tenants.find((t) => t.id === tenantId) ?? null);
      setRestaurants(rests);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    load();
  }, [tenantId]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api(`/tenants/${tenantId}/restaurants`, {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setName("");
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-8">
      <header>
        <Link
          href="/"
          className="text-sm text-gray-500 underline-offset-2 hover:underline"
        >
          ← Tenants
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {tenant?.name ?? "Restaurantes"}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Selecciona un restaurante para abrir su agenda.
        </p>
      </header>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <section className="flex flex-col gap-2">
        {restaurants.map((r) => (
          <Link
            key={r.id}
            href={`/tenants/${tenantId}/restaurants/${r.id}`}
            className="rounded-lg border border-gray-200 px-4 py-3 transition hover:border-gray-400 hover:shadow-sm"
          >
            <span className="font-medium">{r.name}</span>
            <span className="ml-2 text-xs text-gray-500">
              {r._count?.tables ?? 0} mesas · duración {r.defaultDurationMinutes} min
            </span>
          </Link>
        ))}
        {restaurants.length === 0 && (
          <p className="text-sm text-gray-400">Sin restaurantes todavía.</p>
        )}
      </section>

      <form onSubmit={onCreate} className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre del restaurante (ej. Sucursal Centro)"
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-500"
        />
        <button
          type="submit"
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700"
        >
          Crear restaurante
        </button>
      </form>
    </main>
  );
}
