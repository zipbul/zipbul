import { Field } from '@zipbul/baker';
import { isString } from '@zipbul/baker/rules';
import { Recipe } from '@zipbul/core';

@Recipe
export class UpdatePostDto {
  @Field(isString, { optional: true })
  title?: string;

  @Field(isString, { optional: true })
  content?: string;
}
