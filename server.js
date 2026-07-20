// ============================================================================
// PANELA DE BARRO — servidor de pedidos + PIX automatico (Mercado Pago)
// ============================================================================
// Zero dependencias externas: so usa modulos nativos do Node (>=18), entao
// nao precisa nem de "npm install" pra rodar.
//
// Este servidor:
//  1) Serve o site (pasta /public)
//  2) Recebe o pedido do carrinho e cria uma cobranca PIX na API do Mercado
//     Pago, devolvendo o QR Code e o codigo "copia e cola" pro cliente pagar
//  3) Recebe o webhook do Mercado Pago quando o pagamento e aprovado e marca
//     o pedido como pago automaticamente (sem ninguem apertar botao nenhum)
//  4) Expoe uma rota de status para o front-end consultar (fallback caso o
//     webhook demore, o que e normal existir como reforco)
//
// O ACCESS TOKEN so existe aqui no servidor (via .env). Ele nunca e enviado
// para o navegador do cliente — isso e essencial para a seguranca da loja.
// ============================================================================

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

carregarEnv();

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const PUBLIC_URL = process.env.PUBLIC_URL || "";
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

if (!MP_ACCESS_TOKEN) {
  console.warn(
    "\n[AVISO] MP_ACCESS_TOKEN nao foi definido no .env — as cobrancas PIX vao falhar ate voce configurar.\n"
  );
}

// ----------------------------------------------------------------------------
// Le o arquivo .env manualmente (sem depender do pacote "dotenv")
// ----------------------------------------------------------------------------
function carregarEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  const conteudo = fs.readFileSync(envPath, "utf8");
  for (const linha of conteudo.split("\n")) {
    const l = linha.trim();
    if (!l || l.startsWith("#")) continue;
    const idx = l.indexOf("=");
    if (idx === -1) continue;
    const chave = l.slice(0, idx).trim();
    let valor = l.slice(idx + 1).trim();
    valor = valor.replace(/^["']|["']$/g, "");
    if (!(chave in process.env)) process.env[chave] = valor;
  }
}

// ----------------------------------------------------------------------------
// "Banco de dados" em memoria, so para este exemplo funcionar de ponta a
// ponta sem depender de infraestrutura extra. Em producao, troque por um
// banco real (Postgres, SQLite, etc).
// ----------------------------------------------------------------------------
const CARDAPIO = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, "cardapio.json"), "utf8"));
const pedidos = new Map(); // paymentId (string) -> pedido

function calcularTotal(itens) {
  let total = 0;
  for (const item of itens) {
    const prato = CARDAPIO.find((p) => p.id === item.id);
    if (!prato) continue;
    const qtd = Math.max(1, Math.min(20, Number(item.qtd) || 1));
    total += prato.preco * qtd;
  }
  return Math.round(total * 100) / 100;
}

function montarDescricao(itens) {
  return itens
    .map((item) => {
      const prato = CARDAPIO.find((p) => p.id === item.id);
      return prato ? `${item.qtd}x ${prato.nome}` : null;
    })
    .filter(Boolean)
    .join(", ");
}

// ----------------------------------------------------------------------------
// Chamadas à API do Mercado Pago
// ----------------------------------------------------------------------------
async function criarPagamentoPix({ total, descricao, cliente }) {
  const cpfLimpo = String(cliente.cpf).replace(/\D/g, "");
  const [primeiroNome, ...resto] = String(cliente.nome).trim().split(" ");
  const sobrenome = resto.join(" ") || primeiroNome;

  const corpo = {
    transaction_amount: total,
    description: descricao.slice(0, 250),
    payment_method_id: "pix",
    payer: {
      email: cliente.email,
      first_name: primeiroNome,
      last_name: sobrenome,
      identification: { type: "CPF", number: cpfLimpo },
    },
  };

  if (PUBLIC_URL) {
    corpo.notification_url = `${PUBLIC_URL}/api/webhook/mercadopago`;
  }

  const resposta = await fetch("https://api.mercadopago.com/v1/payments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
      "X-Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(corpo),
  });

  const dados = await resposta.json();
  return { ok: resposta.ok, dados };
}

async function consultarPagamento(paymentId) {
  const resposta = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
  });
  if (!resposta.ok) return null;
  return resposta.json();
}

