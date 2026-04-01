import { Field } from '@zipbul/baker';
import { isString, isNumber, isBoolean } from '@zipbul/baker/rules';

export class AddressDto {
  @Field(isString)
  street: string;

  @Field(isNumber())
  zipCode: number;

  @Field(isBoolean)
  isBusiness: boolean;
}
