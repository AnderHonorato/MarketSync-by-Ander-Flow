// ============================================================
// extras.ts — rotas OFICIAIS novas, todas em cima da API do
// Mercado Livre com o token da conta conectada:
//   GET  /api/pedidos       -> /orders/search (vendas + resumo)
//   GET  /api/perguntas     -> /questions/search (SAC)
//   POST /api/perguntas/:id/resposta -> /answers
//   GET  /api/visitas       -> /items/{id}/visits/time_window
//   GET  /api/tendencias    -> /trends/{site}
//   GET  /api/reputacao     -> /users/{id} (seller_reputation)
// Nada aqui mistura com a leitura pública não oficial.
// ============================================================

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { AppError, asyncHandler } from "../lib/errors.js";
import { requireAuthenticated, requireCsrf } from "../middleware/session.js";
import { mlRequest } from "../services/mercadoLivre.js";

export const extrasRouter = Router();
extrasRouter.use(requireAuthenticated);

type Registro = Record<string, unknown>;

function registro(value: unknown): Registro {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Registro : {};
}

function lista(value: unknown): Registro[] {
  return Array.isArray(value) ? value.map(registro) : [];
}

async function contaConectada(accountId: string) {
  const account = await prisma.oAuthAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new AppError(401, "AUTH_REQUIRED", "Conecte uma conta do Mercado Livre.");
  return account;
}

// ----------------------------------------------------------------
// Pedidos & financeiro
// ----------------------------------------------------------------
extrasRouter.get("/pedidos", asyncHandler(async (req, res) => {
  const accountId = req.appSession!.accountId!;
  const account = await contaConectada(accountId);
  const consulta = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(50),
    status: z.string().max(30).optional(),
    de: z.string().max(30).optional(),
    ate: z.string().max(30).optional(),
  }).parse(req.query);

  const parametros = new URLSearchParams({
    seller: account.mlUserId,
    sort: "date_desc",
    limit: String(consulta.limit),
    offset: String((consulta.page - 1) * consulta.limit),
  });
  if (consulta.status && consulta.status !== "all") parametros.set("order.status", consulta.status);
  if (consulta.de) parametros.set("order.date_created.from", `${consulta.de}T00:00:00.000-03:00`);
  if (consulta.ate) parametros.set("order.date_created.to", `${consulta.ate}T23:59:59.999-03:00`);

  const resposta = await mlRequest<Registro>(accountId, `/orders/search?${parametros}`);
  const paginacao = registro(resposta.paging);
  const pedidos = lista(resposta.results).map((pedido) => {
    const comprador = registro(pedido.buyer);
    const envio = registro(pedido.shipping);
    const pagamentos = lista(pedido.payments);
    return {
      id: pedido.id,
      status: pedido.status ?? null,
      criadoEm: pedido.date_created ?? null,
      fechadoEm: pedido.date_closed ?? null,
      valorTotal: Number(pedido.total_amount ?? 0),
      valorPago: Number(pedido.paid_amount ?? pedido.total_amount ?? 0),
      moeda: pedido.currency_id ?? "BRL",
      comprador: { id: comprador.id ?? null, apelido: comprador.nickname ?? null },
      envioId: envio.id ?? null,
      etiquetas: Array.isArray(pedido.tags) ? pedido.tags : [],
      formaPagamento: pagamentos[0]?.payment_type ?? null,
      itens: lista(pedido.order_items).map((linha) => {
        const item = registro(linha.item);
        return {
          id: item.id ?? null,
          titulo: item.title ?? null,
          quantidade: Number(linha.quantity ?? 0),
          precoUnitario: Number(linha.unit_price ?? 0),
        };
      }),
    };
  });

  // Resumo financeiro da página retornada (o total geral vem na paginação)
  const resumo = {
    totalPedidos: Number(paginacao.total ?? pedidos.length),
    valorPagina: pedidos.reduce((soma, pedido) => soma + (pedido.status === "cancelled" ? 0 : pedido.valorPago), 0),
    pagos: pedidos.filter((pedido) => pedido.status === "paid").length,
    cancelados: pedidos.filter((pedido) => pedido.status === "cancelled").length,
  };

  res.json({
    pedidos,
    resumo,
    pagina: consulta.page,
    totalPaginas: Math.max(1, Math.ceil(Number(paginacao.total ?? 0) / consulta.limit)),
    total: Number(paginacao.total ?? pedidos.length),
  });
}));

