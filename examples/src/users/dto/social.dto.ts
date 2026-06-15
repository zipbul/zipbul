import { Field } from '@zipbul/baker';
import { isString, isIn } from '@zipbul/baker/rules';
import { Recipe } from '@zipbul/core';

@Recipe
export class SocialDto {
  @Field(isIn(['twitter', 'github', 'linkedin']))
  platform: string;

  @Field(isString)
  url: string;
}
