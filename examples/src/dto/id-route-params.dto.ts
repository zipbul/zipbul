import { Field } from '@zipbul/baker';
import { isString } from '@zipbul/baker/rules';

export class IdRouteParams {
  @Field(isString)
  id: string;
}
