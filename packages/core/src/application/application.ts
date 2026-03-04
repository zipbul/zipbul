import type { ModuleMarker } from '@zipbul/common';

import { ZipbulApplication } from './zipbul-application';
import { getRuntimeContext } from '../runtime/runtime-context';
import type { CreateApplicationOptions } from './interfaces';

function createApplication(
  _entryModuleMarker: ModuleMarker,
  _options?: CreateApplicationOptions,
): ZipbulApplication {
  const ctx = getRuntimeContext();

  return new ZipbulApplication(ctx.container);
}

export {
  createApplication,
  type CreateApplicationOptions,
};
