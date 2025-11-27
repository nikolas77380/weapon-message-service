import { IsArray, IsNumber, IsOptional, IsString, ArrayMinSize } from 'class-validator';

export class CreateChatDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsNumber({}, { each: true })
  participantIds: number[];

  @IsOptional()
  @IsNumber()
  productId?: number;

  @IsOptional()
  @IsString()
  topic?: string;
}

