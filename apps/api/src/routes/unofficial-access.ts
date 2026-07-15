import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler, AppError } from "../lib/errors.js";
import { sha256, safeEqual } from "../lib/crypto.js";

export const unofficialAccessRouter = Router();

const passwordSchema = z.string().min(8).max(64);
const questionSchema = z.string().min(10).max(200);

unofficialAccessRouter.get("/unofficial/access", asyncHandler(async (_req, res) => {
  const access = await prisma.unofficialAccess.findFirst();
  res.json({ configured: Boolean(access) });
}));

unofficialAccessRouter.post("/unofficial/access/setup", asyncHandler(async (req, res) => {
  const existing = await prisma.unofficialAccess.findFirst();
  if (existing) throw new AppError(409, "ALREADY_CONFIGURED", "O código de liberação já foi configurado. Use a recuperação para redefinir.");

  const { password, recoveryQuestion, recoveryAnswer } = z.object({
    password: passwordSchema,
    recoveryQuestion: questionSchema,
    recoveryAnswer: z.string().min(2).max(200),
  }).parse(req.body);

  await prisma.unofficialAccess.create({
    data: {
      passwordHash: sha256(password),
      recoveryQuestion,
      recoveryAnswerHash: sha256(recoveryAnswer.toLowerCase().trim()),
    },
  });

  res.status(201).json({ ok: true });
}));

unofficialAccessRouter.post("/unofficial/access/verify", asyncHandler(async (req, res) => {
  const { password } = z.object({ password: passwordSchema }).parse(req.body);
  const access = await prisma.unofficialAccess.findFirst();
  if (!access) throw new AppError(404, "NOT_CONFIGURED", "Nenhum código de liberação configurado.");

  if (!safeEqual(access.passwordHash, sha256(password))) {
    throw new AppError(403, "WRONG_PASSWORD", "Código incorreto.");
  }

  res.json({ ok: true });
}));

unofficialAccessRouter.post("/unofficial/access/recover", asyncHandler(async (req, res) => {
  const { recoveryAnswer } = z.object({ recoveryAnswer: z.string().min(2).max(200) }).parse(req.body);
  const access = await prisma.unofficialAccess.findFirst();
  if (!access) throw new AppError(404, "NOT_CONFIGURED", "Nenhum código configurado para recuperação.");

  if (!safeEqual(access.recoveryAnswerHash, sha256(recoveryAnswer.toLowerCase().trim()))) {
    throw new AppError(403, "WRONG_ANSWER", "Resposta incorreta.");
  }

  res.json({
    ok: true,
    recoveryQuestion: access.recoveryQuestion,
  });
}));

unofficialAccessRouter.post("/unofficial/access/reset", asyncHandler(async (req, res) => {
  const { recoveryAnswer, newPassword } = z.object({
    recoveryAnswer: z.string().min(2).max(200),
    newPassword: passwordSchema,
  }).parse(req.body);

  const access = await prisma.unofficialAccess.findFirst();
  if (!access) throw new AppError(404, "NOT_CONFIGURED", "Nenhum código configurado para redefinição.");

  if (!safeEqual(access.recoveryAnswerHash, sha256(recoveryAnswer.toLowerCase().trim()))) {
    throw new AppError(403, "WRONG_ANSWER", "Resposta de recuperação incorreta.");
  }

  await prisma.unofficialAccess.update({
    where: { id: access.id },
    data: { passwordHash: sha256(newPassword) },
  });

  res.json({ ok: true });
}));
