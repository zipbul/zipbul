import { IsNumber, Min } from '@zipbul/common';

export class ChargeDto {
  @IsNumber()
  @Min(1)
  amount: number;
}
