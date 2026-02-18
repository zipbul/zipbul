import { IsIn, IsString } from '@zipbul/core';

export class SocialDto {
  @IsIn(['twitter', 'github', 'linkedin'])
  platform: string;

  @IsString()
  url: string;
}
