import { createApp } from './app.js';
import { config } from './config.js';
import { prisma } from './db.js';

const server = createApp().listen(config.PORT, '0.0.0.0', () => {
  console.log(`[api] MarketSync em http://0.0.0.0:${config.PORT}`);
});

const shutdown = async () => {
  server.close();
  await prisma.$disconnect();
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
