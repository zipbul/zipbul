import { Injectable } from '@zipbul/common';

import type { PostComment, PostCommentInput } from './interfaces';

@Injectable()
export class CommentRepository {
  private comments: PostComment[] = [
    {
      id: 1,
      postId: 1,
      content: 'Comment 1',
    },
    {
      id: 2,
      postId: 1,
      content: 'Comment 2',
    },
  ];

  findAll(): ReadonlyArray<PostComment> {
    return this.comments;
  }

  findOneById(id: number): PostComment | undefined {
    return this.comments.find(comment => comment.id === id);
  }

  create(postId: number, body: PostCommentInput): void {
    this.comments.push({
      id: this.comments.length + 1,
      postId,
      content: body.content,
    });
  }
}
