import { IsBoolean, IsNumber, IsString } from '@zipbul/core';

export class AddressDto {
  @IsString()
  street: string;

  @IsNumber()
  zipCode: number;

  @IsBoolean()
  isBusiness: boolean;
}
