import { ApiPropertyOptional } from '@zipbul/scalar';

export class UpdatePostDto {
  @ApiPropertyOptional({ description: 'Title of the post', example: 'Hello World' })
  title?: string;

  @ApiPropertyOptional({ description: 'Content of the post', example: 'This is a content' })
  content?: string;
}
