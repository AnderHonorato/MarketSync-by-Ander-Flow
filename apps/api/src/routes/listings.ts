import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { AppError, asyncHandler } from "../lib/errors.js";
import { requireAuthenticated } from "../middleware/session.js";
import {
  filteredRows,
  listingView,
  parseFilters,
} from "../services/listings.js";
import { mlRequest } from "../services/mercadoLivre.js";
import {
  asRecord,
  rankingParticipant,
  rankingRows,
  sellerSummary,
  type SellerSummary,
} from "../services/ranking.js";

export const listingsRouter = Router();
listingsRouter.use(requireAuthenticated);

listingsRouter.get(
  "/account",
  asyncHandler(async (req, res) => {
    const account = await prisma.oAuthAccount.findUnique({
      where: { id: req.appSession!.accountId! },
    });
    if (!account)
      throw new AppError(
        401,
        "AUTH_REQUIRED",
        "Conecte uma conta do Mercado Livre.",
      );
    res.json({
      sellerId: account.mlUserId,
      nickname: account.nickname,
      siteId: account.siteId,
      connectedAt: account.createdAt.toISOString(),
      tokenExpiresAt: account.accessTokenExpiresAt?.toISOString() ?? null,
      capabilities: {
        bulkActions: [
          "pause",
          "activate",
          "close",
          "set_price",
          "increase_price",
          "decrease_price",
          "set_stock",
          "add_stock",
          "subtract_stock",
          "set_sku",
        ],
      },
    });
  }),
);

listingsRouter.get(
  "/listings",
  asyncHandler(async (req, res) => {
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .default(1)
      .parse(req.query.page);
    const limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(200)
      .default(30)
      .parse(req.query.limit);
    const scoreEnabled = String(req.query.scoreEnabled ?? "true") !== "false";
    const filters = parseFilters(req.query as Record<string, unknown>);
    if (!scoreEnabled && filters.sort?.startsWith("score_"))
      filters.sort = "created_desc";
    const rows = await filteredRows(req.appSession!.accountId!, filters);
    const start = (page - 1) * limit;
    res.json({
      items: rows
        .slice(start, start + limit)
        .map((row) => ({
          ...listingView(row),
          internalScore: scoreEnabled ? row.internalScore : null,
        })),
      page,
      pageSize: limit,
      total: rows.length,
      totalPages: Math.max(1, Math.ceil(rows.length / limit)),
      hasNext: start + limit < rows.length,
    });
  }),
);

