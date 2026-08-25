/**
 * Env file precedence, highest priority first.
 *
 * `@nestjs/config` treats the FIRST match in `envFilePath` as the winner, so
 * the most specific file is listed first:
 *
 *   1. `.env.<NODE_ENV>.local`  — machine-specific override, never committed
 *   2. `.env.<NODE_ENV>`        — per-environment defaults, may be committed
 *   3. `.env.local`             — machine-specific, all environments
 *   4. `.env`                   — committed defaults
 *
 * `.env.local` is skipped when `NODE_ENV=test`, following the dotenv
 * convention: a test run must not silently pick up a developer's local
 * overrides, or the suite passes on one machine and fails on another.
 *
 * AC4 is satisfied by this function alone — switching environments changes
 * which files load, and no code changes.
 */
export function envFilePathsForNodeEnv(nodeEnv: string | undefined): string[] {
  const env = nodeEnv ?? 'development';

  const paths = [`.env.${env}.local`, `.env.${env}`];

  if (env !== 'test') {
    paths.push('.env.local');
  }

  paths.push('.env');

  return paths;
}
