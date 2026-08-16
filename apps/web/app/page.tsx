export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-semibold tracking-tight">
        Panel de reservas
      </h1>
      <p className="max-w-md text-center text-sm text-gray-500">
        Sistema SaaS multi-tenant de automatización de reservas para
        restaurantes. Fase 0 completada: fundación del monorepo (API NestJS,
        web Next.js, PostgreSQL, Redis).
      </p>
      <p className="font-mono text-xs text-gray-400">
        La agenda, los canales (llamadas/SMS/WhatsApp) y las automatizaciones
        llegan en las próximas fases.
      </p>
    </main>
  );
}
