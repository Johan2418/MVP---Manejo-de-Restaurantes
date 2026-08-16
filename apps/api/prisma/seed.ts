/**
 * Seed de datos demo (Fase 1).
 * Ejecutar con: npm run db:seed   (o: npx prisma db seed)
 * Es idempotente: reemplaza mesas/horarios/reservas del restaurante demo.
 */
import { Channel, PrismaClient, ReservationStatus } from '@prisma/client';

const prisma = new PrismaClient();

const TENANT_SLUG = 'la-terraza';
const RESTAURANT_NAME = 'La Terraza Centro';

function atTime(dayOffset: number, hour: number, minute: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d;
}

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: TENANT_SLUG },
    update: {},
    create: { slug: TENANT_SLUG, name: 'La Terraza' },
  });

  const restaurant = await prisma.restaurant.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: RESTAURANT_NAME } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: RESTAURANT_NAME,
      timezone: 'America/Guayaquil',
      defaultDurationMinutes: 90,
      phone: '+593222345678',
      twilioPhoneNumber: '+593987650001',
    },
  });

  // Reinicia los datos de negocio del restaurante demo (idempotente).
  await prisma.reservation.deleteMany({ where: { restaurantId: restaurant.id } });
  await prisma.table.deleteMany({ where: { restaurantId: restaurant.id } });
  await prisma.openingHour.deleteMany({ where: { restaurantId: restaurant.id } });
  await prisma.message.deleteMany({
    where: { conversation: { restaurantId: restaurant.id } },
  });
  await prisma.conversation.deleteMany({ where: { restaurantId: restaurant.id } });

  // --- Mesas ---
  const tablesData = [
    { name: 'M1', capacity: 2, zone: 'Sala' },
    { name: 'M2', capacity: 2, zone: 'Sala' },
    { name: 'M3', capacity: 4, zone: 'Sala' },
    { name: 'M4', capacity: 4, zone: 'Sala' },
    { name: 'T1', capacity: 4, zone: 'Terraza' },
    { name: 'T2', capacity: 6, zone: 'Terraza' },
    { name: 'T3', capacity: 6, zone: 'Terraza' },
    { name: 'B1', capacity: 3, zone: 'Bar' },
    { name: 'B2', capacity: 3, zone: 'Bar' },
  ];
  const tables: Record<string, string> = {};
  for (const t of tablesData) {
    const created = await prisma.table.create({
      data: { ...t, restaurantId: restaurant.id },
    });
    tables[created.name] = created.id;
  }

  // --- Horarios (mié-dom cena; sáb-dom también almuerzo) ---
  const openingData = [
    { dayOfWeek: 2, openTime: '18:00', closeTime: '23:00' },
    { dayOfWeek: 3, openTime: '18:00', closeTime: '23:00' },
    { dayOfWeek: 4, openTime: '18:00', closeTime: '23:00' },
    { dayOfWeek: 5, openTime: '18:00', closeTime: '23:00' },
    { dayOfWeek: 6, openTime: '12:00', closeTime: '15:00' },
    { dayOfWeek: 6, openTime: '18:00', closeTime: '23:00' },
    { dayOfWeek: 0, openTime: '12:00', closeTime: '15:00' },
    { dayOfWeek: 0, openTime: '18:00', closeTime: '23:00' },
  ];
  for (const o of openingData) {
    await prisma.openingHour.create({
      data: { ...o, restaurantId: restaurant.id },
    });
  }

  // --- Comensales (consentimiento explícito LOPDP) ---
  const guestsData = [
    { name: 'María Fernández', phone: '+593991234567' },
    { name: 'Carlos Andrade', phone: '+593987654321' },
    { name: 'Lucía Pérez', phone: '+593976543210' },
  ];
  const guests: Record<string, string> = {};
  for (const g of guestsData) {
    const existing = await prisma.guest.findUnique({
      where: { tenantId_phone: { tenantId: tenant.id, phone: g.phone } },
    });
    const guest =
      existing ??
      (await prisma.guest.create({
        data: { ...g, tenantId: tenant.id, consent: true },
      }));
    guests[guest.name] = guest.id;
  }

  // --- Reservas demo (hoy y mañana) ---
  const reservationData = [
    {
      guestName: 'María Fernández',
      tableName: 'M1',
      startsAt: atTime(0, 19, 0),
      partySize: 2,
      status: ReservationStatus.CONFIRMED,
      channel: Channel.WHATSAPP,
      customerNotes: 'Celebración de aniversario',
    },
    {
      guestName: 'Carlos Andrade',
      tableName: 'T1',
      startsAt: atTime(0, 19, 30),
      partySize: 4,
      status: ReservationStatus.REQUESTED,
      channel: Channel.WEB,
    },
    {
      guestName: 'Lucía Pérez',
      tableName: 'M3',
      startsAt: atTime(0, 20, 0),
      partySize: 4,
      status: ReservationStatus.CONFIRMED,
      channel: Channel.PHONE,
      customerNotes: 'Alergia al maní',
    },
    {
      guestName: 'María Fernández',
      tableName: 'B1',
      startsAt: atTime(0, 21, 0),
      partySize: 2,
      status: ReservationStatus.CONFIRMED,
      channel: Channel.SMS,
    },
    {
      guestName: 'Carlos Andrade',
      tableName: 'T2',
      startsAt: atTime(1, 19, 0),
      partySize: 6,
      status: ReservationStatus.REQUESTED,
      channel: Channel.WEB,
      customerNotes: 'Cumpleaños',
    },
  ];

  for (const r of reservationData) {
    const { guestName, tableName, ...rest } = r;
    await prisma.reservation.create({
      data: {
        ...rest,
        tenantId: tenant.id,
        restaurantId: restaurant.id,
        guestId: guests[guestName],
        tableId: tables[tableName],
        durationMinutes: 90,
      },
    });
  }

  // --- Conversaciones demo (Fase 2 — canales) ---
  const now = Date.now();
  const maria = await prisma.guest.findUniqueOrThrow({
    where: { tenantId_phone: { tenantId: tenant.id, phone: '+593991234567' } },
  });
  const lucia = await prisma.guest.findUniqueOrThrow({
    where: { tenantId_phone: { tenantId: tenant.id, phone: '+593976543210' } },
  });

  const whatsappConv = await prisma.conversation.create({
    data: {
      tenantId: tenant.id,
      restaurantId: restaurant.id,
      guestId: maria.id,
      channel: 'WHATSAPP',
      channelAddress: restaurant.twilioPhoneNumber!,
      peerAddress: maria.phone,
      lastMessageAt: new Date(now - 50 * 60_000),
    },
  });
  await prisma.message.createMany({
    data: [
      {
        conversationId: whatsappConv.id,
        direction: 'INBOUND',
        body: 'Hola, quiero reservar una mesa para dos el viernes a las 8pm.',
        sentAt: new Date(now - 60 * 60_000),
      },
      {
        conversationId: whatsappConv.id,
        direction: 'OUTBOUND',
        body: '¡Hola María! Claro, le apartamos la mesa M1 para el viernes 20:00. ¿Le confirmo por este medio?',
        sentAt: new Date(now - 50 * 60_000),
      },
    ],
  });

  const smsConv = await prisma.conversation.create({
    data: {
      tenantId: tenant.id,
      restaurantId: restaurant.id,
      guestId: lucia.id,
      channel: 'SMS',
      channelAddress: restaurant.twilioPhoneNumber!,
      peerAddress: lucia.phone,
      unread: 1,
      lastMessageAt: new Date(now - 5 * 60_000),
    },
  });
  await prisma.message.create({
    data: {
      conversationId: smsConv.id,
      direction: 'INBOUND',
      body: '¿Tienen mesa para 4 el sábado al mediodía?',
      sentAt: new Date(now - 5 * 60_000),
    },
  });

  console.log('Seed completado:');
  console.log(`  Tenant:   ${tenant.slug} (${tenant.id})`);
  console.log(`  Restaurante: ${restaurant.name} (${restaurant.id})`);
  console.log(`  Mesas:    ${tablesData.length}`);
  console.log(`  Horarios: ${openingData.length} filas`);
  console.log(`  Comensales: ${guestsData.length}`);
  console.log(`  Reservas: ${reservationData.length}`);
  console.log(`  Conversaciones demo: 2 (WhatsApp, SMS)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
