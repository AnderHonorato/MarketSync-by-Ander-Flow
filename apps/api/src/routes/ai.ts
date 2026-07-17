import { Router } from "express";
import { z } from "zod";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createWorker, type Worker } from "tesseract.js";
import type { Workbook } from "exceljs";
import { prisma } from "../db.js";
import { AppError, asyncHandler } from "../lib/errors.js";
import { requireCsrf } from "../middleware/session.js";
import { askAlphaBot, askAlphaBotStream } from "../services/alphaBotService.js";

export const aiRouter = Router();

const IMAGE_RE = /^image\/(png|jpeg|webp|gif)$/i;

const attachmentSchema = z.object({
  name: z.string().min(1).max(160),
  type: z.string().min(1).max(100),
  dataUrl: z.string().max(5_000_000).optional(),
  content: z.string().max(50_000).optional(),
});

const VISUALIZADOR_URL = "http://127.0.0.1:5000";
let visualizadorProcess: ChildProcess | null = null;

let ocrWorker: Worker | null = null;

async function getOcrWorker(): Promise<Worker> {
  if (!ocrWorker) {
    ocrWorker = await createWorker("por+eng");
  }
  return ocrWorker;
}

async function extractTextWithTesseract(dataUrl: string): Promise<string | null> {
  try {
    const worker = await getOcrWorker();
    const { data: { text } } = await worker.recognize(dataUrl);
    const resultado = text?.trim();
    if (!resultado) return null;
    return resultado.length > 6000 ? resultado.slice(0, 6000) + "\n[...texto truncado]" : resultado;
  } catch {
    return null;
  }
}

async function extractTextFromFile(
  att: z.infer<typeof attachmentSchema>,
): Promise<string | null> {
  // Arquivos de texto puro — conteúdo já veio do frontend
  if (att.content) {
    return `### 📄 ${att.name}\n${att.content}`;
  }

  // PDF — extrai texto com pdf-parse
  if (att.type === "application/pdf" && att.dataUrl) {
    try {
      const pdfParse = await import("pdf-parse");
      const b64 = att.dataUrl.includes(",") ? att.dataUrl.split(",")[1] : att.dataUrl;
      const buf = Buffer.from(b64, "base64");
      const data = (await pdfParse.default(buf)) as { text?: string };
      const texto = data.text?.trim();
      if (!texto) return null;
      const limite = texto.length > 8000 ? texto.slice(0, 8000) + "\n\n*[...texto truncado]*" : texto;
      return `### 📕 ${att.name}\n${limite}`;
    } catch { return null; }
  }

  // Excel (.xlsx) — extrai planilhas com exceljs
  if ((att.type.includes("spreadsheet") || att.type.includes("excel") || att.name.endsWith(".xlsx")) && att.dataUrl) {
    try {
      const ExcelJS = await import("exceljs");
      const b64 = att.dataUrl.includes(",") ? att.dataUrl.split(",")[1] : att.dataUrl;
      const buf = Buffer.from(b64, "base64");
      const wb = new ExcelJS.Workbook();
      // O exceljs espera o tipo Buffer dele; o cast evita a briga de tipos do Node 22
      await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
      const partes: string[] = [];
      for (const ws of wb.worksheets) {
        const linhas: string[] = [];
        ws.eachRow((row) => {
          const valores = Array.isArray(row.values) ? row.values.slice(1) : [];
          linhas.push(valores.map((v) => String(v ?? "")).join("\t"));
        });
        if (linhas.length) partes.push(`**Aba: ${ws.name}**\n${linhas.join("\n")}`);
      }
      const texto = partes.join("\n\n");
      if (!texto.trim()) return null;
      const limite = texto.length > 8000 ? texto.slice(0, 8000) + "\n\n*[...texto truncado]*" : texto;
      return `### 📊 ${att.name}\n${limite}`;
    } catch { return null; }
  }

  return null;
}

async function resolveFileContext(
  attachments: z.infer<typeof attachmentSchema>[],
): Promise<string | null> {
  if (!attachments.length) return null;
  const results = await Promise.all(attachments.map(extractTextFromFile));
  const valid = results.filter(Boolean) as string[];
  return valid.length ? valid.join("\n\n") : null;
}

