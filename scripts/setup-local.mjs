import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const envPath = resolve(root, '.env');
const quiet = process.argv.includes('--quiet');

if (!existsSync(envPath)) {
  const example = readFileSync(resolve(root, '.env.example'), 'utf8');
  const encryptionKey = randomBytes(32).toString('base64');
  const configured = example.replace(/^TOKEN_ENCRYPTION_KEY=.*$/m, `TOKEN_ENCRYPTION_KEY=${encryptionKey}`);
  writeFileSync(envPath, configured, { encoding: 'utf8', flag: 'wx' });
  if (!quiet) console.log('Arquivo .env criado com uma chave local segura.');
}

const database = resolve(root, 'apps/api/prisma/dev.db');
const result = spawnSync(process.execPath, ['scripts/init-sqlite.mjs', 'prisma/dev.db'], {
  cwd: resolve(root, 'apps/api'),
  stdio: quiet ? 'ignore' : 'inherit',
});
if (result.status !== 0) process.exit(result.status ?? 1);

if (!quiet) {
  const env = readFileSync(envPath, 'utf8');
  const clientId = env.match(/^ML_CLIENT_ID=(.*)$/m)?.[1]?.trim();
  const clientSecret = env.match(/^ML_CLIENT_SECRET=(.*)$/m)?.[1]?.trim();
  if (!clientId || !clientSecret) {
    console.log('\nFalta configurar ML_CLIENT_ID e ML_CLIENT_SECRET no arquivo .env.');
    console.log('A interface pode abrir, mas o login permanecerá desabilitado até preencher essas credenciais.');
  } else {
    console.log('Ambiente local pronto. Execute: npm run dev');
  }
}
