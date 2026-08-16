import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class ConnectCalDavDto {
  /** URL del calendario CalDAV (ej. https://dav.example.com/calendars/rest/). */
  @IsUrl({ require_tld: false })
  url: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  username?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  password?: string;
}
