import { config } from "../config.js";
import { prisma } from "../db.js";
import { mlRequest } from "./mercadoLivre.js";
import type { ListingSnapshot } from "@prisma/client";

type Search = {
  results?: string[];
  scroll_id?: string;
  paging?: { total?: number };
};
type Multi = Array<{ code: number; body: Record<string, any> }>;
type SellerPromotions = { results?: Array<{ id?: string; type?: string }> };
type PromotionItems = {
  results?: Array<{
    id?: string;
    status?: string;
    price?: number;
    original_price?: number;
  }>;
  paging?: { searchAfter?: string; search_after?: string };
  search_after?: string;
};
const running = new Set<string>();
type FieldDifference = { field: string; before: unknown; after: unknown };
type SyncItemChange = { id: string; kind: "added" | "updated" | "unchanged" | "removed"; fields: string[]; differences?: FieldDifference[] };

const chunks = <T>(values: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(values.length / size) }, (_, i) =>
    values.slice(i * size, i * size + size),
  );
const date = (value: unknown): Date | null =>
  value && !Number.isNaN(new Date(String(value)).getTime())
    ? new Date(String(value))
    : null;

function score(item: Record<string, any>): number {
  const sold = Math.min(
    35,
    Math.log10((Number(item.sold_quantity) || 0) + 1) * 15,
  );
  const stock = Number(item.available_quantity) > 0 ? 15 : 0;
  const active = item.status === "active" ? 20 : 0;
  const catalog = item.catalog_listing ? 10 : 0;
  const health = Number.isFinite(Number(item.health))
    ? Math.min(20, Number(item.health) * 20)
    : 0;
  return Math.round((sold + stock + active + catalog + health) * 10) / 10;
}

function fieldDifferences(previous: ListingSnapshot, item: Record<string, any>, sku: string | null): FieldDifference[] {
  const fields: Array<[string, unknown, unknown]> = [
    ["título", previous.title, String(item.title ?? "Anúncio sem título")],
    ["SKU", previous.sku, sku],
    ["status", previous.status, String(item.status ?? "unknown")],
    ["preço", previous.price, Number(item.price) || 0],
    ["preço original", previous.originalPrice, item.original_price == null ? null : Number(item.original_price)],
    ["estoque", previous.availableQuantity, Number(item.available_quantity) || 0],
    ["quantidade vendida", previous.soldQuantity, Number(item.sold_quantity) || 0],
    ["categoria", previous.categoryId, item.category_id ?? null],
    ["condição", previous.condition, item.condition ?? null],
    ["tipo de anúncio", previous.listingTypeId, item.listing_type_id ?? null],
    ["link", previous.permalink, item.permalink ?? null],
    ["imagem", previous.thumbnail, item.thumbnail ?? null],
    ["catálogo", previous.catalogListing, Boolean(item.catalog_listing)],
    ["produto de catálogo", previous.catalogProductId, item.catalog_product_id ?? null],
    ["frete grátis", previous.freeShipping, Boolean(item.shipping?.free_shipping)],
  ];
  return fields
    .filter(([, before, after]) => (before ?? null) !== (after ?? null))
    .map(([field, before, after]) => ({ field, before: before ?? null, after: after ?? null }));
}

export function changedFields(previous: ListingSnapshot, item: Record<string, any>, sku: string | null): string[] {
  return fieldDifferences(previous, item, sku).map((difference) => difference.field);
}

async function allIds(
  accountId: string,
  sellerId: string,
  jobId: string,
): Promise<string[]> {
  const ids: string[] = [];
  let scrollId: string | undefined;
  do {
    const path = scrollId
      ? `/users/${sellerId}/items/search?search_type=scan&scroll_id=${encodeURIComponent(scrollId)}`
      : `/users/${sellerId}/items/search?search_type=scan`;
    const page = await mlRequest<Search>(accountId, path);
    const found = page.results ?? [];
    ids.push(...found);
    scrollId = found.length ? page.scroll_id : undefined;
    await prisma.syncJob.update({
      where: { id: jobId },
      data: { total: page.paging?.total ?? ids.length },
    });
  } while (scrollId);
  return [...new Set(ids)];
}