// ----------------------------------------------------------------------------
// Handlers das rotas da API
// ----------------------------------------------------------------------------
async function handlePostPedido(req, res) {
  const body = await lerJson(req);
  const { itens, cliente } = body || {};

  if (!Array.isArray(itens) || itens.length === 0) {
    return responderJson(res, 400, { erro: "Carrinho vazio." });
  }
  if (!cliente || !cliente.nome || !cliente.email || !cliente.cpf) {
    return responderJson(res, 400, {
      erro: "Preencha nome, e-mail e CPF para pagar com PIX.",
    });
  }

  const total = calcularTotal(itens);
  if (total <= 0) return responderJson(res, 400, { erro: "Itens inválidos." });

  if (!MP_ACCESS_TOKEN) {
    return responderJson(res, 500, {
      erro: "Loja ainda não configurada: defina MP_ACCESS_TOKEN no arquivo .env.",
    });
  }

  try {
    const descricao = `Panela de Barro - ${montarDescricao(itens)}`;
    const { ok, dados } = await criarPagamentoPix({ total, descricao, cliente });

    if (!ok) {
      console.error("Erro Mercado Pago:", dados);
      return responderJson(res, 502, {
        erro: dados?.message || "Não foi possível gerar o PIX agora. Tente novamente.",
      });
    }

    const pix = dados.point_of_interaction?.transaction_data;
    if (!pix?.qr_code) {
      return responderJson(res, 502, { erro: "O Mercado Pago não retornou o QR Code do PIX." });
    }

    const pedido = {
      id: String(dados.id),
      status: dados.status,
      total,
      itens,
      cliente: { nome: cliente.nome, email: cliente.email },
      criadoEm: new Date().toISOString(),
      qrCodeBase64: pix.qr_code_base64,
      copiaCola: pix.qr_code,
      expiraEm: dados.date_of_expiration || null,
    };
    pedidos.set(pedido.id, pedido);

    responderJson(res, 200, {
      pedidoId: pedido.id,
      status: pedido.status,
      total: pedido.total,
      qrCodeBase64: pedido.qrCodeBase64,
      copiaCola: pedido.copiaCola,
      expiraEm: pedido.expiraEm,
    });
  } catch (erro) {
    console.error("Erro ao criar pedido:", erro);
    responderJson(res, 500, { erro: "Erro interno ao gerar o pagamento." });
  }
}

async function handleGetStatus(req, res, pedidoId) {
  const pedido = pedidos.get(pedidoId);
  if (!pedido) return responderJson(res, 404, { erro: "Pedido não encontrado." });

  if (pedido.status === "pending" || pedido.status === "in_process") {
    try {
      const atualizado = await consultarPagamento(pedido.id);
      if (atualizado) {
        pedido.status = atualizado.status;
        pedidos.set(pedido.id, pedido);
      }
    } catch (erro) {
      console.error("Erro ao consultar status:", erro);
    }
  }

  responderJson(res, 200, { pedidoId: pedido.id, status: pedido.status, total: pedido.total });
}

async function handleWebhook(req, res) {
  const body = await lerJson(req).catch(() => ({}));
  res.writeHead(200).end(); // responde logo, processa depois

  try {
    const paymentId = body?.data?.id;
    if (!paymentId) return;

    const pagamento = await consultarPagamento(paymentId);
    if (!pagamento) return;

    const pedido = pedidos.get(String(pagamento.id));
    if (!pedido) return;

    pedido.status = pagamento.status;
    pedidos.set(pedido.id, pedido);

    if (pagamento.status === "approved") {
      console.log(`✅ Pedido ${pedido.id} pago automaticamente via PIX! Total: R$ ${pedido.total}`);
      // AQUI é o lugar de: enviar pro sistema da cozinha, notificar por
      // WhatsApp/e-mail, atualizar estoque, etc.
    }
  } catch (erro) {
    console.error("Erro no webhook:", erro);
  }
}

// ----------------------------------------------------------------------------
// Utilidades HTTP (sem framework)
// ----------------------------------------------------------------------------
function lerJson(req) {
  return new Promise((resolve, reject) => {
    let corpo = "";
    req.on("data", (chunk) => (corpo += chunk));
    req.on("end", () => {
      try {
        resolve(corpo ? JSON.parse(corpo) : {});
      } catch (erro) {
        reject(erro);
      }
    });
    req.on("error", reject);
  });
}

function responderJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function servirArquivoEstatico(req, res) {
  let rota = decodeURIComponent(req.url.split("?")[0]);
  if (rota === "/") rota = "/index.html";

  const caminho = path.normalize(path.join(PUBLIC_DIR, rota));
  if (!caminho.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end("Proibido");
    return;
  }

  fs.readFile(caminho, (erro, conteudo) => {
    if (erro) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Página não encontrada.");
      return;
    }
    const ext = path.extname(caminho);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(conteudo);
  });
}

// ----------------------------------------------------------------------------
// Roteador principal
// ----------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  try {
    const rota = req.url.split("?")[0];

    if (req.method === "GET" && rota === "/api/cardapio") {
      return responderJson(res, 200, CARDAPIO);
    }
    if (req.method === "POST" && rota === "/api/pedido") {
      return await handlePostPedido(req, res);
    }
    const matchStatus = rota.match(/^\/api\/pedido\/([^/]+)\/status$/);
    if (req.method === "GET" && matchStatus) {
      return await handleGetStatus(req, res, matchStatus[1]);
    }
    if (req.method === "POST" && rota === "/api/webhook/mercadopago") {
      return await handleWebhook(req, res);
    }
    if (req.method === "GET") {
      return servirArquivoEstatico(req, res);
    }

    res.writeHead(404).end("Não encontrado");
  } catch (erro) {
    console.error("Erro inesperado:", erro);
    responderJson(res, 500, { erro: "Erro interno no servidor." });
  }
});

server.listen(PORT, () => {
  console.log(`🍲 Panela de Barro rodando em http://localhost:${PORT}`);
});
