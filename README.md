# Panela de Barro — site de vendas com PIX automático (Mercado Pago)

Site completo de venda de comida: cardápio, carrinho, checkout e cobrança
PIX gerada automaticamente pela API do Mercado Pago. O pedido é confirmado
sozinho assim que o cliente paga — sem precisar de comprovante.

## Estrutura

```
panela-de-barro/
├── server.js           # backend Express: fala com a API do Mercado Pago
├── package.json
├── .env.example         # copie para .env e preencha
└── public/
    ├── index.html
    ├── styles.css
    ├── app.js
    └── cardapio.json    # pratos e preços (fonte única de verdade)
```

## 1. Pré-requisitos

- Node.js 18 ou superior
- Uma conta no [Mercado Pago](https://www.mercadopago.com.br) com o **Access
  Token** das suas credenciais (Seu negócio → Configurações →
  **Credenciais de produção**, ou **de teste** para simular pagamentos).

## 2. Instalar

```bash
cd panela-de-barro
npm install
cp .env.example .env
```

Abra o `.env` e preencha:

```
MP_ACCESS_TOKEN=APP_USR-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
PUBLIC_URL=https://seu-dominio-ou-tunel.com
PORT=3000
```

> ⚠️ **O Access Token é secreto.** Ele fica só no `.env`, nunca no código do
> front-end (`public/`), nunca em um repositório público.

## 3. Rodar localmente

```bash
npm start
```

Acesse `http://localhost:3000`.

### Testando o PIX sem tomar dinheiro de verdade

Use um **Access Token de teste** (começa com `TEST-`) e os
[usuários de teste do Mercado Pago](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/additional-content/test-cards)
para simular a aprovação do pagamento pelo próprio painel de developers, sem
precisar pagar de verdade.

## 4. Confirmação automática (webhook)

Para os pedidos serem confirmados **sozinhos**, o Mercado Pago precisa
conseguir chamar o seu servidor pela internet (não adianta ser só
`localhost`). Duas formas:

- **Em desenvolvimento:** use um túnel como o [ngrok](https://ngrok.com)
  (`ngrok http 3000`) e coloque a URL https gerada em `PUBLIC_URL` no `.env`.
- **Em produção:** hospede em qualquer serviço com HTTPS (Railway, Render,
  Fly.io, uma VPS com Nginx + certificado, etc.) e coloque a URL final do seu
  domínio em `PUBLIC_URL`.

O endpoint que recebe o aviso automático é `/api/webhook/mercadopago` — já
está implementado no `server.js`. Mesmo sem o webhook configurado, o site
continua funcionando: o front-end confere o status a cada 3 segundos
(`/api/pedido/:id/status`) como reforço, mas o webhook é o que deixa a
confirmação instantânea e é o recomendado pelo Mercado Pago.

## 5. Editar o cardápio

Edite `public/cardapio.json` — cada prato tem `id`, `nome`, `descricao`,
`preco` e `icone` (`pote`, `prato`, `panela` ou `folha`). O backend sempre lê
o preço deste arquivo, então o cliente nunca consegue alterar valores pelo
navegador.

## 6. Colocar no ar

Qualquer host Node.js funciona (Railway, Render, Fly.io, VPS própria). Passos
gerais:

1. Suba o projeto (sem o `.env` — configure as variáveis de ambiente
   `MP_ACCESS_TOKEN`, `PUBLIC_URL` e `PORT` direto no painel do host).
2. Rode `npm install` e depois `npm start`.
3. No painel do Mercado Pago, nada extra a configurar: a `notification_url`
   é enviada automaticamente em cada cobrança criada pelo `server.js`.

## Próximos passos sugeridos

- Trocar o armazenamento em memória (`Map` no `server.js`) por um banco de
  dados de verdade (Postgres, SQLite, etc.) — hoje os pedidos somem se o
  servidor reiniciar.
- Enviar uma notificação (WhatsApp, e-mail, painel da cozinha) quando o
  webhook confirmar o pagamento — já tem um comentário `// AQUI é o lugar de`
  marcando onde entrar com isso no `server.js`.
- Adicionar HTTPS/domínio próprio antes de usar o Access Token de produção.
