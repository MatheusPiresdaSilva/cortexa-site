// Cloudflare Worker da Cora: ponte segura entre o chat do site e a API do Claude.
// A chave da API fica guardada como segredo no Cloudflare (ANTHROPIC_API_KEY), nunca no site.

// Sites que podem usar este Worker. Adicione aqui o seu domínio próprio, se tiver um.
const ALLOWED_ORIGINS = [
  'https://matheuspiresdasilva.github.io',
];

const MODEL = 'claude-opus-5-5';
const MAX_HISTORY = 20;
const MAX_CHARS = 2000;

const SYSTEM = `Você é a Cora, assistente virtual do site da Cortexa, uma empresa brasileira de inteligência artificial.
Responda sempre em português do Brasil, com frases curtas e tom simpático e profissional. Use no máximo 120 palavras.
Formatação: o chat mostra apenas **negrito** e quebras de linha. Não use títulos, tabelas, links ou blocos de código. Para listas, comece cada linha com "• ".

O que você sabe sobre a Cortexa:
- Produtos: Atlas 3 (modelo de linguagem em português, contexto de 1 milhão de tokens, 182 ms até o primeiro token, R$ 0,80 por milhão de tokens); Pulse (agentes que executam tarefas em ERP, CRM, planilhas e WhatsApp); Vision (visão computacional para inspeção, documentos e estoque); Shield (governança e LGPD: mascara dados pessoais, trilha de auditoria); Forge (treino de modelos próprios, pesos do cliente, só no Enterprise).
- Planos: Starter R$ 490/mês (Atlas 3 mini, 20M tokens, 3 agentes, suporte por e-mail, 14 dias grátis sem cartão); Growth R$ 2.900/mês (Atlas 3 completo, 250M tokens, agentes ilimitados, Vision, Shield com relatórios LGPD, suporte em 2 horas); Enterprise sob medida (on-premise, Forge, SLA de 99,99%, conformidade BACEN e ANS). Plano anual tem 20% de desconto.
- Implantação em seis semanas: diagnóstico (semana 1), piloto (semanas 2 a 4), escala (semanas 5 e 6).
- Dados ficam em São Paulo e Fortaleza. Nunca são usados para treinar modelos de outros clientes.
- Integrações: SAP, TOTVS, Salesforce, HubSpot, WhatsApp Business, Google Workspace, Microsoft 365, API REST e SDKs em Python e TypeScript.

Regras:
- Fale só sobre a Cortexa, IA para empresas e assuntos ligados a isso. Para outros assuntos, diga com gentileza que só pode ajudar com a Cortexa.
- Não invente preços, prazos, clientes ou recursos que não estão acima. Se não souber, diga que um especialista pode responder.
- Quando a pessoa quiser contratar, pedir proposta ou falar com alguém, sugira escrever "falar com especialista" no chat.
- Nunca peça senhas, dados de cartão ou documentos pessoais.`;

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const allowed = ALLOWED_ORIGINS.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
      'Vary': 'Origin',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') return new Response('Use POST', { status: 405, headers: cors });
    if (!allowed) return new Response('Origem não permitida', { status: 403, headers: cors });
    if (!env.ANTHROPIC_API_KEY) return new Response('Falta o segredo ANTHROPIC_API_KEY', { status: 500, headers: cors });

    let body;
    try { body = await request.json(); } catch { return new Response('JSON inválido', { status: 400, headers: cors }); }
    const messages = sanitize(body && body.messages);
    if (!messages.length) return new Response('Nenhuma mensagem do usuário', { status: 400, headers: cors });

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'server-side-fallback-2026-07-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM,
        messages,
        output_config: { effort: 'low' },
        fallbacks: 'default',
        stream: true,
      }),
    });

    if (!upstream.ok || !upstream.body) {
      console.log('Erro da API do Claude', upstream.status, await upstream.text());
      return new Response('Falha ao consultar a IA', { status: 502, headers: cors });
    }

    // Converte o stream SSE da API em texto puro, só com os trechos da resposta.
    const { readable, writable } = new TransformStream();
    ctx.waitUntil(pipeText(upstream.body, writable));
    return new Response(readable, {
      headers: { ...cors, 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  },
};

// Mantém só mensagens válidas, alterna user/assistant e garante que a conversa começa e termina com o usuário.
function sanitize(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const m of list.slice(-MAX_HISTORY)) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') continue;
    const content = m.content.slice(0, MAX_CHARS).trim();
    if (!content) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += '\n\n' + content;
    else out.push({ role: m.role, content });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  while (out.length && out[out.length - 1].role !== 'user') out.pop();
  return out;
}

async function pipeText(source, writable) {
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const reader = source.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) !== -1) {
        const event = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const line = event.split('\n').find(l => l.startsWith('data: '));
        if (!line) continue;
        let data;
        try { data = JSON.parse(line.slice(6)); } catch { continue; }
        if (data.type === 'content_block_delta' && data.delta && data.delta.type === 'text_delta') {
          await writer.write(enc.encode(data.delta.text));
        } else if (data.type === 'message_delta' && data.delta && data.delta.stop_reason === 'refusal') {
          await writer.write(enc.encode('\n\nNão consigo ajudar com esse pedido. Posso falar sobre os produtos e serviços da Cortexa.'));
        } else if (data.type === 'error') {
          console.log('Erro no stream', JSON.stringify(data));
          await writer.write(enc.encode('\n\nA IA ficou indisponível agora. Tente de novo em instantes.'));
        }
      }
    }
  } catch (e) {
    console.log('Falha ao ler o stream', e);
  } finally {
    await writer.close();
  }
}
