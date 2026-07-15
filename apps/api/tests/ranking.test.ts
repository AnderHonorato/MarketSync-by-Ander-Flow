import { describe, expect, it } from "vitest";
import { rankingParticipant, sellerSummary } from "../src/services/ranking.js";

describe("ranking de competição", () => {
  it("identifica vencedor, conta própria e dados comerciais", () => {
    const seller = sellerSummary({
      nickname: "MINHA_LOJA",
      seller_reputation: {
        level_id: "5_green",
        power_seller_status: "platinum",
        transactions: { total: 1250 },
      },
      eshop: { permalink: "https://example.test/loja" },
    });
    const participant = rankingParticipant({
      item_id: "MLB1",
      seller_id: "SELLER1",
      price: 90,
      original_price: 100,
      shipping: { free_shipping: true, logistic_type: "fulfillment" },
    }, "SELLER1", "MLB1", seller);

    expect(participant).toMatchObject({
      itemId: "MLB1",
      sellerNickname: "MINHA_LOJA",
      winner: true,
      mine: true,
      discountPercent: 10,
      freeShipping: true,
      logisticType: "fulfillment",
      sellerSales: 1250,
    });
  });
});
