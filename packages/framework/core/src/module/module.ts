import { ZipbulSymbol, type ModuleMarker } from '@zipbul/common';
import type { DefineModuleOptions } from './interfaces';

export function defineModule(_options?: DefineModuleOptions): ModuleMarker {
  return Symbol(ZipbulSymbol.Module);
}
