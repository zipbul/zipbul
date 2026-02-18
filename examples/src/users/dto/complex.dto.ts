import { IsArray, IsOptional, IsString, Max, Min, ValidateNested } from '@zipbul/core';

import { AddressDto } from './address.dto';
import { SocialDto } from './social.dto';

export class CreateUserComplexDto {
  @IsString()
  name: string;

  @Min(18)
  @Max(99)
  age: number;

  @ValidateNested()
  addresses: AddressDto[];

  @ValidateNested()
  social: SocialDto;

  @IsArray()
  tags: string[];

  @IsOptional()
  @IsString()
  bio?: string;
}
