import type { ModuleMarker } from '@zipbul/common';
import { ZipbulApplication } from './zipbul-application';
import type { CreateApplicationOptions } from './interfaces';

function createApplication(
  _entryModuleMarker: ModuleMarker,
  _options?: CreateApplicationOptions,
): ZipbulApplication {
  return new ZipbulApplication();
}

export {
  createApplication,
  type CreateApplicationOptions,
};
