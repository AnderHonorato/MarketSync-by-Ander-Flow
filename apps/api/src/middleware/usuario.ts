// ============================================================
// usuario.ts — carrega o usuário logado (se houver) na requisição
// e oferece as travas de papel e de permissão por página.
// ============================================================

import type { NextFunction, Request, Response } from "express";
import type { AppUser } from "@prisma/client";
import { prisma } from "../db.js";
import { AppError } from "../lib/errors.js";
import { podeAcessar, podeGerenciarUsuarios, type Papel } from "../lib/permissoes.js";

// Anexa req.appUser a partir do usuarioId da sessão. Não bloqueia nada
// sozinho — só disponibiliza o usuário pras rotas que precisarem.
export async function carregarUsuario(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const usuarioId = req.appSession?.usuarioId;
    if (usuarioId) {
      const usuario = await prisma.appUser.findUnique({ where: { id: usuarioId } });
      // Só considero logado quem está ativo; suspenso/pendente cai fora
      if (usuario && usuario.situacao === "ATIVO") req.appUser = usuario;
    }
    next();
  } catch (error) {
    next(error);
  }
}

// Enquanto não existe NENHUM usuário cadastrado (instalação recém-feita,
// antes do Fundador), as travas ficam abertas — senão nem daria pra chegar
// na tela de criar a primeira conta. Assim que o primeiro usuário existe,
// a proteção liga e não desliga mais (o Fundador não pode se excluir).
let sistemaJaTemUsuarios = false;
async function modoInicial(): Promise<boolean> {
  if (sistemaJaTemUsuarios) return false;
  const total = await prisma.appUser.count();
  if (total > 0) { sistemaJaTemUsuarios = true; return false; }
  return true;
}

// Só para os testes: zera o cache do modo inicial entre casos
export function resetarCacheModoInicial(): void {
  sistemaJaTemUsuarios = false;
}

export async function requireUsuario(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    if (req.appUser) { next(); return; }
    if (await modoInicial()) { next(); return; }
    next(new AppError(401, "LOGIN_REQUIRED", "Faça login para continuar."));
  } catch (error) {
    next(error);
  }
}

export function requirePapel(...papeis: Papel[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.appUser) { next(new AppError(401, "LOGIN_REQUIRED", "Faça login para continuar.")); return; }
    if (!papeis.includes(req.appUser.papel as Papel)) {
      next(new AppError(403, "SEM_PERMISSAO", "Seu perfil não tem acesso a esta operação."));
      return;
    }
    next();
  };
}

export function requireGestaoUsuarios(req: Request, _res: Response, next: NextFunction): void {
  if (!req.appUser) { next(new AppError(401, "LOGIN_REQUIRED", "Faça login para continuar.")); return; }
  if (!podeGerenciarUsuarios(req.appUser.papel as Papel)) {
    next(new AppError(403, "SEM_PERMISSAO", "Só o Fundador e os Administradores gerenciam usuários."));
    return;
  }
  next();
}

// Trava de acesso a uma página específica (usada nas rotas das abas).
export function requirePermissao(chave: string) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.appUser) {
        if (await modoInicial()) { next(); return; }
        next(new AppError(401, "LOGIN_REQUIRED", "Faça login para continuar."));
        return;
      }
      const permissoes = JSON.parse(req.appUser.permissoesJson || "[]") as string[];
      if (!podeAcessar(req.appUser.papel as Papel, permissoes, chave)) {
        next(new AppError(403, "AREA_BLOQUEADA", "Você não tem acesso a esta área."));
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

// Visão pública do usuário (sem hashes) pra devolver ao frontend.
export function usuarioView(usuario: AppUser) {
  const permissoes = JSON.parse(usuario.permissoesJson || "[]") as string[];
  return {
    id: usuario.id,
    papel: usuario.papel,
    situacao: usuario.situacao,
    usuario: usuario.usuario,
    email: usuario.email,
    nome: usuario.nome,
    cpf: usuario.cpf,
    perfil: JSON.parse(usuario.perfilJson || "{}"),
    permissoes,
    fotoPerfil: usuario.fotoPerfil ?? null,
    adminPaiId: usuario.adminPaiId,
    perguntaRecuperacao: usuario.perguntaRecuperacao,
    aprovadoEm: usuario.aprovadoEm?.toISOString() ?? null,
    ultimoLoginEm: usuario.ultimoLoginEm?.toISOString() ?? null,
    createdAt: usuario.createdAt.toISOString(),
  };
}
