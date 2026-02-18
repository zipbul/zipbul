export const IS_DEVELOPMENT = Bun.env.NODE_ENV === 'development';
export const IS_TEST = Bun.env.NODE_ENV === 'test';
export const IS_PRODUCTION = Bun.env.NODE_ENV === 'production';

export const CONFIG_SERVICE = Symbol.for('zipbul:config:service');
export const ENV_SERVICE = Symbol.for('zipbul:env:service');
