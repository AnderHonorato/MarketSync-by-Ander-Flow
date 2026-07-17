import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

// Cria um agente com sessão + CSRF já resolvidos, do jeito que o frontend usa.
async function agenteComSessao() {
  const app = createApp();
  const agente = request.agent(app);
  const sessao = await agente.get("/api/session").expect(200);
  return { agente, csrf: sessao.body.csrfToken as string };
}

describe("autenticação e hierarquia de usuários", () => {
  it("primeiro cadastro vira Fundador ativo e entra logado", async () => {
    const { agente, csrf } = await agenteComSessao();
    const estado = await agente.get("/api/auth/estado").expect(200);
    expect(estado.body.precisaFundador).toBe(true);

    const cadastro = await agente
      .post("/api/auth/cadastro")
      .set("X-CSRF-Token", csrf)
      .send({ usuario: "fundador", email: "dono@teste.com", senha: "senha123", perguntaRecuperacao: "Meu bichinho?", respostaRecuperacao: "lobo" })
      .expect(201);
    expect(cadastro.body.fundador).toBe(true);

    const eu = await agente.get("/api/auth/eu").expect(200);
    expect(eu.body.usuario.papel).toBe("OWNER");
    expect(eu.body.usuario.situacao).toBe("ATIVO");
  });

  it("segundo cadastro vira Admin pendente e não loga até ser aprovado", async () => {
    // Garante que já existe um Fundador
    const dono = await agenteComSessao();
    await dono.agente.post("/api/auth/cadastro").set("X-CSRF-Token", dono.csrf)
      .send({ usuario: "dona2", email: "dona2@teste.com", senha: "senha123", perguntaRecuperacao: "Sua cidade natal?", respostaRecuperacao: "sp" }).expect(201);

    const { agente, csrf } = await agenteComSessao();
    const cadastro = await agente.post("/api/auth/cadastro").set("X-CSRF-Token", csrf)
      .send({ usuario: "empresa", email: "empresa@teste.com", senha: "senha123", perguntaRecuperacao: "Qual seu time?", respostaRecuperacao: "xis" })
      .expect(201);
    expect(cadastro.body.pendente).toBe(true);

    const login = await agente.post("/api/auth/login").set("X-CSRF-Token", csrf)
      .send({ usuario: "empresa", senha: "senha123" }).expect(403);
    expect(login.body.error.code).toBe("AGUARDANDO_APROVACAO");
  });

  it("usuário criado pelo dono só acessa as áreas liberadas", async () => {
    const { agente, csrf } = await agenteComSessao();
    await agente.post("/api/auth/cadastro").set("X-CSRF-Token", csrf)
      .send({ usuario: "chefe", email: "chefe@teste.com", senha: "senha123", perguntaRecuperacao: "Pergunta secreta?", respostaRecuperacao: "aa" }).expect(201);

    const criado = await agente.post("/api/usuarios").set("X-CSRF-Token", csrf)
      .send({ usuario: "func1", email: "func1@teste.com", senha: "senha123", permissoes: ["anuncios", "vendas"], respostaRecuperacao: "zz" })
      .expect(201);
    expect(criado.body.usuario.papel).toBe("USER");
    expect(criado.body.usuario.permissoes).toEqual(["anuncios", "vendas"]);

    // Logando como o funcionário, ele não gerencia usuários
    const func = await agenteComSessao();
    await func.agente.post("/api/auth/login").set("X-CSRF-Token", func.csrf)
      .send({ usuario: "func1", senha: "senha123" }).expect(200);
    const bloqueio = await func.agente.get("/api/usuarios").expect(403);
    expect(bloqueio.body.error.code).toBe("SEM_PERMISSAO");
  });

  it("recupera a senha pela pergunta secreta", async () => {
    const { agente, csrf } = await agenteComSessao();
    await agente.post("/api/auth/cadastro").set("X-CSRF-Token", csrf)
      .send({ usuario: "recupera", email: "rec@teste.com", senha: "senha123", perguntaRecuperacao: "Cor favorita?", respostaRecuperacao: "Azul" }).expect(201);

    const outra = await agenteComSessao();
    const pergunta = await outra.agente.post("/api/auth/recuperar/pergunta").set("X-CSRF-Token", outra.csrf)
      .send({ usuario: "rec@teste.com" }).expect(200);
    expect(pergunta.body.pergunta).toBe("Cor favorita?");

    await outra.agente.post("/api/auth/recuperar/redefinir").set("X-CSRF-Token", outra.csrf)
      .send({ usuario: "recupera", resposta: "AZUL", novaSenha: "nova12345" }).expect(200);

    const login = await outra.agente.post("/api/auth/login").set("X-CSRF-Token", outra.csrf)
      .send({ usuario: "recupera", senha: "nova12345" }).expect(200);
    expect(login.body.usuario.usuario).toBe("recupera");
  });
});
