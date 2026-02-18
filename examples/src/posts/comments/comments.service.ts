import { Injectable } from '@zipbul/common';

import type { PostCommentInput } from './interfaces';

import { CommentRepository } from './comments.repository';

@Injectable({
  visibility: 'exported',
})
export class CommentsService {
  private readonly commentsRepo = new CommentRepository();

  create(id: number, body: PostCommentInput): void {
    this.commentsRepo.create(id, body);
  }
}
