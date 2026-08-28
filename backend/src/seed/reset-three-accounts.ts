/**
 * Database Reset & Clean Seed Script.
 *
 * Cleans out all tickets, messages, history, audit logs, sessions, and extra accounts,
 * leaving exactly 3 accounts ready for testing the full end-to-end flow:
 *
 *   1. Customer: customer@crm.local (Omar Nasser) - accesses the Customer Portal (/portal)
 *   2. Agent:    agent@crm.local    (Aisha Haddad) - accesses the Agent Queue (/dashboard, /tickets)
 *   3. Manager:  manager@crm.local  (Marcus Webb)  - accesses Team Dashboard & Management (/dashboard, /tickets)
 *
 * All three accounts use password: DevPassw0rd! (or SEED_PASSWORD from .env).
 */
/* eslint-disable no-process-env */
import { PrismaPg } from '@prisma/adapter-pg';
import argon2 from 'argon2';
import { Pool } from 'pg';

import { PERMISSION_CATALOGUE, SYSTEM_ROLES } from '../permissions/permission-catalogue.js';
import { seedDefaultSlaPolicies } from '../sla/seed-default-policies.js';
import { PrismaClient } from '../generated/prisma/client.js';

const PASSWORD = process.env['SEED_PASSWORD'] || 'DevPassw0rd!';

async function resetAndSeed(): Promise<void> {
  const connectionString = process.env['DATABASE_URL'];

  if (connectionString === undefined || connectionString === '') {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString, max: 5 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    console.log('🔄 Cleaning up database data...');

    // 1. Truncate tables with cascade (cleans all tickets, messages, attachments, history, tasks, notifications, audit logs, sessions)
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE 
        "Attachment",
        "Message",
        "TicketHistory",
        "Ticket",
        "Task",
        "Notification",
        "AuditLog",
        "Session",
        "UserRole",
        "RolePermission",
        "Customer",
        "User",
        "Category",
        "Department",
        "Branch",
        "SlaPolicy",
        "SlaEscalationStep"
      CASCADE;
    `);

    console.log('✅ Cleaned all transaction and user tables.');

    // 2. Seed Permissions
    console.log('🔄 Seeding permissions...');
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
    console.log(`✅ Seeded ${String(PERMISSION_CATALOGUE.length)} permissions.`);

    const permissionIdByKey = new Map(
      (await prisma.permission.findMany({ select: { id: true, key: true } })).map((row) => [
        row.key,
        row.id,
      ]),
    );

    // 3. Seed System Roles
    console.log('🔄 Seeding system roles...');
    const roleIdByKey = new Map<string, string>();

    for (const definition of SYSTEM_ROLES) {
      const role = await prisma.role.upsert({
        where: { key: definition.key },
        create: {
          key: definition.key,
          nameEn: definition.nameEn,
          nameAr: definition.nameAr,
          description: definition.description,
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

      roleIdByKey.set(definition.key, role.id);

      await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
      await prisma.rolePermission.createMany({
        data: definition.grants.map(([key, scope]) => {
          const permissionId = permissionIdByKey.get(key);
          if (!permissionId) throw new Error(`Missing permission ${key}`);
          return { roleId: role.id, permissionId, scope };
        }),
      });
    }
    console.log('✅ Seeded roles (administrator, manager, agent, customer).');

    // 4. Seed Organization (Branch & Department)
    console.log('🔄 Seeding branch & department...');
    const branch = await prisma.branch.create({
      data: {
        code: 'MAIN',
        nameEn: 'Main Branch',
        nameAr: 'الفرع الرئيسي',
        city: 'Riyadh',
        country: 'Saudi Arabia',
        timezone: 'Asia/Riyadh',
      },
    });

    const department = await prisma.department.create({
      data: {
        code: 'SUPPORT',
        nameEn: 'Customer Support',
        nameAr: 'الدعم الفني',
        description: 'Customer service and technical assistance',
        branchId: branch.id,
      },
    });

    // 5. Seed Categories
    console.log('🔄 Seeding categories...');
    const categories = [
      { slug: 'technical', nameEn: 'Technical Support', nameAr: 'الدعم التقني' },
      { slug: 'billing', nameEn: 'Billing & Invoicing', nameAr: 'الفواتير والمدفوعات' },
      { slug: 'general', nameEn: 'General Inquiry', nameAr: 'استفسار عام' },
    ];

    for (const cat of categories) {
      await prisma.category.create({
        data: {
          slug: cat.slug,
          nameEn: cat.nameEn,
          nameAr: cat.nameAr,
          departmentId: department.id,
          isActive: true,
        },
      });
    }
    console.log('✅ Seeded 3 categories linked to Customer Support.');

    // 6. Seed Default SLA Policies
    console.log('🔄 Seeding SLA policies...');
    const slaCount = await seedDefaultSlaPolicies(prisma);
    console.log(`✅ Seeded ${String(slaCount)} SLA policies.`);

    // 7. Seed Password Hash
    const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });

    // 8. Seed Exactly 3 Accounts
    console.log('🔄 Creating the 3 accounts...');

    // Account 1: Manager
    const managerUser = await prisma.user.create({
      data: {
        email: 'manager@crm.local',
        passwordHash,
        firstName: 'Marcus',
        lastName: 'Webb',
        locale: 'EN',
        departmentId: department.id,
        branchId: branch.id,
        isActive: true,
        roles: { create: { roleId: roleIdByKey.get('manager')! } },
      },
    });

    // Link manager as Department manager
    await prisma.department.update({
      where: { id: department.id },
      data: { managerId: managerUser.id },
    });
    console.log('  👤 1. Manager:  manager@crm.local (Marcus Webb) - Role: manager, Dept: Customer Support');

    // Account 2: Support Agent
    await prisma.user.create({
      data: {
        email: 'agent@crm.local',
        passwordHash,
        firstName: 'Aisha',
        lastName: 'Haddad',
        locale: 'EN',
        departmentId: department.id,
        branchId: branch.id,
        isActive: true,
        roles: { create: { roleId: roleIdByKey.get('agent')! } },
      },
    });
    console.log('  👤 2. Agent:    agent@crm.local   (Aisha Haddad) - Role: agent, Dept: Customer Support');

    // Account 3: Portal Customer
    const customerUser = await prisma.user.create({
      data: {
        email: 'customer@crm.local',
        passwordHash,
        firstName: 'Omar',
        lastName: 'Nasser',
        locale: 'EN',
        isActive: true,
        roles: { create: { roleId: roleIdByKey.get('customer')! } },
      },
    });

    await prisma.customer.create({
      data: {
        userId: customerUser.id,
        email: 'customer@crm.local',
        firstName: 'Omar',
        lastName: 'Nasser',
        type: 'INDIVIDUAL',
        departmentId: department.id,
        branchId: branch.id,
      },
    });
    console.log('  👤 3. Customer: customer@crm.local (Omar Nasser) - Role: customer (Portal Profile Linked)');

    console.log('\n🎉 Database reset complete! Exactly 3 accounts ready for testing.');
    console.log(`🔑 Password for all accounts: ${PASSWORD}\n`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

resetAndSeed().catch((err) => {
  console.error('Failed to reset and seed database:', err);
  process.exit(1);
});
