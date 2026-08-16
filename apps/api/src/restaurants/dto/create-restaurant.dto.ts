import { Channel } from '@prisma/client';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class CreateRestaurantDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  /** Duración por defecto de una reserva (minutos). */
  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(720)
  defaultDurationMinutes?: number;

  /** Horas antes de la reserva en que se envía el recordatorio (Fase 3). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(168)
  reminderHoursBefore?: number;

  /**
   * Canal del recordatorio automático (Fase 3): PHONE = llamada IVR,
   * SMS/WHATSAPP = mensaje. Por defecto WHATSAPP.
   */
  @IsOptional()
  @IsIn([Channel.PHONE, Channel.SMS, Channel.WHATSAPP])
  reminderChannel?: Channel;

  /** Teléfono real del restaurante (destino de reenvío del IVR). */
  @IsOptional()
  @Matches(/^\+?[0-9\s()-]{7,20}$/, {
    message: 'Teléfono inválido (use +593999999999)',
  })
  phone?: string;

  /** Número Twilio asignado a este restaurante (destino de SMS/WhatsApp/llamadas). */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  twilioPhoneNumber?: string;
}
