import { IsBoolean } from 'class-validator';

export class ToggleChatSettingDto {
  @IsBoolean()
  value: boolean;
}


