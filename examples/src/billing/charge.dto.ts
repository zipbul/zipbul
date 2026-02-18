import { IsNumber, Min } from '@zipbul/core';

export class ChargeDto {
  @IsNumber()
  @Min(1)
  amount: number;
}
