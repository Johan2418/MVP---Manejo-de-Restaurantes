import { BadRequestException } from '@nestjs/common';

/** Parsea "YYYY-MM-DD" a medianoche en hora local. Lanza 400 si el formato no es válido. */
export function parseLocalDate(dateStr: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) {
    throw new BadRequestException(
      `Fecha inválida: "${dateStr}" (formato esperado YYYY-MM-DD)`,
    );
  }
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

/** Clave "YYYY-MM-DD" en hora local de un Date. */
export function toDateKey(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export function endOfDay(date: Date): Date {
  return addMinutes(date, 24 * 60);
}

/** "HH:MM" en hora local a partir de un Date. */
export function formatHHMM(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`;
}

/** Combina una fecha local con una hora "HH:MM". */
export function combineDateAndTime(date: Date, time: string): Date {
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    hours,
    minutes,
  );
}

/**
 * Fecha/hora local "YYYY-MM-DDTHH:mm:ss" (sin offset) para una zona IANA.
 * Se usa al crear eventos en Google Calendar junto con el campo timeZone.
 */
export function toLocalDateTime(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  // Algunos motores devuelven "24" para medianoche en hora 12:00; normalizar.
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}:${get('second')}`;
}
