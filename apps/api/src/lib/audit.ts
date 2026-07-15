import type { Request } from 'express';
import { prisma } from '../db.js';
import { hashClientValue } from './crypto.js';

const redact = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      /token|secret|verifier|authorization|cookie/i.test(key) ? '[REDACTED]' : redact(child),
    ]));
  }
  return value;
};

export async function audit(
  req: Request,
  action: string,
  outcome: 'SUCCESS' | 'FAILURE',
  options: { accountId?: string | null; targetType?: string; targetId?: string; metadata?: unknown } = {},
): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      accountId: options.accountId ?? req.appSession?.accountId,
      sessionId: req.appSession?.id,
      action,
      outcome,
      targetType: options.targetType,
      targetId: options.targetId,
      metadataJson: JSON.stringify(redact(options.metadata ?? {})),
      ipHash: hashClientValue(req.ip),
    },
  });
}