function findPython(): string | null {
  for (const cmd of ["python", "python3", "py"]) {
    try {
      const result = require("node:child_process").execSync(`where ${cmd}`, { timeout: 3000, stdio: "pipe" });
      if (result.toString().trim()) return cmd;
    } catch { /* tenta o próximo */ }
  }
  return null;
}

async function isVisualizadorRunning(): Promise<boolean> {
  try {
    const resp = await fetch(`${VISUALIZADOR_URL}/status`, { signal: AbortSignal.timeout(2_000) });
    return resp.ok;
  } catch {
    return false;
  }
}

async function ensureVisualizadorRunning(): Promise<boolean> {
  if (await isVisualizadorRunning()) return true;
  if (visualizadorProcess && !visualizadorProcess.killed) return false;

  const python = findPython();
  if (!python) return false;

  const serverScript = resolve(process.cwd(), "ferramentas", "agente-visualizador", "server.py");
  if (!existsSync(serverScript)) return false;

  try {
    visualizadorProcess = spawn(python, [serverScript], {
      cwd: resolve(process.cwd(), "ferramentas", "agente-visualizador"),
      stdio: "ignore",
      detached: true,
      windowsHide: true,
    });
    visualizadorProcess.unref();
  } catch {
    return false;
  }

  for (let i = 0; i < 30; i++) {
    if (await isVisualizadorRunning()) return true;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return false;
}

async function resolveVisualContext(
  attachments: z.infer<typeof attachmentSchema>[],
  onStatus?: (msg: string) => void,
): Promise<string | null> {
  if (!attachments.length) return null;

  const imagens = attachments.filter((a) => IMAGE_RE.test(a.type) && a.dataUrl);
  const arquivos = attachments.filter((a) => !IMAGE_RE.test(a.type));

  const partes: string[] = [];
  let temConteudo = false;

  // 1. Imagens: visualizador + tesseract
  if (imagens.length > 0) {
    onStatus?.(`Analisando ${imagens.length} imagem(ns) com o visualizador...`);
    const online = await ensureVisualizadorRunning();
    if (online) {
      try {
        const results = await Promise.all(
          imagens.map(async (att) => {
            const resp = await fetch(`${VISUALIZADOR_URL}/analisar`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ imagem: att.dataUrl!, nome: att.name, tamanho: att.dataUrl!.length }),
              signal: AbortSignal.timeout(45_000),
            });
            if (!resp.ok) return null;
            return (await resp.json()) as { contexto?: string; texto_ocr?: string } | null;
          }),
        );
        const validos = results.filter(Boolean);
        if (validos.length > 0) {
          partes.push("## 📷 Análise visual");
          for (let i = 0; i < validos.length; i++) {
            const r = validos[i]!;
            if (r.contexto) {
              const ctxLimpo = r.contexto
                .replace(/^\[CONTEXTO VISUAL[^\]]*\]/gm, "")
                .replace(/^={3,}/gm, "")
                .replace(/\[FIM DO CONTEXTO VISUAL\]/gi, "")
                .trim();
              partes.push(`### ${imagens[i].name}\n${ctxLimpo}`);
              temConteudo = true;
            }
          }
        }
      } catch { /* visualizador falhou */ }
    }

    onStatus?.("Extraindo texto das imagens (OCR)...");
    try {
      const textosOcr = await Promise.all(
        imagens.map(async (att) => {
          const texto = await extractTextWithTesseract(att.dataUrl!);
          return texto ? `### 📝 Texto extraído de ${att.name}\n${texto}` : null;
        }),
      );
      const validos = textosOcr.filter(Boolean) as string[];
      if (validos.length > 0) {
        if (!temConteudo) { partes.push("## 🔍 Texto das imagens"); temConteudo = true; }
        partes.push(...validos);
      }
    } catch { /* tesseract falhou */ }
  }

  // 2. Arquivos: extrai texto do conteúdo
  if (arquivos.length > 0) {
    onStatus?.(`Lendo ${arquivos.length} arquivo(s)...`);
    const ctx = await resolveFileContext(arquivos);
    if (ctx) {
      partes.push(ctx);
      temConteudo = true;
    }
  }

  if (!temConteudo) return null;
  return partes.join("\n\n");
}

