import { IsEnum } from 'class-validator';

export class FinishChatDto {
  @IsEnum(['successfully_completed', 'unsuccessfully_completed', 'closed'])
  status: 'successfully_completed' | 'unsuccessfully_completed' | 'closed';
}

