import { IsBoolean, IsNumber, IsString } from '@zipbul/common';

export class AddressDto {
  @IsString()
  street: string;

  @IsNumber()
  zipCode: number;

  @IsBoolean()
  isBusiness: boolean;
}
