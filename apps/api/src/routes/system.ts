import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler } from "../lib/errors.js";
import { clearCurrentSession, requireCsrf } from "../middleware/session.js";
import { clearUnofficialScans } from "../services/unofficialScan.js";

export const systemRouter = Router();

systemRouter.post("/system/reset", requireCsrf, asyncHandler(async (req, res) => {
  z.object({ confirmation: z.literal("CONFIRMAR") }).parse(req.body);
  clearUnofficialScans();
  await clearCurrentSession(req, res);
  await prisma.$transaction(async (tx) => {
    await tx.auditEvent.deleteMany();
    await tx.aiMessage.deleteMany();
    await tx.aiConversation.deleteMany();
    await tx.oAuthAttempt.deleteMany();
    await tx.session.deleteMany();
    await tx.oAuthAccount.deleteMany();
  });
  res.status(204).end();
}));
