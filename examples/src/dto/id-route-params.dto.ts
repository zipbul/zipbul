import { Field } from '@zipbul/baker';
import { isString } from '@zipbul/baker/rules';
import { Recipe } from '@zipbul/core';

@Recipe
export class IdRouteParams {
  @Field(isString)
  id: string;
}
