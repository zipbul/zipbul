import { Field } from '@zipbul/baker';
import { isString, isIn } from '@zipbul/baker/rules';

export class SocialDto {
  @Field(isIn(['twitter', 'github', 'linkedin']))
  platform: string;

  @Field(isString)
  url: string;
}
