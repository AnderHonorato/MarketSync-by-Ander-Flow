import { describe, expect, it } from "vitest";
import { DEFAULT_UNOFFICIAL_CONFIG, normalizeUnofficialConfig } from "./unofficialConfig";

describe("configuracao das consultas publicas", () => {
  it("migra uma configuracao antiga que ainda nao possui busca por produto", () => {
    expect(normalizeUnofficialConfig({
      enabled: true,
      url: "https://www.mercadolivre.com.br/loja/exemplo",
      maxItems: 12,
      inspectPix: true,
    })).toEqual({
      ...DEFAULT_UNOFFICIAL_CONFIG,
      enabled: true,
      url: "https://www.mercadolivre.com.br/loja/exemplo",
      maxItems: 12,
    });
  });

  it("substitui valores corrompidos por opcoes seguras", () => {
    expect(normalizeUnofficialConfig({
      mode: "invalido",
      query: null,
      limitMode: "invalido",
      maxItems: "sem-numero",
      inspectPix: null,
    })).toEqual(DEFAULT_UNOFFICIAL_CONFIG);
  });
});
