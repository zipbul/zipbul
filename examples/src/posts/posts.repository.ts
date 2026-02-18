import { Injectable } from '@zipbul/common';

import type { CreatePostDto } from './dto/create-post.dto';
import type { UpdatePostDto } from './dto/update-post.dto';
import type { Post } from './interfaces';

@Injectable()
export class PostsRepository {
  private posts: Post[] = [
    {
      id: 1,
      title: 'Post 1',
      content: 'Content 1',
    },
    {
      id: 2,
      title: 'Post 2',
      content: 'Content 2',
    },
  ];

  findAll(): ReadonlyArray<Post> {
    return this.posts;
  }

  findOneById(id: number): Post | undefined {
    return this.posts.find(post => post.id === id);
  }

  create(body: CreatePostDto): number {
    const lastPost = this.posts.at(-1);
    const nextId = lastPost ? lastPost.id + 1 : 1;
    const post: Post = {
      id: nextId,
      title: body.title,
      content: body.content,
    };

    return this.posts.push(post);
  }

  update(id: number, data: UpdatePostDto): Post {
    const index = this.posts.findIndex(post => post.id === id);

    if (index < 0) {
      throw new Error(`Post not found: ${id}`);
    }

    const current = this.posts[index];

    if (!current) {
      throw new Error(`Post not found: ${id}`);
    }

    const updated: Post = {
      id: current.id,
      title: data.title ?? current.title,
      content: data.content ?? current.content,
    };

    this.posts[index] = updated;

    return updated;
  }

  delete(id: number): Post[] {
    const index = this.posts.findIndex(post => post.id === id);

    if (index < 0) {
      throw new Error(`Post not found: ${id}`);
    }

    return this.posts.splice(index, 1);
  }
}
