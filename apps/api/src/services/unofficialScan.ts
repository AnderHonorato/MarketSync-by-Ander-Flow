import { randomUUID } from "node:crypto";
import * as cheerio from "cheerio";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { config } from "../config.js";
import { AppError } from "../lib/errors.js";

const PUBLIC_HOSTS = new Set([
  "www.mercadolivre.com.br",
  "produto.mercadolivre.com.br",
  "lista.mercadolivre.com.br",
]);
const MAX_HTML_BYTES = 5_000_000;
const JOB_TTL_MS = 60 * 60 * 1000;
const detailCooldownMs = () => 2_800 + Math.floor(Math.random() * 2_200);
const pageCooldownMs = () => 4_500 + Math.floor(Math.random() * 3_500);
const MAX_PUBLIC_PAGES = 100;

export type ObservedAttribute = { id: string | null; name: string; value: string };
export type ObservedSeller = {
  id: string | null;
  nickname: string | null;
  profileUrl: string | null;
};

export type ScanLogEntry = {
  at: string;
  level: "info" | "warning" | "error";
  message: string;
  code: string | null;
};

export type ObservedListing = {
  id: string;
  title: string;
  permalink: string;
  thumbnail: string | null;
  pictures: string[];
  price: number | null;
  originalPrice: number | null;
  currencyId: "BRL";
  description: string | null;
  condition: string | null;
  availableQuantity: number | null;
  soldQuantity: number | null;
  listingTypeId: string | null;
  categoryId: string | null;
  catalogListing: boolean;
  catalogProductId: string | null;
  warranty: string | null;
  rating: number | null;
  reviewCount: number | null;
  dateCreated: string | null;
  seller: ObservedSeller;
  shipping: { freeShipping: boolean | null; mode: string | null; logisticType: string | null };
  attributes: ObservedAttribute[];
  pixObserved: boolean | null;
  pixEvidence: string | null;
  checkedAt: string | null;
  error: string | null;
  errorCode: string | null;
  sourceRank: number;
};

export type UnofficialScanJob = {
  id: string;
  sessionId: string;
  mode: "seller" | "product";
  sourceUrl: string;
  query: string | null;
  limitMode: "limited" | "all";
  requestedLimit: number | null;
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | "auth_required";
  phase: string;
  progress: number;
  processed: number;
  total: number;
  pagesRead: number;
  inspectPix: boolean;
  waiting: boolean;
  waitReason: string | null;
  cooldownMs: number;
  partial: boolean;
  items: ObservedListing[];
  logs: ScanLogEntry[];
  error: string | null;
  errorCode: string | null;
  cancelRequested: boolean;
  _sellerSearchDone?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CreateUnofficialScanInput = {
  mode: "seller" | "product";
  url?: string;
  query?: string;
  limitMode: "limited" | "all";
  maxItems?: number;
  inspectPix: boolean;
};

const jobs = new Map<string, UnofficialScanJob>();

function addJobLog(job: UnofficialScanJob, level: ScanLogEntry["level"], message: string, code: string | null = null) {
  job.logs.push({ at: new Date().toISOString(), level, message, code });
  if (job.logs.length > 500) job.logs.splice(0, job.logs.length - 500);
}

function cleanOldJobs() {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    if (new Date(job.updatedAt).getTime() < cutoff) jobs.delete(id);
  }
}

function decodeHtmlValue(value: string): string {
  return value
    .replace(/\\u0026amp;|&amp;/gi, "&")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/")
    .trim();
}

function decodeJsonValue(value: string): string {
  try { return JSON.parse(`"${value.replace(/"/g, '\\"')}"`) as string; }
  catch { return decodeHtmlValue(value); }
}

export function normalizeSellerUrl(input: string): URL {
  const firstUrl = input.match(/https?:\/\/[^\s]+/i)?.[0];
  if (!firstUrl) throw new AppError(400, "INVALID_SELLER_URL", "Informe um link de página ou loja do Mercado Livre.");
  const withoutConcatenatedUrl = firstUrl.split(/(?=https?:\/\/)/i)[0];
  let url: URL;
  try { url = new URL(withoutConcatenatedUrl); }
  catch { throw new AppError(400, "INVALID_SELLER_URL", "O link informado não é válido."); }
  if (url.protocol !== "https:" || url.hostname !== "www.mercadolivre.com.br") {
    throw new AppError(400, "UNSUPPORTED_SELLER_URL", "Use um link https://www.mercadolivre.com.br/pagina/... ou /loja/....");
  }
  if (!/^\/(pagina|loja)\/[^/]+/i.test(url.pathname)) {
    throw new AppError(400, "UNSUPPORTED_SELLER_URL", "Esse link não corresponde a uma página ou loja de anunciante.");
  }
  url.hash = "";
  return url;
}

