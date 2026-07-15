import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { AppError, asyncHandler } from "../lib/errors.js";
import { requireCsrf } from "../middleware/session.js";
import { askAlphaBot, askAlphaBotStream } from "../services/alphaBotService.js";

export const aiRouter = Router();

const attachmentSchema = z.object({
  name: z.string().min(1).max(160),
  type: z.string().regex(/^image\/(png|jpeg|webp|gif)$/i),
  dataUrl: z.string().max(3_000_000).refine((value) => /^data:image\/(png|jpeg|webp|gif);base64,/i.test(value)),
});

const conversationView = (conversation: { id: string; title: string; archivedAt: Date | null; createdAt: Date; updatedAt: Date; _count?: { messages: number } }) => ({
  id: conversation.id,
  title: conversation.title,
  archived: Boolean(conversation.archivedAt),
  createdAt: conversation.createdAt.toISOString(),
  updatedAt: conversation.updatedAt.toISOString(),
  messageCount: conversation._count?.messages ?? 0,
});

function messageView(message: { id: string; role: string; content: string; reasoning: string | null; attachmentsJson: string; createdAt: Date }) {
  let attachments: unknown[] = [];
  try { attachments = JSON.parse(message.attachmentsJson) as unknown[]; } catch { /* keep empty */ }
  return { id: message.id, role: message.role, content: message.content, reasoning: message.reasoning, attachments, createdAt: message.createdAt.toISOString() };
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
  const input = z.object({ content: z.string().trim().max(12_000).default(""), attachments: z.array(attachmentSchema).max(4).default([]) })
    .refine((value) => Boolean(value.content || value.attachments.length), "Escreva uma mensagem ou anexe uma imagem.")
    .parse(req.body);
  const attachmentNote = input.attachments.length ? `\n\n[Imagens anexadas: ${input.attachments.map((item) => item.name).join(", ")}]` : "";
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
  const assistantMessage = await prisma.aiMessage.create({ data: { conversationId: conversation.id, role: "assistant", content: answer.content, reasoning: answer.reasoning } });
  const nextTitle = conversation.title === "Nova conversa" ? (input.content || input.attachments[0]?.name || "Nova conversa").slice(0, 72) : conversation.title;
  await prisma.aiConversation.update({ where: { id: conversation.id }, data: { title: nextTitle, updatedAt: new Date() } });
  res.status(201).json({ user: messageView(userMessage), assistant: messageView(assistantMessage), title: nextTitle });
}));

aiRouter.post("/ai/conversations/:id/messages/stream", requireCsrf, asyncHandler(async (req, res) => {
  const conversation = await ownedConversation(req.appSession!.id, String(req.params.id));
  if (conversation.archivedAt) throw new AppError(409, "AI_CONVERSATION_ARCHIVED", "Reabra a conversa antes de enviar mensagens.");
  const input = z.object({ content: z.string().trim().max(12_000).default(""), attachments: z.array(attachmentSchema).max(4).default([]) })
    .refine((value) => Boolean(value.content || value.attachments.length), "Escreva uma mensagem ou anexe uma imagem.")
    .parse(req.body);
  const attachmentNote = input.attachments.length ? `\n\n[Imagens anexadas: ${input.attachments.map((item) => item.name).join(", ")}]` : "";
  const userMessage = await prisma.aiMessage.create({ data: { conversationId: conversation.id, role: "user", content: input.content || "Imagem enviada", attachmentsJson: JSON.stringify(input.attachments) } });
  const history = await prisma.aiMessage.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: "asc" }, take: 30 });
  const accountId = req.appSession!.accountId;
  const [listingCount, account] = accountId ? await Promise.all([
    prisma.listingSnapshot.count({ where: { accountId } }),
    prisma.oAuthAccount.findUnique({ where: { id: accountId }, select: { nickname: true, mlUserId: true } }),
  ]) : [0, null];
  const siteContext = `Conta oficial: ${account ? `${account.nickname} (${account.mlUserId})` : "não conectada"}. Anúncios sincronizados: ${listingCount}. A área pública é opcional e não oficial. A interface possui abas de anúncios oficiais, consultas públicas e histórico.`;
  const providerMessages = history.map((message) => ({ role: message.role === "assistant" ? "assistant" as const : "user" as const, content: message.content + (message.id === userMessage.id ? attachmentNote : "") }));

  req.socket.setTimeout(0);
  req.socket.setNoDelay(true);
  req.socket.setKeepAlive(true);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  try {
    const answer = await askAlphaBotStream(providerMessages, siteContext, (chunk) => {
      res.write(`event: ${chunk.type}\ndata: ${JSON.stringify({ text: chunk.text })}\n\n`);
    });

    const assistantMessage = await prisma.aiMessage.create({ data: { conversationId: conversation.id, role: "assistant", content: answer.content, reasoning: answer.reasoning } });
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