function attachmentFallbackNote(attachments: z.infer<typeof attachmentSchema>[]): string {
  if (!attachments.length) return "";
  return `\n\n[Imagens anexadas: ${attachments.map((i) => i.name).join(", ")}]`;
}

const conversationView = (conversation: { id: string; title: string; archivedAt: Date | null; createdAt: Date; updatedAt: Date; _count?: { messages: number } }) => ({
  id: conversation.id,
  title: conversation.title,
  archived: Boolean(conversation.archivedAt),
  createdAt: conversation.createdAt.toISOString(),
  updatedAt: conversation.updatedAt.toISOString(),
  messageCount: conversation._count?.messages ?? 0,
});

function messageView(message: { id: string; role: string; content: string; reasoning: string | null; attachmentsJson: string; tokensJson: string; createdAt: Date }) {
  let attachments: unknown[] = [];
  try { attachments = JSON.parse(message.attachmentsJson) as unknown[]; } catch { /* keep empty */ }
  let tokens: unknown = null;
  try { tokens = JSON.parse(message.tokensJson); } catch { /* keep empty */ }
  return { id: message.id, role: message.role, content: message.content, reasoning: message.reasoning, attachments, tokens, createdAt: message.createdAt.toISOString() };
}

async function ownedConversation(sessionId: string, id: string) {
  const conversation = await prisma.aiConversation.findFirst({ where: { id, sessionId } });
  if (!conversation) throw new AppError(404, "AI_CONVERSATION_NOT_FOUND", "A conversa não foi encontrada.");
  return conversation;
}

aiRouter.get("/ai/conversations", asyncHandler(async (req, res) => {
  const archived = req.query.archived === "true";
  const conversations = await prisma.aiConversation.findMany({
    where: { sessionId: req.appSession!.id, archivedAt: archived ? { not: null } : null },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { messages: true } } },
    take: 100,
  });
  res.json({ items: conversations.map(conversationView) });
}));

aiRouter.post("/ai/conversations", requireCsrf, asyncHandler(async (req, res) => {
  const input = z.object({ title: z.string().trim().min(1).max(100).optional() }).parse(req.body ?? {});
  const conversation = await prisma.aiConversation.create({ data: { sessionId: req.appSession!.id, title: input.title ?? "Nova conversa" } });
  res.status(201).json(conversationView(conversation));
}));

aiRouter.get("/ai/conversations/:id/messages", asyncHandler(async (req, res) => {
  const conversation = await ownedConversation(req.appSession!.id, String(req.params.id));
  const messages = await prisma.aiMessage.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: "asc" }, take: 300 });
  res.json({ conversation: conversationView(conversation), items: messages.map(messageView) });
}));

aiRouter.patch("/ai/conversations/:id", requireCsrf, asyncHandler(async (req, res) => {
  const conversation = await ownedConversation(req.appSession!.id, String(req.params.id));
  const input = z.object({ title: z.string().trim().min(1).max(100).optional(), archived: z.boolean().optional() }).parse(req.body);
  const updated = await prisma.aiConversation.update({ where: { id: conversation.id }, data: { title: input.title, archivedAt: input.archived == null ? undefined : input.archived ? new Date() : null } });
  res.json(conversationView(updated));
}));

aiRouter.delete("/ai/conversations/:id", requireCsrf, asyncHandler(async (req, res) => {
  const conversation = await ownedConversation(req.appSession!.id, String(req.params.id));
  await prisma.aiConversation.delete({ where: { id: conversation.id } });
  res.status(204).end();
}));

