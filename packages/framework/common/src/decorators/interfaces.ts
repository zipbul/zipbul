import type { InjectableScope, InjectableVisibleTo } from './types';

export interface InjectableOptions {
  scope?: InjectableScope;
  visibleTo?: InjectableVisibleTo;
}