async function saveItem(
  accountId: string,
  jobId: string,
  item: Record<string, any>,
): Promise<SyncItemChange> {
  const attrs = Array.isArray(item.attributes) ? item.attributes : [];
  const variations = Array.isArray(item.variations) ? item.variations : [];
  const sku =
    attrs.find((a: any) => a.id === "SELLER_SKU")?.value_name ??
    variations.find((v: any) => v.seller_custom_field)?.seller_custom_field ??
    null;
  const previous = await prisma.listingSnapshot.findUnique({
    where: { accountId_mlItemId: { accountId, mlItemId: String(item.id) } },
  });
  const sold = Number(item.sold_quantity) || 0;
  const differences = previous ? fieldDifferences(previous, item, sku) : [];
  const fields = differences.map((difference) => difference.field);
  if (previous) {
    try {
      if ((JSON.parse(previous.rawJson) as Record<string, unknown>)._missingFromSync === true) fields.unshift("retorno à consulta");
    } catch { /* snapshot anterior sem JSON válido */ }
  }
  const kind: SyncItemChange["kind"] = !previous ? "added" : fields.length ? "updated" : "unchanged";
  const raw: Record<string, unknown> = { ...item };
  if (kind !== "unchanged") {
    raw._syncChange = { kind, fields, differences, jobId, at: new Date().toISOString() };
  }
  await prisma.listingSnapshot.upsert({
    where: { accountId_mlItemId: { accountId, mlItemId: String(item.id) } },
    create: {
      accountId,
      mlItemId: String(item.id),
      title: String(item.title ?? "Anúncio sem título"),
      sku,
      sellerCustomField: item.seller_custom_field ?? null,
      status: String(item.status ?? "unknown"),
      price: Number(item.price) || 0,
      originalPrice:
        item.original_price == null ? null : Number(item.original_price),
      discountPercent: 0,
      currencyId: String(item.currency_id ?? "BRL"),
      availableQuantity: Number(item.available_quantity) || 0,
      soldQuantity: sold,
      categoryId: item.category_id ?? null,
      condition: item.condition ?? null,
      listingTypeId: item.listing_type_id ?? null,
      permalink: item.permalink ?? null,
      thumbnail: item.thumbnail ?? null,
      catalogListing: Boolean(item.catalog_listing),
      catalogProductId: item.catalog_product_id ?? null,
      startTime: date(item.start_time),
      stopTime: date(item.stop_time),
      lastUpdated: date(item.last_updated),
      freeShipping: Boolean(item.shipping?.free_shipping),
      picturesJson: JSON.stringify(item.pictures ?? []),
      attributesJson: JSON.stringify(attrs),
      variationsJson: JSON.stringify(variations),
      shippingJson: JSON.stringify(item.shipping ?? {}),
      rawJson: JSON.stringify(raw),
      internalScore: score(item),
      lastSaleDetectedAt:
        sold > (previous?.soldQuantity ?? sold)
          ? new Date()
          : previous?.lastSaleDetectedAt,
      lastSyncJobId: jobId,
    },
    update: {
      title: String(item.title ?? "Anúncio sem título"),
      sku,
      sellerCustomField: item.seller_custom_field ?? null,
      status: String(item.status ?? "unknown"),
      price: Number(item.price) || 0,
      originalPrice:
        item.original_price == null ? null : Number(item.original_price),
      currencyId: String(item.currency_id ?? "BRL"),
      availableQuantity: Number(item.available_quantity) || 0,
      soldQuantity: sold,
      categoryId: item.category_id ?? null,
      condition: item.condition ?? null,
      listingTypeId: item.listing_type_id ?? null,
      permalink: item.permalink ?? null,
      thumbnail: item.thumbnail ?? null,
      catalogListing: Boolean(item.catalog_listing),
      catalogProductId: item.catalog_product_id ?? null,
      startTime: date(item.start_time),
      stopTime: date(item.stop_time),
      lastUpdated: date(item.last_updated),
      freeShipping: Boolean(item.shipping?.free_shipping),
      picturesJson: JSON.stringify(item.pictures ?? []),
      attributesJson: JSON.stringify(attrs),
      variationsJson: JSON.stringify(variations),
      shippingJson: JSON.stringify(item.shipping ?? {}),
      rawJson: JSON.stringify(raw),
      internalScore: score(item),
      lastSaleDetectedAt:
        sold > (previous?.soldQuantity ?? sold)
          ? new Date()
          : previous?.lastSaleDetectedAt,
      capturedAt: new Date(),
      lastSyncJobId: jobId,
    },
  });
  await prisma.salesSnapshot.create({
    data: { accountId, mlItemId: String(item.id), soldQuantity: sold },
  });
  return { id: String(item.id), kind, fields, differences };
}

