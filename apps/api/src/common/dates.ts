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