listingsRouter.get(
  "/listings/:id/ranking",
  asyncHandler(async (req, res) => {
    const accountId = req.appSession!.accountId!;
    const itemId = String(req.params.id);
    const [row, account] = await Promise.all([
      prisma.listingSnapshot.findUnique({
        where: { accountId_mlItemId: { accountId, mlItemId: itemId } },
      }),
      prisma.oAuthAccount.findUnique({ where: { id: accountId } }),
    ]);
    if (!row || !account)
      throw new AppError(404, "LISTING_NOT_FOUND", "Anúncio não encontrado nesta conta.");

    const catalogProductId = row.catalogProductId;
    if (!catalogProductId) {
      res.json({
        available: false,
        catalogProductId: null,
        source: "not_catalog",
        message: "Este anúncio não participa de uma página de catálogo, por isso não possui ranking de Buy Box.",
        status: null,
        priceToWin: null,
        visitShare: null,
        competitorsSharingFirstPlace: null,
        participants: [],
      });
      return;
    }

    const [competitionValue, productValue, productItemsValue] = await Promise.all([
      mlRequest<unknown>(accountId, `/items/${encodeURIComponent(itemId)}/price_to_win?siteId=${encodeURIComponent(account.siteId ?? "MLB")}&version=v2`).catch(() => null),
      mlRequest<unknown>(accountId, `/products/${encodeURIComponent(catalogProductId)}`).catch(() => null),
      mlRequest<unknown>(accountId, `/products/${encodeURIComponent(catalogProductId)}/items?limit=100`).catch(() => null),
    ]);
    const competition = asRecord(competitionValue);
    const product = asRecord(productValue);
    const productWinner = asRecord(product.buy_box_winner);
    const competitionWinner = asRecord(competition.winner);
    const winnerItemId = String(productWinner.item_id ?? competitionWinner.item_id ?? "") || null;
    const candidates = rankingRows(productItemsValue);

    if (!candidates.some((candidate) => {
      const value = asRecord(candidate);
      return String(value.item_id ?? value.id ?? "") === itemId;
    })) {
      candidates.push({
        item_id: row.mlItemId,
        seller_id: account.mlUserId,
        title: row.title,
        price: row.price,
        original_price: row.originalPrice,
        currency_id: row.currencyId,
        available_quantity: row.availableQuantity,
        sold_quantity: row.soldQuantity,
        shipping: JSON.parse(row.shippingJson),
        listing_type_id: row.listingTypeId,
        thumbnail: row.thumbnail,
        permalink: row.permalink,
      });
    }
    if (winnerItemId && !candidates.some((candidate) => {
      const value = asRecord(candidate);
      return String(value.item_id ?? value.id ?? "") === winnerItemId;
    })) candidates.push(productWinner.item_id ? productWinner : competitionWinner);

    const sellerIds = [...new Set(candidates.map((candidate) => {
      const value = asRecord(candidate);
      const nestedSeller = asRecord(value.seller);
      return String(value.seller_id ?? nestedSeller.id ?? "");
    }).filter(Boolean))].slice(0, 50);
    const sellerEntries = await Promise.all(sellerIds.map(async (sellerId) => {
      const profile = await mlRequest<unknown>(accountId, `/users/${encodeURIComponent(sellerId)}`).catch(() => null);
      return [sellerId, sellerSummary(profile)] as const;
    }));
    const sellers = new Map<string, SellerSummary>(sellerEntries);
    const participants = candidates
      .map((candidate) => {
        const value = asRecord(candidate);
        const nestedSeller = asRecord(value.seller);
        const sellerId = String(value.seller_id ?? nestedSeller.id ?? "");
        return rankingParticipant(candidate, account.mlUserId, winnerItemId, sellers.get(sellerId));
      })
      .filter((participant) => participant.itemId)
      .filter((participant, index, all) => all.findIndex((other) => other.itemId === participant.itemId) === index)
      .sort((a, b) => Number(b.winner) - Number(a.winner) || (a.price ?? Number.MAX_SAFE_INTEGER) - (b.price ?? Number.MAX_SAFE_INTEGER));

    res.json({
      available: true,
      catalogProductId,
      source: productItemsValue ? "official_product_items" : "official_competition_summary",
      message: productItemsValue
        ? null
        : "A API retornou o resumo da competição, mas não disponibilizou a lista completa de participantes.",
      status: typeof competition.status === "string" ? competition.status : null,
      reason: typeof competition.reason === "string" ? competition.reason : null,
      priceToWin: typeof competition.price_to_win === "number" ? competition.price_to_win : null,
      currentPrice: typeof competition.current_price === "number" ? competition.current_price : row.price,
      visitShare: typeof competition.visit_share === "string" ? competition.visit_share : null,
      competitorsSharingFirstPlace: typeof competition.competitors_sharing_first_place === "number" ? competition.competitors_sharing_first_place : null,
      winnerItemId,
      participants,
    });
  }),
);

listingsRouter.get(
  "/listings/:id",
  asyncHandler(async (req, res) => {
    const accountId = req.appSession!.accountId!;
    const itemId = String(req.params.id);
    const row = await prisma.listingSnapshot.findUnique({
      where: { accountId_mlItemId: { accountId, mlItemId: itemId } },
    });
    if (!row)
      throw new AppError(
        404,
        "LISTING_NOT_FOUND",
        "Anúncio não encontrado nesta conta.",
      );
    const [description, promotions] = await Promise.all([
      mlRequest<Record<string, unknown>>(
        accountId,
        `/items/${encodeURIComponent(row.mlItemId)}/description`,
      ).catch(() => ({})),
      mlRequest<unknown>(
        accountId,
        `/seller-promotions/items/${encodeURIComponent(row.mlItemId)}?app_version=v2`,
      ).catch(() => []),
    ]);
    const raw = JSON.parse(row.rawJson) as Record<string, unknown>;
    raw._promotions = promotions;
    await prisma.listingSnapshot.update({
      where: { id: row.id },
      data: { rawJson: JSON.stringify(raw) },
    });
    const descriptionData = description as Record<string, unknown>;
    res.json({
      ...listingView({ ...row, rawJson: JSON.stringify(raw) }),
      pictures: JSON.parse(row.picturesJson),
      attributes: JSON.parse(row.attributesJson),
      variations: JSON.parse(row.variationsJson),
      shipping: JSON.parse(row.shippingJson),
      description: descriptionData.plain_text ?? descriptionData.text ?? null,
      metrics: null,
      unavailableFields: [
        "posição orgânica",
        "tempo líquido descontando pausas",
        "Pix como propriedade geral do anúncio",
      ],
    });
  }),
);
