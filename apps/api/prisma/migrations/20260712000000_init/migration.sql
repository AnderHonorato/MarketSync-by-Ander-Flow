PRAGMA foreign_keys=OFF;

CREATE TABLE IF NOT EXISTS "Session" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "accountId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" DATETIME NOT NULL,
  "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userAgentHash" TEXT,
  "ipHash" TEXT,
  CONSTRAINT "Session_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "OAuthAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "OAuthAttempt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sessionId" TEXT NOT NULL,
  "stateHash" TEXT NOT NULL,
  "codeVerifierCipher" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" DATETIME NOT NULL,
  "usedAt" DATETIME,
  CONSTRAINT "OAuthAttempt_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "OAuthAccount" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "mlUserId" TEXT NOT NULL,
  "nickname" TEXT NOT NULL,
  "siteId" TEXT,
  "accessTokenCipher" TEXT,
  "refreshTokenCipher" TEXT,
  "accessTokenExpiresAt" DATETIME,
  "tokenVersion" INTEGER NOT NULL DEFAULT 0,
  "lastRefreshAt" DATETIME,
  "revokedAt" DATETIME,
  "disconnectedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
CREATE TABLE IF NOT EXISTS "ListingSnapshot" (
  "id" TEXT NOT NULL PRIMARY KEY, "accountId" TEXT NOT NULL, "mlItemId" TEXT NOT NULL, "title" TEXT NOT NULL,
  "sku" TEXT, "sellerCustomField" TEXT, "status" TEXT NOT NULL, "price" REAL NOT NULL, "originalPrice" REAL,
  "discountPercent" REAL NOT NULL DEFAULT 0, "currencyId" TEXT NOT NULL, "availableQuantity" INTEGER NOT NULL,
  "soldQuantity" INTEGER NOT NULL, "categoryId" TEXT, "condition" TEXT, "listingTypeId" TEXT, "permalink" TEXT,
  "thumbnail" TEXT, "catalogListing" BOOLEAN NOT NULL DEFAULT false, "catalogProductId" TEXT, "startTime" DATETIME,
  "stopTime" DATETIME, "lastUpdated" DATETIME, "freeShipping" BOOLEAN NOT NULL DEFAULT false,
  "picturesJson" TEXT NOT NULL DEFAULT '[]', "attributesJson" TEXT NOT NULL DEFAULT '[]', "variationsJson" TEXT NOT NULL DEFAULT '[]',
  "shippingJson" TEXT NOT NULL DEFAULT '{}', "rawJson" TEXT NOT NULL, "internalScore" REAL NOT NULL DEFAULT 0,
  "lastSaleDetectedAt" DATETIME, "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSyncJobId" TEXT,
  CONSTRAINT "ListingSnapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "OAuthAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "SalesSnapshot" (
  "id" TEXT NOT NULL PRIMARY KEY, "accountId" TEXT NOT NULL, "mlItemId" TEXT NOT NULL, "soldQuantity" INTEGER NOT NULL,
  "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SalesSnapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "OAuthAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "SyncJob" (
  "id" TEXT NOT NULL PRIMARY KEY, "accountId" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'QUEUED', "kind" TEXT NOT NULL DEFAULT 'FULL',
  "total" INTEGER NOT NULL DEFAULT 0, "processed" INTEGER NOT NULL DEFAULT 0, "succeeded" INTEGER NOT NULL DEFAULT 0,
  "failed" INTEGER NOT NULL DEFAULT 0, "errorMessage" TEXT, "cancelRequestedAt" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" DATETIME, "completedAt" DATETIME,
  CONSTRAINT "SyncJob_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "OAuthAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "BulkOperation" (
  "id" TEXT NOT NULL PRIMARY KEY, "accountId" TEXT NOT NULL, "idempotencyKey" TEXT NOT NULL, "action" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PREVIEW', "payloadJson" TEXT NOT NULL, "previewJson" TEXT NOT NULL, "total" INTEGER NOT NULL DEFAULT 0,
  "succeeded" INTEGER NOT NULL DEFAULT 0, "failed" INTEGER NOT NULL DEFAULT 0, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" DATETIME, "completedAt" DATETIME,
  CONSTRAINT "BulkOperation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "OAuthAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "BulkOperationItem" (
  "id" TEXT NOT NULL PRIMARY KEY, "operationId" TEXT NOT NULL, "mlItemId" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING',
  "beforeJson" TEXT NOT NULL, "afterJson" TEXT NOT NULL, "errorCode" TEXT, "errorMessage" TEXT, "attempts" INTEGER NOT NULL DEFAULT 0,
  "completedAt" DATETIME,
  CONSTRAINT "BulkOperationItem_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "BulkOperation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "AuditEvent" (
  "id" TEXT NOT NULL PRIMARY KEY, "accountId" TEXT, "sessionId" TEXT, "action" TEXT NOT NULL, "targetType" TEXT, "targetId" TEXT,
  "outcome" TEXT NOT NULL, "metadataJson" TEXT NOT NULL DEFAULT '{}', "ipHash" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "OAuthAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "AuditEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "OAuthAttempt_stateHash_key" ON "OAuthAttempt"("stateHash");
CREATE UNIQUE INDEX IF NOT EXISTS "OAuthAccount_mlUserId_key" ON "OAuthAccount"("mlUserId");
CREATE UNIQUE INDEX IF NOT EXISTS "ListingSnapshot_accountId_mlItemId_key" ON "ListingSnapshot"("accountId","mlItemId");
CREATE UNIQUE INDEX IF NOT EXISTS "BulkOperation_accountId_idempotencyKey_key" ON "BulkOperation"("accountId","idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "BulkOperationItem_operationId_mlItemId_key" ON "BulkOperationItem"("operationId","mlItemId");
CREATE INDEX IF NOT EXISTS "Session_accountId_idx" ON "Session"("accountId"); CREATE INDEX IF NOT EXISTS "Session_expiresAt_idx" ON "Session"("expiresAt");
CREATE INDEX IF NOT EXISTS "OAuthAttempt_sessionId_expiresAt_idx" ON "OAuthAttempt"("sessionId","expiresAt");
CREATE INDEX IF NOT EXISTS "ListingSnapshot_accountId_status_idx" ON "ListingSnapshot"("accountId","status");
CREATE INDEX IF NOT EXISTS "ListingSnapshot_accountId_title_idx" ON "ListingSnapshot"("accountId","title");
CREATE INDEX IF NOT EXISTS "ListingSnapshot_accountId_startTime_idx" ON "ListingSnapshot"("accountId","startTime");
CREATE INDEX IF NOT EXISTS "ListingSnapshot_accountId_lastUpdated_idx" ON "ListingSnapshot"("accountId","lastUpdated");
CREATE INDEX IF NOT EXISTS "ListingSnapshot_accountId_internalScore_idx" ON "ListingSnapshot"("accountId","internalScore");
CREATE INDEX IF NOT EXISTS "SalesSnapshot_accountId_mlItemId_capturedAt_idx" ON "SalesSnapshot"("accountId","mlItemId","capturedAt");
CREATE INDEX IF NOT EXISTS "SyncJob_accountId_createdAt_idx" ON "SyncJob"("accountId","createdAt"); CREATE INDEX IF NOT EXISTS "SyncJob_accountId_status_idx" ON "SyncJob"("accountId","status");
CREATE INDEX IF NOT EXISTS "BulkOperation_accountId_createdAt_idx" ON "BulkOperation"("accountId","createdAt"); CREATE INDEX IF NOT EXISTS "BulkOperationItem_operationId_status_idx" ON "BulkOperationItem"("operationId","status");
CREATE INDEX IF NOT EXISTS "AuditEvent_accountId_createdAt_idx" ON "AuditEvent"("accountId","createdAt"); CREATE INDEX IF NOT EXISTS "AuditEvent_action_createdAt_idx" ON "AuditEvent"("action","createdAt");

PRAGMA foreign_keys=ON;
