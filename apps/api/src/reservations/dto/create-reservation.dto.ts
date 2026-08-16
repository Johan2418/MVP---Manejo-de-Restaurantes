import { Channel, ReservationStatus } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateReservationDto {
  /** Comensal existente (tenantId). Alternativa a guestName+guestPhone. */
  @IsOptional()
  @IsString()
  guestId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  guestName?: string;

  @IsOptional()
  @Matches(/^\+?[0-9\s()-]{7,20}$/, {
    message: 'Teléfono inválido (use +593999999999)',
  })
  guestPhone?: string;

  /** Fecha/hora de inicio en ISO 8601. */
  @IsISO8601()
  startsAt: string;

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(720)
  durationMinutes?: number;

  @IsInt()
  @Min(1)
  @Max(50)
  partySize: number;

  @IsOptional()
  @IsString()
  tableId?: string;

  /** Solo REQUESTED o CONFIRMED al crear. */
  @IsOptional()
  @IsEnum(ReservationStatus)
  status?: ReservationStatus;

  @IsOptional()
  @IsEnum(Channel)
  channel?: Channel;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  customerNotes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  internalNotes?: string;
}
