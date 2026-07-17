import { afterAll, beforeEach } from 'vitest';
import { prisma } from '../src/db.js';
import { resetarCacheModoInicial } from '../src/middleware/usuario.js';

beforeEach(async () => {
  resetarCacheModoInicial();
  await prisma.chatMensagem.deleteMany();
  await prisma.chatPreferencia.deleteMany();
  await prisma.bulkOperationItem.deleteMany();
  await prisma.bulkOperation.deleteMany();
  await prisma.salesSnapshot.deleteMany();
  await prisma.listingSnapshot.deleteMany();
  await prisma.syncJob.deleteMany();
  await prisma.auditEvent.deleteMany();
  await prisma.oAuthAttempt.deleteMany();
  await prisma.session.deleteMany();
  await prisma.oAuthAccount.deleteMany();
  await prisma.appUser.deleteMany();
});

afterAll(async () => prisma.$disconnect());
