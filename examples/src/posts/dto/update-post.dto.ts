import { Field } from '@zipbul/baker';
import { isString } from '@zipbul/baker/rules';

export class UpdatePostDto {
  @Field(isString, { optional: true })
  title?: string;

  @Field(isString, { optional: true })
  content?: string;
}
