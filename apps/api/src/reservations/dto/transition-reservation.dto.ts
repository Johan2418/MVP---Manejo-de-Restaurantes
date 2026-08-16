import { ReservationStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class TransitionReservationDto {
  @IsEnum(ReservationStatus)
  status: ReservationStatus;
}
