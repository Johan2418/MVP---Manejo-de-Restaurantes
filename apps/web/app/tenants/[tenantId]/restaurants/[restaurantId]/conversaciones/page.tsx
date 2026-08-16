"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { CHANNEL_LABELS } from "@reservas/shared";
import type { Channel } from "@reservas/shared";
import { api } from "@/lib/api";
import type { Conversation, Message } from "@/lib/types";

const CHANNEL_BADGES: Record<Channel, string> = {
  WHATSAPP: "border-emerald-200 bg-emerald-50 text-emerald-700",
  SMS: "border-sky-200 bg-sky-50 text-sky-700",
  PHONE: "border-amber-200 bg-amber-50 text-amber-700",
  WEB: "border-gray-200 bg-gray-100 text-gray-600",
};

function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString("es-EC", {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (sameDay) return time;
  return `${d.toLocaleDateString("es-EC", {
    day: "2-digit",
    month: "short",
  })} ${time}`;
}

export default function ConversationsPage() {
  const { tenantId, restaurantId } = useParams<{
    tenantId: string;
    restaurantId: string;
  }>();

  const base = `/tenants/${tenantId}/restaurants/${restaurantId}`;
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const threadRef = useRef<HTMLDivElement>(null);

  // Refresco periódico del panel (simula una bandeja en vivo).
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 10_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await api<Conversation[]>(`${base}/conversations`);
        if (cancelled) return;
        setConversations(list);
        setSelectedId((cur) =>
          cur && list.some((c) => c.id === cur) ? cur : (list[0]?.id ?? null),
        );
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base, tick]);

  const selected = useMemo(
    () => conversations.find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId],
  );

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const msgs = await api<Message[]>(
          `${base}/conversations/${selectedId}/messages`,
        );
        if (cancelled) return;
        setMessages(msgs);
        // Marcar como leído al abrir el hilo.
        if (selected?.unread && selected.unread > 0) {
          api(`${base}/conversations/${selectedId}/read`, {
            method: "POST",
          }).catch(() => {});
          setConversations((list) =>
            list.map((c) =>
              c.id === selectedId ? { ...c, unread: 0 } : c,
            ),
          );
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base, selectedId, selected?.unread, tick]);

  // Auto-scroll al último mensaje.
  useEffect(() => {
    threadRef.current?.scrollTo({
      top: threadRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length]);

  function selectConversation(id: string) {
    setSelectedId(id);
    setTick((n) => n + 1);
  }

  async function onSend(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || !selectedId || sending) return;
    setSending(true);
    setError(null);
    try {
      await api(`${base}/conversations/${selectedId}/reply`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      setDraft("");
      setTick((n) => n + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
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
          Conversaciones
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          SMS, WhatsApp y llamadas entrantes. Responde aquí: el mensaje sale por
          el mismo canal.
        </p>
      </header>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="grid min-h-[28rem] flex-1 grid-cols-1 overflow-hidden rounded-lg border border-gray-200 lg:grid-cols-[20rem_1fr]">
        {/* Lista de hilos */}
        <aside className="border-b border-gray-200 bg-gray-50 lg:border-b-0 lg:border-r">
          {conversations.length === 0 ? (
            <p className="p-4 text-sm text-gray-400">
              Sin conversaciones todavía. Cuando un cliente escriba al número
              Twilio del restaurante (SMS/WhatsApp) o llame, el hilo aparecerá
              aquí.
            </p>
          ) : (
            <ul className="divide-y divide-gray-200">
              {conversations.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => selectConversation(c.id)}
                    className={`flex w-full flex-col gap-1 px-4 py-3 text-left transition hover:bg-white ${
                      c.id === selectedId ? "bg-white ring-1 ring-inset ring-gray-300" : ""
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">
                        {c.guest?.name ?? c.guest?.phone ?? "Sin comensal"}
                      </span>
                      <span className="shrink-0 text-[10px] text-gray-400">
                        {formatTime(c.lastMessageAt)}
                      </span>
                    </span>
                    <span className="flex items-center justify-between gap-2">
                      <span
                        className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${
                          CHANNEL_BADGES[c.channel]
                        }`}
                      >
                        {CHANNEL_LABELS[c.channel]}
                      </span>
                      {c.unread > 0 && (
                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[10px] font-semibold text-white">
                          {c.unread}
                        </span>
                      )}
                    </span>
                    <span className="truncate text-xs text-gray-500">
                      {c.lastMessage?.body ?? "Sin mensajes"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* Hilo */}
        <section className="flex min-w-0 flex-col bg-white">
          {selected ? (
            <>
              <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">
                    {selected.guest?.name ?? selected.guest?.phone ?? "Sin comensal"}
                  </p>
                  <p className="text-xs text-gray-500">
                    {selected.guest?.phone ?? ""}
                    {selected.guest?.phone ? " · " : ""}
                    {CHANNEL_LABELS[selected.channel]}
                  </p>
                </div>
                <span
                  className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${
                    CHANNEL_BADGES[selected.channel]
                  }`}
                >
                  {CHANNEL_LABELS[selected.channel]}
                </span>
              </div>

              <div
                ref={threadRef}
                className="flex flex-1 flex-col gap-2 overflow-y-auto bg-gray-50 p-4"
              >
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex ${m.direction === "OUTBOUND" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[75%] rounded-lg px-3 py-2 text-sm shadow-sm ${
                        m.direction === "OUTBOUND"
                          ? "bg-gray-900 text-white"
                          : "border border-gray-200 bg-white text-gray-900"
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words">{m.body}</p>
                      <p
                        className={`mt-1 text-[10px] ${
                          m.direction === "OUTBOUND"
                            ? "text-gray-400"
                            : "text-gray-400"
                        }`}
                      >
                        {formatTime(m.sentAt)}
                        {m.direction === "OUTBOUND" &&
                          m.status === "FAILED" && (
                            <span className="ml-1 font-medium text-red-400">
                              · no enviado
                            </span>
                          )}
                      </p>
                    </div>
                  </div>
                ))}
                {messages.length === 0 && (
                  <p className="text-sm text-gray-400">
                    Sin mensajes en este hilo todavía.
                  </p>
                )}
              </div>

              <form
                onSubmit={onSend}
                className="flex gap-2 border-t border-gray-200 p-3"
              >
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={`Responder por ${CHANNEL_LABELS[selected.channel]}…`}
                  className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-500"
                />
                <button
                  type="submit"
                  disabled={sending || !draft.trim()}
                  className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:opacity-50"
                >
                  {sending ? "Enviando…" : "Enviar"}
                </button>
              </form>
            </>
          ) : (
            <p className="p-4 text-sm text-gray-400">
              Selecciona un hilo para ver la conversación.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
