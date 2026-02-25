export const enum DiagnosticCode {
  // Adapter
  AdapterSpecNotCollected = 'ADAPTER_SPEC_NOT_COLLECTED',
  AdapterInputUncollectable = 'ADAPTER_INPUT_UNCOLLECTABLE',
  AdapterClassrefInvalid = 'ADAPTER_CLASSREF_INVALID',
  AdapterPipelineTokenInvalid = 'ADAPTER_PIPELINE_TOKEN_INVALID',
  AdapterPhaseIdInvalid = 'ADAPTER_PHASE_ID_INVALID',
  AdapterPipelinePhaseOrderMismatch = 'ADAPTER_PIPELINE_PHASE_ORDER_MISMATCH',
  AdapterMiddlewarePlacementInvalid = 'ADAPTER_MIDDLEWARE_PLACEMENT_INVALID',
  AdapterExceptionFilterInvalid = 'ADAPTER_EXCEPTION_FILTER_INVALID',
  AdapterEntryDecoratorInvalid = 'ADAPTER_ENTRY_DECORATOR_INVALID',
  AdapterHandlerIdUnresolvable = 'ADAPTER_HANDLER_ID_UNRESOLVABLE',
  AdapterMiddlewareErrorBypass = 'ADAPTER_MIDDLEWARE_ERROR_BYPASS',

  // App
  AppEntryNotFound = 'APP_ENTRY_NOT_FOUND',
  AppMultipleEntries = 'APP_MULTIPLE_ENTRIES',

  // Build
  BuildParseFailed = 'BUILD_PARSE_FAILED',
  BuildFailed = 'BUILD_FAILED',
  BuildFileCycle = 'BUILD_FILE_CYCLE',
  BuildInjectNotDeterminable = 'BUILD_INJECT_NOT_DETERMINABLE',

  // CLI
  CliInvalidCommand = 'CLI_INVALID_COMMAND',

  // Dev
  DevFailed = 'DEV_FAILED',
  DevGildashParse = 'DEV_GILDASH_PARSE',
}
