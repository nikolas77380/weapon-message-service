import { IsArray, IsOptional, IsString } from 'class-validator';

export class MarkAsReadDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  messageIds?: string[];
}

