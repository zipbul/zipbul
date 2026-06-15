import { Field } from '@zipbul/baker';
import { isString } from '@zipbul/baker/rules';
import { Recipe } from '@zipbul/core';

@Recipe
export class CreatePostDto {
  @Field(isString)
  title: string;

  @Field(isString)
  content: string;
}