function promotionStatus(
  itemStatus: string | undefined,
  campaignStatus: string | undefined,
): "active" | "future" | "ended" | "unknown" {
  if (itemStatus === "started" && campaignStatus === "started") return "active";
  if (itemStatus === "pending" || campaignStatus === "pending") return "future";
  if (campaignStatus === "finished") return "ended";
  return "unknown";
}

async function syncPixCampaigns(
  accountId: string,
  sellerId: string,
): Promise<void> {
  let campaigns: SellerPromotions;
  try {
    campaigns = await mlRequest<SellerPromotions>(
      accountId,
      `/seller-promotions/users/${encodeURIComponent(sellerId)}?promotion_type=BANK&app_version=v2`,
    );
  } catch {
    // Promoções podem não estar habilitadas para a conta. Não apague o último estado conhecido.
    return;
  }

  const associations = new Map<string, Record<string, unknown>>();
  for (const campaign of campaigns.results ?? []) {
    if (!campaign.id || campaign.type !== "BANK") continue;
    const detail = await mlRequest<Record<string, any>>(
      accountId,
      `/seller-promotions/promotions/${encodeURIComponent(campaign.id)}?promotion_type=BANK&app_version=v2`,
    ).catch(() => null);
    if (
      !detail ||
      detail.sub_type !== "COFINANCED" ||
      String(detail.payment_method).toUpperCase() !== "PIX"
    )
      continue;

    for (const itemState of ["active", "paused"]) {
      let cursor: string | undefined;
      for (let page = 0; page < 100; page += 1) {
        const params = new URLSearchParams({
          promotion_type: "BANK",
          app_version: "v2",
          status_item: itemState,
          limit: "50",
        });
        if (cursor) params.set("search_after", cursor);
        const response = await mlRequest<PromotionItems>(
          accountId,
          `/seller-promotions/promotions/${encodeURIComponent(campaign.id)}/items?${params}`,
        );
        const results = response.results ?? [];
        for (const item of results) {
          if (!item.id || item.status === "candidate") continue;
          const status = promotionStatus(item.status, detail.status);
          if (!["active", "future"].includes(status)) continue;
          associations.set(String(item.id), {
            pix: true,
            type: "BANK",
            subType: "COFINANCED",
            paymentMethod: "PIX",
            campaignId: campaign.id,
            name: detail.name ?? "Campanha Pix",
            status,
            itemStatus: item.status,
            startAt: detail.start_date ?? null,
            endAt: detail.finish_date ?? null,
            originalPrice: item.original_price ?? null,
            price: item.price ?? null,
          });
        }
        const next =
          response.paging?.searchAfter ??
          response.paging?.search_after ??
          response.search_after;
        if (!results.length || !next || next === cursor) break;
        cursor = next;
      }
    }
  }

  const rows = await prisma.listingSnapshot.findMany({
    where: { accountId },
    select: { id: true, mlItemId: true, rawJson: true },
  });
  for (const row of rows) {
    const raw = JSON.parse(row.rawJson) as Record<string, unknown>;
    const pix = associations.get(row.mlItemId);
    if (pix) raw._promotion = pix;
    else if (
      (raw._promotion as Record<string, unknown> | undefined)?.pix === true
    )
      delete raw._promotion;
    await prisma.listingSnapshot.update({
      where: { id: row.id },
      data: { rawJson: JSON.stringify(raw) },
    });
  }
}

