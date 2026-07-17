-- Chat interno entre usuários + foto de perfil.

ALTER TABLE "AppUser" ADD COLUMN "fotoPerfil" TEXT;

CREATE TABLE "ChatMensagem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deId" TEXT NOT NULL,
    "paraId" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "apagadaEm" DATETIME,
    "lidaEm" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMensagem_deId_fkey" FOREIGN KEY ("deId") REFERENCES "AppUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChatMensagem_paraId_fkey" FOREIGN KEY ("paraId") REFERENCES "AppUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ChatMensagem_deId_paraId_createdAt_idx" ON "ChatMensagem"("deId", "paraId", "createdAt");
CREATE INDEX "ChatMensagem_paraId_lidaEm_idx" ON "ChatMensagem"("paraId", "lidaEm");

CREATE TABLE "ChatPreferencia" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "usuarioId" TEXT NOT NULL,
    "contatoId" TEXT NOT NULL,
    "fixada" BOOLEAN NOT NULL DEFAULT false,
    "arquivada" BOOLEAN NOT NULL DEFAULT false,
    "apagadaAte" DATETIME,
    CONSTRAINT "ChatPreferencia_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "AppUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChatPreferencia_contatoId_fkey" FOREIGN KEY ("contatoId") REFERENCES "AppUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ChatPreferencia_usuarioId_contatoId_key" ON "ChatPreferencia"("usuarioId", "contatoId");