aiRouter.post("/ai/conversations/:id/messages", requireCsrf, asyncHandler(async (req, res) => {
  const conversation = await ownedConversation(req.appSession!.id, String(req.params.id));
  if (conversation.archivedAt) throw new AppError(409, "AI_CONVERSATION_ARCHIVED", "Reabra a conversa antes de enviar mensagens.");
  const input = z.object({ content: z.string().trim().max(12_000).default(""), attachments: z.array(attachmentSchema).max(6).default([]) })
    .refine((value) => Boolean(value.content || value.attachments.length), "Escreva uma mensagem ou anexe uma imagem.")
    .parse(req.body);
  const visualContext = await resolveVisualContext(input.attachments);
  const attachmentNote = visualContext ?? attachmentFallbackNote(input.attachments);
  const userMessage = await prisma.aiMessage.create({ data: { conversationId: conversation.id, role: "user", content: input.content || "Imagem enviada", attachmentsJson: JSON.stringify(input.attachments) } });
  const history = await prisma.aiMessage.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: "asc" }, take: 30 });
  const accountId = req.appSession!.accountId;
  const [listingCount, account] = accountId ? await Promise.all([
    prisma.listingSnapshot.count({ where: { accountId } }),
    prisma.oAuthAccount.findUnique({ where: { id: accountId }, select: { nickname: true, mlUserId: true } }),
  ]) : [0, null];
  const siteContext = `Conta oficial: ${account ? `${account.nickname} (${account.mlUserId})` : "não conectada"}. Anúncios sincronizados: ${listingCount}. A área pública é opcional e não oficial. A interface possui abas de anúncios oficiais, consultas públicas e histórico.`;
  const providerMessages = history.map((message) => ({ role: message.role === "assistant" ? "assistant" as const : "user" as const, content: message.content + (message.id === userMessage.id ? attachmentNote : "") }));
  const answer = await askAlphaBot(providerMessages, siteContext);
  const assistantMessage = await prisma.aiMessage.create({ data: { conversationId: conversation.id, role: "assistant", content: answer.content, reasoning: answer.reasoning, tokensJson: JSON.stringify(answer.tokens ?? {}) } });
  const nextTitle = conversation.title === "Nova conversa" ? (input.content || input.attachments[0]?.name || "Nova conversa").slice(0, 72) : conversation.title;
  await prisma.aiConversation.update({ where: { id: conversation.id }, data: { title: nextTitle, updatedAt: new Date() } });
  res.status(201).json({ user: messageView(userMessage), assistant: messageView(assistantMessage), title: nextTitle });
}));

