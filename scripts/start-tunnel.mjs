import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envText = readFileSync(join(root, ".env"), "utf8");
const redirect = envText.match(/^ML_REDIRECT_URI\s*=\s*["']?([^\r\n"']+)/m)?.[1]?.trim();
if (!redirect?.startsWith("https://")) {
  throw new Error("ML_REDIRECT_URI precisa usar HTTPS para iniciar o túnel.");
}
const host = new URL(redirect).hostname;
if (!host.endsWith(".ngrok-free.dev") && !host.endsWith(".ngrok.app")) {
  throw new Error("O script automático aceita somente um domínio ngrok configurado no projeto.");
}
const executable = join(root, "..", process.platform === "win32" ? "ngrok.exe" : "ngrok");
if (!existsSync(executable)) throw new Error(`ngrok não encontrado em ${executable}`);

const child = spawn(executable, ["http", `--url=${host}`, "3100"], { stdio: "inherit", windowsHide: true });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
