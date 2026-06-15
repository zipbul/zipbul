import { Field } from '@zipbul/baker';
import { isString, isArray, min, max } from '@zipbul/baker/rules';
import { Recipe } from '@zipbul/core';

import { AddressDto } from './address.dto';
import { SocialDto } from './social.dto';

@Recipe
export class CreateUserComplexDto {
  @Field(isString)
  name: string;

  @Field(min(18), max(99))
  age: number;

  @Field({ type: () => [AddressDto] })
  addresses: AddressDto[];

  @Field({ type: () => SocialDto })
  social: SocialDto;

  @Field(isArray)
  tags: string[];

  @Field(isString, { optional: true })
  bio?: string;
}
