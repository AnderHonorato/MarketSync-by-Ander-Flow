import { describe, expect, it } from "vitest";
import {
  detectExplicitPix,
  discoverListings,
  discoverNextPage,
  enrichFromPage,
  normalizeSellerUrl,
  productSearchUrl,
} from "../src/services/unofficialScan.js";

describe("leitura pública opcional", () => {
  it("normaliza URL duplicada e restringe o domínio", () => {
    expect(normalizeSellerUrl("https://www.mercadolivre.com.br/loja/goosehttps://www.mercadolivre.com.br/loja/goose").toString())
      .toBe("https://www.mercadolivre.com.br/loja/goose");
    expect(() => normalizeSellerUrl("https://example.com/loja/goose")).toThrow();
  });

  it("descobre anúncio e prioriza o item_id real", () => {
    const html = `<article><img src="https://http2.mlstatic.com/a.webp"><a title="Produto teste" href="https://www.mercadolivre.com.br/produto/p/MLB12345678?pdp_filters=item_id%3AMLB4432398841">Produto teste</a><span class="andes-money-amount__fraction">1.299</span></article>`;
    expect(discoverListings(html, 10)[0]).toMatchObject({ id: "MLB4432398841", title: "Produto teste", price: 1299 });
  });

  it("marca apenas texto visível e contextual de Pix", () => {
    expect(detectExplicitPix(`<main><p>Economize 8% pagando com Pix.</p></main>`)).toMatchObject({ found: true });
    expect(detectExplicitPix(`<script>{"payment_method":"PIX"}</script><main>Entrega rápida.</main>`)).toEqual({ found: false, evidence: null });
  });

  it("monta busca pública por nome e encontra a próxima página permitida", () => {
    expect(productSearchUrl("Furadeira Bosch GSB 13").toString()).toBe("https://lista.mercadolivre.com.br/furadeira-bosch-gsb-13");
    const current = new URL("https://lista.mercadolivre.com.br/furadeira");
    expect(discoverNextPage(`<a rel="next" href="https://lista.mercadolivre.com.br/furadeira_Desde_49">Seguinte</a>`, current)?.toString())
      .toBe("https://lista.mercadolivre.com.br/furadeira_Desde_49");
    expect(discoverNextPage(`<a rel="next" href="https://example.com/page/2">Seguinte</a>`, current)).toBeNull();
  });

  it("enriquece o anúncio público com catálogo, vendedor, descrição, fotos e ficha", () => {
    const item = discoverListings(`<article><a title="Furadeira" href="https://produto.mercadolivre.com.br/MLB-4432398841-furadeira-_JM">Furadeira</a></article>`, 1)[0];
    const html = `
      <html><head><link rel="canonical" href="https://produto.mercadolivre.com.br/MLB-4432398841-furadeira-_JM">
      <script type="application/ld+json">{"@type":"Product","name":"Furadeira Bosch","description":"Descrição completa","image":["https://http2.mlstatic.com/a.webp"],"offers":{"price":399.9,"itemCondition":"https://schema.org/NewCondition","seller":{"name":"Loja Teste"}},"aggregateRating":{"ratingValue":4.8,"reviewCount":32}}</script></head>
      <body><main>Mais de 120 vendidos. Economize 5% pagando com Pix.<table><tr><th>Marca</th><td>Bosch</td></tr></table></main>
      <script>{"seller_id":123,"catalog_listing":true,"catalog_product_id":"MLB999","available_quantity":20,"sold_quantity":120,"listing_type_id":"gold_special","category_id":"MLB123","free_shipping":true}</script></body></html>`;
    expect(enrichFromPage(item, html)).toMatchObject({
      title: "Furadeira Bosch",
      description: "Descrição completa",
      price: 399.9,
      condition: "new",
      availableQuantity: 20,
      soldQuantity: 120,
      catalogListing: true,
      catalogProductId: "MLB999",
      seller: { id: "123", nickname: "Loja Teste" },
      shipping: { freeShipping: true },
      pixObserved: true,
      rating: 4.8,
      reviewCount: 32,
    });
  });
});
