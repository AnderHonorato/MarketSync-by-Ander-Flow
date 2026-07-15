import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { audit } from "../lib/audit.js";
import { randomOpaque, safeEqual, sha256 } from "../lib/crypto.js";
import { AppError, asyncHandler } from "../lib/errors.js";
import { requireAuthenticated, requireCsrf } from "../middleware/session.js";
import { filteredRows, parseFilters } from "../services/listings.js";
import { mlRequest } from "../services/mercadoLivre.js";

const operationSchema = z.object({
  type: z.enum([
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
  ]),
  value: z.union([z.number(), z.string()]).optional(),
  unit: z.enum(["fixed", "percentage"]).optional(),
  rounding: z.enum(["none", "integer", "ending_90", "ending_99"]).optional(),
  minPrice: z.number().nonnegative().optional(),
  maxPrice: z.number().positive().optional(),
});
const selectionSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("explicit"),
    ids: z.array(z.string().min(3)).min(1).max(10_000),
  }),
  z.object({
    mode: z.literal("allFiltered"),
    excludedIds: z.array(z.string()).max(10_000),
    filters: z.record(z.unknown()),
  }),
]);

function newPrice(
  current: number,
  op: z.infer<typeof operationSchema>,
): number {
  const amount = Number(op.value);
  let value =
    op.type === "set_price"
      ? amount
      : op.type === "increase_price"
        ? current +
          (op.unit === "percentage" ? (current * amount) / 100 : amount)
        : current -
          (op.unit === "percentage" ? (current * amount) / 100 : amount);
  if (op.rounding === "integer") value = Math.round(value);
  if (op.rounding === "ending_90") value = Math.floor(value) + 0.9;
  if (op.rounding === "ending_99") value = Math.floor(value) + 0.99;
  return Math.max(
    op.minPrice ?? 0,
    Math.min(
      op.maxPrice ?? Number.MAX_SAFE_INTEGER,
      Math.round(value * 100) / 100,
    ),
  );
}

async function selected(
  accountId: string,
  selection: z.infer<typeof selectionSchema>,
) {
  if (selection.mode === "explicit")
    return prisma.listingSnapshot.findMany({
      where: { accountId, mlItemId: { in: selection.ids } },
    });
  const rows = await filteredRows(accountId, parseFilters(selection.filters));
  return rows.filter((row) => !selection.excludedIds.includes(row.mlItemId));
}

function previewItem(row: any, op: z.infer<typeof operationSchema>) {
  const raw = JSON.parse(row.rawJson) as Record<string, any>;
  const priceAction = [
    "set_price",
    "increase_price",
    "decrease_price",
  ].includes(op.type);
  const stockAction = ["set_stock", "add_stock", "subtract_stock"].includes(
    op.type,
  );
  let currentValue: string | number = row.status;
  let next: string | number =
    op.type === "pause"
      ? "paused"
      : op.type === "activate"
        ? "active"
        : op.type === "close"
          ? "closed"
          : String(op.value ?? "");
  let message: string | null = null;
  if (priceAction) {
    currentValue = row.price;
    next = newPrice(row.price, op);
    if (raw.tags?.includes("dynamic_standard_price"))
      message = "Preço controlado por automação.";
    if (raw._promotion?.pix === true)
      message =
        "Anúncio em campanha Pix: o preço não pode ser alterado diretamente enquanto participa da campanha.";
  }
  if (stockAction) {
    currentValue = row.availableQuantity;
    const amount = Number(op.value);
    next =
      op.type === "set_stock"
        ? amount
        : op.type === "add_stock"
          ? row.availableQuantity + amount
          : row.availableQuantity - amount;
    if (Number(next) < 0) message = "O estoque não pode ser negativo.";
  }
  if (op.type === "close") message = "Encerramento é definitivo.";
  if (op.type === "activate" && row.status === "closed")
    message = "Anúncio encerrado não pode ser reativado.";
  if (op.type === "set_sku" && raw.variations?.length)
    message = "SKU de item com variações exige edição por variação.";
  return {
    id: row.mlItemId,
    title: row.title,
    currentValue,
    newValue: next,
    valid: !message || op.type === "close",
    message,
  };
}

