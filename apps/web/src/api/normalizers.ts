import type {
  Account,
  BulkJob,
  BulkPreview,
  Listing,
  ListingAttribute,
  ListingDetail,
  ListingsPage,
  Session,
  SyncState,
} from "../types";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function string(value: unknown, fallback = ""): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : fallback;
}

function nullableString(value: unknown): string | null {
  return value == null ? null : string(value) || null;
}

function number(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function boolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "true") return true;
  if (value === 0 || value === "false") return false;
  return null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function pick(source: JsonObject, ...keys: string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined) return source[key];
  }
  return undefined;
}

function normalizedAttribute(value: unknown): ListingAttribute {
  const raw = object(value);
  return {
    id: nullableString(pick(raw, "id", "attribute_id")),
    name: nullableString(raw.name),
    valueId: nullableString(pick(raw, "valueId", "value_id")),
    valueName: nullableString(pick(raw, "valueName", "value_name", "value")),
  };
}

export function normalizeSession(value: unknown): Session {
  const raw = object(value);
  const nested = object(raw.session);
  const source = Object.keys(nested).length ? nested : raw;
  return {
    authenticated: Boolean(
      pick(source, "authenticated", "isAuthenticated") ??
        source.user ??
        source.account,
    ),
    csrfToken: nullableString(pick(source, "csrfToken", "csrf_token", "csrf")),
    expiresAt: nullableString(
      pick(source, "expiresAt", "expires_at", "sessionExpiresAt"),
    ),
  };
}

export function normalizeAccount(value: unknown): Account {
  const raw = object(value);
  const nested = object(raw.account);
  const source = Object.keys(nested).length ? nested : raw;
  const capabilities = object(source.capabilities);
  return {
    sellerId: string(
      pick(source, "sellerId", "seller_id", "userId", "user_id", "id"),
    ),
    nickname: string(
      pick(source, "nickname", "name", "displayName"),
      "Conta conectada",
    ),
    siteId: nullableString(pick(source, "siteId", "site_id")),
    email: nullableString(source.email),
    connectedAt: nullableString(pick(source, "connectedAt", "connected_at")),
    tokenExpiresAt: nullableString(
      pick(source, "tokenExpiresAt", "token_expires_at"),
    ),
    capabilities: {
      bulkActions: array(pick(capabilities, "bulkActions", "bulk_actions")).map(
        String,
      ) as Account["capabilities"] extends { bulkActions?: infer T }
        ? T
        : never,
    },
  };
}

export function normalizeSync(value: unknown): SyncState {
  const raw = object(value);
  const nested = object(raw.sync);
  const source = Object.keys(nested).length ? nested : raw;
  const total = number(source.total);
  const processed =
    number(pick(source, "processed", "completed", "current")) ?? 0;
  const progress = number(pick(source, "progress", "percentage"));
  const changesRaw = object(source.changes);
  return {
    status: string(source.status, "idle") as SyncState["status"],
    phase: nullableString(pick(source, "phase", "stage")),
    processed,
    total,
    progress:
      progress ?? (total ? Math.round((processed / total) * 100) : null),
    message: nullableString(source.message),
    lastSyncedAt: nullableString(
      pick(source, "lastSyncedAt", "last_synced_at", "completedAt"),
    ),
    startedAt: nullableString(pick(source, "startedAt", "started_at")),
    canCancel:
      boolean(pick(source, "canCancel", "can_cancel")) ??
      ["queued", "running"].includes(string(source.status)),
    error: nullableString(source.error),
    changes: Object.keys(changesRaw).length ? {
      added: number(changesRaw.added) ?? undefined,
      updated: number(changesRaw.updated) ?? undefined,
      removed: number(changesRaw.removed) ?? undefined,
      unchanged: number(changesRaw.unchanged) ?? undefined,
      details: array(changesRaw.details).map((entry) => {
        const detail = object(entry);
        return {
          id: string(detail.id),
          kind: string(detail.kind, "updated") as "added" | "updated" | "removed",
          fields: array(detail.fields).map(String),
        };
      }),
    } : null,
  };
}

