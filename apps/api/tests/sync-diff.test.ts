import type { ListingSnapshot } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { changedFields } from "../src/services/sync.js";

describe("comparação entre sincronizações", () => {
  it("identifica somente campos realmente alterados", () => {
    const previous = {
      title: "Produto", sku: "A1", status: "active", price: 100,
      originalPrice: null, availableQuantity: 10, soldQuantity: 2,
      categoryId: "MLB1", condition: "new", listingTypeId: "gold_special",
      permalink: "https://example.test/item", thumbnail: "image.webp",
      catalogListing: false, catalogProductId: null, freeShipping: false,
    } as ListingSnapshot;
    const fields = changedFields(previous, {
      title: "Produto", status: "active", price: 90, original_price: null,
      available_quantity: 7, sold_quantity: 2, category_id: "MLB1",
      condition: "new", listing_type_id: "gold_special",
      permalink: "https://example.test/item", thumbnail: "image.webp",
      catalog_listing: false, catalog_product_id: null,
      shipping: { free_shipping: false },
    }, "A1");
    expect(fields).toEqual(["preço", "estoque"]);
  });
});