export const bulkRouter = Router();
bulkRouter.use(requireAuthenticated);

bulkRouter.post(
  "/bulk/preview",
  requireCsrf,
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        selection: selectionSchema,
        operation: operationSchema,
        idempotencyKey: z.string().min(8).max(120),
      })
      .parse(req.body);
    const accountId = req.appSession!.accountId!;
    const rows = await selected(accountId, input.selection);
    if (!rows.length)
      throw new AppError(
        400,
        "EMPTY_SELECTION",
        "Nenhum anúncio válido foi selecionado.",
      );
    if (
      input.selection.mode === "explicit" &&
      rows.length !== new Set(input.selection.ids).size
    )
      throw new AppError(
        403,
        "LISTING_OWNERSHIP",
        "A seleção contém anúncio que não pertence à conta.",
      );
    const items = rows.map((row) => previewItem(row, input.operation));
    const confirmation = randomOpaque(24);
    const created = await prisma.bulkOperation
      .create({
        data: {
          accountId,
          idempotencyKey: input.idempotencyKey,
          action: input.operation.type,
          payloadJson: JSON.stringify(input.operation),
          previewJson: JSON.stringify({
            confirmationHash: sha256(confirmation),
            items,
          }),
          total: rows.length,
          items: {
            create: rows.map((row, index) => ({
              mlItemId: row.mlItemId,
              beforeJson: JSON.stringify({ value: items[index].currentValue }),
              afterJson: JSON.stringify({ value: items[index].newValue }),
              status: items[index].valid ? "PENDING" : "INVALID",
            })),
          },
        },
      })
      .catch(async () => {
        const existing = await prisma.bulkOperation.findUnique({
          where: {
            accountId_idempotencyKey: {
              accountId,
              idempotencyKey: input.idempotencyKey,
            },
          },
        });
        if (!existing)
          throw new AppError(
            409,
            "IDEMPOTENCY_CONFLICT",
            "Chave de idempotência já utilizada.",
          );
        return existing;
      });
    res.json({
      previewId: created.id,
      confirmationToken: confirmation,
      affected: rows.length,
      valid: items.filter((i) => i.valid).length,
      invalid: items.filter((i) => !i.valid).length,
      warnings:
        input.operation.type === "close"
          ? ["Encerrar um anúncio é irreversível."]
          : [],
      items,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
  }),
);

