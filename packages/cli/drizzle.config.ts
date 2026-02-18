import type { Config } from 'drizzle-kit';

export default {
  schema: './packages/cli/src/store/schema.ts',
  out: './packages/cli/drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: 'file:./.zipbul/cache/index.sqlite',
  },
} satisfies Config;
