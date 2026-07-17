// ============================================================
// autenticacao.ts — login local do aplicativo (separado da conta
// do Mercado Livre). Cadastro, login, logout, "quem sou eu" e
// recuperação de senha por pergunta secreta. Tudo local.
//
// Bootstrap: se ainda não existe ninguém, o primeiro cadastro
// vira o FUNDADOR (OWNER), já ativo. Os cadastros seguintes são
// ADMINISTRADORES e ficam PENDENTES até o Owner aprovar.
// ============================================================

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { AppError, asyncHandler } from "../lib/errors.js";
import { requireCsrf } from "../middleware/session.js";
import { requireUsuario, usuarioView } from "../middleware/usuario.js";
import { hashSenha, conferirSenha, sha256 } from "../lib/crypto.js";
import { AREAS } from "../lib/permissoes.js";

export const autenticacaoRouter = Router();

const esquemaSenha = z.string().min(6, "A senha precisa de ao menos 6 caracteres.").max(120);
const esquemaUsuario = z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/, "Use letras, números, ponto, hífen ou sublinhado.");

function normalizarResposta(valor: string): string {
  return sha256(valor.toLowerCase().trim());
}

// Situação geral do login: se já tem Owner, mostra a tela de entrar;
// se não tem, mostra a criação do Fundador. Também informa as áreas
// do sistema pro frontend montar a tela de permissões.
autenticacaoRouter.get("/auth/estado", asyncHandler(async (req, res) => {
  const totalUsuarios = await prisma.appUser.count();
  res.json({
    precisaFundador: totalUsuarios === 0,
    logado: Boolean(req.appUser),
    usuario: req.appUser ? usuarioView(req.appUser) : null,
    areas: AREAS,
  });
}));

autenticacaoRouter.post("/auth/cadastro", requireCsrf, asyncHandler(async (req, res) => {
  const dados = z.object({
    usuario: esquemaUsuario,
    email: z.string().trim().email("E-mail inválido.").max(160),
    senha: esquemaSenha,
    nome: z.string().trim().max(120).default(""),
    perguntaRecuperacao: z.string().trim().min(8, "A pergunta de recuperação é muito curta.").max(200),
    respostaRecuperacao: z.string().trim().min(2).max(200),
  }).parse(req.body);

  const totalUsuarios = await prisma.appUser.count();
  const ehFundador = totalUsuarios === 0;

  const jaExiste = await prisma.appUser.findFirst({
    where: { OR: [{ usuario: dados.usuario }, { email: dados.email.toLowerCase() }] },
  });
  if (jaExiste) throw new AppError(409, "USUARIO_EXISTENTE", "Já existe um usuário com esse nome de acesso ou e-mail.");

  const usuario = await prisma.appUser.create({
    data: {
      papel: ehFundador ? "OWNER" : "ADMIN",
      situacao: ehFundador ? "ATIVO" : "PENDENTE",
      usuario: dados.usuario,
      email: dados.email.toLowerCase(),
      senhaHash: hashSenha(dados.senha),
      perguntaRecuperacao: dados.perguntaRecuperacao,
      respostaRecuperacaoHash: normalizarResposta(dados.respostaRecuperacao),
      nome: dados.nome,
      aprovadoEm: ehFundador ? new Date() : null,
    },
  });

  // O Fundador já entra logado; o Admin novo espera aprovação
  if (ehFundador && req.appSession) {
    await prisma.session.update({ where: { id: req.appSession.id }, data: { usuarioId: usuario.id } });
    await prisma.appUser.update({ where: { id: usuario.id }, data: { ultimoLoginEm: new Date() } });
  }

  res.status(201).json({
    ok: true,
    fundador: ehFundador,
    pendente: !ehFundador,
    usuario: ehFundador ? usuarioView(usuario) : null,
  });
}));