async function execute(operationId: string, accountId: string): Promise<void> {
  const operation = await prisma.bulkOperation.findUniqueOrThrow({
    where: { id: operationId },
    include: { items: true },
  });
  const op = JSON.parse(operation.payloadJson) as z.infer<
    typeof operationSchema
  >;
  await prisma.bulkOperation.update({
    where: { id: operationId },
    data: { status: "RUNNING", startedAt: new Date() },
  });
  for (const item of operation.items.filter((i) => i.status === "PENDING")) {
    try {
      const fresh = await mlRequest<Record<string, any>>(
        accountId,
        `/items/${encodeURIComponent(item.mlItemId)}`,
      );
      const snapshot = await prisma.listingSnapshot.findUnique({
        where: { accountId_mlItemId: { accountId, mlItemId: item.mlItemId } },
      });
      const snapshotRaw = snapshot
        ? (JSON.parse(snapshot.rawJson) as Record<string, any>)
        : {};
      let body: Record<string, unknown>;
      if (op.type === "pause") body = { status: "paused" };
      else if (op.type === "activate") body = { status: "active" };
      else if (op.type === "close") body = { status: "closed" };
      else if (
        ["set_price", "increase_price", "decrease_price"].includes(op.type)
      ) {
        if (fresh.tags?.includes("dynamic_standard_price"))
          throw new Error("Preço controlado por automação.");
        if (snapshotRaw._promotion?.pix === true)
          throw new Error(
            "Saia da campanha Pix antes de alterar o preço diretamente.",
          );
        body = { price: newPrice(Number(fresh.price), op) };
      } else if (
        ["set_stock", "add_stock", "subtract_stock"].includes(op.type)
      ) {
        const amount = Number(op.value);
        const current = Number(fresh.available_quantity);
        const value =
          op.type === "set_stock"
            ? amount
            : op.type === "add_stock"
              ? current + amount
              : current - amount;
        if (value < 0) throw new Error("Estoque resultante negativo.");
        body = { available_quantity: value };
      } else
        body = {
          attributes: [{ id: "SELLER_SKU", value_name: String(op.value) }],
        };
      await mlRequest(
        accountId,
        `/items/${encodeURIComponent(item.mlItemId)}`,
        { method: "PUT", body: JSON.stringify(body) },
      );
      await prisma.bulkOperationItem.update({
        where: { id: item.id },
        data: {
          status: "SUCCESS",
          attempts: { increment: 1 },
          completedAt: new Date(),
        },
      });
      await prisma.bulkOperation.update({
        where: { id: operationId },
        data: { succeeded: { increment: 1 } },
      });
    } catch (error) {
      await prisma.bulkOperationItem.update({
        where: { id: item.id },
        data: {
          status: "FAILED",
          attempts: { increment: 1 },
          errorMessage:
            error instanceof Error ? error.message : "Falha desconhecida",
          completedAt: new Date(),
        },
      });
      await prisma.bulkOperation.update({
        where: { id: operationId },
        data: { failed: { increment: 1 } },
      });
    }
    if (config.BULK_DELAY_MS)
      await new Promise((resolve) => setTimeout(resolve, config.BULK_DELAY_MS));
  }
  await prisma.bulkOperation.update({
    where: { id: operationId },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
}

bulkRouter.post(
  "/bulk/execute",
  requireCsrf,
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        previewId: z.string(),
        confirmationToken: z.string().min(10),
        idempotencyKey: z.string(),
      })
      .parse(req.body);
    const accountId = req.appSession!.accountId!;
    const operation = await prisma.bulkOperation.findFirst({
      where: {
        id: input.previewId,
        accountId,
        idempotencyKey: input.idempotencyKey,
      },
      include: { items: true },
    });
    if (!operation || operation.status !== "PREVIEW")
      throw new AppError(
        409,
        "PREVIEW_INVALID",
        "A prévia não existe ou já foi executada.",
      );
    const stored = JSON.parse(operation.previewJson) as {
      confirmationHash: string;
    };
    if (!safeEqual(stored.confirmationHash, sha256(input.confirmationToken)))
      throw new AppError(403, "CONFIRMATION_INVALID", "Confirmação inválida.");
    await audit(req, "bulk.execute", "SUCCESS", {
      accountId,
      targetType: "bulk",
      targetId: operation.id,
      metadata: { action: operation.action, total: operation.total },
    });
    void execute(operation.id, accountId);
    res
      .status(202)
      .json({
        id: operation.id,
        status: "queued",
        processed: 0,
        total: operation.total,
        successes: 0,
        failures: 0,
      });
  }),
);

bulkRouter.get(
  "/bulk/:id",
  asyncHandler(async (req, res) => {
    const op = await prisma.bulkOperation.findFirst({
      where: {
        id: String(req.params.id),
        accountId: req.appSession!.accountId!,
      },
      include: { items: true },
    });
    if (!op)
      throw new AppError(404, "BULK_NOT_FOUND", "Operação não encontrada.");
    res.json({
      id: op.id,
      status: op.status.toLowerCase(),
      processed: op.succeeded + op.failed,
      total: op.total,
      successes: op.succeeded,
      failures: op.failed,
      items: op.items.map((i) => ({
        id: i.mlItemId,
        success: i.status === "SUCCESS",
        message: i.errorMessage,
      })),
    });
  }),
);
