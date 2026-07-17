// ============================================================
// gestao-usuarios.ts — moderação e gestão da hierarquia.
//
// OWNER (Fundador): vê e modera TODOS. Aprova/recusa Administradores.
//   Pode suspender, editar e excluir qualquer conta.
// ADMIN (Administrador): cria e gerencia os próprios USERs, define as
//   permissões página por página, exclui esses usuários. Pode excluir
//   a própria conta (o que apaga, em cascata, os usuários vinculados).
// USER: não gerencia ninguém.
// ============================================================

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { AppError, asyncHandler } from "../lib/errors.js";
import { requireCsrf } from "../middleware/session.js";
import { requireUsuario, requireGestaoUsuarios, requirePapel, usuarioView } from "../middleware/usuario.js";
import { hashSenha, sha256 } from "../lib/crypto.js";
import { CHAVES_AREAS } from "../lib/permissoes.js";

// Importante: NÃO uso um requireUsuario geral no router, senão ele bloquearia
// todas as rotas /api (o router roda seu middleware pra qualquer caminho que
// passe por ele). Cada rota abaixo já tem a sua própria trava.
export const gestaoUsuariosRouter = Router();

const normalizarResposta = (valor: string) => sha256(valor.toLowerCase().trim());

// Lista os usuários que o solicitante pode ver.
// OWNER vê todos; ADMIN vê a si e aos seus USERs.
gestaoUsuariosRouter.get("/usuarios", requireGestaoUsuarios, asyncHandler(async (req, res) => {
  const eu = req.appUser!;
  const usuarios = eu.papel === "OWNER"
    ? await prisma.appUser.findMany({ orderBy: [{ papel: "asc" }, { createdAt: "asc" }] })
    : await prisma.appUser.findMany({
        where: { OR: [{ id: eu.id }, { adminPaiId: eu.id }] },
        orderBy: { createdAt: "asc" },
      });
  res.json({ usuarios: usuarios.map(usuarioView) });
}));

// Administradores pendentes de aprovação (só o Owner)
gestaoUsuariosRouter.get("/usuarios/pendentes", requirePapel("OWNER"), asyncHandler(async (_req, res) => {
  const pendentes = await prisma.appUser.findMany({ where: { papel: "ADMIN", situacao: "PENDENTE" }, orderBy: { createdAt: "asc" } });
  res.json({ pendentes: pendentes.map(usuarioView) });
}));

// Aprovar ou recusar um administrador pendente (só o Owner)
gestaoUsuariosRouter.post("/usuarios/:id/aprovacao", requireCsrf, requirePapel("OWNER"), asyncHandler(async (req, res) => {
  const { decisao } = z.object({ decisao: z.enum(["aprovar", "recusar"]) }).parse(req.body);
  const alvo = await prisma.appUser.findUnique({ where: { id: String(req.params.id) } });
  if (!alvo || alvo.papel !== "ADMIN") throw new AppError(404, "ADMIN_NAO_ENCONTRADO", "Administrador não encontrado.");

  if (decisao === "recusar") {
    await prisma.appUser.delete({ where: { id: alvo.id } });
    res.json({ ok: true, removido: true });
    return;
  }
  const atualizado = await prisma.appUser.update({
    where: { id: alvo.id },
    data: { situacao: "ATIVO", aprovadoEm: new Date(), aprovadoPorId: req.appUser!.id },
  });
  res.json({ ok: true, usuario: usuarioView(atualizado) });
}));

// Criar um USER (feito pelo Administrador ou pelo Owner).
gestaoUsuariosRouter.post("/usuarios", requireCsrf, requireGestaoUsuarios, asyncHandler(async (req, res) => {
  const eu = req.appUser!;
  const dados = z.object({
    usuario: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/),
    email: z.string().trim().email().max(160),
    senha: z.string().min(6).max(120),
    nome: z.string().trim().max(120).default(""),
    cpf: z.string().trim().max(20).default(""),
    perfil: z.object({
      telefone: z.string().trim().max(30).optional(),
      cep: z.string().trim().max(12).optional(),
      logradouro: z.string().trim().max(160).optional(),
      numero: z.string().trim().max(20).optional(),
      complemento: z.string().trim().max(80).optional(),
      bairro: z.string().trim().max(80).optional(),
      cidade: z.string().trim().max(80).optional(),
      uf: z.string().trim().max(2).optional(),
    }).default({}),
    permissoes: z.array(z.string()).default([]),
    perguntaRecuperacao: z.string().trim().min(8).max(200).default("Qual o nome de acesso do seu administrador?"),
    respostaRecuperacao: z.string().trim().min(2).max(200),
  }).parse(req.body);

  const jaExiste = await prisma.appUser.findFirst({
    where: { OR: [{ usuario: dados.usuario }, { email: dados.email.toLowerCase() }] },
  });
  if (jaExiste) throw new AppError(409, "USUARIO_EXISTENTE", "Já existe um usuário com esse nome de acesso ou e-mail.");

  const permissoes = dados.permissoes.filter((chave) => CHAVES_AREAS.includes(chave));
  const criado = await prisma.appUser.create({
    data: {
      papel: "USER",
      situacao: "ATIVO",
      usuario: dados.usuario,
      email: dados.email.toLowerCase(),
      senhaHash: hashSenha(dados.senha),
      perguntaRecuperacao: dados.perguntaRecuperacao,
      respostaRecuperacaoHash: normalizarResposta(dados.respostaRecuperacao),
      nome: dados.nome,
      cpf: dados.cpf,
      perfilJson: JSON.stringify(dados.perfil),
      permissoesJson: JSON.stringify(permissoes),
      // Se o Owner criar direto, ele vira o admin-pai; senão, o admin logado
      adminPaiId: eu.id,
      criadoPorId: eu.id,
      aprovadoEm: new Date(),
    },
  });
  res.status(201).json({ ok: true, usuario: usuarioView(criado) });
}));

