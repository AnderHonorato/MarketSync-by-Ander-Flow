import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { sha256 } from "../src/lib/crypto.js";

describe("sessão e CSRF", () => {
  it("aceita localhost e 127.0.0.1 no desenvolvimento local", async () => {
    const response = await request(createApp())
      .get("/api/session")
      .set("Origin", "http://127.0.0.1:5180")
      .expect(200);
    expect(response.headers["access-control-allow-origin"]).toBe(
      "http://127.0.0.1:5180",
    );
  });

  it("redireciona a raiz da API para a interface", async () => {
    const response = await request(createApp()).get("/").expect(302);
    expect(response.headers.location).toBe("http://localhost:5180");
  });

  it("cria sessão opaca em cookie httpOnly e fornece CSRF", async () => {
    const response = await request(createApp()).get("/api/session").expect(200);
    expect(response.body.authenticated).toBe(false);
    expect(response.body.csrfToken).toEqual(expect.any(String));
    expect(response.headers["set-cookie"][0]).toContain("HttpOnly");
    expect(response.headers["set-cookie"][0]).toContain("SameSite=Lax");
  });

  it("não expõe credenciais na verificação e protege o callback HTTPS por state", async () => {
    const setup = await request(createApp()).get("/api/setup").expect(200);
    expect(setup.body).toMatchObject({ mercadoLivreConfigured: true, application: { configured: true } });
    expect(setup.body.application.secureRedirect).toEqual(expect.any(Boolean));
    expect(JSON.stringify(setup.body)).not.toMatch(/client|secret|redirectUri/i);

    const callback = await request(createApp())
      .get(`/api/ml/callback?code=test-code&state=${"x".repeat(32)}`)
      .expect(400);
    expect(callback.body.error.code).toBe("OAUTH_STATE_INVALID");
  });

  it("bloqueia mutação sem CSRF e aceita token da própria sessão", async () => {
    const agent = request.agent(createApp());
    const session = await agent.get("/api/session").expect(200);
    await agent.post("/api/auth/logout").expect(403);
    await agent
      .post("/api/auth/logout")
      .set("X-CSRF-Token", session.body.csrfToken)
      .expect(204);
  });

  it("não exige CSRF para exportação somente leitura autenticada", async () => {
    const agent = request.agent(createApp());
    const session = await agent.get("/api/session").expect(200);
    const rawCookie = String(session.headers["set-cookie"][0]).match(
      /mlam_session=([^;]+)/,
    )?.[1];
    const account = await prisma.oAuthAccount.create({
      data: { mlUserId: "seller-test", nickname: "Loja teste" },
    });
    await prisma.session.update({
      where: { id: sha256(rawCookie!) },
      data: { accountId: account.id },
    });
    const response = await agent.get("/api/export.xlsx").expect(200);
    expect(response.headers["content-type"]).toContain("spreadsheetml");
  });
});
