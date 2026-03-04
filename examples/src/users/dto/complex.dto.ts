import { IsArray, IsOptional, IsString, Max, Min, Nested } from '@zipbul/common';

import { AddressDto } from './address.dto';
import { SocialDto } from './social.dto';

export class CreateUserComplexDto {
  @IsString()
  name: string;

  @Min(18)
  @Max(99)
  age: number;

  @Nested(() => AddressDto, { each: true })
  addresses: AddressDto[];

  @Nested(() => SocialDto)
  social: SocialDto;

  @IsArray()
  tags: string[];

  @IsOptional()
  @IsString()
  bio?: string;
}
