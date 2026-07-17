// ============================================================
// chat.ts — chat interno entre os usuários do aplicativo.
//
// Regras de quem fala com quem:
//   - Owner (Fundador) conversa com TODOS.
//   - Todos podem conversar com o Owner.
//   - Admin e seus usuários conversam entre si (mesma empresa).
// Funções: conversas com fixar/arquivar/apagar (só pra mim),
// apagar mensagem (soft), lidas/não lidas e foto de perfil.
// ============================================================

import { Router } from "express";
import { z } from "zod";
import type { AppUser } from "@prisma/client";
import { prisma } from "../db.js";
import { AppError, asyncHandler } from "../lib/errors.js";
import { requireCsrf } from "../middleware/session.js";
import { requireUsuario } from "../middleware/usuario.js";

export const chatRouter = Router();

// "Empresa" de um usuário: o Admin é a raiz; usuários apontam pro Admin-pai
function empresaDe(usuario: AppUser): string | null {
  if (usuario.papel === "ADMIN") return usuario.id;
  return usuario.adminPaiId;
}

function podeConversar(eu: AppUser, alvo: AppUser): boolean {
  if (eu.id === alvo.id) return false;
  if (alvo.situacao !== "ATIVO") return false;
  if (eu.papel === "OWNER" || alvo.papel === "OWNER") return true;
  const minhaEmpresa = empresaDe(eu);
  return minhaEmpresa != null && minhaEmpresa === empresaDe(alvo);
}

function contatoView(usuario: AppUser) {
  return {
    id: usuario.id,
    usuario: usuario.usuario,
    nome: usuario.nome || usuario.usuario,
    papel: usuario.papel,
    fotoPerfil: usuario.fotoPerfil ?? null,
  };
}

function mensagemView(mensagem: { id: string; deId: string; paraId: string; texto: string; apagadaEm: Date | null; lidaEm: Date | null; createdAt: Date }) {
  return {
    id: mensagem.id,
    deId: mensagem.deId,
    paraId: mensagem.paraId,
    texto: mensagem.apagadaEm ? null : mensagem.texto,
    apagada: Boolean(mensagem.apagadaEm),
    lida: Boolean(mensagem.lidaEm),
    criadaEm: mensagem.createdAt.toISOString(),
  };
}

async function contatoValido(eu: AppUser, contatoId: string): Promise<AppUser> {
  const contato = await prisma.appUser.findUnique({ where: { id: contatoId } });
  if (!contato || !podeConversar(eu, contato)) {
    throw new AppError(403, "CONTATO_INDISPONIVEL", "Você não pode conversar com esse usuário.");
  }
  return contato;
}

// Todos os contatos com quem eu posso conversar
chatRouter.get("/chat/contatos", requireUsuario, asyncHandler(async (req, res) => {
  const eu = req.appUser!;
  const todos = await prisma.appUser.findMany({ where: { situacao: "ATIVO" }, orderBy: [{ papel: "asc" }, { nome: "asc" }] });
  res.json({ contatos: todos.filter((usuario) => podeConversar(eu, usuario)).map(contatoView) });
}));

// Resumo das conversas: último recado, não lidas e preferências
chatRouter.get("/chat/conversas", requireUsuario, asyncHandler(async (req, res) => {
  const eu = req.appUser!;
  const [mensagens, preferencias, todos] = await Promise.all([
    prisma.chatMensagem.findMany({
      where: { OR: [{ deId: eu.id }, { paraId: eu.id }] },
      orderBy: { createdAt: "desc" },
      take: 1_000,
    }),
    prisma.chatPreferencia.findMany({ where: { usuarioId: eu.id } }),
    prisma.appUser.findMany({ where: { situacao: "ATIVO" } }),
  ]);
  const usuariosPorId = new Map(todos.map((usuario) => [usuario.id, usuario]));
  const prefsPorContato = new Map(preferencias.map((pref) => [pref.contatoId, pref]));

  const conversas = new Map<string, { contato: AppUser; ultima: typeof mensagens[number]; naoLidas: number }>();
  for (const mensagem of mensagens) {
    const contatoId = mensagem.deId === eu.id ? mensagem.paraId : mensagem.deId;
    const contato = usuariosPorId.get(contatoId);
    if (!contato || !podeConversar(eu, contato)) continue;
    const corte = prefsPorContato.get(contatoId)?.apagadaAte;
    if (corte && mensagem.createdAt <= corte) continue; // conversa apagada pra mim
    const atual = conversas.get(contatoId);
    if (!atual) conversas.set(contatoId, { contato, ultima: mensagem, naoLidas: 0 });
    const registro = conversas.get(contatoId)!;
    if (mensagem.paraId === eu.id && !mensagem.lidaEm && !mensagem.apagadaEm) registro.naoLidas += 1;
  }

  const lista = [...conversas.values()].map(({ contato, ultima, naoLidas }) => {
    const pref = prefsPorContato.get(contato.id);
    return {
      contato: contatoView(contato),
      ultimaMensagem: { texto: ultima.apagadaEm ? null : ultima.texto.slice(0, 80), minha: ultima.deId === eu.id, em: ultima.createdAt.toISOString() },
      naoLidas,
      fixada: Boolean(pref?.fixada),
      arquivada: Boolean(pref?.arquivada),
    };
  });
  // Fixadas primeiro, depois pela mensagem mais recente
  lista.sort((a, b) => Number(b.fixada) - Number(a.fixada) || b.ultimaMensagem.em.localeCompare(a.ultimaMensagem.em));
  res.json({ conversas: lista });
}));

