import type { ZipbulModule } from '@zipbul/core';

import { CommentRepository } from './comments.repository';
import { CommentsService } from './comments.service';

export const module: ZipbulModule = {
  name: 'CommentsModule',
  providers: [CommentsService, CommentRepository],
};