export async function runSync(
  accountId: string,
  sellerId: string,
  jobId: string,
  sessionId?: string,
): Promise<void> {
  if (running.has(accountId)) return;
  running.add(accountId);
  try {
    await prisma.syncJob.update({
      where: { id: jobId },
      data: { status: "RUNNING", startedAt: new Date() },
    });
    const previousRows = await prisma.listingSnapshot.findMany({ where: { accountId } });
    const ids = await allIds(accountId, sellerId, jobId);
    const currentIds = new Set(ids);
    const changes: SyncItemChange[] = [];
    await prisma.syncJob.update({
      where: { id: jobId },
      data: { total: ids.length },
    });
    for (const group of chunks(ids, 20)) {
      const current = await prisma.syncJob.findUnique({ where: { id: jobId } });
      if (current?.cancelRequestedAt) {
        await prisma.syncJob.update({
          where: { id: jobId },
          data: { status: "CANCELLED", completedAt: new Date() },
        });
        return;
      }
      const multi = await mlRequest<Multi>(
        accountId,
        `/items?ids=${group.map(encodeURIComponent).join(",")}`,
      );
      for (const result of multi) {
        if (result.code === 200 && result.body?.id) {
          changes.push(await saveItem(accountId, jobId, result.body));
          await prisma.syncJob.update({
            where: { id: jobId },
            data: { processed: { increment: 1 }, succeeded: { increment: 1 } },
          });
        } else {
          await prisma.syncJob.update({
            where: { id: jobId },
            data: { processed: { increment: 1 }, failed: { increment: 1 } },
          });
        }
      }
    }
    for (const previous of previousRows.filter((row) => !currentIds.has(row.mlItemId))) {
      const raw = JSON.parse(previous.rawJson) as Record<string, unknown>;
      if (raw._missingFromSync === true) {
        delete raw._syncChange;
      } else {
        raw._syncChange = { kind: "removed", fields: ["não retornou na consulta"], jobId, at: new Date().toISOString() };
        changes.push({ id: previous.mlItemId, kind: "removed", fields: ["não retornou na consulta"] });
      }
      raw._missingFromSync = true;
      await prisma.listingSnapshot.update({
        where: { id: previous.id },
        data: { rawJson: JSON.stringify(raw), lastSyncJobId: jobId, capturedAt: new Date() },
      });
    }
    await syncPixCampaigns(accountId, sellerId);
    const summary = {
      added: changes.filter((change) => change.kind === "added").length,
      updated: changes.filter((change) => change.kind === "updated").length,
      removed: changes.filter((change) => change.kind === "removed").length,
      unchanged: changes.filter((change) => change.kind === "unchanged").length,
      details: changes.filter((change) => change.kind !== "unchanged").slice(0, 200),
    };
    await prisma.auditEvent.create({
      data: {
        accountId, sessionId, action: "sync.completed", outcome: "SUCCESS",
        targetType: "sync", targetId: jobId, metadataJson: JSON.stringify(summary),
      },
    });
    await prisma.syncJob.update({
      where: { id: jobId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
  } catch (error) {
    await prisma.syncJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        errorMessage:
          error instanceof Error ? error.message : "Falha desconhecida",
        completedAt: new Date(),
      },
    });
    await prisma.auditEvent.create({
      data: {
        accountId, sessionId, action: "sync.failed", outcome: "FAILURE",
        targetType: "sync", targetId: jobId,
        metadataJson: JSON.stringify({ message: error instanceof Error ? error.message : "Falha desconhecida" }),
      },
    }).catch(() => undefined);
  } finally {
    running.delete(accountId);
  }
}

export function isSyncRunning(accountId: string): boolean {
  return running.has(accountId);
}
