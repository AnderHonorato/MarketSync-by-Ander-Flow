import { Router } from 'express';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuthenticated, requireCsrf } from '../middleware/session.js';
import { isSyncRunning, runSync } from '../services/sync.js';

export const syncRouter = Router();
syncRouter.use(requireAuthenticated);

function view(job: Awaited<ReturnType<typeof prisma.syncJob.findFirst>>, changes?: Record<string, unknown> | null) {
  if (!job) return { status: 'idle', processed: 0, total: 0, progress: 0, canCancel: false };
  return {
    id: job.id, status: job.status.toLowerCase(), processed: job.processed, total: job.total,
    progress: job.total ? Math.round(job.processed / job.total * 100) : 0,
    lastSyncedAt: job.status === 'COMPLETED' ? job.completedAt?.toISOString() : undefined,
    startedAt: job.startedAt?.toISOString(), canCancel: ['QUEUED', 'RUNNING'].includes(job.status), error: job.errorMessage,
    changes: changes ?? null,
  };
}

async function changeSummary(jobId: string) {
  const event = await prisma.auditEvent.findFirst({ where: { targetId: jobId, action: 'sync.completed' }, orderBy: { createdAt: 'desc' } });
  if (!event) return null;
  try { return JSON.parse(event.metadataJson) as Record<string, unknown>; } catch { return null; }
}

syncRouter.get('/sync', asyncHandler(async (req, res) => {
  const job = await prisma.syncJob.findFirst({ where: { accountId: req.appSession!.accountId! }, orderBy: { createdAt: 'desc' } });
  res.json(view(job, job ? await changeSummary(job.id) : null));
}));

syncRouter.post('/sync', requireCsrf, asyncHandler(async (req, res) => {
  const accountId = req.appSession!.accountId!;
  if (isSyncRunning(accountId)) throw new AppError(409, 'SYNC_ALREADY_RUNNING', 'Já existe uma sincronização em andamento.');
  const last = await prisma.syncJob.findFirst({ where: { accountId }, orderBy: { createdAt: 'desc' } });
  if (last?.createdAt && Date.now() - last.createdAt.getTime() < config.SYNC_COOLDOWN_SECONDS * 1000) {
    throw new AppError(429, 'SYNC_COOLDOWN', 'Aguarde antes de sincronizar novamente.');
  }
  const account = await prisma.oAuthAccount.findUniqueOrThrow({ where: { id: accountId } });
  const job = await prisma.syncJob.create({ data: { accountId } });
  await audit(req, 'sync.start', 'SUCCESS', { accountId, targetType: 'sync', targetId: job.id });
  void runSync(accountId, account.mlUserId, job.id, req.appSession!.id);
  res.status(202).json(view(job));
}));

syncRouter.delete('/sync', requireCsrf, asyncHandler(async (req, res) => {
  const job = await prisma.syncJob.findFirst({ where: { accountId: req.appSession!.accountId!, status: { in: ['QUEUED', 'RUNNING'] } }, orderBy: { createdAt: 'desc' } });
  if (!job) throw new AppError(404, 'SYNC_NOT_RUNNING', 'Não há sincronização para cancelar.');
  const updated = await prisma.syncJob.update({ where: { id: job.id }, data: { cancelRequestedAt: new Date(), status: 'CANCELLING' } });
  await audit(req, 'sync.cancel', 'SUCCESS', {
    accountId: req.appSession!.accountId!,
    targetType: 'sync',
    targetId: job.id,
  });
  res.json(view(updated));
}));