// ----------------------------------------------------------------
// Perguntas de compradores (SAC)
// ----------------------------------------------------------------
extrasRouter.get("/perguntas", asyncHandler(async (req, res) => {
  const accountId = req.appSession!.accountId!;
  const account = await contaConectada(accountId);
  const consulta = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(30),
    status: z.enum(["UNANSWERED", "ANSWERED", "all"]).default("all"),
  }).parse(req.query);

  const parametros = new URLSearchParams({
    seller_id: account.mlUserId,
    sort_fields: "date_created",
    sort_types: "DESC",
    limit: String(consulta.limit),
    offset: String((consulta.page - 1) * consulta.limit),
    api_version: "4",
  });
  if (consulta.status !== "all") parametros.set("status", consulta.status);

  const resposta = await mlRequest<Registro>(accountId, `/questions/search?${parametros}`);
  const brutas = lista(resposta.questions);

  // Busco os títulos dos anúncios das perguntas numa chamada só (multiget)
  const idsAnuncios = [...new Set(brutas.map((pergunta) => String(pergunta.item_id ?? "")).filter(Boolean))];
  const dadosAnuncios = new Map<string, Registro>();
  if (idsAnuncios.length) {
    const multiget = await mlRequest<unknown>(
      accountId,
      `/items?ids=${idsAnuncios.slice(0, 20).join(",")}&attributes=id,title,permalink,thumbnail,price`,
    ).catch(() => null);
    for (const entrada of lista(multiget)) {
      const corpo = registro(entrada.body);
      if (corpo.id) dadosAnuncios.set(String(corpo.id), corpo);
    }
  }

  const perguntas = brutas.map((pergunta) => {
    const resposta = registro(pergunta.answer);
    const quem = registro(pergunta.from);
    const anuncio = dadosAnuncios.get(String(pergunta.item_id ?? "")) ?? {};
    return {
      id: pergunta.id,
      texto: pergunta.text ?? "",
      status: pergunta.status ?? null,
      criadaEm: pergunta.date_created ?? null,
      deUsuario: quem.id ?? null,
      anuncio: {
        id: pergunta.item_id ?? null,
        titulo: anuncio.title ?? null,
        link: anuncio.permalink ?? null,
        foto: anuncio.thumbnail ?? null,
        preco: anuncio.price ?? null,
      },
      resposta: resposta.text
        ? { texto: resposta.text, em: resposta.date_created ?? null }
        : null,
    };
  });

  const total = Number(registro(resposta.paging ?? resposta).total ?? resposta.total ?? perguntas.length);
  res.json({
    perguntas,
    pagina: consulta.page,
    total,
    totalPaginas: Math.max(1, Math.ceil(total / consulta.limit)),
    naoRespondidas: consulta.status === "UNANSWERED" ? total : undefined,
  });
}));

extrasRouter.post("/perguntas/:id/resposta", requireCsrf, asyncHandler(async (req, res) => {
  const accountId = req.appSession!.accountId!;
  await contaConectada(accountId);
  const idPergunta = z.coerce.number().int().positive().parse(req.params.id);
  const corpo = z.object({ texto: z.string().trim().min(2).max(2000) }).parse(req.body);
  const resultado = await mlRequest<Registro>(accountId, "/answers", {
    method: "POST",
    body: JSON.stringify({ question_id: idPergunta, text: corpo.texto }),
  });
  res.status(201).json({ ok: true, resultado });
}));

