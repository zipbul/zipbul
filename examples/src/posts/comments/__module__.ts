import type { Module } from '@zipbul/core';

import { CommentRepository } from './comments.repository';
import { CommentsService } from './comments.service';

export const module: Module = {
  name: 'CommentsModule',
  providers: [CommentsService, CommentRepository],
};