// Garante que o solicitante pode mexer no alvo.
async function alvoGerenciavel(req: import("express").Request, id: string) {
  const eu = req.appUser!;
  const alvo = await prisma.appUser.findUnique({ where: { id } });
  if (!alvo) throw new AppError(404, "USUARIO_NAO_ENCONTRADO", "Usuário não encontrado.");
  if (eu.papel === "OWNER") return alvo;
  // Admin só mexe nos próprios usuários
  if (alvo.adminPaiId === eu.id) return alvo;
  throw new AppError(403, "SEM_PERMISSAO", "Você não pode gerenciar esta conta.");
}

// Editar dados e permissões de um usuário (página por página).
gestaoUsuariosRouter.patch("/usuarios/:id", requireCsrf, requireGestaoUsuarios, asyncHandler(async (req, res) => {
  const alvo = await alvoGerenciavel(req, String(req.params.id));
  if (alvo.papel === "OWNER") throw new AppError(403, "OWNER_PROTEGIDO", "A conta do Fundador não pode ser editada por aqui.");

  const dados = z.object({
    nome: z.string().trim().max(120).optional(),
    cpf: z.string().trim().max(20).optional(),
    email: z.string().trim().email().max(160).optional(),
    perfil: z.record(z.string(), z.string()).optional(),
    permissoes: z.array(z.string()).optional(),
    situacao: z.enum(["ATIVO", "SUSPENSO"]).optional(),
    novaSenha: z.string().min(6).max(120).optional(),
  }).parse(req.body);

  // Só faz sentido mexer em permissão de USER
  const patch: Record<string, unknown> = {};
  if (dados.nome !== undefined) patch.nome = dados.nome;
  if (dados.cpf !== undefined) patch.cpf = dados.cpf;
  if (dados.email !== undefined) {
    const conflito = await prisma.appUser.findFirst({ where: { email: dados.email.toLowerCase(), id: { not: alvo.id } } });
    if (conflito) throw new AppError(409, "EMAIL_EXISTENTE", "Já existe outro usuário com esse e-mail.");
    patch.email = dados.email.toLowerCase();
  }
  if (dados.perfil !== undefined) patch.perfilJson = JSON.stringify(dados.perfil);
  if (dados.permissoes !== undefined && alvo.papel === "USER") {
    patch.permissoesJson = JSON.stringify(dados.permissoes.filter((chave) => CHAVES_AREAS.includes(chave)));
  }
  if (dados.situacao !== undefined) patch.situacao = dados.situacao;
  if (dados.novaSenha !== undefined) patch.senhaHash = hashSenha(dados.novaSenha);

  const atualizado = await prisma.appUser.update({ where: { id: alvo.id }, data: patch });
  res.json({ ok: true, usuario: usuarioView(atualizado) });
}));

// Excluir um usuário. O Admin pode excluir os seus USERs.
gestaoUsuariosRouter.delete("/usuarios/:id", requireCsrf, requireGestaoUsuarios, asyncHandler(async (req, res) => {
  const alvo = await alvoGerenciavel(req, String(req.params.id));
  if (alvo.id === req.appUser!.id) throw new AppError(400, "USE_EXCLUIR_CONTA", "Para apagar a própria conta use a opção de excluir conta.");
  if (alvo.papel === "OWNER") throw new AppError(403, "OWNER_PROTEGIDO", "A conta do Fundador não pode ser excluída.");
  // A cascata do banco leva junto os usuários vinculados (se for um admin)
  await prisma.appUser.delete({ where: { id: alvo.id } });
  res.json({ ok: true });
}));

// Excluir a PRÓPRIA conta. Para Admin, isso apaga em cascata os usuários
// vinculados (garantido pela FK adminPaiId ON DELETE CASCADE). Exige a
// confirmação por texto para evitar acidente.
gestaoUsuariosRouter.post("/auth/excluir-conta", requireCsrf, requireUsuario, asyncHandler(async (req, res) => {
  const eu = req.appUser!;
  const { confirmacao } = z.object({ confirmacao: z.string() }).parse(req.body);
  if (confirmacao !== "EXCLUIR") throw new AppError(400, "CONFIRMACAO_INVALIDA", "Digite EXCLUIR para confirmar.");
  if (eu.papel === "OWNER") {
    const totalOwners = await prisma.appUser.count({ where: { papel: "OWNER" } });
    if (totalOwners <= 1) throw new AppError(400, "OWNER_UNICO", "O Fundador não pode excluir a própria conta enquanto for o único. Transfira a fundação antes.");
  }
  const vinculados = eu.papel === "ADMIN" ? await prisma.appUser.count({ where: { adminPaiId: eu.id } }) : 0;
  await prisma.appUser.delete({ where: { id: eu.id } }); // cascata apaga sessões e usuários-filhos
  res.json({ ok: true, usuariosRemovidos: vinculados });
}));
