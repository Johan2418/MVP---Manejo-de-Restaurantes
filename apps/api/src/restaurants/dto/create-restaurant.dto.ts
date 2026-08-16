import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

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
}
