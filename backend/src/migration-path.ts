import path from 'node:path';

/**
 * Resolve the SQL migration directory for local Node execution and the
 * production container. Docker runs the backend with /app/backend as cwd and
 * copies migrations to /app/backend/migrations.
 */
export function resolveMigrationsDirectory(
  cwd = process.cwd(),
  override = process.env.AFFETTA_MIGRATIONS_DIR
): string {
  const candidate = override?.trim() || path.join(cwd, 'migrations');
  return path.resolve(candidate);
}