export function normalizeListing(value: unknown): Listing {
  const raw = object(value);
  const promotionRaw = object(pick(raw, "promotion", "promotion_info"));
  const syncChangeRaw = object(pick(raw, "syncChange", "sync_change"));
  return {
    id: string(pick(raw, "id", "itemId", "item_id")),
    title: string(raw.title, "Anúncio sem título"),
    sku: nullableString(pick(raw, "sku", "sellerSku", "seller_sku")),
    sellerCustomField: nullableString(
      pick(raw, "sellerCustomField", "seller_custom_field"),
    ),
    status: nullableString(raw.status),
    price: number(raw.price),
    originalPrice: number(pick(raw, "originalPrice", "original_price")),
    currencyId: nullableString(pick(raw, "currencyId", "currency_id")),
    availableQuantity: number(
      pick(raw, "availableQuantity", "available_quantity", "stock"),
    ),
    soldQuantity: number(pick(raw, "soldQuantity", "sold_quantity", "sold")),
    thumbnail: nullableString(
      pick(raw, "thumbnail", "thumbnailUrl", "thumbnail_url"),
    ),
    permalink: nullableString(pick(raw, "permalink", "url")),
    categoryId: nullableString(pick(raw, "categoryId", "category_id")),
    condition: nullableString(raw.condition),
    listingTypeId: nullableString(
      pick(raw, "listingTypeId", "listing_type_id"),
    ),
    catalogListing: boolean(pick(raw, "catalogListing", "catalog_listing")),
    catalogProductId: nullableString(
      pick(raw, "catalogProductId", "catalog_product_id"),
    ),
    catalogEligible: boolean(pick(raw, "catalogEligible", "catalog_eligible")),
    promotion: Object.keys(promotionRaw).length
      ? {
          status: nullableString(
            promotionRaw.status,
          ) as Listing["promotion"] extends infer P
            ? P extends { status?: infer S }
              ? S
              : never
            : never,
          type: nullableString(pick(promotionRaw, "type", "promotion_type")),
          discountPercentage: number(
            pick(promotionRaw, "discountPercentage", "discount_percentage"),
          ),
          startAt: nullableString(
            pick(promotionRaw, "startAt", "start_at", "start_date"),
          ),
          endAt: nullableString(
            pick(promotionRaw, "endAt", "end_at", "end_date"),
          ),
          pix: boolean(promotionRaw.pix) ?? false,
          campaignId: nullableString(
            pick(promotionRaw, "campaignId", "campaign_id"),
          ),
          name: nullableString(promotionRaw.name),
          subType: nullableString(pick(promotionRaw, "subType", "sub_type")),
          paymentMethod: nullableString(
            pick(promotionRaw, "paymentMethod", "payment_method"),
          ),
        }
      : null,
    createdAt: nullableString(
      pick(raw, "createdAt", "created_at", "date_created"),
    ),
    updatedAt: nullableString(
      pick(raw, "updatedAt", "updated_at", "last_updated"),
    ),
    stopAt: nullableString(pick(raw, "stopAt", "stop_at", "stop_time")),
    activeDays: number(pick(raw, "activeDays", "active_days")),
    health: number(raw.health),
    internalScore: number(pick(raw, "internalScore", "internal_score")),
    freeShipping: boolean(pick(raw, "freeShipping", "free_shipping")),
    shippingMode: nullableString(pick(raw, "shippingMode", "shipping_mode")),
    syncChange: Object.keys(syncChangeRaw).length ? {
      kind: string(syncChangeRaw.kind, "updated") as "added" | "updated" | "removed",
      fields: array(syncChangeRaw.fields).map(String),
      differences: array(syncChangeRaw.differences).map((entry) => {
        const difference = object(entry);
        return { field: string(difference.field), before: difference.before, after: difference.after };
      }),
      jobId: nullableString(pick(syncChangeRaw, "jobId", "job_id")) ?? undefined,
      at: nullableString(syncChangeRaw.at) ?? undefined,
    } : null,
    missingFromSync: boolean(pick(raw, "missingFromSync", "missing_from_sync")) ?? false,
  };
}

export function normalizeListingsPage(value: unknown): ListingsPage {
  const raw = object(value);
  const data = raw.data;
  const itemsRaw = Array.isArray(raw.items)
    ? raw.items
    : Array.isArray(raw.results)
      ? raw.results
      : Array.isArray(data)
        ? data
        : array(object(data).items);
  const pagination = {
    ...object(raw.paging),
    ...object(raw.pagination),
    ...object(object(data).pagination),
  };
  const pageSize =
    number(pick(pagination, "pageSize", "page_size", "limit")) ??
    Math.max(itemsRaw.length, 1);
  const offset = number(pagination.offset) ?? 0;
  const page =
    number(pick(pagination, "page", "currentPage")) ??
    Math.floor(offset / pageSize) + 1;
  const total =
    number(pick(pagination, "total", "totalItems", "total_items")) ??
    itemsRaw.length;
  const totalPages =
    number(pick(pagination, "totalPages", "total_pages")) ??
    Math.max(1, Math.ceil(total / pageSize));
  return {
    items: itemsRaw.map(normalizeListing).filter((item) => item.id),
    page,
    pageSize,
    total,
    totalPages,
    hasNext:
      boolean(pick(pagination, "hasNext", "has_next")) ?? page < totalPages,
  };
}

