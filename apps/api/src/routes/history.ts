import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { audit } from "../lib/audit.js";
import { asyncHandler } from "../lib/errors.js";
import { requireCsrf } from "../middleware/session.js";

export const historyRouter = Router();

const uiAction = z.enum([
  "ui.open",
  "ui.reset",
  "ui.filters",
  "ui.theme",
  "ui.tab",
  "listing.view",
  "unofficial.start",
  "unofficial.complete",
  "export.start",
]);

const safeJson = (value: string): Record<string, unknown> => {
  try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
};

historyRouter.get(
  "/history",
  asyncHandler(async (req, res) => {
    const limit = z.coerce.number().int().min(10).max(200).default(100).parse(req.query.limit);
    const accountId = req.appSession?.accountId;
    const scope = accountId
      ? { OR: [{ accountId }, { session: { accountId } }] }
      : { sessionId: req.appSession!.id };
    const [events, sessions] = await Promise.all([
      prisma.auditEvent.findMany({
        where: scope,
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true, sessionId: true, action: true, targetType: true, targetId: true,
          outcome: true, metadataJson: true, createdAt: true,
        },
      }),
      prisma.session.findMany({
        where: accountId ? { accountId } : { id: req.appSession!.id },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, createdAt: true, lastSeenAt: true, expiresAt: true },
      }),
    ]);
    const now = Date.now();
    res.json({
      events: events.map((event) => ({
        ...event,
        metadata: safeJson(event.metadataJson),
        metadataJson: undefined,
        createdAt: event.createdAt.toISOString(),
        currentSession: event.sessionId === req.appSession!.id,
      })),
      sessions: sessions.map((session) => ({
        id: session.id.slice(0, 10),
        current: session.id === req.appSession!.id,
        startedAt: session.createdAt.toISOString(),
        lastSeenAt: session.lastSeenAt.toISOString(),
        endedAt: session.expiresAt.getTime() <= now ? session.expiresAt.toISOString() : null,
        activeSeconds: Math.max(0, Math.round((Math.min(now, session.lastSeenAt.getTime()) - session.createdAt.getTime()) / 1000)),
      })),
    });
  }),
);

historyRouter.post(
  "/history/activity",
  requireCsrf,
  asyncHandler(async (req, res) => {
    const input = z.object({
      action: uiAction,
      targetType: z.string().max(40).optional(),
      targetId: z.string().max(160).optional(),
      metadata: z.record(z.unknown()).optional(),
    }).parse(req.body);
    const duplicate = ["ui.open", "unofficial.complete"].includes(input.action) ? await prisma.auditEvent.findFirst({
      where: {
        sessionId: req.appSession!.id,
        action: input.action,
        targetId: input.targetId ?? null,
        createdAt: { gt: new Date(Date.now() - 3_000) },
      },
    }) : null;
    if (!duplicate) {
      await audit(req, input.action, "SUCCESS", {
        targetType: input.targetType,
        targetId: input.targetId,
        metadata: input.metadata,
      });
    }
    await prisma.session.update({ where: { id: req.appSession!.id }, data: { lastSeenAt: new Date() } });
    res.status(204).end();
  }),
);

historyRouter.post(
  "/history/heartbeat",
  requireCsrf,
  asyncHandler(async (req, res) => {
    await prisma.session.update({ where: { id: req.appSession!.id }, data: { lastSeenAt: new Date() } });
    res.status(204).end();
  }),
);
