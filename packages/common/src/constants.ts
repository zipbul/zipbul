export const IS_DEVELOPMENT = Bun.env.NODE_ENV === 'development';
export const IS_TEST = Bun.env.NODE_ENV === 'test';
export const IS_PRODUCTION = Bun.env.NODE_ENV === 'production';

export const CONFIG_SERVICE = Symbol.for('zipbul:config:service');
export const ENV_SERVICE = Symbol.for('zipbul:env:service');

/**
 * Canonical decorator name constants.
 * SSOT for decorator name matching across packages.
 * Do NOT use `Function.name` — minified builds mangle function names.
 */
export const DECORATOR_INJECTABLE = 'Injectable';
export const DECORATOR_USE_MIDDLEWARES = 'UseMiddlewares';
export const DECORATOR_USE_EXCEPTION_FILTERS = 'UseExceptionFilters';
export const DECORATOR_CATCH = 'Catch';
export const DECORATOR_USE_GUARDS = 'UseGuards';