export function productSearchUrl(query: string): URL {
  const normalized = query.replace(/\s+/g, " ").trim();
  if (normalized.length < 2) throw new AppError(400, "INVALID_PRODUCT_QUERY", "Informe ao menos 2 caracteres para buscar um produto.");
  const slug = normalized.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  return new URL(`https://lista.mercadolivre.com.br/${encodeURIComponent(slug)}`);
}

function assertAllowedPublicUrl(value: string): URL {
  const url = new URL(decodeHtmlValue(value));
  if (url.protocol !== "https:" || !PUBLIC_HOSTS.has(url.hostname)) throw new Error("Endereço externo não permitido.");
  url.hash = "";
  return url;
}

async function fetchHtml(url: URL): Promise<string> {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(Math.min(config.REQUEST_TIMEOUT_MS, 30_000)),
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml",
      "accept-language": "pt-BR,pt;q=0.9",
      "cache-control": "no-cache",
    },
  });
  if (!response.ok) throw new AppError(response.status, "PUBLIC_PAGE_UNAVAILABLE", `O Mercado Livre recusou a página pública (${response.status}).`);
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_HTML_BYTES) throw new AppError(413, "PUBLIC_PAGE_TOO_LARGE", "A página pública é grande demais para leitura segura.");
  const html = await response.text();
  if (Buffer.byteLength(html) > MAX_HTML_BYTES) throw new AppError(413, "PUBLIC_PAGE_TOO_LARGE", "A página pública é grande demais para leitura segura.");
  if (/account-verification|negative_traffic/i.test(response.url) || /loginType=negative_traffic|This page requires JavaScript/i.test(html)) {
    throw new AppError(403, "PUBLIC_PAGE_BLOCKED", "O Mercado Livre pediu uma verificação de acesso para esta página.");
  }
  if (/\/login\b|auth\/?login|login\.mercadolivre|identification/i.test(response.url)) {
    throw new AppError(401, "ML_AUTH_REQUIRED", "O Mercado Livre solicitou autenticação para continuar.");
  }
  return html;
}

type RenderedReader = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  read: (url: URL, expandListings?: boolean, targetItems?: number | null) => Promise<string>;
};

