import { Router } from "express";
import { z } from "zod";
import { AppError, asyncHandler } from "../lib/errors.js";
import { requireCsrf } from "../middleware/session.js";
import { cancelUnofficialScan, createUnofficialScan, decideUnofficialScanPause, getUnofficialScan, resumeUnofficialScan } from "../services/unofficialScan.js";
import { mlRequest } from "../services/mercadoLivre.js";
import { rankingParticipant, rankingRows, sellerSummary } from "../services/ranking.js";
import { prisma } from "../db.js";

export const unofficialRouter = Router();

function scanView(job: ReturnType<typeof createUnofficialScan>) {
  const {
    sessionId: _sessionId, cancelRequested: _cancelRequested,
    _sellerSearchDone: __sd, _pauseDecision: __pd, _nextPauseAt: __np,
    ...view
  } = job;
  return view;
}

unofficialRouter.post(
  "/unofficial/scans",
  requireCsrf,
  asyncHandler(async (req, res) => {
    const input = z.object({
      mode: z.enum(["seller", "product"]).default("seller"),
      url: z.string().max(2_500).optional(),
      query: z.string().max(200).optional(),
      limitMode: z.enum(["limited", "all"]).default("limited"),
      maxItems: z.coerce.number().int().min(1).max(2_000).default(30),
      inspectPix: z.boolean().default(true),
      pauseEvery: z.coerce.number().int().min(10).max(2_000).optional(),
    }).superRefine((value, context) => {
      if (value.mode === "seller" && (!value.url || value.url.trim().length < 12)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["url"], message: "Informe a URL da página ou loja." });
      }
      if (value.mode === "product" && (!value.query || value.query.trim().length < 2)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["query"], message: "Informe o nome do produto." });
      }
    }).parse(req.body);
    const job = createUnofficialScan(req.appSession!.id, input);
    res.status(202).json(scanView(job));
  }),
);

unofficialRouter.get(
  "/unofficial/scans/:id",
  asyncHandler(async (req, res) => res.json(scanView(getUnofficialScan(req.appSession!.id, String(req.params.id))))),
);

unofficialRouter.delete(
  "/unofficial/scans/:id",
  requireCsrf,
  asyncHandler(async (req, res) => res.json(scanView(cancelUnofficialScan(req.appSession!.id, String(req.params.id))))),
);

unofficialRouter.post(
  "/unofficial/scans/:id/resume",
  requireCsrf,
  asyncHandler(async (req, res) => res.json(scanView(resumeUnofficialScan(req.appSession!.id, String(req.params.id))))),
);

// Resposta da pausa configurável: continuar a busca ou finalizar com o que já tem
unofficialRouter.post(
  "/unofficial/scans/:id/decisao",
  requireCsrf,
  asyncHandler(async (req, res) => {
    const { continuar } = z.object({ continuar: z.boolean() }).parse(req.body);
    res.json(scanView(decideUnofficialScanPause(req.appSession!.id, String(req.params.id), continuar)));
  }),
);

unofficialRouter.get(
  "/unofficial/catalog/:catalogProductId/participants",
  asyncHandler(async (req, res) => {
    const accountId = req.appSession!.accountId;
    if (!accountId) throw new AppError(403, "AUTH_REQUIRED", "Conecte uma conta do Mercado Livre para ver participantes do catálogo.");
    const catalogProductId = String(req.params.catalogProductId);
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(10, Number(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    const account = await prisma.oAuthAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new AppError(404, "ACCOUNT_NOT_FOUND", "Conta não encontrada.");

    const [productItemsValue] = await Promise.all([
      mlRequest<unknown>(accountId, `/products/${encodeURIComponent(catalogProductId)}/items?limit=${limit}&offset=${offset}`).catch(() => null),
    ]);

    const candidates = rankingRows(productItemsValue);
    const ownSellerId = account.mlUserId;

    const sellerIds = [...new Set(candidates.map((c) => {
      const r = c as Record<string, unknown>;
      return String(r.seller_id ?? (r.seller as Record<string, unknown>)?.id ?? "");
    }).filter(Boolean))];

    const sellerMap = new Map<string, { nickname?: string | null; permalink?: string | null; reputation?: string | null; powerSellerStatus?: string | null; sales?: number | null }>();
    await Promise.all(sellerIds.slice(0, 30).map(async (sellerId) => {
      try {
        const userData = await mlRequest<unknown>(accountId, `/users/${encodeURIComponent(sellerId)}`).catch(() => null);
        if (userData) sellerMap.set(sellerId, sellerSummary(userData));
      } catch { /* skip */ }
    }));

    const participants = candidates.map((c) => {
      const r = c as Record<string, unknown>;
      const sid = String(r.seller_id ?? (r.seller as Record<string, unknown>)?.id ?? "");
      return rankingParticipant(c, ownSellerId, null, sellerMap.get(sid));
    });

    const unique = participants.filter((p, i, arr) => arr.findIndex((x) => x.itemId === p.itemId) === i);
    unique.sort((a, b) => (a.price ?? 999999) - (b.price ?? 999999));

    res.json({
      catalogProductId,
      page,
      limit,
      participants: unique,
      total: unique.length,
    });
  }),
);
