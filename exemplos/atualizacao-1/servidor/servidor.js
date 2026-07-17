// ============================================================
// servidor.js — servidor local do MarketSync (nova interface)
//
// Faz duas coisas:
//   1. Entrega os arquivos da pasta "publico" (HTML, CSS, JS)
//   2. Repassa tudo que começa com /api pro backend na porta 3100
//
// Com isso a página e a API ficam no MESMO endereço, então acabou
// o problema de CORS e de porta bloqueada quando acessa pela rede.
// Não usa nenhuma dependência de fora — só o Node puro.
//
// Rodar:  node servidor.js   (ou pelo iniciar.bat na pasta acima)
// ============================================================

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

// PORTA é a nossa; PORT entra como reserva pra ambientes que definem só ela
const PORTA = Number(process.env.PORTA || process.env.PORT || 5190);
const API_DESTINO = { host: "127.0.0.1", port: Number(process.env.PORTA_API || 3100) };
const PASTA_PUBLICO = path.join(__dirname, "..", "publico");

// Tipos de arquivo que a pasta publico usa
const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
};

// ----- Proxy: repassa a requisição pro backend e devolve a resposta -----
// Uso pipe dos dois lados, então o streaming da IA (SSE) passa direto,
// sem esperar a resposta inteira.
function repassarParaApi(requisicao, resposta) {
  const opcoes = {
    host: API_DESTINO.host,
    port: API_DESTINO.port,
    path: requisicao.url,
    method: requisicao.method,
    headers: {
      ...requisicao.headers,
      host: `${API_DESTINO.host}:${API_DESTINO.port}`,
      // O backend confere a origem no CORS; como agora é tudo local,
      // apresento a origem que ele conhece
      origin: `http://localhost:${API_DESTINO.port}`,
    },
  };

  const chamada = http.request(opcoes, (respostaApi) => {
    resposta.writeHead(respostaApi.statusCode ?? 502, respostaApi.headers);
    respostaApi.pipe(resposta);
  });

  chamada.on("error", () => {
    // Backend fora do ar: devolvo um erro que o front sabe explicar
    if (!resposta.headersSent) {
      resposta.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
    }
    resposta.end(JSON.stringify({
      code: "API_LOCAL_FORA",
      message: `A API local não respondeu na porta ${API_DESTINO.port}. Inicie o backend (npm run dev na pasta do projeto) e recarregue a página.`,
    }));
  });

  requisicao.pipe(chamada);
}

// ----- /saude: diagnóstico rápido usado pelo indicador no cabeçalho -----
function responderSaude(resposta) {
  const chamada = http.get(
    { host: API_DESTINO.host, port: API_DESTINO.port, path: "/health", timeout: 3000 },
    (respostaApi) => {
      respostaApi.resume(); // não preciso do corpo, só do status
      const ok = respostaApi.statusCode === 200;
      resposta.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      resposta.end(JSON.stringify({
        servidor: "ok",
        api: ok ? "ok" : "erro",
        portaApi: API_DESTINO.port,
        dica: ok ? null : `A API respondeu com status ${respostaApi.statusCode}.`,
      }));
    },
  );
  const falhou = (motivo) => {
    chamada.destroy();
    resposta.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    resposta.end(JSON.stringify({
      servidor: "ok",
      api: "fora",
      portaApi: API_DESTINO.port,
      dica: `A API local (porta ${API_DESTINO.port}) não respondeu${motivo ? ` (${motivo})` : ""}. Confira se o backend está rodando.`,
    }));
  };
  chamada.on("timeout", () => falhou("tempo esgotado"));
  chamada.on("error", (erro) => falhou(erro.code ?? erro.message));
}

// ----- Arquivos estáticos -----
function entregarArquivo(requisicao, resposta) {
  // Removo a query string e normalizo pra ninguém escapar da pasta publico
  let caminho = decodeURIComponent(requisicao.url.split("?")[0]);
  if (caminho === "/") caminho = "/index.html";
  const arquivo = path.normalize(path.join(PASTA_PUBLICO, caminho));
  if (!arquivo.startsWith(PASTA_PUBLICO)) {
    resposta.writeHead(403);
    resposta.end("Caminho negado");
    return;
  }

  fs.readFile(arquivo, (erro, conteudo) => {
    if (erro) {
      // Qualquer rota desconhecida cai no index (a navegação é toda em uma página só)
      if (!path.extname(caminho)) {
        fs.readFile(path.join(PASTA_PUBLICO, "index.html"), (erroIndex, indice) => {
          if (erroIndex) { resposta.writeHead(500); resposta.end("Erro ao ler o index"); return; }
          resposta.writeHead(200, { "Content-Type": TIPOS[".html"] });
          resposta.end(indice);
        });
        return;
      }
      resposta.writeHead(404);
      resposta.end("Arquivo não encontrado");
      return;
    }
    const extensao = path.extname(arquivo).toLowerCase();
    const ehImagem = [".png", ".jpg", ".svg", ".ico", ".woff2"].includes(extensao);
    resposta.writeHead(200, {
      "Content-Type": TIPOS[extensao] ?? "application/octet-stream",
      // HTML, CSS e JS sempre frescos (o projeto muda com frequência);
      // só imagem e fonte podem ficar guardadas no navegador
      "Cache-Control": ehImagem ? "public, max-age=86400" : "no-cache",
    });
    resposta.end(conteudo);
  });
}

// ----- Servidor -----
const servidor = http.createServer((requisicao, resposta) => {
  if (requisicao.url.startsWith("/api")) {
    repassarParaApi(requisicao, resposta);
  } else if (requisicao.url.startsWith("/saude")) {
    responderSaude(resposta);
  } else {
    entregarArquivo(requisicao, resposta);
  }
});

servidor.on("error", (erro) => {
  if (erro.code === "EADDRINUSE") {
    console.error(`\n[MarketSync] A porta ${PORTA} já está em uso.`);
    console.error(`Feche o outro processo ou rode com outra porta: set PORTA=5191 && node servidor.js\n`);
    process.exit(1);
  }
  throw erro;
});

servidor.listen(PORTA, () => {
  console.log("");
  console.log("  MarketSync — interface atualizada");
  console.log("  ----------------------------------");
  console.log(`  Página:     http://localhost:${PORTA}`);
  console.log(`  API local:  http://${API_DESTINO.host}:${API_DESTINO.port} (repassada em /api)`);
  console.log("");
  console.log("  Deixe esta janela aberta enquanto usa o sistema.");
  console.log("");
});
