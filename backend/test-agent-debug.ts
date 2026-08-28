import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { AppModule } from './src/app.module.js';
import { TicketsController } from './src/tickets/tickets.controller.js';
import { PrismaService } from './src/prisma/prisma.service.js';

async function main() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();

  const controller = app.get(TicketsController);
  const prisma = app.get(PrismaService);

  const agent = await prisma.user.findUnique({ where: { email: 'agent@crm.local' } });
  console.log('Agent:', agent?.id, agent?.departmentId);

  try {
    const result = await controller.list(
      { view: 'mine', sort: 'sla', dir: 'asc', pageSize: 10, page: 1 },
      { userId: agent!.id, roles: ['agent'], sessionId: 'fake', audience: 'crm-staff' },
    );
    console.log('Success result:', result);
  } catch (err: any) {
    console.error('ERROR OCCURRED:');
    console.error(err);
    if (err.stack) console.error(err.stack);
  } finally {
    await app.close();
  }
}

main();
