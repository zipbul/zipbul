import { Field } from '@zipbul/baker';
import { isString } from '@zipbul/baker/rules';
import { ApiProperty } from '@zipbul/scalar';

export class CreatePostDto {
  @ApiProperty({ description: 'Title of the post', example: 'Hello World' })
  @Field(isString)
  title: string;

  @ApiProperty({ description: 'Content of the post', example: 'This is a content' })
  @Field(isString)
  content: string;
}
