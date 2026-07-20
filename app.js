// ============================================================================
// PANELA DE BARRO — front-end
// Nenhum dado sensivel (access token) existe aqui. Este arquivo so conversa
// com o NOSSO backend (/api/...), que e quem fala com o Mercado Pago.
// ============================================================================

const ICONES = {
  pote: `<svg viewBox="0 0 46 46" fill="none"><path d="M11 18h24l-2 15a6 6 0 0 1-6 5H19a6 6 0 0 1-6-5l-2-15z" fill="var(--gold)"/><rect x="9" y="13" width="28" height="6" rx="3" fill="var(--brick)"/></svg>`,
  prato: `<svg viewBox="0 0 46 46" fill="none"><circle cx="23" cy="23" r="16" fill="var(--gold)"/><circle cx="23" cy="23" r="9" fill="var(--paper)"/></svg>`,
  panela: `<svg viewBox="0 0 46 46" fill="none"><path d="M9 20h28v4c0 8-6.3 14-14 14S9 32 9 24v-4z" fill="var(--gold)"/><rect x="6" y="17" width="6" height="4" rx="2" fill="var(--brick)"/><rect x="34" y="17" width="6" height="4" rx="2" fill="var(--brick)"/></svg>`,
  folha: `<svg viewBox="0 0 46 46" fill="none"><path d="M12 34C10 20 20 9 34 9c1.5 12-9 25-22 25z" fill="var(--green)"/><path d="M13 33C22 24 27 18 33 10" stroke="var(--paper)" stroke-width="1.6" stroke-linecap="round"/></svg>`,
};

const state = {
  cardapio: [],
  carrinho: {}, // { id: qtd }
  pedidoAtual: null,
  pollTimer: null,
};

const fmtMoeda = (v) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// ----------------------------------------------------------------------------
// Carregar cardápio do backend (fonte única de preços)
// ----------------------------------------------------------------------------
async function carregarCardapio() {
  const resp = await fetch("/api/cardapio");
  state.cardapio = await resp.json();
  renderMenu();
}

function renderMenu() {
  const grid = document.getElementById("menu-grid");
  grid.innerHTML = state.cardapio
    .map((prato) => {
      const qtd = state.carrinho[prato.id] || 0;
      return `
      <article class="dish">
        <div class="dish__icon">${ICONES[prato.icone] || ICONES.prato}</div>
        <h3>${prato.nome}</h3>
        <p>${prato.descricao}</p>
        <div class="dish__foot">
          <span class="dish__price">${fmtMoeda(prato.preco)}</span>
          <div class="stepper">
            <button data-acao="menos" data-id="${prato.id}" aria-label="Diminuir">–</button>
            <span>${qtd}</span>
            <button data-acao="mais" data-id="${prato.id}" aria-label="Aumentar">+</button>
          </div>
        </div>
      </article>`;
    })
    .join("");
}

document.getElementById("menu-grid").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-id]");
  if (!btn) return;
  const { id, acao } = btn.dataset;
  const atual = state.carrinho[id] || 0;
  const novo = acao === "mais" ? Math.min(20, atual + 1) : Math.max(0, atual - 1);
  if (novo === 0) delete state.carrinho[id];
  else state.carrinho[id] = novo;
  renderMenu();
  renderCarrinho();
});

// ----------------------------------------------------------------------------
// Carrinho
// ----------------------------------------------------------------------------
function itensCarrinho() {
  return Object.entries(state.carrinho).map(([id, qtd]) => {
    const prato = state.cardapio.find((p) => p.id === id);
    return { id, qtd, prato };
  });
}

function totalCarrinho() {
  return itensCarrinho().reduce((soma, i) => soma + i.prato.preco * i.qtd, 0);
}

function renderCarrinho() {
  const itens = itensCarrinho();
  const contagem = itens.reduce((s, i) => s + i.qtd, 0);
  document.getElementById("cart-count").textContent = contagem;

  const lista = document.getElementById("cart-items");
  lista.innerHTML = itens.length
    ? itens
        .map(
          (i) => `
        <div class="cart-line">
          <div>
            <div class="cart-line__name">${i.qtd}x ${i.prato.nome}</div>
            <div class="cart-line__price">${fmtMoeda(i.prato.preco * i.qtd)}</div>
          </div>
          <button class="icon-btn" data-remover="${i.id}" aria-label="Remover">✕</button>
        </div>`
        )
        .join("")
    : `<p class="cart-empty">Seu carrinho está vazio.<br>Escolha um prato no cardápio 🍲</p>`;

  document.getElementById("cart-total").textContent = fmtMoeda(totalCarrinho());
  document.getElementById("cart-checkout").disabled = itens.length === 0;
}