async function createRenderedReader(): Promise<RenderedReader> {
  let browser: Browser;
  try {
    browser = await chromium.launch({
      channel: "chrome",
      headless: true,
      args: ["--window-size=1280,900", "--disable-notifications", "--disable-extensions"],
    });
  } catch (error) {
    throw new AppError(503, "PUBLIC_BROWSER_UNAVAILABLE", `A busca por produto precisa do Google Chrome instalado. ${error instanceof Error ? error.message : ""}`.trim());
  }
  const context = await browser.newContext({
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    viewport: { width: 1280, height: 900 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    extraHTTPHeaders: { "accept-language": "pt-BR,pt;q=0.9,en;q=0.7" },
  });
  const page = await context.newPage();
  await page.route("**/*", async (route) => {
    const type = route.request().resourceType();
    if (["image", "font", "media"].includes(type)) await route.abort();
    else await route.continue();
  });
  const read = async (url: URL, expandListings = false, targetItems: number | null = null) => {
    const response = await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (response && response.status() >= 400) throw new AppError(response.status(), "PUBLIC_PAGE_UNAVAILABLE", `O Mercado Livre recusou a página pública (${response.status()}).`);
    await page.waitForSelector("main, li.ui-search-layout__item, .poly-card, a[href*='pdp_filters=item_id']", { timeout: 15_000 }).catch(() => undefined);
    if (expandListings) {
      let previousCount = 0;
      let stableRounds = 0;
      const maxRounds = targetItems == null ? 120 : Math.min(120, Math.max(8, Math.ceil(targetItems / 20)));
      for (let round = 0; round < maxRounds; round += 1) {
        const count = await page.locator("a[href*='MLB'], a[href*='item_id'], a[href*='pdp_filters']").count();
        if (targetItems != null && count >= targetItems) break;
        stableRounds = count <= previousCount ? stableRounds + 1 : 0;
        if (stableRounds >= 4) break;
        previousCount = Math.max(previousCount, count);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(700);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
    } else {
      const paymentTrigger = page.getByText(/(?:ver\s+)?(?:meios|formas)\s+de\s+pagamento|pagamento\s+com\s+pix/i).first();
      if (await paymentTrigger.isVisible().catch(() => false)) {
        await paymentTrigger.click({ timeout: 2_500 }).catch(() => undefined);
        await page.waitForTimeout(450);
      }
    }
    const currentUrl = page.url();
    if (/account-verification|\/login|\/captcha\//i.test(currentUrl)) throw new AppError(403, "PUBLIC_BROWSER_BLOCKED", "O Mercado Livre pediu uma verificação de acesso. Aguarde e tente novamente mais tarde.");
    const html = await page.content();
    if (Buffer.byteLength(html) > MAX_HTML_BYTES) throw new AppError(413, "PUBLIC_PAGE_TOO_LARGE", "A página pública é grande demais para leitura segura.");
    if (url.hostname === "lista.mercadolivre.com.br" && !/MLB-?\d{7,}/i.test(html)) {
      throw new AppError(429, "PUBLIC_SEARCH_TEMPORARILY_BLOCKED", "O Mercado Livre limitou temporariamente a busca pública. A pausa de segurança foi mantida; aguarde alguns minutos antes de tentar novamente.");
    }
    return html;
  };
  return { browser, context, page, read };
}

function itemIdFromLink(url: URL): string | null {
  const candidates = [
    url.searchParams.get("item_id"),
    url.hash.match(/(?:wid|item_id)=?(MLB-?\d+)/i)?.[1],
    url.href.match(/pdp_filters=[^#]*item_id(?:%3A|:)(MLB-?\d+)/i)?.[1],
    url.href.match(/[?&#]wid=(MLB-?\d+)/i)?.[1],
    url.pathname.match(/\/(MLB-?\d{7,})(?:[-/?]|$)/i)?.[1],
  ];
  const found = candidates.find(Boolean);
  return found ? found.toUpperCase().replace("MLB-", "MLB") : null;
}

function catalogProductIdFromLink(url: URL): string | null {
  // /p/MLB12345 or /jM-p-MLB12345 or /p/MLB12345/p
  const pathMatch = url.pathname.match(/\/p\/(MLB-?\d{7,})(?:[/-]|$)/i);
  if (pathMatch) return pathMatch[1].toUpperCase().replace("MLB-", "MLB");
  // Query param: ?catalog_product_id=MLB12345
  const qp = url.searchParams.get("catalog_product_id");
  if (qp) return qp.toUpperCase().replace("MLB-", "MLB");
  return null;
}

function extractSellerSlug(sourceUrl: string): string | null {
  try {
    const url = new URL(sourceUrl);
    const match = url.pathname.match(/\/(?:loja|pagina)\/([^/?]+)/i);
    return match?.[1] ?? null;
  } catch { return null; }
}

function moneyFromText(value: string): number | null {
  const cleaned = value.replace(/[^\d,.]/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  const amount = Number(cleaned);
  return Number.isFinite(amount) ? amount : null;
}

function emptyListing(id: string, title: string, permalink: string, sourceRank: number): ObservedListing {
  return {
    id, title, permalink, thumbnail: null, pictures: [], price: null, originalPrice: null, currencyId: "BRL",
    description: null, condition: null, availableQuantity: null, soldQuantity: null, listingTypeId: null,
    categoryId: null, catalogListing: false, catalogProductId: null, warranty: null, rating: null,
    reviewCount: null, dateCreated: null, seller: { id: null, nickname: null, profileUrl: null },
    shipping: { freeShipping: null, mode: null, logisticType: null }, attributes: [], pixObserved: null,
    pixEvidence: null, checkedAt: null, error: null, sourceRank,
    errorCode: null,
  };
}

export function discoverListings(html: string, maxItems?: number): ObservedListing[] {
  const $ = cheerio.load(html);
  const found = new Map<string, ObservedListing>();
  $("a[href]").each((_, element) => {
    if (maxItems && found.size >= maxItems) return false;
    const href = $(element).attr("href");
    if (!href || !/^https?:/i.test(decodeHtmlValue(href))) return;
    let url: URL;
    try { url = assertAllowedPublicUrl(href); } catch { return; }
    const id = itemIdFromLink(url);
    if (!id || found.has(id)) return;
    const card = $(element).closest("li, article, [class*='poly-card'], [class*='item']");
    const rawTitle = $(element).attr("title") || card.find("[class*='title']").first().text() || $(element).text();
    const title = rawTitle.replace(/\s+/g, " ").trim() || id;
    const matchingImage = $("img").filter((_, image) => ($(image).attr("alt") || "").replace(/\s+/g, " ").trim() === title).first();
    const image = card.find("img").first().length ? card.find("img").first() : matchingImage;
    const thumbnail = image.attr("data-src") || image.attr("src") || null;
    const item = emptyListing(id, title, url.toString(), found.size + 1);
    item.catalogProductId = catalogProductIdFromLink(url)
      || card.attr("data-catalog-product-id")
      || card.find("[data-catalog-product-id]").attr("data-catalog-product-id")
      || null;
    if (!item.catalogProductId) {
      const cardHref = card.find("a[href*='/p/MLB']").first().attr("href");
      if (cardHref) {
        try { item.catalogProductId = catalogProductIdFromLink(new URL(decodeHtmlValue(cardHref))); } catch { /* ignore */ }
      }
    }
    item.catalogListing = Boolean(item.catalogProductId);
    item.thumbnail = thumbnail ? decodeHtmlValue(thumbnail) : null;
    item.pictures = item.thumbnail ? [item.thumbnail] : [];
    item.price = moneyFromText(card.find("[class*='money-amount__fraction']").first().text());
    item.originalPrice = moneyFromText(card.find("[class*='money-amount--previous'], [class*='price--original']").first().text());
    const cardText = card.text().replace(/\s+/g, " ");
    item.shipping.freeShipping = /frete\s+gr[aá]tis/i.test(cardText) ? true : null;
    item.condition = /\busado\b/i.test(cardText) ? "used" : /\bnovo\b/i.test(cardText) ? "new" : null;
    found.set(id, item);
  });
  return [...found.values()];
}

export function discoverNextPage(html: string, currentUrl: URL): URL | null {
  const $ = cheerio.load(html);
  const selectors = ["a[rel='next']", ".andes-pagination__button--next a", "a[title*='Seguinte']", "a[aria-label*='Seguinte']"];
  for (const selector of selectors) {
    const href = $(selector).first().attr("href");
    if (!href) continue;
    try {
      const url = assertAllowedPublicUrl(new URL(decodeHtmlValue(href), currentUrl).toString());
      if (url.toString() !== currentUrl.toString()) return url;
    } catch { /* ignore malformed pagination links */ }
  }
  return null;
}

export function detectExplicitPix(html: string): { found: boolean; evidence: string | null } {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, template").remove();
  const normalized = ($("main").text() || $("body").text()).replace(/\s+/g, " ").trim();
  const patterns = [
    /(?:\d{1,2}%\s*(?:de\s*)?(?:desconto|off)|desconto|preço|pagamento)[^.]{0,100}(?:com|no|via)\s+pix/iu,
    /pix[^.]{0,100}(?:desconto|preço|pagamento|economize)/iu,
    /(?:pague|pagando)[^.]{0,80}(?:com|via)\s+pix/iu,
  ];
  const match = patterns.map((pattern) => normalized.match(pattern)).find(Boolean);
  if (!match?.index && match?.index !== 0) return { found: false, evidence: null };
  const start = Math.max(0, match.index - 45);
  return { found: true, evidence: normalized.slice(start, Math.min(normalized.length, match.index + match[0].length + 45)).trim().slice(0, 220) };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function findProductNode(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const entry of value) { const found = findProductNode(entry); if (found) return found; }
    return null;
  }
  const node = record(value);
  if (!node) return null;
  const type = node["@type"];
  if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) return node;
  for (const child of Object.values(node)) { const found = findProductNode(child); if (found) return found; }
  return null;
}

function embeddedString(html: string, key: string): string | null {
  const match = html.match(new RegExp(`(?:"|\\\\")${key}(?:"|\\\\")\\s*:\\s*(?:"|\\\\")([^"\\\\]*(?:\\\\.[^"\\\\]*)*)`, "i"));
  return match?.[1] ? decodeJsonValue(match[1]) : null;
}

function embeddedNumber(html: string, key: string): number | null {
  const match = html.match(new RegExp(`(?:"|\\\\")${key}(?:"|\\\\")\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, "i"));
  const value = Number(match?.[1]);
  return Number.isFinite(value) ? value : null;
}

function embeddedBoolean(html: string, key: string): boolean | null {
  const match = html.match(new RegExp(`(?:"|\\\\")${key}(?:"|\\\\")\\s*:\\s*(true|false)`, "i"));
  return match ? match[1].toLowerCase() === "true" : null;
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function productImages(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.map((entry) => typeof entry === "string" ? entry : textValue(record(entry)?.url)).filter((entry): entry is string => Boolean(entry));
}

export function enrichFromPage(item: ObservedListing, html: string, inspectPix = true): ObservedListing {
  const $ = cheerio.load(html);
  let product: Record<string, unknown> | null = null;
  $("script[type='application/ld+json']").each((_, script) => {
    if (product) return;
    try { product = findProductNode(JSON.parse($(script).text())); } catch { /* invalid structured data */ }
  });
  const productData = product as Record<string, unknown> | null;
  const offers = record(productData?.offers) ?? (Array.isArray(productData?.offers) ? record(productData?.offers[0]) : null);
  const aggregate = record(productData?.aggregateRating);
  const sellerData = record(offers?.seller) ?? record(productData?.seller);
  const title = textValue(productData?.name) ?? $("meta[property='og:title']").attr("content")?.trim() ?? item.title;
  const canonical = $("link[rel='canonical']").attr("href") || $("meta[property='og:url']").attr("content");
  let permalink = item.permalink;
  if (canonical) { try { permalink = assertAllowedPublicUrl(canonical).toString(); } catch { /* keep discovered URL */ } }
  const pictures = [...new Set([
    ...productImages(productData?.image),
    ...$("meta[property='og:image']").map((_, meta) => $(meta).attr("content")).get().filter(Boolean),
    ...[...html.matchAll(/(?:"|\\")secure_url(?:"|\\")\s*:\s*(?:"|\\")([^"\\]+(?:\\.[^"\\]*)*)/gi)].slice(0, 12).map((match) => decodeJsonValue(match[1])),
  ])].slice(0, 20);
  const visibleText = ($("main").text() || $("body").text()).replace(/\s+/g, " ");
  const soldText = visibleText.match(/(?:mais de\s+)?([\d.,]+)\s+(?:vendidos?|vendas?)/i)?.[1];
  const attributes: ObservedAttribute[] = [];
  $("tr").each((_, row) => {
    const cells = $(row).find("th, td").map((__, cell) => $(cell).text().replace(/\s+/g, " ").trim()).get().filter(Boolean);
    if (cells.length >= 2 && cells[0].length < 100 && cells[1].length < 300) attributes.push({ id: null, name: cells[0], value: cells[1] });
  });
  const additional = Array.isArray(productData?.additionalProperty) ? productData?.additionalProperty : [];
  for (const entry of additional) {
    const property = record(entry); const name = textValue(property?.name); const value = textValue(property?.value);
    if (name && value && !attributes.some((attribute) => attribute.name === name)) attributes.push({ id: textValue(property?.propertyID), name, value });
  }
  const pix = inspectPix ? detectExplicitPix(html) : { found: false, evidence: null };
  const itemCondition = textValue(offers?.itemCondition) ?? embeddedString(html, "condition");
  const catalogProductId = embeddedString(html, "catalog_product_id") ?? item.catalogProductId;
  const observedItemId = embeddedString(html, "item_id");
  const sellerId = embeddedNumber(html, "seller_id");
  const rawPrice = offers?.price ?? embeddedNumber(html, "price");
  const price = rawPrice == null ? null : Number(rawPrice);
  const originalPrice = embeddedNumber(html, "original_price") ?? item.originalPrice;
  const description = textValue(productData?.description)
    ?? $("[class*='description'] p, [class*='description__content']").first().text().replace(/\s+/g, " ").trim()
    ?? null;
  const freeShipping = embeddedBoolean(html, "free_shipping") ?? (/frete\s+gr[aá]tis/i.test(visibleText) ? true : item.shipping.freeShipping);
  return {
    ...item,
    id: observedItemId && /^MLB\d{7,}$/i.test(observedItemId) ? observedItemId.toUpperCase() : item.id,
    title,
    permalink,
    thumbnail: pictures[0] ?? item.thumbnail,
    pictures: pictures.length ? pictures : item.pictures,
    price: price != null && Number.isFinite(price) ? price : item.price,
    originalPrice,
    description: description || null,
    condition: /NewCondition/i.test(itemCondition || "") ? "new" : /UsedCondition/i.test(itemCondition || "") ? "used" : itemCondition || item.condition,
    availableQuantity: embeddedNumber(html, "available_quantity"),
    soldQuantity: embeddedNumber(html, "sold_quantity") ?? (soldText ? moneyFromText(soldText) : null),
    listingTypeId: embeddedString(html, "listing_type_id"),
    categoryId: embeddedString(html, "category_id"),
    catalogListing: embeddedBoolean(html, "catalog_listing") ?? Boolean(catalogProductId),
    catalogProductId,
    warranty: embeddedString(html, "warranty"),
    rating: Number.isFinite(Number(aggregate?.ratingValue)) ? Number(aggregate?.ratingValue) : null,
    reviewCount: Number.isFinite(Number(aggregate?.reviewCount ?? aggregate?.ratingCount)) ? Number(aggregate?.reviewCount ?? aggregate?.ratingCount) : null,
    dateCreated: embeddedString(html, "date_created"),
    seller: {
      id: sellerId != null ? String(sellerId) : null,
      nickname: textValue(sellerData?.name) ?? embeddedString(html, "nickname"),
      profileUrl: textValue(sellerData?.url),
    },
    shipping: { freeShipping, mode: embeddedString(html, "mode"), logisticType: embeddedString(html, "logistic_type") },
    attributes: attributes.slice(0, 80),
    pixObserved: inspectPix ? pix.found : null,
    pixEvidence: inspectPix ? pix.evidence : null,
    checkedAt: new Date().toISOString(),
  };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function safetyPause(job: UnofficialScanJob, ms: number, reason: string) {
  addJobLog(job, "info", `Pausa de ${(ms / 1000).toFixed(1)} s: ${reason}.`);
  job.waiting = true;
  job.waitReason = reason;
  job.cooldownMs = ms;
  job.phase = `Pausa de segurança: ${reason}`;
  job.updatedAt = new Date().toISOString();
  let remaining = ms;
  while (remaining > 0 && !job.cancelRequested) {
    const slice = Math.min(250, remaining);
    await pause(slice);
    remaining -= slice;
  }
  job.waiting = false;
  job.waitReason = null;
  job.cooldownMs = 0;
}

async function discoverAllPages(job: UnofficialScanJob, renderedReader: RenderedReader | null): Promise<ObservedListing[]> {
  const results = new Map<string, ObservedListing>();
  const visited = new Set<string>();
  let pageUrl: URL | null = new URL(job.sourceUrl);
  while (pageUrl && job.pagesRead < MAX_PUBLIC_PAGES) {
      if (job.cancelRequested) throw new Error("CANCELLED");
      const pageKey = pageUrl.toString();
      if (visited.has(pageKey)) break;
      visited.add(pageKey);
      job.phase = job.mode === "product" ? `Buscando ofertas públicas · página ${job.pagesRead + 1}` : `Lendo anúncios da loja · página ${job.pagesRead + 1}`;
      let html: string;
      try {
        html = await fetchHtml(pageUrl);
      } catch (directError) {
        if (!renderedReader || !(directError instanceof AppError) || ![403, 429].includes(directError.status)) throw directError;
        addJobLog(job, "warning", "A resposta pública direta foi limitada. Tentando a leitura renderizada.", "MLAM-PUB-010");
        html = await renderedReader.read(pageUrl, true, job.requestedLimit);
      }
      const remaining = job.requestedLimit == null ? undefined : Math.max(0, job.requestedLimit - results.size);
      const pageItems = discoverListings(html, remaining);
      for (const item of pageItems) if (!results.has(item.id)) results.set(item.id, { ...item, sourceRank: results.size + 1 });
      job.pagesRead += 1;
      job.total = results.size;
      job.items = [...results.values()];
      job.progress = job.limitMode === "all" ? Math.min(32, 5 + job.pagesRead * 2) : Math.min(32, Math.round((results.size / Math.max(1, job.requestedLimit ?? 1)) * 30));
      job.updatedAt = new Date().toISOString();
      addJobLog(job, "info", `Página ${job.pagesRead} lida: ${pageItems.length} anúncios encontrados, ${results.size} únicos acumulados.`);
      if (job.requestedLimit != null && results.size >= job.requestedLimit) break;
      const nextPage = discoverNextPage(html, pageUrl);
      if (!nextPage) {
        if (job.mode === "seller" && !job._sellerSearchDone) {
          job._sellerSearchDone = true;
          const sellerSlug = extractSellerSlug(job.sourceUrl);
          if (sellerSlug) {
            addJobLog(job, "info", `Páginas da loja esgotadas. Buscando por "${sellerSlug}" no catálogo público.`);
            const searchUrl = new URL(`https://lista.mercadolivre.com.br/_CustId_${encodeURIComponent(sellerSlug)}`);
            pageUrl = searchUrl;
            await safetyPause(job, pageCooldownMs(), "aguardando antes da busca complementar");
            continue;
          }
        }
        addJobLog(job, "warning", "A página não informou um próximo endereço. A leitura desta origem foi encerrada.", "MLAM-PUB-007");
        break;
      }
      await safetyPause(job, pageCooldownMs(), "aguardando antes da próxima página");
      pageUrl = nextPage;
  }
  if (pageUrl && job.pagesRead >= MAX_PUBLIC_PAGES) job.partial = true;
  return [...results.values()].slice(0, job.requestedLimit ?? undefined);
}

async function runJob(job: UnofficialScanJob) {
  let renderedReader: RenderedReader | null = null;
  try {
    job.status = "running";
    job.phase = "Preparando a consulta pública";
    job.progress = 2;
    job.updatedAt = new Date().toISOString();
    addJobLog(job, "info", `Consulta iniciada no modo ${job.mode === "product" ? "produto" : "loja"}.`);
    await safetyPause(job, 900, "preparando a primeira leitura em ritmo seguro");
    if (job.cancelRequested) throw new Error("CANCELLED");
    renderedReader = await createRenderedReader();
    job.items = await discoverAllPages(job, renderedReader);
    job.total = job.items.length;
    if (!job.items.length) throw new AppError(422, "NO_PUBLIC_LISTINGS", "Nenhum anúncio público foi encontrado para essa consulta.");
    for (let index = 0; index < job.items.length; index += 1) {
      if (job.cancelRequested) throw new Error("CANCELLED");
      const item = job.items[index];
      job.phase = `Lendo detalhes ${index + 1} de ${job.total}: ${item.id}`;
      try {
        const itemUrl = assertAllowedPublicUrl(item.permalink);
        let itemHtml: string;
        try {
          itemHtml = await fetchHtml(itemUrl);
        } catch (directError) {
          if (!renderedReader || !(directError instanceof AppError) || ![403, 429].includes(directError.status)) throw directError;
          addJobLog(job, "warning", `A resposta direta de ${item.id} foi limitada; tentando a leitura renderizada.`, "MLAM-PUB-010");
          itemHtml = await renderedReader.read(itemUrl);
        }
        const enriched = enrichFromPage(item, itemHtml, job.inspectPix);
        job.items[index] = enriched;
        addJobLog(job, "info", `${enriched.id} detalhado${enriched.pixObserved ? "; Pix explícito observado" : ""}.`);
        if (job.mode === "product" && enriched.catalogProductId) {
          const known = new Set(job.items.map((entry) => entry.id));
          const relatedOffers = discoverListings(itemHtml).filter((entry) =>
            entry.catalogProductId === enriched.catalogProductId && !known.has(entry.id),
          );
          const remaining = job.requestedLimit == null ? relatedOffers.length : Math.max(0, job.requestedLimit - job.items.length);
          for (const related of relatedOffers.slice(0, remaining)) {
            job.items.push({ ...related, sourceRank: job.items.length + 1 });
            known.add(related.id);
          }
          job.total = job.items.length;
        }
      } catch (error) {
        const errorCode = error instanceof AppError ? error.code : "MLAM-PUB-008";
        job.items[index] = { ...item, checkedAt: new Date().toISOString(), error: error instanceof Error ? error.message : "Não foi possível ler este anúncio.", errorCode };
        addJobLog(job, "error", `Não foi possível detalhar ${item.id}.`, errorCode);
      }
      job.processed = index + 1;
      job.progress = Math.round(35 + (job.processed / job.total) * 60);
      job.updatedAt = new Date().toISOString();
      if (index + 1 < job.items.length) await safetyPause(job, detailCooldownMs(), `reduzindo requisições antes do anúncio ${index + 2}`);
    }
    // Retry failed items with more patience
    const failed = job.items.reduce<number[]>((acc, item, idx) => { if (item.error) acc.push(idx); return acc; }, []);
    if (failed.length > 0) {
      addJobLog(job, "warning", `${failed.length} anúncios não puderam ser lidos. Tentando novamente com mais calma.`);
      for (const idx of failed) {
        if (job.cancelRequested) throw new Error("CANCELLED");
        const item = job.items[idx];
        job.phase = `Retentando ${failed.indexOf(idx) + 1} de ${failed.length}: ${item.id}`;
        try {
          const itemUrl = assertAllowedPublicUrl(item.permalink);
          await safetyPause(job, 5_000 + Math.floor(Math.random() * 4_000), "aguardando antes da nova tentativa");
          let itemHtml: string;
          try { itemHtml = await fetchHtml(itemUrl); }
          catch { if (!renderedReader) throw new Error("RENDERER_UNAVAILABLE"); itemHtml = await renderedReader.read(itemUrl); }
          const enriched = enrichFromPage(item, itemHtml, job.inspectPix);
          job.items[idx] = enriched;
          addJobLog(job, "info", `${enriched.id} recuperado na segunda tentativa.`);
        } catch (retryError) {
          addJobLog(job, "error", `Falha definitiva ao detalhar ${item.id} após nova tentativa.`, "MLAM-PUB-012");
        }
        job.progress = Math.round(60 + (job.processed / job.total) * 38);
        job.updatedAt = new Date().toISOString();
      }
    }
    job.status = "completed";
    job.phase = job.partial ? "Consulta concluída parcialmente por segurança" : "Consulta concluída";
    job.progress = 100;
    addJobLog(job, job.partial ? "warning" : "info", `${job.phase}: ${job.items.length} anúncios, ${job.pagesRead} páginas.`);
  } catch (error) {
    if (job.cancelRequested || (error instanceof Error && error.message === "CANCELLED")) {
      job.status = "cancelled";
      job.phase = "Consulta cancelada";
      addJobLog(job, "warning", "A consulta foi cancelada pelo usuário.", "MLAM-OPR-001");
    } else if (error instanceof AppError && error.code === "ML_AUTH_REQUIRED") {
      job.status = "auth_required";
      job.phase = "O Mercado Livre solicitou autenticação. Faça login e retome a consulta.";
      job.error = error.message;
      job.errorCode = error.code;
      addJobLog(job, "warning", job.phase, "ML_AUTH_REQUIRED");
    } else {
      job.status = "failed";
      job.phase = "Não foi possível concluir a consulta";
      job.error = error instanceof Error ? error.message : "Falha inesperada na consulta pública.";
      job.errorCode = error instanceof AppError ? error.code : "INTERNAL_ERROR";
      addJobLog(job, "error", job.error, job.errorCode);
    }
  } finally {
    await renderedReader?.context.close().catch(() => undefined);
    await renderedReader?.browser.close().catch(() => undefined);
    job.waiting = false;
    job.waitReason = null;
    job.cooldownMs = 0;
    job.updatedAt = new Date().toISOString();
  }
}

export function createUnofficialScan(sessionId: string, input: CreateUnofficialScanInput) {
  cleanOldJobs();
  const running = [...jobs.values()].find((job) => job.sessionId === sessionId && ["queued", "running"].includes(job.status));
  if (running) throw new AppError(409, "SCAN_ALREADY_RUNNING", "Já existe uma consulta pública em andamento.");
  const source = input.mode === "seller" ? normalizeSellerUrl(input.url ?? "") : productSearchUrl(input.query ?? "");
  const query = input.mode === "product" ? (input.query ?? "").replace(/\s+/g, " ").trim() : null;
  const requestedLimit = input.limitMode === "all" ? null : Math.max(1, Math.min(2_000, input.maxItems ?? 30));
  const now = new Date().toISOString();
  const job: UnofficialScanJob = {
    id: randomUUID(), sessionId, mode: input.mode, sourceUrl: source.toString(), query,
    limitMode: input.limitMode, requestedLimit, status: "queued", phase: "Preparando a consulta",
    progress: 0, processed: 0, total: 0, pagesRead: 0, inspectPix: input.inspectPix,
    waiting: false, waitReason: null, cooldownMs: 0, partial: false, items: [], logs: [], error: null, errorCode: null,
    cancelRequested: false, createdAt: now, updatedAt: now,
  };
  jobs.set(job.id, job);
  void runJob(job);
  return job;
}

export function getUnofficialScan(sessionId: string, id: string) {
  cleanOldJobs();
  const job = jobs.get(id);
  if (!job || job.sessionId !== sessionId) throw new AppError(404, "SCAN_NOT_FOUND", "Essa consulta não foi encontrada.");
  return job;
}

export function cancelUnofficialScan(sessionId: string, id: string) {
  const job = getUnofficialScan(sessionId, id);
  if (["queued", "running"].includes(job.status)) {
    job.cancelRequested = true;
    job.phase = "Cancelando após a leitura atual";
    job.updatedAt = new Date().toISOString();
  }
  return job;
}

export function resumeUnofficialScan(sessionId: string, id: string) {
  const job = getUnofficialScan(sessionId, id);
  if (job.status !== "auth_required") throw new AppError(409, "SCAN_NOT_PAUSED", "Esta consulta não está pausada para autenticação.");
  job.status = "running";
  job.phase = "Retomando consulta após autenticação";
  job.error = null;
  job.errorCode = null;
  job.updatedAt = new Date().toISOString();
  addJobLog(job, "info", "Consulta retomada após autenticação.");
  void runJob(job);
  return job;
}

export function clearUnofficialScans() {
  for (const job of jobs.values()) job.cancelRequested = true;
  jobs.clear();
}
