import type { ModuleMarkers } from '../types';
import type { ProviderScope } from '../interfaces';

export type InjectableScope = ProviderScope;

export type InjectableVisibleTo = 'all' | 'module' | ModuleMarkers;