document.getElementById("cart-items").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-remover]");
  if (!btn) return;
  delete state.carrinho[btn.dataset.remover];
  renderMenu();
  renderCarrinho();
});

const drawer = document.getElementById("cart-drawer");
document.getElementById("cart-fab").addEventListener("click", () => (drawer.hidden = false));
document.getElementById("cart-close").addEventListener("click", () => (drawer.hidden = true));

// ----------------------------------------------------------------------------
// Checkout (dados do cliente)
// ----------------------------------------------------------------------------
const checkoutModal = document.getElementById("checkout-modal");
const checkoutForm = document.getElementById("checkout-form");
const checkoutError = document.getElementById("checkout-error");

document.getElementById("cart-checkout").addEventListener("click", () => {
  drawer.hidden = true;
  checkoutError.hidden = true;
  checkoutModal.hidden = false;
});

document.querySelectorAll("[data-close]").forEach((el) =>
  el.addEventListener("click", () => {
    document.getElementById("checkout-modal").hidden = true;
    document.getElementById("pix-modal").hidden = true;
    pararPolling();
  })
);

checkoutForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  checkoutError.hidden = true;

  const dados = Object.fromEntries(new FormData(checkoutForm).entries());
  const btn = checkoutForm.querySelector("button[type=submit]");
  btn.disabled = true;
  btn.textContent = "Gerando PIX…";

  try {
    const resp = await fetch("/api/pedido", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        itens: itensCarrinho().map((i) => ({ id: i.id, qtd: i.qtd })),
        cliente: dados,
      }),
    });
    const resultado = await resp.json();

    if (!resp.ok) throw new Error(resultado.erro || "Não foi possível gerar o PIX.");

    state.pedidoAtual = resultado;
    checkoutModal.hidden = true;
    abrirTelaPix(resultado);
  } catch (erro) {
    checkoutError.textContent = erro.message;
    checkoutError.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = "Gerar PIX para pagar";
  }
});

// ----------------------------------------------------------------------------
// Tela de pagamento PIX (comanda) + confirmação automática
// ----------------------------------------------------------------------------
const pixModal = document.getElementById("pix-modal");

function abrirTelaPix(pedido) {
  document.getElementById("pix-pending").hidden = false;
  document.getElementById("pix-success").hidden = true;

  document.getElementById("pix-total").textContent = fmtMoeda(pedido.total);
  document.getElementById("pix-qr").src = `data:image/png;base64,${pedido.qrCodeBase64}`;
  document.getElementById("pix-copiacola").value = pedido.copiaCola;

  pixModal.hidden = false;
  iniciarPolling(pedido.pedidoId);
}

document.getElementById("pix-copy").addEventListener("click", async () => {
  const input = document.getElementById("pix-copiacola");
  input.select();
  await navigator.clipboard.writeText(input.value);
  const btn = document.getElementById("pix-copy");
  const original = btn.textContent;
  btn.textContent = "Copiado!";
  setTimeout(() => (btn.textContent = original), 1500);
});

function iniciarPolling(pedidoId) {
  pararPolling();
  state.pollTimer = setInterval(async () => {
    try {
      const resp = await fetch(`/api/pedido/${pedidoId}/status`);
      const dados = await resp.json();
      if (dados.status === "approved") {
        pararPolling();
        mostrarSucesso(pedidoId);
      }
    } catch (erro) {
      console.error("Erro ao checar status:", erro);
    }
  }, 3000);
}

function pararPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = null;
}

function mostrarSucesso(pedidoId) {
  document.getElementById("pix-pending").hidden = true;
  document.getElementById("pix-success").hidden = false;
  document.getElementById("pix-order-id").textContent = `#${pedidoId}`;

  // esvazia o carrinho, o pedido foi concluído
  state.carrinho = {};
  renderMenu();
  renderCarrinho();
}

// ----------------------------------------------------------------------------
carregarCardapio();
renderCarrinho();
