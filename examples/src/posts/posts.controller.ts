import { UseMiddlewares } from '@zipbul/common';
import { RestController, Delete, Get, Post, Put, type HttpContext } from '@zipbul/http-adapter';

import type { PostCommentInput } from './comments/interfaces';
import type { Post as PostEntity } from './interfaces';

import { IdRouteParams } from '../dto/id-route-params.dto';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { loggerMiddleware } from '../middleware/logger.middleware';
import { PostsService } from './posts.service';

@RestController('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Get()
  getAll(): ReadonlyArray<PostEntity> {
    return this.postsService.findAll();
  }

  @Get(':id')
  getById(ctx: HttpContext): PostEntity | undefined {
    const params = ctx.getParams<IdRouteParams>();

    return this.postsService.findOneById(Number(params.id));
  }

  @Post()
  @UseMiddlewares(loggerMiddleware)
  create(ctx: HttpContext): number {
    const body = ctx.getBody<CreatePostDto>();

    return this.postsService.create(body);
  }

  @Put(':id')
  update(ctx: HttpContext): PostEntity {
    const params = ctx.getParams<IdRouteParams>();
    const body = ctx.getBody<UpdatePostDto>();

    return this.postsService.update(Number(params.id), body);
  }

  @Delete(':id')
  delete(ctx: HttpContext): PostEntity[] {
    const params = ctx.getParams<IdRouteParams>();

    return this.postsService.delete(Number(params.id));
  }

  @Post(':id/comments')
  createComment(ctx: HttpContext): void {
    const params = ctx.getParams<IdRouteParams>();

    this.postsService.createComment(Number(params.id), ctx.request.body as PostCommentInput);
  }
}
