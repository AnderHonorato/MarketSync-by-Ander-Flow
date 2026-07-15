CREATE TABLE "AiConversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Nova conversa',
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiConversation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "AiMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "reasoning" TEXT,
    "attachmentsJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "AiConversation_sessionId_archivedAt_updatedAt_idx" ON "AiConversation"("sessionId", "archivedAt", "updatedAt");
CREATE INDEX "AiMessage_conversationId_createdAt_idx" ON "AiMessage"("conversationId", "createdAt");
