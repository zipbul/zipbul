import { Field } from '@zipbul/baker';
import { isString } from '@zipbul/baker/rules';

export interface PostComment {
  id: number;
  postId: number;
  content: string;
}

export class PostCommentInput {
  @Field(isString)
  content: string;
}
