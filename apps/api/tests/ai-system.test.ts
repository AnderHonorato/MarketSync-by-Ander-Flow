import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

describe("AlphaBot e controle dos dados locais", () => {
  it("mantém conversas separadas por sessão e permite arquivar e excluir", async () => {
    const owner = request.agent(createApp());
    const outsider = request.agent(createApp());
    const ownerSession = await owner.get("/api/session").expect(200);
    await outsider.get("/api/session").expect(200);

    const created = await owner
      .post("/api/ai/conversations")
      .set("X-CSRF-Token", ownerSession.body.csrfToken)
      .send({ title: "Análise de catálogo" })
      .expect(201);

    expect(created.body).toMatchObject({ title: "Análise de catálogo", archived: false, messageCount: 0 });
    expect((await owner.get("/api/ai/conversations").expect(200)).body.items).toHaveLength(1);
    expect((await outsider.get("/api/ai/conversations").expect(200)).body.items).toHaveLength(0);
    await outsider.get(`/api/ai/conversations/${created.body.id}/messages`).expect(404);

    await owner
      .patch(`/api/ai/conversations/${created.body.id}`)
      .set("X-CSRF-Token", ownerSession.body.csrfToken)
      .send({ archived: true })
      .expect(200);
    expect((await owner.get("/api/ai/conversations?archived=true").expect(200)).body.items[0].archived).toBe(true);

    await owner
      .delete(`/api/ai/conversations/${created.body.id}`)
      .set("X-CSRF-Token", ownerSession.body.csrfToken)
      .expect(204);
    expect((await owner.get("/api/ai/conversations?archived=true").expect(200)).body.items).toHaveLength(0);
  });

  it("exige a confirmação exata antes do reset total", async () => {
    const agent = request.agent(createApp());
    const session = await agent.get("/api/session").expect(200);
    await agent
      .post("/api/ai/conversations")
      .set("X-CSRF-Token", session.body.csrfToken)
      .send({ title: "Será removida" })
      .expect(201);

    await agent
      .post("/api/system/reset")
      .set("X-CSRF-Token", session.body.csrfToken)
      .send({ confirmation: "confirmar" })
      .expect(400);
    expect((await agent.get("/api/ai/conversations").expect(200)).body.items).toHaveLength(1);

    await agent
      .post("/api/system/reset")
      .set("X-CSRF-Token", session.body.csrfToken)
      .send({ confirmation: "CONFIRMAR" })
      .expect(204);
    expect((await agent.get("/api/ai/conversations").expect(200)).body.items).toHaveLength(0);
  });
});
