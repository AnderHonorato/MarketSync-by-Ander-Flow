import { describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { filteredRows } from "../src/services/listings.js";

async function listing(
  accountId: string,
  id: string,
  promotion?: Record<string, unknown>,
) {
  return prisma.listingSnapshot.create({
    data: {
      accountId,
      mlItemId: id,
      title: `Anúncio ${id}`,
      status: "active",
      price: 100,
      currencyId: "BRL",
      availableQuantity: 1,
      soldQuantity: 0,
      rawJson: JSON.stringify(promotion ? { _promotion: promotion } : {}),
    },
  });
}

describe("filtro de campanha Pix", () => {
  it("retorna somente anúncios oficialmente associados a uma campanha Pix", async () => {
    const account = await prisma.oAuthAccount.create({
      data: { mlUserId: "pix-seller", nickname: "Loja Pix" },
    });
    await listing(account.id, "MLB-PIX", {
      pix: true,
      type: "BANK",
      paymentMethod: "PIX",
      status: "active",
    });
    await listing(account.id, "MLB-COMUM");
    await listing(account.id, "MLB-CANDIDATO", {
      pix: false,
      type: "BANK",
      status: "eligible",
    });

    const rows = await filteredRows(account.id, { promotion: "pix" });
    expect(rows.map((row) => row.mlItemId)).toEqual(["MLB-PIX"]);
  });

  it("separa campanha Pix ativa e programada", async () => {
    const account = await prisma.oAuthAccount.create({
      data: { mlUserId: "pix-status", nickname: "Loja Pix" },
    });
    await listing(account.id, "MLB-ATIVO", { pix: true, status: "active" });
    await listing(account.id, "MLB-FUTURO", { pix: true, status: "future" });

    expect(
      (await filteredRows(account.id, { promotion: "pix_active" })).map(
        (row) => row.mlItemId,
      ),
    ).toEqual(["MLB-ATIVO"]);
    expect(
      (await filteredRows(account.id, { promotion: "pix_future" })).map(
        (row) => row.mlItemId,
      ),
    ).toEqual(["MLB-FUTURO"]);
  });
});
