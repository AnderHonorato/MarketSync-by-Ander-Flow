import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { config } from "./config.js";
import { errorHandler, notFound } from "./lib/errors.js";
import { ensureSession } from "./middleware/session.js";
import { carregarUsuario, requireUsuario, requirePermissao } from "./middleware/usuario.js";
import { apiRateLimit, noStore } from "./middleware/security.js";
import { chatRouter } from "./routes/chat.js";
import { authRouter } from "./routes/auth.js";
import { autenticacaoRouter } from "./routes/autenticacao.js";
import { gestaoUsuariosRouter } from "./routes/gestao-usuarios.js";
import { bulkRouter } from "./routes/bulk.js";
import { exportRouter } from "./routes/export.js";
import { listingsRouter } from "./routes/listings.js";
import { syncRouter } from "./routes/sync.js";
import { unofficialRouter } from "./routes/unofficial.js";
import { historyRouter } from "./routes/history.js";
import { aiRouter } from "./routes/ai.js";
import { systemRouter } from "./routes/system.js";
import { unofficialAccessRouter } from "./routes/unofficial-access.js";
import { extrasRouter } from "./routes/extras.js";

export function createApp() {
  const app = express();
  const allowedOrigins = new Set([config.WEB_ORIGIN]);
  if (config.NODE_ENV !== "production") {
    allowedOrigins.add("http://localhost:5180");
    allowedOrigins.add("http://127.0.0.1:5180");
  }
  const isLocalNetworkHost = (hostname: string) =>
    /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname)
    || hostname === "localhost"
    || hostname === "127.0.0.1";
  if (config.NODE_ENV === "production") app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) { callback(null, true); return; }
        if (allowedOrigins.has(origin)) { callback(null, true); return; }
        if (config.NODE_ENV !== "production") {
          try {
            const hostname = new URL(origin).hostname;
            if (isLocalNetworkHost(hostname)) { callback(null, true); return; }
          } catch { /* origin invalida, segue para rejeicao */ }
        }
        callback(null, false);
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    }),
  );
  app.use(express.json({ limit: "12mb" }));
  app.use(cookieParser());
  app.get("/", (_req, res) => res.redirect(config.WEB_ORIGIN));
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use("/api", noStore, ensureSession, carregarUsuario, apiRateLimit);

  // ----- Travas de segurança por área -----
  // Cada caminho sensível exige login local E a permissão da aba
  // correspondente (Fundador e Administradores passam por tudo).
  // Sessão, setup e /auth ficam de fora porque são o próprio portão.
  app.use("/api/listings", requireUsuario, requirePermissao("anuncios"));
  app.use("/api/sync", requireUsuario, requirePermissao("anuncios"));
  app.use("/api/bulk", requireUsuario, requirePermissao("anuncios"));
  app.use("/api/export.xlsx", requireUsuario, requirePermissao("anuncios"));
  app.use("/api/visitas", requireUsuario, requirePermissao("anuncios"));
  app.use("/api/pedidos", requireUsuario, requirePermissao("vendas"));
  app.use("/api/perguntas", requireUsuario, requirePermissao("perguntas"));
  app.use("/api/tendencias", requireUsuario, requirePermissao("tendencias"));
  app.use("/api/reputacao", requireUsuario, requirePermissao("tendencias"));
  app.use("/api/unofficial/scans", requireUsuario, requirePermissao("publico"));
  app.use("/api/unofficial/access", requireUsuario, requirePermissao("publico"));
  app.use("/api/unofficial/catalog", requireUsuario);
  app.use("/api/ai", requireUsuario, requirePermissao("assistente"));
  app.use("/api/history", requireUsuario);
  app.use("/api/system", requireUsuario);
  app.use("/api/account", requireUsuario);
  app.use("/api/chat", requireUsuario);

  app.use(
    "/api",
    autenticacaoRouter,
    gestaoUsuariosRouter,
    chatRouter,
    authRouter,
    historyRouter,
    aiRouter,
    systemRouter,
    unofficialRouter,
    unofficialAccessRouter,
    listingsRouter,
    syncRouter,
    bulkRouter,
    exportRouter,
    extrasRouter,
  );
  app.use(notFound, errorHandler);
  return app;
}
