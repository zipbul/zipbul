import { Injectable } from '@zipbul/common';
import { inject } from '@zipbul/core';

import type { PostCommentInput } from './interfaces';

import { CommentRepository } from './comments.repository';

@Injectable({
  visibleTo: 'all',
})
export class CommentsService {
  private readonly commentsRepo = inject(CommentRepository);

  create(id: number, body: PostCommentInput): void {
    this.commentsRepo.create(id, body);
  }
}