autenticacaoRouter.post("/auth/login", requireCsrf, asyncHandler(async (req, res) => {
  const dados = z.object({
    usuario: z.string().trim().min(1).max(160),
    senha: z.string().min(1).max(120),
  }).parse(req.body);

  const alvo = dados.usuario.toLowerCase();
  const usuario = await prisma.appUser.findFirst({
    where: { OR: [{ usuario: dados.usuario }, { email: alvo }] },
  });
  // Mensagem única pra não revelar se o usuário existe
  if (!usuario || !conferirSenha(dados.senha, usuario.senhaHash)) {
    throw new AppError(401, "CREDENCIAIS_INVALIDAS", "Usuário ou senha incorretos.");
  }
  if (usuario.situacao === "PENDENTE") {
    throw new AppError(403, "AGUARDANDO_APROVACAO", "Sua conta de administrador ainda não foi aprovada pelo Fundador.");
  }
  if (usuario.situacao === "SUSPENSO") {
    throw new AppError(403, "CONTA_SUSPENSA", "Esta conta está suspensa. Fale com o administrador responsável.");
  }

  if (req.appSession) {
    await prisma.session.update({ where: { id: req.appSession.id }, data: { usuarioId: usuario.id } });
  }
  await prisma.appUser.update({ where: { id: usuario.id }, data: { ultimoLoginEm: new Date() } });

  res.json({ ok: true, usuario: usuarioView(usuario) });
}));

autenticacaoRouter.post("/auth/sair", requireCsrf, asyncHandler(async (req, res) => {
  // Desvincula o usuário da sessão, mas mantém a sessão local viva
  // (a conta do Mercado Livre segue conectada se estiver)
  if (req.appSession) {
    await prisma.session.update({ where: { id: req.appSession.id }, data: { usuarioId: null } });
  }
  res.json({ ok: true });
}));

autenticacaoRouter.get("/auth/eu", requireUsuario, asyncHandler(async (req, res) => {
  res.json({ usuario: usuarioView(req.appUser!) });
}));

// ----- Recuperação de senha por pergunta secreta -----

// Passo 1: informa o usuário/e-mail e recebe a pergunta de recuperação
autenticacaoRouter.post("/auth/recuperar/pergunta", requireCsrf, asyncHandler(async (req, res) => {
  const { usuario } = z.object({ usuario: z.string().trim().min(1).max(160) }).parse(req.body);
  const alvo = usuario.toLowerCase();
  const encontrado = await prisma.appUser.findFirst({ where: { OR: [{ usuario }, { email: alvo }] } });
  if (!encontrado) throw new AppError(404, "USUARIO_NAO_ENCONTRADO", "Não encontrei um usuário com esse nome ou e-mail.");
  res.json({ pergunta: encontrado.perguntaRecuperacao });
}));

// Passo 2: confere a resposta e redefine a senha
autenticacaoRouter.post("/auth/recuperar/redefinir", requireCsrf, asyncHandler(async (req, res) => {
  const dados = z.object({
    usuario: z.string().trim().min(1).max(160),
    resposta: z.string().trim().min(1).max(200),
    novaSenha: esquemaSenha,
  }).parse(req.body);

  const alvo = dados.usuario.toLowerCase();
  const usuario = await prisma.appUser.findFirst({ where: { OR: [{ usuario: dados.usuario }, { email: alvo }] } });
  if (!usuario) throw new AppError(404, "USUARIO_NAO_ENCONTRADO", "Usuário não encontrado.");
  if (usuario.respostaRecuperacaoHash !== normalizarResposta(dados.resposta)) {
    throw new AppError(403, "RESPOSTA_INCORRETA", "A resposta de recuperação não confere.");
  }
  await prisma.appUser.update({ where: { id: usuario.id }, data: { senhaHash: hashSenha(dados.novaSenha) } });
  res.json({ ok: true });
}));

// Foto de perfil (visível no chat e no site). Aceito uma imagem pequena em
// data URL — o frontend já reduz pra 128px antes de enviar.
autenticacaoRouter.post("/auth/foto-perfil", requireCsrf, requireUsuario, asyncHandler(async (req, res) => {
  const { fotoPerfil } = z.object({
    fotoPerfil: z.string().regex(/^data:image\/(png|jpeg|webp);base64,/).max(300_000).nullable(),
  }).parse(req.body);
  const atualizado = await prisma.appUser.update({ where: { id: req.appUser!.id }, data: { fotoPerfil } });
  res.json({ ok: true, usuario: usuarioView(atualizado) });
}));

// Troca de senha por quem está logado (sabendo a senha atual)
autenticacaoRouter.post("/auth/trocar-senha", requireCsrf, requireUsuario, asyncHandler(async (req, res) => {
  const dados = z.object({ senhaAtual: z.string().min(1), novaSenha: esquemaSenha }).parse(req.body);
  if (!conferirSenha(dados.senhaAtual, req.appUser!.senhaHash)) {
    throw new AppError(403, "SENHA_ATUAL_INCORRETA", "A senha atual não confere.");
  }
  await prisma.appUser.update({ where: { id: req.appUser!.id }, data: { senhaHash: hashSenha(dados.novaSenha) } });
  res.json({ ok: true });
}));
