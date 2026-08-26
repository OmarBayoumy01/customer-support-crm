import { Injectable, Logger } from '@nestjs/common';
import type { EffectivePermissions, PermissionKey, PermissionScope } from '@crm/shared';

import { PrismaService } from '../prisma/index.js';
import { CacheService } from '../redis/index.js';
import { ticketScopeWhere, type ScopeContext } from './scope.js';

/** Cache key family, so one user can be invalidated without touching others. */
const CACHE_PREFIX = 'permissions:user:';

/** Short by design — see the note on invalidation below. */
const CACHE_TTL_SECONDS = 300;

@Injectable()
export class PermissionsService {
  private readonly logger = new Logger(PermissionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  private static cacheKey(userId: string): string {
    return `${CACHE_PREFIX}${userId}`;
  }

  /**
   * Everything a user may do, collapsed across all of their roles.
   *
   * Cached in Redis because this runs on every authenticated request and is
   * three joins. The cache is an optimisation only: `CacheService` degrades to
   * a miss when Redis is down, so an outage makes this slower and never wrong.
   */
  async effectivePermissionsFor(userId: string): Promise<EffectivePermissions> {
    const cached = await this.cache.get<EffectivePermissions>(PermissionsService.cacheKey(userId));

    if (cached !== undefined) {
      return cached;
    }

    const resolved = await this.resolveFromDatabase(userId);

    await this.cache.set(PermissionsService.cacheKey(userId), resolved, CACHE_TTL_SECONDS);

    return resolved;
  }

  private async resolveFromDatabase(userId: string): Promise<EffectivePermissions> {
    const rows = await this.prisma.userRole.findMany({
      where: { userId },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });

    const permissions: Record<string, PermissionScope[]> = {};

    for (const userRole of rows) {
      for (const grant of userRole.role.permissions) {
        const key = grant.permission.key;
        const scopes = (permissions[key] ??= []);

        // Two roles can grant the same permission at different scopes. Both are
        // kept — see the note on EffectivePermissions in @crm/shared.
        if (!scopes.includes(grant.scope)) {
          scopes.push(grant.scope);
        }
      }
    }

    return {
      userId,
      roles: rows.map((userRole) => userRole.role.key),
      permissions,
    };
  }

  /**
   * Drops a user's cached permissions (AC4).
   *
   * Called whenever a role assignment or a role's own permissions change, so
   * the user's **next** request resolves afresh — no redeploy, no waiting for a
   * TTL. The TTL above is a safety net for a missed invalidation, not the
   * mechanism.
   */
  async invalidateUser(userId: string): Promise<void> {
    await this.cache.delete(PermissionsService.cacheKey(userId));
    this.logger.debug(`Invalidated cached permissions for user ${userId}`);
  }

  /**
   * Drops the cache for every user holding a role.
   *
   * Editing a role changes what its holders may do, and there may be hundreds
   * of them. The ids are read first rather than clearing the whole family,
   * because `deleteByPrefix` would also evict users the change did not affect.
   */
  async invalidateRole(roleId: string): Promise<number> {
    const holders = await this.prisma.userRole.findMany({
      where: { roleId },
      select: { userId: true },
    });

    await Promise.all(holders.map((holder) => this.invalidateUser(holder.userId)));

    this.logger.log(
      `Invalidated ${String(holders.length)} user(s) after a change to role ${roleId}`,
    );

    return holders.length;
  }

  /** Whether a permission is held at all, at any scope. */
  async can(userId: string, key: PermissionKey): Promise<boolean> {
    const effective = await this.effectivePermissionsFor(userId);

    return (effective.permissions[key] ?? []).length > 0;
  }

  /** The scopes a user holds for one permission. Empty means not granted. */
  async scopesFor(userId: string, key: PermissionKey): Promise<PermissionScope[]> {
    const effective = await this.effectivePermissionsFor(userId);

    return effective.permissions[key] ?? [];
  }

  /**
   * The `where` fragment restricting a ticket query to what this user may see.
   *
   * The whole point of AC3, in one call: a caller composes this into its query
   * and the database does the narrowing. There is no version of this that
   * returns a list to be filtered afterwards.
   */
  async ticketScopeFor(
    userId: string,
    key: PermissionKey = 'ticket:view',
  ): Promise<ReturnType<typeof ticketScopeWhere>> {
    const [scopes, user] = await Promise.all([
      this.scopesFor(userId, key),
      this.prisma.user.findUnique({ where: { id: userId }, select: { departmentId: true } }),
    ]);

    const context: ScopeContext = { userId, departmentId: user?.departmentId ?? null };

    return ticketScopeWhere(scopes, context);
  }
}
