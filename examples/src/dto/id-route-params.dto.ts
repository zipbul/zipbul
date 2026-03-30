import { IsString } from '@zipbul/common';

export class IdRouteParams {
  @IsString()
  id: string;
}
