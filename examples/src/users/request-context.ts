import { Injectable, type OnDestroy } from '@zipbul/common';
import { Logger } from '@zipbul/logger';

/**
 * Request-scoped context that holds per-request metadata.
 * A new instance is created for each incoming HTTP request and
 * destroyed when the request completes.
 *
 * @example
 * ```ts
 * // Resolved from request container during handling:
 * const reqCtx = container.get('users::RequestContext');
 * reqCtx.setUserId(authenticatedUser.id);
 * ```
 *
 * @public
 */
@Injectable({
  scope: 'request',
})
export class RequestContext implements OnDestroy {
  private readonly logger = new Logger('RequestContext');
  private readonly createdAt = Date.now();
  private userId: number | undefined;
  private metadata = new Map<string, string>();

  /**
   * Returns the timestamp (epoch ms) when this request scope was created.
   *
   * @returns Epoch milliseconds
   * @public
   */
  getCreatedAt(): number {
    return this.createdAt;
  }

  /**
   * Associates a user ID with this request scope.
   *
   * @param id - The authenticated user's ID
   * @public
   */
  setUserId(id: number): void {
    this.userId = id;
  }

  /**
   * Returns the user ID associated with this request, if any.
   *
   * @returns The user ID, or undefined if not authenticated
   * @public
   */
  getUserId(): number | undefined {
    return this.userId;
  }

  /**
   * Stores arbitrary key-value metadata for this request.
   *
   * @param key - Metadata key
   * @param value - Metadata value
   * @public
   */
  set(key: string, value: string): void {
    this.metadata.set(key, value);
  }

  /**
   * Retrieves request-scoped metadata by key.
   *
   * @param key - Metadata key
   * @returns The value, or undefined if not set
   * @public
   */
  get(key: string): string | undefined {
    return this.metadata.get(key);
  }

  onDestroy(): void {
    const elapsed = Date.now() - this.createdAt;
    this.logger.debug(`Request scope destroyed after ${elapsed}ms (userId=${this.userId ?? 'anonymous'})`);
    this.metadata.clear();
  }
}
