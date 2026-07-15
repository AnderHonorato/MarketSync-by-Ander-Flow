import { afterAll, beforeEach } from 'vitest';
import { prisma } from '../src/db.js';

beforeEach(async () => {
  await prisma.bulkOperationItem.deleteMany();
  await prisma.bulkOperation.deleteMany();
  await prisma.salesSnapshot.deleteMany();
  await prisma.listingSnapshot.deleteMany();
  await prisma.syncJob.deleteMany();
  await prisma.auditEvent.deleteMany();
  await prisma.oAuthAttempt.deleteMany();
  await prisma.session.deleteMany();
  await prisma.oAuthAccount.deleteMany();
});

afterAll(async () => prisma.$disconnect());
