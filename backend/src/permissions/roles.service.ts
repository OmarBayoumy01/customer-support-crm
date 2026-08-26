import { Injectable, Logger } from '@nestjs/common';
import type { PermissionKey, PermissionScope } from '@crm/shared';

import { ApiException } from '../common/index.js';
import { PrismaService } from '../prisma/index.js';
import { TokenRevocationService } from '../auth/token-revocation.service.js';
import { PermissionsService } from './permissions.service.js';

export interface RoleGrantInput {
  readonly key: PermissionKey;
  readonly scope: PermissionScope;
}

export interface CreateRoleInput {
  readonly key: string;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly description?: string;
  readonly grants: readonly RoleGrantInput[];
}

/**
 * Creating and editing roles, and assigning them to users (AC5).
 *
 * The admin UI that drives this is US-115 and explicitly out of scope here —
 * these are the operations it will call.
 *
 * Every method that changes what someone may do **invalidates the permission
 * cache before returning**, which is what makes AC4 true: the change is visible
 * on the user's next request, with no redeploy and no waiting for a TTL.
 */
@Injectable()
export class RolesService {
  private readonly logger = new Logger(RolesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly revocations: TokenRevocationService,
  ) {}

  /**
   * Creates a role with any combination of permissions.
   *
   * Unknown permission keys are rejected rather than silently dropped: a role
   * that was created with a typo and quietly grants less than the administrator
   * intended is a security bug that presents as a support ticket months later.
   */
  async createRole(input: CreateRoleInput): Promise<{ id: string; key: string }> {
    const keys = input.grants.map((grant) => grant.key);

    const known = await this.prisma.permission.findMany({
      where: { key: { in: keys } },
      select: { id: true, key: true },
    });

    const knownKeys = new Set(known.map((permission) => permission.key));
    const unknown = keys.filter((key) => !knownKeys.has(key));

    if (unknown.length > 0) {
      throw ApiException.unprocessable(
        `Unknown permission${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}`,
      );
    }

    const existing = await this.prisma.role.findUnique({ where: { key: input.key } });

    if (existing !== null) {
      throw ApiException.conflict(`A role with the key "${input.key}" already exists.`);
    }

    const idByKey = new Map(known.map((permission) => [permission.key, permission.id]));

    const role = await this.prisma.role.create({
      data: {
        key: input.key,
        nameEn: input.nameEn,
        nameAr: input.nameAr,
        ...(input.description === undefined ? {} : { description: input.description }),
        // Custom roles are never system roles: an administrator must always be
        // able to delete what an administrator created.
        isSystem: false,
        permissions: {
          create: input.grants.map((grant) => ({
            permissionId: idByKey.get(grant.key) ?? '',
            scope: grant.scope,
          })),
        },
      },
      select: { id: true, key: true },
    });

    this.logger.log(`Created role ${role.key} with ${String(input.grants.length)} permission(s)`);

    return role;
  }

  /**
   * Replaces a role's permissions wholesale.
   *
   * Replace rather than merge, because the admin UI edits a checkbox matrix and
   * submits the whole state — a merge would make unticking a box do nothing.
   */
  async setRolePermissions(roleId: string, grants: readonly RoleGrantInput[]): Promise<void> {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });

    if (role === null) {
      throw ApiException.notFound('The role');
    }

    const known = await this.prisma.permission.findMany({
      where: { key: { in: grants.map((grant) => grant.key) } },
      select: { id: true, key: true },
    });

    const idByKey = new Map(known.map((permission) => [permission.key, permission.id]));
    const unknown = grants.filter((grant) => !idByKey.has(grant.key)).map((grant) => grant.key);

    if (unknown.length > 0) {
      throw ApiException.unprocessable(
        `Unknown permission${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}`,
      );
    }

    // One transaction: a role must never be observed with its old permissions
    // removed and its new ones not yet written.
    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { roleId } }),
      this.prisma.rolePermission.createMany({
        data: grants.map((grant) => ({
          roleId,
          permissionId: idByKey.get(grant.key) ?? '',
          scope: grant.scope,
        })),
      }),
    ]);

    await this.permissions.invalidateRole(roleId);
  }

  /** Grants a role to a user, recording who granted it. */
  async assignRole(userId: string, roleId: string, assignedById?: string): Promise<void> {
    await this.prisma.userRole.upsert({
      where: { userId_roleId: { userId, roleId } },
      create: {
        userId,
        roleId,
        ...(assignedById === undefined ? {} : { assignedById }),
      },
      // Re-assigning an existing role is a no-op rather than an error: the
      // admin UI submits a set, and idempotence is what lets it.
      update: {},
    });

    await this.permissions.invalidateUser(userId);
    // US-16, AC4 — a token minted before this change still carries the old
    // roles, and a signed token cannot be edited. Revoking is the only way the
    // next request does not proceed on stale permissions.
    await this.revocations.revokeUserTokens(userId);
  }

  /** Removes a role from a user. */
  async removeRole(userId: string, roleId: string): Promise<void> {
    await this.prisma.userRole.deleteMany({ where: { userId, roleId } });
    await this.permissions.invalidateUser(userId);
    // US-16, AC4 — a token minted before this change still carries the old
    // roles, and a signed token cannot be edited. Revoking is the only way the
    // next request does not proceed on stale permissions.
    await this.revocations.revokeUserTokens(userId);
  }

  /**
   * Replaces a user's roles wholesale, in one transaction.
   *
   * The operation the admin UI actually performs when someone changes a user's
   * role in a dropdown.
   */
  async setUserRoles(
    userId: string,
    roleIds: readonly string[],
    assignedById?: string,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({ where: { userId } }),
      this.prisma.userRole.createMany({
        data: roleIds.map((roleId) => ({
          userId,
          roleId,
          ...(assignedById === undefined ? {} : { assignedById }),
        })),
      }),
    ]);

    await this.permissions.invalidateUser(userId);
    // US-16, AC4 — a token minted before this change still carries the old
    // roles, and a signed token cannot be edited. Revoking is the only way the
    // next request does not proceed on stale permissions.
    await this.revocations.revokeUserTokens(userId);
  }

  /** A role and its grants, for the admin UI to render. */
  async roleWithGrants(
    roleId: string,
  ): Promise<{ key: string; isSystem: boolean; grants: RoleGrantInput[] }> {
    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
      include: { permissions: { include: { permission: true } } },
    });

    if (role === null) {
      throw ApiException.notFound('The role');
    }

    return {
      key: role.key,
      isSystem: role.isSystem,
      grants: role.permissions.map((grant) => ({
        key: grant.permission.key as PermissionKey,
        scope: grant.scope,
      })),
    };
  }
}
