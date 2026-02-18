import { RestController, Delete, Get, Param, Post, Put, Body } from '@zipbul/http-adapter';

import type { PostCommentInput } from './comments/interfaces';
import type { Post as PostEntity } from './interfaces';

import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { PostsService } from './posts.service';

@RestController('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Get()
  getAll(): ReadonlyArray<PostEntity> {
    return this.postsService.findAll();
  }

  @Get(':id')
  getById(@Param('id') id: string): PostEntity | undefined {
    return this.postsService.findOneById(Number(id));
  }

  @Post()
  create(@Body() body: CreatePostDto): number {
    return this.postsService.create(body);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: UpdatePostDto): PostEntity {
    return this.postsService.update(Number(id), body);
  }

  @Delete(':id')
  delete(@Param('id') id: string): PostEntity[] {
    return this.postsService.delete(Number(id));
  }

  @Post(':id/comments')
  createComment(@Param('id') id: string, @Body() body: PostCommentInput): void {
    this.postsService.createComment(Number(id), body);
  }
}
