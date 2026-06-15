import { Field } from '@zipbul/baker';
import { isString } from '@zipbul/baker/rules';
import { Recipe } from '@zipbul/core';

export interface PostComment {
  id: number;
  postId: number;
  content: string;
}

@Recipe
export class PostCommentInput {
  @Field(isString)
  content: string;
}
