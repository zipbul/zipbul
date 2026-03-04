import { IsString } from '@zipbul/common';
import { ApiProperty } from '@zipbul/scalar';

export class CreatePostDto {
  @ApiProperty({ description: 'Title of the post', example: 'Hello World' })
  @IsString()
  title: string;

  @ApiProperty({ description: 'Content of the post', example: 'This is a content' })
  @IsString()
  content: string;
}