export function normalizeListingDetail(value: unknown): ListingDetail {
  const raw = object(value);
  const nested = object(pick(raw, "item", "listing", "data"));
  const source = Object.keys(nested).length ? { ...raw, ...nested } : raw;
  return {
    ...normalizeListing(source),
    pictures: array(source.pictures)
      .map((picture) => {
        const item = object(picture);
        const url = string(pick(item, "secure_url", "url", "source"));
        return {
          id: nullableString(item.id),
          url,
          alt: nullableString(item.alt),
        };
      })
      .filter((picture) => picture.url),
    description: nullableString(
      pick(source, "description", "plainText", "plain_text") ??
        object(source.description).plain_text,
    ),
    attributes: array(source.attributes).map(normalizedAttribute),
    variations: array(source.variations).map((variation) => {
      const item = object(variation);
      return {
        id: string(item.id),
        sku: nullableString(pick(item, "sku", "seller_sku")),
        price: number(item.price),
        availableQuantity: number(
          pick(item, "availableQuantity", "available_quantity"),
        ),
        soldQuantity: number(pick(item, "soldQuantity", "sold_quantity")),
        attributes: array(
          pick(item, "attributes", "attribute_combinations"),
        ).map(normalizedAttribute),
      };
    }),
    metrics: object(source.metrics) as ListingDetail["metrics"],
    shipping: object(source.shipping),
    unavailableFields: array(
      pick(source, "unavailableFields", "unavailable_fields"),
    ).map(String),
  };
}

export function normalizeBulkPreview(value: unknown): BulkPreview {
  const raw = object(value);
  const nested = object(raw.preview);
  const source = Object.keys(nested).length ? nested : raw;
  const items = array(pick(source, "items", "sample")).map((value) => {
    const item = object(value);
    return {
      id: string(pick(item, "id", "itemId", "item_id")),
      title: nullableString(item.title),
      currentValue: pick(item, "currentValue", "current_value") as
        | string
        | number
        | null,
      newValue: pick(item, "newValue", "new_value") as string | number | null,
      valid: boolean(item.valid) ?? true,
      message: nullableString(item.message),
    };
  });
  const affected = number(pick(source, "affected", "total")) ?? items.length;
  const invalid =
    number(source.invalid) ?? items.filter((item) => !item.valid).length;
  return {
    previewId: string(pick(source, "previewId", "preview_id", "id")),
    confirmationToken: nullableString(
      pick(source, "confirmationToken", "confirmation_token"),
    ),
    affected,
    valid: number(source.valid) ?? Math.max(0, affected - invalid),
    invalid,
    estimatedBatches: number(
      pick(source, "estimatedBatches", "estimated_batches"),
    ),
    warnings: array(source.warnings).map((warning) =>
      typeof warning === "string" ? warning : string(object(warning).message),
    ),
    items,
    expiresAt: nullableString(pick(source, "expiresAt", "expires_at")),
  };
}

export function normalizeBulkJob(value: unknown): BulkJob {
  const raw = object(value);
  const nested = object(pick(raw, "job", "operation"));
  const source = Object.keys(nested).length ? nested : raw;
  const items = array(pick(source, "items", "results")).map((value) => {
    const item = object(value);
    return {
      id: string(pick(item, "id", "itemId", "item_id")),
      success: Boolean(pick(item, "success", "ok")),
      message: nullableString(pick(item, "message", "error")),
      code: nullableString(item.code),
    };
  });
  const total = number(source.total) ?? items.length;
  const processed = number(source.processed) ?? items.length;
  const successes =
    number(source.successes) ?? items.filter((item) => item.success).length;
  const failures =
    number(source.failures) ?? items.filter((item) => !item.success).length;
  return {
    id: string(
      pick(source, "id", "jobId", "job_id", "operationId", "operation_id"),
    ),
    status: string(source.status, "queued") as BulkJob["status"],
    processed,
    total,
    successes,
    failures,
    progress:
      number(source.progress) ??
      (total ? Math.round((processed / total) * 100) : 0),
    items,
    error: nullableString(source.error),
  };
}
