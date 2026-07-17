import type { Session, AppUser } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      appSession?: Session;
      rawSessionId?: string;
      appUser?: AppUser;
    }
  }
}

export {};
