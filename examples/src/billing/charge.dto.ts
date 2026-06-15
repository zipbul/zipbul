import { Field } from '@zipbul/baker';
import { isNumber, min } from '@zipbul/baker/rules';
import { Recipe } from '@zipbul/core';

@Recipe
export class ChargeDto {
  @Field(isNumber(), min(1))
  amount: number;
}