// ----------------------------------------------------------------
// Visitas por anúncio (janela de dias)
// ----------------------------------------------------------------
extrasRouter.get("/visitas", asyncHandler(async (req, res) => {
  const accountId = req.appSession!.accountId!;
  await contaConectada(accountId);
  const consulta = z.object({
    ids: z.string().min(3).max(600),
    dias: z.coerce.number().int().min(1).max(150).default(30),
  }).parse(req.query);

  const ids = [...new Set(consulta.ids.split(",").map((id) => id.trim().toUpperCase()).filter((id) => /^MLB\d{7,}$/.test(id)))].slice(0, 20);
  if (!ids.length) throw new AppError(400, "INVALID_ITEM_IDS", "Informe ao menos um MLB válido.");

  const itens = await Promise.all(ids.map(async (id) => {
    try {
      const dados = await mlRequest<Registro>(accountId, `/items/${id}/visits/time_window?last=${consulta.dias}&unit=day`);
      return {
        id,
        total: Number(dados.total_visits ?? 0),
        porDia: lista(dados.results).map((linha) => ({
          data: linha.date ?? null,
          visitas: Number(linha.total ?? 0),
        })),
      };
    } catch {
      return { id, total: null, porDia: [], erro: "Não foi possível ler as visitas deste anúncio." };
    }
  }));

  res.json({ dias: consulta.dias, itens });
}));

// ----------------------------------------------------------------
// Tendências de busca do site (cacheadas por 1 hora)
// ----------------------------------------------------------------
let cacheTendencias: { em: number; dados: unknown } | null = null;

extrasRouter.get("/tendencias", asyncHandler(async (req, res) => {
  const accountId = req.appSession!.accountId!;
  const account = await contaConectada(accountId);
  const site = account.siteId || "MLB";
  const categoria = z.string().regex(/^ML[A-Z]\d+$/).optional().catch(undefined).parse(req.query.categoria);

  if (!categoria && cacheTendencias && Date.now() - cacheTendencias.em < 3_600_000) {
    res.json(cacheTendencias.dados);
    return;
  }

  const caminho = categoria ? `/trends/${site}/${categoria}` : `/trends/${site}`;
  const resposta = await mlRequest<unknown>(accountId, caminho);
  const tendencias = lista(resposta).map((linha, posicao) => ({
    posicao: posicao + 1,
    termo: linha.keyword ?? "",
    link: linha.url ?? null,
  })).filter((linha) => linha.termo);

  const dados = { site, categoria: categoria ?? null, tendencias };
  if (!categoria) cacheTendencias = { em: Date.now(), dados };
  res.json(dados);
}));

// ----------------------------------------------------------------
// Reputação do vendedor
// ----------------------------------------------------------------
extrasRouter.get("/reputacao", asyncHandler(async (req, res) => {
  const accountId = req.appSession!.accountId!;
  const account = await contaConectada(accountId);
  const usuario = await mlRequest<Registro>(accountId, `/users/${account.mlUserId}`);
  const reputacao = registro(usuario.seller_reputation);
  const transacoes = registro(reputacao.transactions);
  const avaliacoes = registro(transacoes.ratings);
  const metricas = registro(reputacao.metrics);
  const reclamacoes = registro(metricas.claims);
  const atrasos = registro(metricas.delayed_handling_time);
  const cancelamentos = registro(metricas.cancellations);

  res.json({
    apelido: usuario.nickname ?? account.nickname,
    link: usuario.permalink ?? null,
    nivel: reputacao.level_id ?? null,
    medalha: reputacao.power_seller_status ?? null,
    transacoes: {
      total: Number(transacoes.total ?? 0),
      concluidas: Number(transacoes.completed ?? 0),
      canceladas: Number(transacoes.canceled ?? 0),
    },
    avaliacoes: {
      positivas: Number(avaliacoes.positive ?? 0),
      neutras: Number(avaliacoes.neutral ?? 0),
      negativas: Number(avaliacoes.negative ?? 0),
    },
    metricas: {
      reclamacoes: Number(registro(reclamacoes).rate ?? 0),
      atrasos: Number(registro(atrasos).rate ?? 0),
      cancelamentos: Number(registro(cancelamentos).rate ?? 0),
    },
  });
}));
