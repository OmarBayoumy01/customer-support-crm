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
import argon2 from 'argon2';
import { Pool } from 'pg';

import { PERMISSION_CATALOGUE, SYSTEM_ROLES } from '../permissions/permission-catalogue.js';
import { seedDefaultSlaPolicies } from '../sla/seed-default-policies.js';
import { seedDemoData } from './demo-seed.js';
import { PrismaClient } from '../generated/prisma/client.js';

/** One development account per system role, so every role can be tried by hand. */
const DEVELOPMENT_USERS = [
  { email: 'admin@crm.local', firstName: 'Amina', lastName: 'Al-Rashid', role: 'administrator' },
  { email: 'manager@crm.local', firstName: 'Marcus', lastName: 'Webb', role: 'manager' },
  { email: 'agent@crm.local', firstName: 'Aisha', lastName: 'Haddad', role: 'agent' },
  { email: 'customer@crm.local', firstName: 'Omar', lastName: 'Nasser', role: 'customer' },
] as const;

/**
 * Creates the accounts a developer signs in with — US-14.
 *
 * Three guards, in order of how badly each would go wrong:
 *
 *   1. **Never in production.** A known email with a known password on a live
 *      helpdesk is a back door, and one that would be trivially findable in
 *      this file.
 *   2. **Only when `SEED_PASSWORD` is set.** Inventing a default here would
 *      recreate exactly the problem guard 1 prevents, one environment variable
 *      later.
 *   3. **Passwords are only ever set on create.** Re-running the seed must not
 *      reset a password a developer has since changed.
 *
 * Automated tests create their own users and do not depend on any of this.
 */
async function seedDevelopmentUsers(prisma: PrismaClient): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    console.log('\nSkipping development users: NODE_ENV is production.');
    return;
  }

  const password = process.env['SEED_PASSWORD'];

  if (password === undefined || password === '') {
    console.log('\nSkipping development users: SEED_PASSWORD is not set.');
    return;
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  const roleIdByKey = new Map(
    (await prisma.role.findMany({ select: { id: true, key: true } })).map((row) => [
      row.key,
      row.id,
    ]),
  );

  console.log('');

  for (const definition of DEVELOPMENT_USERS) {
    const roleId = roleIdByKey.get(definition.role);

    if (roleId === undefined) {
      throw new Error(`Role "${definition.role}" is missing; cannot seed ${definition.email}`);
    }

    const user = await prisma.user.upsert({
      where: { email: definition.email },
      create: {
        email: definition.email,
        passwordHash,
        firstName: definition.firstName,
        lastName: definition.lastName,
        isActive: true,
      },
      // Deliberately does NOT touch `passwordHash` — see guard 3 above.
      update: {
        firstName: definition.firstName,
        lastName: definition.lastName,
      },
      select: { id: true },
    });

    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId } },
      create: { userId: user.id, roleId },
      update: {},
    });

    /**
     * The portal account needs a `Customer` row, or it cannot sign in at all.
     *
     * US-21 decided that what makes an account a portal account is a linked
     * customer and **not** a role name — roles are configuration, and which
     * door an account may use should not be something an administrator can
     * change by reassigning one. Which means the seeded `customer` role on its
     * own gets refused at `/auth/portal/login`, and the documented development
     * account for the customer role would be the one account nobody can use.
     *
     * Deliberately carries no tickets: it is the account to try submitting a
     * request from, and its empty state is worth seeing.
     */
    if (definition.role === 'customer') {
      const linked = await prisma.customer.findFirst({
        where: { userId: user.id },
        select: { id: true },
      });

      if (linked === null) {
        await prisma.customer.create({
          data: {
            userId: user.id,
            email: definition.email,
            firstName: definition.firstName,
            lastName: definition.lastName,
            type: 'INDIVIDUAL',
          },
        });
      }
    }

    console.log(`Seeded user ${definition.email.padEnd(21)} ${definition.role}`);
  }

  console.log(`\n${String(DEVELOPMENT_USERS.length)} development users ready.`);
  console.log('Sign in with the password from SEED_PASSWORD.');
}

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

    // --- Development users (US-14) ------------------------------------------
    // Until this existed there was no account anyone could sign in with: P01
    // closed with roles and permissions but no users, so AC1 could not even be
    // exercised by hand.
    await seedDevelopmentUsers(prisma);

    // --- SLA policies (US-67) ------------------------------------------------
    // The MVP defers the management UI, so this is where service commitments
    // come from. Without them every ticket resolves to no policy and the SLA
    // column reads `none` forever.
    console.log(`Seeded ${String(await seedDefaultSlaPolicies(prisma))} SLA policies.`);

    // --- Demonstration data (US-120) -----------------------------------------
    // After the policies, because every demo ticket resolves one to get its
    // deadlines. Guarded on NODE_ENV and SEED_PASSWORD, same as the users.
    await seedDemoData(prisma);

    console.log('\nSeeding complete.');
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

await seed();
