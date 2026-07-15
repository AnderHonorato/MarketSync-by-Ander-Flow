import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { config } from "./config.js";
import { errorHandler, notFound } from "./lib/errors.js";
import { ensureSession } from "./middleware/session.js";
import { apiRateLimit, noStore } from "./middleware/security.js";
import { authRouter } from "./routes/auth.js";
import { bulkRouter } from "./routes/bulk.js";
import { exportRouter } from "./routes/export.js";
import { listingsRouter } from "./routes/listings.js";
import { syncRouter } from "./routes/sync.js";
import { unofficialRouter } from "./routes/unofficial.js";
import { historyRouter } from "./routes/history.js";
import { aiRouter } from "./routes/ai.js";
import { systemRouter } from "./routes/system.js";
import { unofficialAccessRouter } from "./routes/unofficial-access.js";

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
  app.use("/api", noStore, ensureSession, apiRateLimit);
  app.use(
    "/api",
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
  );
  app.use(notFound, errorHandler);
  return app;
}
