import { IsString, IsNotEmpty, IsOptional, IsNumber, IsUUID } from 'class-validator';

export class SendMessageDto {
  @IsUUID()
  @IsNotEmpty()
  chatId: string;

  @IsString()
  @IsNotEmpty()
  text: string;

  @IsNumber()
  @IsOptional()
  productId?: number;
}

export class TypingDto {
  @IsUUID()
  @IsNotEmpty()
  chatId: string;
}

export class JoinChatDto {
  @IsUUID()
  @IsNotEmpty()
  chatId: string;
}

export class CreateChatDto {
  @IsNumber()
  @IsNotEmpty()
  buyerId: number;

  @IsNumber()
  @IsNotEmpty()
  sellerId: number;
}