aiRouter.post("/ai/conversations/:id/messages/stream", requireCsrf, asyncHandler(async (req, res) => {
  const conversation = await ownedConversation(req.appSession!.id, String(req.params.id));
  if (conversation.archivedAt) throw new AppError(409, "AI_CONVERSATION_ARCHIVED", "Reabra a conversa antes de enviar mensagens.");
  const input = z.object({ content: z.string().trim().max(12_000).default(""), attachments: z.array(attachmentSchema).max(6).default([]) })
    .refine((value) => Boolean(value.content || value.attachments.length), "Escreva uma mensagem ou anexe uma imagem.")
    .parse(req.body);

  req.socket.setTimeout(0);
  req.socket.setNoDelay(true);
  req.socket.setKeepAlive(true);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const temAnexos = input.attachments.length > 0;

  // Cria blocos de status individuais para cada arquivo
  if (temAnexos) {
    for (let i = 0; i < input.attachments.length; i++) {
      const att = input.attachments[i];
      const tipo = IMAGE_RE.test(att.type) ? "imagem" : att.type === "application/pdf" ? "PDF" : att.type.includes("spreadsheet") || att.type.includes("excel") ? "planilha" : "arquivo";
      res.write(`event: status\ndata: ${JSON.stringify({ text: `Analisando ${tipo}: ${att.name}...`, file: att.name, index: i, total: input.attachments.length })}\n\n`);
    }
  }

  // Processa cada arquivo individualmente
  const partes: string[] = [];
  let temConteudo = false;

  for (let i = 0; i < input.attachments.length; i++) {
    const att = input.attachments[i];
    const t0 = Date.now();
    const isImagem = IMAGE_RE.test(att.type) && att.dataUrl;

    if (isImagem) {
      // Visualizador
      const online = await ensureVisualizadorRunning();
      if (online) {
        try {
          const resp = await fetch(`${VISUALIZADOR_URL}/analisar`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ imagem: att.dataUrl!, nome: att.name, tamanho: att.dataUrl!.length }),
            signal: AbortSignal.timeout(45_000),
          });
          if (resp.ok) {
            const r = await resp.json() as { contexto?: string; texto_ocr?: string } | null;
            if (r?.contexto) {
              const ctxLimpo = r.contexto
                .replace(/^\[CONTEXTO VISUAL[^\]]*\]/gm, "")
                .replace(/^={3,}/gm, "")
                .replace(/\[FIM DO CONTEXTO VISUAL\]/gi, "")
                .trim();
              partes.push(`### ${att.name}\n${ctxLimpo}`);
              temConteudo = true;
            }
          }
        } catch { /* visualizador falhou */ }
      }

      // Tesseract OCR
      try {
        const texto = await extractTextWithTesseract(att.dataUrl!);
        if (texto) {
          if (!temConteudo) { partes.push("## 🔍 Texto das imagens"); temConteudo = true; }
          partes.push(`### 📝 Texto extraído de ${att.name}\n${texto}`);
        }
      } catch { /* tesseract falhou */ }
    } else {
      // Arquivo não-imagem (PDF, Excel, texto)
      const ctx = await extractTextFromFile(att);
      if (ctx) {
        partes.push(ctx);
        temConteudo = true;
      }
    }

    const s = Math.max(1, Math.round((Date.now() - t0) / 1000));
    const tipo = isImagem ? "imagem" : att.type === "application/pdf" ? "PDF" : att.type.includes("spreadsheet") || att.type.includes("excel") ? "planilha" : "arquivo";
    res.write(`event: status\ndata: ${JSON.stringify({ text: `${att.name} — ${tipo} analisado (${s}s)`, file: att.name, index: i, total: input.attachments.length, done: true })}\n\n`);

    // Pequena pausa entre arquivos para mostrar progresso individual
    if (i < input.attachments.length - 1) {
      await new Promise((r) => setTimeout(r, 600));
    }
  }

  const visualContext = temConteudo ? (partes.length > 1 && partes[0]?.startsWith("## 📷") ? "" : "## 📷 Análise visual\n") + partes.join("\n\n") : null;
  const attachmentNote = visualContext ?? attachmentFallbackNote(input.attachments);

  if (temAnexos) {
    if (visualContext) {
      res.write(`event: status\ndata: ${JSON.stringify({ text: "Preparando resposta..." })}\n\n`);
    } else {
      res.write(`event: status\ndata: ${JSON.stringify({ text: "Análise indisponível. Responderei com as informações disponíveis." })}\n\n`);
    }
  }

  const userMessage = await prisma.aiMessage.create({ data: { conversationId: conversation.id, role: "user", content: input.content || "Imagem enviada", attachmentsJson: JSON.stringify(input.attachments) } });
  const history = await prisma.aiMessage.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: "asc" }, take: 30 });
  const accountId = req.appSession!.accountId;
  const [listingCount, account] = accountId ? await Promise.all([
    prisma.listingSnapshot.count({ where: { accountId } }),
    prisma.oAuthAccount.findUnique({ where: { id: accountId }, select: { nickname: true, mlUserId: true } }),
  ]) : [0, null];
  const siteContext = `Conta oficial: ${account ? `${account.nickname} (${account.mlUserId})` : "não conectada"}. Anúncios sincronizados: ${listingCount}. A área pública é opcional e não oficial. A interface possui abas de anúncios oficiais, consultas públicas e histórico.`;
  const providerMessages = history.map((message) => ({ role: message.role === "assistant" ? "assistant" as const : "user" as const, content: message.content + (message.id === userMessage.id ? attachmentNote : "") }));

  try {
    const answer = await askAlphaBotStream(providerMessages, siteContext, (chunk) => {
      res.write(`event: ${chunk.type}\ndata: ${JSON.stringify({ text: chunk.text })}\n\n`);
    });

    const assistantMessage = await prisma.aiMessage.create({ data: { conversationId: conversation.id, role: "assistant", content: answer.content, reasoning: answer.reasoning, tokensJson: JSON.stringify(answer.tokens ?? {}) } });
    const nextTitle = conversation.title === "Nova conversa" ? (input.content || input.attachments[0]?.name || "Nova conversa").slice(0, 72) : conversation.title;
    await prisma.aiConversation.update({ where: { id: conversation.id }, data: { title: nextTitle, updatedAt: new Date() } });

    res.write(`event: done\ndata: ${JSON.stringify({ user: messageView(userMessage), assistant: messageView(assistantMessage), title: nextTitle })}\n\n`);
    res.end();
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erro interno do assistente.";
    res.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
    res.end();
  }
}));