// Total de mensagens não lidas (pra bolinha do menu)
chatRouter.get("/chat/nao-lidas", requireUsuario, asyncHandler(async (req, res) => {
  const total = await prisma.chatMensagem.count({
    where: { paraId: req.appUser!.id, lidaEm: null, apagadaEm: null },
  });
  res.json({ total });
}));

// Mensagens de uma conversa (e marca as recebidas como lidas)
chatRouter.get("/chat/mensagens/:contatoId", requireUsuario, asyncHandler(async (req, res) => {
  const eu = req.appUser!;
  const contato = await contatoValido(eu, String(req.params.contatoId));
  const corte = (await prisma.chatPreferencia.findUnique({
    where: { usuarioId_contatoId: { usuarioId: eu.id, contatoId: contato.id } },
  }))?.apagadaAte ?? undefined;

  const mensagens = await prisma.chatMensagem.findMany({
    where: {
      OR: [
        { deId: eu.id, paraId: contato.id },
        { deId: contato.id, paraId: eu.id },
      ],
      ...(corte ? { createdAt: { gt: corte } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: 300,
  });

  await prisma.chatMensagem.updateMany({
    where: { deId: contato.id, paraId: eu.id, lidaEm: null },
    data: { lidaEm: new Date() },
  });

  res.json({ contato: contatoView(contato), mensagens: mensagens.map(mensagemView) });
}));

// Enviar mensagem
chatRouter.post("/chat/mensagens", requireCsrf, requireUsuario, asyncHandler(async (req, res) => {
  const eu = req.appUser!;
  const dados = z.object({ paraId: z.string().min(1), texto: z.string().trim().min(1).max(2_000) }).parse(req.body);
  const contato = await contatoValido(eu, dados.paraId);
  const mensagem = await prisma.chatMensagem.create({
    data: { deId: eu.id, paraId: contato.id, texto: dados.texto },
  });
  res.status(201).json({ mensagem: mensagemView(mensagem) });
}));

// Apagar UMA mensagem (só quem enviou; vira "mensagem apagada" pros dois lados)
chatRouter.delete("/chat/mensagens/:id", requireCsrf, requireUsuario, asyncHandler(async (req, res) => {
  const eu = req.appUser!;
  const mensagem = await prisma.chatMensagem.findUnique({ where: { id: String(req.params.id) } });
  if (!mensagem || mensagem.deId !== eu.id) {
    throw new AppError(403, "MENSAGEM_PROTEGIDA", "Só dá pra apagar as mensagens que você mesmo enviou.");
  }
  await prisma.chatMensagem.update({ where: { id: mensagem.id }, data: { apagadaEm: new Date() } });
  res.json({ ok: true });
}));

// Fixar / arquivar conversa (preferência só minha)
chatRouter.post("/chat/conversas/:contatoId/preferencias", requireCsrf, requireUsuario, asyncHandler(async (req, res) => {
  const eu = req.appUser!;
  const contato = await contatoValido(eu, String(req.params.contatoId));
  const dados = z.object({ fixada: z.boolean().optional(), arquivada: z.boolean().optional() }).parse(req.body);
  const pref = await prisma.chatPreferencia.upsert({
    where: { usuarioId_contatoId: { usuarioId: eu.id, contatoId: contato.id } },
    create: { usuarioId: eu.id, contatoId: contato.id, ...dados },
    update: dados,
  });
  res.json({ ok: true, fixada: pref.fixada, arquivada: pref.arquivada });
}));

// Apagar a conversa inteira SÓ PRA MIM (o outro lado mantém o histórico)
chatRouter.delete("/chat/conversas/:contatoId", requireCsrf, requireUsuario, asyncHandler(async (req, res) => {
  const eu = req.appUser!;
  const contato = await contatoValido(eu, String(req.params.contatoId));
  await prisma.chatPreferencia.upsert({
    where: { usuarioId_contatoId: { usuarioId: eu.id, contatoId: contato.id } },
    create: { usuarioId: eu.id, contatoId: contato.id, apagadaAte: new Date(), fixada: false, arquivada: false },
    update: { apagadaAte: new Date(), fixada: false, arquivada: false },
  });
  res.json({ ok: true });
}));
