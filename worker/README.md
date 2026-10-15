# Ligar a IA de verdade na Cora

Hoje a Cora responde no **modo demo**, com respostas programadas. Para ela conversar com o Claude de verdade, você precisa de um pequeno servidor que guarde a sua chave da API em segredo. Este Worker do Cloudflare faz isso de graça.

A chave **nunca** deve ir no `index.html`. Se for, qualquer pessoa consegue copiá-la e gastar o seu crédito.

## 1. Pegue a chave da API do Claude

1. Entre em https://console.anthropic.com e crie uma conta.
2. Em **Billing**, adicione créditos e defina um **limite de gastos mensal** (por exemplo, US$ 10).
3. Em **API Keys**, clique em **Create Key** e copie a chave (começa com `sk-ant-`).

## 2. Crie o Worker no Cloudflare

1. Entre em https://dash.cloudflare.com e crie uma conta grátis.
2. Vá em **Workers & Pages** > **Create** > **Create Worker**, dê o nome `cora-chat` e clique em **Deploy**.
3. Clique em **Edit code**, apague o código de exemplo, cole todo o conteúdo de `worker.js` e clique em **Deploy**.
4. Volte ao Worker, abra **Settings** > **Variables and Secrets** > **Add**:
   - Type: **Secret**
   - Name: `ANTHROPIC_API_KEY`
   - Value: a chave que você copiou
5. Copie a URL do Worker, algo como `https://cora-chat.seu-usuario.workers.dev`.

## 3. Ligue no site

No `index.html`, procure esta linha e cole a URL do Worker entre as aspas:

```js
const CORA_ENDPOINT = '';
```

Depois de publicar, o selo no topo do chat muda de **modo demo** para **IA ao vivo**.

## Custos e ajustes

- O Worker usa o modelo `claude-opus-5-5` com esforço baixo, para respostas rápidas. Para gastar menos, troque `MODEL` por `claude-haiku-5-5`.
- A calculadora de economia e a captura de contato continuam funcionando localmente, sem gastar nada.
- Se a IA falhar, a Cora volta sozinha para as respostas do modo demo.
- Só os endereços listados em `ALLOWED_ORIGINS` podem usar o Worker. Se você ligar um domínio próprio, adicione ele lá.
