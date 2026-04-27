import { Field } from '@zipbul/baker';
import { isString } from '@zipbul/baker/rules';

export class CreatePostDto {
  @Field(isString)
  title: string;

  @Field(isString)
  content: string;
}
