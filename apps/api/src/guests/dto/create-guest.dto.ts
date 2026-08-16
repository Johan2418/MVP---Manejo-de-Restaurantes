import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateGuestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  /** Teléfono en formato E.164 (ej. +593999999999) o nacional. */
  @Matches(/^\+?[0-9\s()-]{7,20}$/, {
    message: 'Teléfono inválido (use +593999999999)',
  })
  phone: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  preferences?: string;

  /** Consentimiento explícito para contacto/almacenamiento (LOPDP). */
  @IsOptional()
  @IsBoolean()
  consent?: boolean;
}
