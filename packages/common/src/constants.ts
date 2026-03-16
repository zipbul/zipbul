export const IS_DEVELOPMENT = Bun.env.NODE_ENV === 'development';
export const IS_TEST = Bun.env.NODE_ENV === 'test';
export const IS_PRODUCTION = Bun.env.NODE_ENV === 'production';

export const CONFIG_SERVICE = Symbol.for('zipbul:config:service');
export const ENV_SERVICE = Symbol.for('zipbul:env:service');

/** AOT marker property keys used in serialized metadata. */
export const ZIPBUL_REF = '__zipbul_ref';
export const ZIPBUL_LAZY_REF = '__zipbul_lazy_ref';
export const ZIPBUL_IMPORT_SOURCE = '__zipbul_import_source';
export const ZIPBUL_CALL = '__zipbul_call';
export const ZIPBUL_NEW = '__zipbul_new';
export const ZIPBUL_FACTORY_CODE = '__zipbul_factory_code';
export const ZIPBUL_SPREAD = '__zipbul_spread';
export const ZIPBUL_COMPUTED_PREFIX = '__zipbul_computed_';
export const ZIPBUL_COMPUTED_KEY = '__zipbul_computed_key';
export const ZIPBUL_COMPUTED_VALUE = '__zipbul_computed_value';

/** Marker key for unresolvable AST expressions (ternary, template literal, etc.). */
export const ZIPBUL_UNRESOLVABLE = '__zipbul_unresolvable';

/** Scoped key separator used in DI container keys (e.g. "ModuleName::ProviderName"). */
export const SCOPED_KEY_SEPARATOR = '::';

/** Framework function names recognized by the AOT compiler. */
export const FRAMEWORK_CREATE_APPLICATION = 'createApplication';
export const FRAMEWORK_DEFINE_MODULE = 'defineModule';
export const FRAMEWORK_DEFINE_ADAPTER = 'defineAdapter';

/** TypeScript utility types skipped during metadata analysis. */
export const TS_UTILITY_TYPES: readonly string[] = ['Partial', 'Pick', 'Omit', 'Required'];

/** Provider visibility values. */
export const VISIBILITY_ALL = 'all';
export const VISIBILITY_MODULE = 'module';
export const VISIBILITY_ALLOWLIST = 'allowlist';

/** Provider scope values. */
export const SCOPE_SINGLETON = 'singleton';
export const SCOPE_REQUEST = 'request';
export const SCOPE_TRANSIENT = 'transient';

