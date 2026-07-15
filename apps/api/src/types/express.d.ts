import type { Session } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      appSession?: Session;
      rawSessionId?: string;
    }
  }
}

export {};
