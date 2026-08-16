import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ReplyMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  body: string;
}
