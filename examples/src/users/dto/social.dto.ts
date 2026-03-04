import { IsIn, IsString } from '@zipbul/common';

export class SocialDto {
  @IsIn(['twitter', 'github', 'linkedin'])
  platform: string;

  @IsString()
  url: string;
}
