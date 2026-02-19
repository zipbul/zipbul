/** @type {import('@commitlint/types').UserConfig} */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'scope-no-multi': (parsed, when) => {
          const scope = parsed.scope;

          if (scope === undefined || scope.length === 0) {
            return [true];
          }

          const hasComma = scope.includes(',');

          if (when === 'always') {
            return [!hasComma, 'scope must be a single value (no commas)'];
          }

          if (when === 'never') {
            return [hasComma, 'scope must contain a comma'];
          }

          return [true];
        },
      },
    },
  ],
  rules: {
    'body-max-line-length': [2, 'always', 100],
    'footer-max-line-length': [2, 'always', 100],
    'scope-case': [2, 'always', ['kebab-case']],
    'scope-no-multi': [2, 'always'],
    'scope-enum': [
      2,
      'always',
      ['cli', 'common', 'core', 'http-adapter', 'logger', 'scalar', 'examples', 'repo', 'config', 'plan', 'eslint', 'scripts', 'emberdeck'],
    ],
    'type-enum': [2, 'always', ['build', 'chore', 'ci', 'docs', 'feat', 'fix', 'perf', 'refactor', 'revert', 'style', 'test']],
    'subject-case': [2, 'never', ['pascal-case', 'upper-case']],
    'subject-full-stop': [2, 'never', '.'],
  },
};
