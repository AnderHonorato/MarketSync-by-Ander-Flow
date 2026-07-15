import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

describe("histórico persistente", () => {
  it("registra sessão e movimentos permitidos da interface", async () => {
    const agent = request.agent(createApp());
    const session = await agent.get("/api/session").expect(200);
    await agent.post("/api/history/activity")
      .set("X-CSRF-Token", session.body.csrfToken)
      .send({ action: "ui.theme", metadata: { theme: "dark" } })
      .expect(204);
    const history = await agent.get("/api/history").expect(200);
    expect(history.body.sessions).toHaveLength(1);
    expect(history.body.events.map((event: { action: string }) => event.action))
      .toEqual(expect.arrayContaining(["session.start", "ui.theme"]));
  });

  it("não aceita nomes arbitrários de movimento", async () => {
    const agent = request.agent(createApp());
    const session = await agent.get("/api/session").expect(200);
    await agent.post("/api/history/activity")
      .set("X-CSRF-Token", session.body.csrfToken)
      .send({ action: "token.dump" })
      .expect(400);
  });
});
