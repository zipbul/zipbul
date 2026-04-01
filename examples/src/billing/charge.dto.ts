import { Field } from '@zipbul/baker';
import { isNumber, min } from '@zipbul/baker/rules';

export class ChargeDto {
  @Field(isNumber(), min(1))
  amount: number;
}
