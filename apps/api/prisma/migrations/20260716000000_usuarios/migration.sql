-- Usuários do aplicativo (login local) e vínculo com a sessão.
-- Hierarquia OWNER > ADMIN > USER, com permissões por página para USER.

CREATE TABLE "AppUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "papel" TEXT NOT NULL DEFAULT 'USER',
    "situacao" TEXT NOT NULL DEFAULT 'PENDENTE',
    "usuario" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senhaHash" TEXT NOT NULL,
    "perguntaRecuperacao" TEXT NOT NULL,
    "respostaRecuperacaoHash" TEXT NOT NULL,
    "nome" TEXT NOT NULL DEFAULT '',
    "cpf" TEXT NOT NULL DEFAULT '',
    "perfilJson" TEXT NOT NULL DEFAULT '{}',
    "permissoesJson" TEXT NOT NULL DEFAULT '[]',
    "adminPaiId" TEXT,
    "criadoPorId" TEXT,
    "aprovadoPorId" TEXT,
    "aprovadoEm" DATETIME,
    "ultimoLoginEm" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AppUser_adminPaiId_fkey" FOREIGN KEY ("adminPaiId") REFERENCES "AppUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AppUser_usuario_key" ON "AppUser"("usuario");
CREATE UNIQUE INDEX "AppUser_email_key" ON "AppUser"("email");
CREATE INDEX "AppUser_papel_situacao_idx" ON "AppUser"("papel", "situacao");
CREATE INDEX "AppUser_adminPaiId_idx" ON "AppUser"("adminPaiId");

-- Novo vínculo da sessão com o usuário logado
ALTER TABLE "Session" ADD COLUMN "usuarioId" TEXT REFERENCES "AppUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Session_usuarioId_idx" ON "Session"("usuarioId");
