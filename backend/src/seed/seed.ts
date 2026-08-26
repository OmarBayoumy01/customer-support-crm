/**
 * Seeds the permissions, roles, and grants a fresh installation cannot work
 * without (US-13, AC1).
 *
 * **Idempotent.** Everything is an upsert keyed on a natural key, so running it
 * twice changes nothing and running it after a catalogue change brings the
 * database up to date. That matters because it runs on every `prisma migrate
 * reset`, on a fresh Compose volume, and by hand whenever someone adds a
 * permission.
 *
 * Deliberately **not** destructive: it adds and updates, and removes only the
 * grants of system roles, which it owns. A custom role an administrator created
 * is never touched.
 *
 * Runs outside Nest, so it reads `process.env` and writes to the console
 * directly — `eslint.config.js` exempts `src/testing/**` and test files; this
 * file carries its own narrow disable for the same reason.
 */
/* eslint-disable no-process-env */
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

import { PERMISSION_CATALOGUE, SYSTEM_ROLES } from '../permissions/permission-catalogue.js';
import { PrismaClient } from '../generated/prisma/client.js';

async function seed(): Promise<void> {
  const connectionString = process.env['DATABASE_URL'];

  if (connectionString === undefined || connectionString === '') {
    console.error('DATABASE_URL is not set. Copy backend/.env.example to backend/.env.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString, max: 5 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    // --- Permissions (AC2) ---------------------------------------------------
    // Upserted on `key`, so a renamed description updates and a new permission
    // appears without disturbing the grants that reference the old ones.
    for (const permission of PERMISSION_CATALOGUE) {
      await prisma.permission.upsert({
        where: { key: permission.key },
        create: {
          key: permission.key,
          resource: permission.resource,
          action: permission.action,
          description: permission.description,
        },
        update: {
          resource: permission.resource,
          action: permission.action,
          description: permission.description,
        },
      });
    }

    console.log(`Seeded ${String(PERMISSION_CATALOGUE.length)} permissions.`);

    const permissionIdByKey = new Map(
      (await prisma.permission.findMany({ select: { id: true, key: true } })).map((row) => [
        row.key,
        row.id,
      ]),
    );

    // --- Roles and their grants (AC1) ---------------------------------------
    for (const definition of SYSTEM_ROLES) {
      const role = await prisma.role.upsert({
        where: { key: definition.key },
        create: {
          key: definition.key,
          nameEn: definition.nameEn,
          nameAr: definition.nameAr,
          description: definition.description,
          // System roles cannot be deleted or renamed by an administrator —
          // this is what stops someone removing "administrator" and locking
          // everyone, including themselves, out of the platform.
          isSystem: true,
        },
        update: {
          nameEn: definition.nameEn,
          nameAr: definition.nameAr,
          description: definition.description,
          isSystem: true,
        },
        select: { id: true, key: true },
      });

      // Replaced rather than merged: the catalogue is the source of truth for
      // what a system role may do, so a grant removed from the definition must
      // disappear from the database. Anything else means tightening a
      // permission in code has no effect in production.
      await prisma.$transaction([
        prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
        prisma.rolePermission.createMany({
          data: definition.grants.map(([key, scope]) => {
            const permissionId = permissionIdByKey.get(key);

            if (permissionId === undefined) {
              // Unreachable: the catalogue is derived from the same key list.
              // Loud anyway, because a silently skipped grant is a role that
              // quietly cannot do its job.
              throw new Error(`Permission "${key}" is granted to ${role.key} but does not exist`);
            }

            return { roleId: role.id, permissionId, scope };
          }),
        }),
      ]);

      console.log(
        `Seeded role ${definition.key.padEnd(13)} ${String(definition.grants.length).padStart(2)} grant(s)`,
      );
    }

    console.log('\nSeeding complete.');
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

await seed();
