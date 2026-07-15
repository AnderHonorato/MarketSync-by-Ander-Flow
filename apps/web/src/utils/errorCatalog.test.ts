import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { userFacingCode, userFacingError } from "./errorCatalog";

describe("catálogo de erros da interface", () => {
  it("traduz erros conhecidos sem expor a mensagem interna", () => {
    const result = userFacingError(new ApiError("segredo técnico", { status: 404, code: "SCAN_NOT_FOUND" }));
    expect(result).toContain("MLAM-PUB-009");
    expect(result).not.toContain("segredo técnico");
  });

  it("mantém uma referência mesmo para códigos inesperados", () => {
    expect(userFacingCode("NOVO_ERRO", "Falha controlada")).toBe("Falha controlada Código: NOVO_ERRO.");
  });
});
