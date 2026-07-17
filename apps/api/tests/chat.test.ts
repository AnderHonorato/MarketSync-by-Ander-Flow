import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

// Agente com sessão + CSRF resolvidos, como o frontend usa
async function agenteComSessao() {
  const app = createApp();
  const agente = request.agent(app);
  const sessao = await agente.get("/api/session").expect(200);
  return { agente, csrf: sessao.body.csrfToken as string };
}

async function criarFundador() {
  const dono = await agenteComSessao();
  await dono.agente.post("/api/auth/cadastro").set("X-CSRF-Token", dono.csrf)
    .send({ usuario: "dono", email: "dono@t.com", senha: "senha123", perguntaRecuperacao: "Pergunta segura?", respostaRecuperacao: "ok" }).expect(201);
  const eu = await dono.agente.get("/api/auth/eu").expect(200);
  return { ...dono, id: eu.body.usuario.id as string };
}

async function criarUsuarioLogado(dono: Awaited<ReturnType<typeof criarFundador>>, nome: string) {
  const criado = await dono.agente.post("/api/usuarios").set("X-CSRF-Token", dono.csrf)
    .send({ usuario: nome, email: `${nome}@t.com`, senha: "senha123", nome, permissoes: ["anuncios"], respostaRecuperacao: "ok" }).expect(201);
  const usuario = await agenteComSessao();
  await usuario.agente.post("/api/auth/login").set("X-CSRF-Token", usuario.csrf)
    .send({ usuario: nome, senha: "senha123" }).expect(200);
  return { ...usuario, id: criado.body.usuario.id as string };
}

describe("chat interno da equipe", () => {
  it("owner e usuário trocam mensagens, com lidas, apagar e preferências", async () => {
    const dono = await criarFundador();
    const maria = await criarUsuarioLogado(dono, "maria");

    // Dono manda mensagem pra Maria
    const enviada = await dono.agente.post("/api/chat/mensagens").set("X-CSRF-Token", dono.csrf)
      .send({ paraId: maria.id, texto: "Oi Maria, bem-vinda!" }).expect(201);
    expect(enviada.body.mensagem.texto).toBe("Oi Maria, bem-vinda!");

    // Maria vê 1 não lida; abrir a conversa marca como lida
    const naoLidas = await maria.agente.get("/api/chat/nao-lidas").expect(200);
    expect(naoLidas.body.total).toBe(1);
    const thread = await maria.agente.get(`/api/chat/mensagens/${dono.id}`).expect(200);
    expect(thread.body.mensagens).toHaveLength(1);
    const depois = await maria.agente.get("/api/chat/nao-lidas").expect(200);
    expect(depois.body.total).toBe(0);

    // Maria responde; dono vê a conversa com a última mensagem dela
    await maria.agente.post("/api/chat/mensagens").set("X-CSRF-Token", maria.csrf)
      .send({ paraId: dono.id, texto: "Obrigada!" }).expect(201);
    const conversas = await dono.agente.get("/api/chat/conversas").expect(200);
    expect(conversas.body.conversas[0].ultimaMensagem.texto).toBe("Obrigada!");
    expect(conversas.body.conversas[0].naoLidas).toBe(1);

    // Maria não pode apagar mensagem do dono; o dono pode apagar a própria
    await maria.agente.delete(`/api/chat/mensagens/${enviada.body.mensagem.id}`)
      .set("X-CSRF-Token", maria.csrf).expect(403);
    await dono.agente.delete(`/api/chat/mensagens/${enviada.body.mensagem.id}`)
      .set("X-CSRF-Token", dono.csrf).expect(200);
    const threadDepois = await maria.agente.get(`/api/chat/mensagens/${dono.id}`).expect(200);
    expect(threadDepois.body.mensagens[0].apagada).toBe(true);
    expect(threadDepois.body.mensagens[0].texto).toBeNull();

    // Fixar e arquivar
    const pref = await dono.agente.post(`/api/chat/conversas/${maria.id}/preferencias`)
      .set("X-CSRF-Token", dono.csrf).send({ fixada: true }).expect(200);
    expect(pref.body.fixada).toBe(true);

    // Apagar a conversa só pra Maria: a lista dela zera, a do dono continua
    await maria.agente.delete(`/api/chat/conversas/${dono.id}`).set("X-CSRF-Token", maria.csrf).expect(200);
    const conversasMaria = await maria.agente.get("/api/chat/conversas").expect(200);
    expect(conversasMaria.body.conversas).toHaveLength(0);
    const conversasDono = await dono.agente.get("/api/chat/conversas").expect(200);
    expect(conversasDono.body.conversas).toHaveLength(1);
  });

  it("usuários da mesma empresa se falam; empresas diferentes não", async () => {
    const dono = await criarFundador();
    const maria = await criarUsuarioLogado(dono, "maria");
    const joao = await criarUsuarioLogado(dono, "joao");

    // Mesma empresa: Maria fala com João
    await maria.agente.post("/api/chat/mensagens").set("X-CSRF-Token", maria.csrf)
      .send({ paraId: joao.id, texto: "Oi João!" }).expect(201);

    // Outra empresa: cadastro um Admin, dono aprova, Admin cria a Rita
    const outra = await agenteComSessao();
    await outra.agente.post("/api/auth/cadastro").set("X-CSRF-Token", outra.csrf)
      .send({ usuario: "empresa2", email: "e2@t.com", senha: "senha123", perguntaRecuperacao: "Pergunta segura?", respostaRecuperacao: "ok" }).expect(201);
    const pendentes = await dono.agente.get("/api/usuarios/pendentes").expect(200);
    await dono.agente.post(`/api/usuarios/${pendentes.body.pendentes[0].id}/aprovacao`)
      .set("X-CSRF-Token", dono.csrf).send({ decisao: "aprovar" }).expect(200);
    await outra.agente.post("/api/auth/login").set("X-CSRF-Token", outra.csrf)
      .send({ usuario: "empresa2", senha: "senha123" }).expect(200);
    const rita = await outra.agente.post("/api/usuarios").set("X-CSRF-Token", outra.csrf)
      .send({ usuario: "rita", email: "rita@t.com", senha: "senha123", permissoes: [], respostaRecuperacao: "ok" }).expect(201);

    // Maria (empresa do dono) não fala com Rita (empresa2)…
    await maria.agente.post("/api/chat/mensagens").set("X-CSRF-Token", maria.csrf)
      .send({ paraId: rita.body.usuario.id, texto: "oi?" }).expect(403);
    // …mas o Owner fala com qualquer um
    await dono.agente.post("/api/chat/mensagens").set("X-CSRF-Token", dono.csrf)
      .send({ paraId: rita.body.usuario.id, texto: "Bem-vinda ao sistema!" }).expect(201);
  });

  it("permissões por área bloqueiam as rotas da API", async () => {
    const dono = await criarFundador();
    const maria = await criarUsuarioLogado(dono, "maria"); // só tem "anuncios"

    // Sem login: barrado
    const anonimo = await agenteComSessao();
    await anonimo.agente.get("/api/pedidos").expect(401);
    // Maria sem a permissão "vendas": barrada com AREA_BLOQUEADA
    const bloqueio = await maria.agente.get("/api/pedidos").expect(403);
    expect(bloqueio.body.error.code).toBe("AREA_BLOQUEADA");
    // Aba liberada passa da trava de permissão (a rota interna ainda pede
    // a conta do Mercado Livre conectada, que não existe no teste)
    const liberada = await maria.agente.get("/api/listings").expect(401);
    expect(liberada.body.error.code).toBe("AUTH_REQUIRED");
  });
});
