/**
 * worker.js — Cloudflare Worker Anycast para Bancos, ISPB & Contas Pro API
 *
 * @license MIT
 * @see https://github.com/clepta2/bancos-pro
 */

import {
  buscarPorCodigo,
  buscarPorIspb,
  buscarPorCnpj,
  identificar,
  listarBancos,
  estatisticas,
  validarConta,
  gerarIban,
  validarIban,
  identificarBancoBoleto,
  validarChavePix,
  BANCOS_COM_VALIDACAO_DV,
  BANCOS_DB_GERADO_EM
} from './bancos-engine.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
  'Access-Control-Max-Age': '86400',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Ponte-Version': '3.0.0'
};

const PLANOS_CONFIG = {
  free: { nome: 'Free / Sandbox', rpm: 30, cotaDiaria: 500 },
  starter: { nome: 'Starter 86.400 (1 req/s)', rpm: 60, cotaDiaria: 86400 },
  pro: { nome: 'Pro (5 req/s)', rpm: 300, cotaDiaria: 250000 },
  business: { nome: 'Business (20 req/s)', rpm: 1200, cotaDiaria: 1000000 },
  master: { nome: 'Master Admin (Bypass)', rpm: 3000, cotaDiaria: Infinity }
};

const PREFIXOS = [
  ['master', ['bco_master_', 'pnt_master_']],
  ['business', ['bco_biz_', 'pnt_biz_']],
  ['pro', ['bco_pro_', 'pnt_pro_']],
  ['starter', ['bco_start_', 'pnt_start_']]
];

const minuteBuckets = new Map();
const dailyBuckets = new Map();
const BOOT_TIME = Date.now();

function resolverPlano(request, url) {
  const auth = request.headers.get('Authorization') || '';
  const token = (auth.startsWith('Bearer ') ? auth.slice(7) : (request.headers.get('x-api-key') || url.searchParams.get('key') || '')).trim();
  if (!token) {
    const ip = request.headers.get('cf-connecting-ip') || 'anonymous_ip';
    return { plano: 'free', keyId: `ip_${ip}`, config: PLANOS_CONFIG.free };
  }
  for (const [plano, prefixos] of PREFIXOS) {
    if (prefixos.some(p => token.startsWith(p))) return { plano, keyId: token, config: PLANOS_CONFIG[plano] };
  }
  return { plano: 'free', keyId: token, config: PLANOS_CONFIG.free };
}

function aplicarRateLimit(keyId, config) {
  const now = Date.now();
  let d = dailyBuckets.get(keyId);
  if (!d || now > d.resetAt) { d = { count: 0, resetAt: now + 86400000 }; dailyBuckets.set(keyId, d); }
  let m = minuteBuckets.get(keyId);
  if (!m || now > m.resetAt) { m = { count: 0, resetAt: now + 60000 }; minuteBuckets.set(keyId, m); }
  const isMaster = config.cotaDiaria === Infinity;
  if (!isMaster && d.count >= config.cotaDiaria) {
    return { ok: false, error: 'DAILY_LIMIT_EXCEEDED', message: `Cota diária excedida para o plano ${config.nome}.`, resetEmSegundos: Math.ceil((d.resetAt - now) / 1000) };
  }
  if (!isMaster && m.count >= config.rpm) {
    return { ok: false, error: 'RATE_LIMIT_EXCEEDED', message: `Limite de ${config.rpm} RPM excedido.`, resetEmSegundos: Math.ceil((m.resetAt - now) / 1000) };
  }
  d.count++; m.count++;
  return { ok: true, rpmRestante: Math.max(0, config.rpm - m.count) };
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS, ...extra }
  });
}

async function lerParametros(request, url) {
  const p = Object.fromEntries(url.searchParams.entries());
  if (request.method === 'POST') {
    try { Object.assign(p, await request.json()); } catch (_) { /* corpo vazio ou inválido: usa só a query */ }
  }
  return p;
}

const naoEncontrado = (tipo, valor, rh) => json({ ok: false, erro: 'INSTITUICAO_NAO_ENCONTRADA', mensagem: `Nenhuma instituição com ${tipo} "${valor}" na base do BACEN.` }, 404, rh);
const bool = v => v === true || v === 'true' || v === '1';

export default {
  async fetch(request) {
    const t0 = performance.now();
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

    const { plano, keyId, config } = resolverPlano(request, url);
    const rate = aplicarRateLimit(keyId, config);
    if (!rate.ok) return json(rate, 429, { 'Retry-After': String(rate.resetEmSegundos || 60) });

    const rh = {
      'x-bancos-plan': plano,
      'x-bancos-ratelimit-limit': String(config.rpm),
      'x-bancos-ratelimit-remaining': String(rate.rpmRestante),
      'x-bancos-edge-latency': `${Math.max(1, Math.round(performance.now() - t0))}ms`
    };

    try {
      const p = await lerParametros(request, url);

      if (path === '/' || path === '/health' || path === '/status' || path === '/api/bancos/health') {
        return json({
          ok: true,
          servico: 'Bancos, ISPB & Contas Pro API',
          versao: '1.0.0',
          borda: 'Cloudflare Workers Anycast (<2ms)',
          uptimeSegundos: Math.floor((Date.now() - BOOT_TIME) / 1000),
          planoAtivo: config.nome,
          baseAtualizadaEm: BANCOS_DB_GERADO_EM,
          rotas: [
            'GET /api/bancos?q=nubank&pix=true&compe=true&pagina=1&limite=50',
            'GET /api/bancos/:codigo',
            'GET /api/bancos/ispb/:ispb',
            'GET /api/bancos/cnpj/:cnpj',
            'GET /api/bancos/estatisticas',
            'GET|POST /api/bancos/conta/validar?banco=341&agencia=2545&conta=02366-1',
            'GET|POST /api/bancos/iban/gerar?banco=001&agencia=1584&conta=00210169-6',
            'GET /api/bancos/iban/validar/:iban',
            'GET /api/bancos/boleto/:linhaDigitavel'
          ]
        }, 200, rh);
      }

      if (path === '/api/bancos' || path === '/api/bancos/lista' || path === '/api/bancos/buscar') {
        return json(listarBancos({ q: p.q || p.busca, compe: bool(p.compe), pix: bool(p.pix), comCodigo: bool(p.comCodigo), tipo: p.tipo, pagina: p.pagina, limite: p.limite }), 200, { ...rh, 'Cache-Control': 'public, max-age=3600' });
      }

      if (path === '/api/bancos/estatisticas') return json(estatisticas(), 200, rh);

      if (path === '/api/bancos/pix/validar' || path === '/api/bancos/validar-pix') {
        const chave = p.chave || p.key || p.valor || '';
        return json(validarChavePix(chave), 200, rh);
      }

      if (path === '/api/bancos/conta/validar' || path === '/api/bancos/validar-conta') {
        const r = validarConta({ banco: p.banco, agencia: p.agencia, conta: p.conta });
        return json({ ...r, bancosComAlgoritmoDv: r.ok ? undefined : BANCOS_COM_VALIDACAO_DV }, r.ok ? 200 : 400, rh);
      }

      if (path === '/api/bancos/iban/gerar') {
        const r = gerarIban({ banco: p.banco, ispb: p.ispb, agencia: p.agencia, conta: p.conta, tipoConta: p.tipoConta || p.tipo || 'C', titular: p.titular || '1' });
        return json(r, r.ok ? 200 : 400, rh);
      }

      const mIban = path.match(/^\/api\/bancos\/iban\/validar(?:\/([A-Za-z0-9%\s]+))?$/i);
      if (mIban) {
        const valor = decodeURIComponent(mIban[1] || p.iban || '');
        if (!valor) return json({ ok: false, erro: 'PARAMETROS_OBRIGATORIOS', mensagem: 'Informe o IBAN.' }, 400, rh);
        return json(validarIban(valor), 200, rh);
      }

      const mBoleto = path.match(/^\/api\/bancos\/boleto(?:\/([0-9.\s%]+))?$/i);
      if (mBoleto) {
        const r = identificarBancoBoleto(decodeURIComponent(mBoleto[1] || p.linha || p.codigo || ''));
        return json(r, r.ok ? 200 : 400, rh);
      }

      const mIspb = path.match(/^\/api\/bancos\/ispb\/(\d{1,8})$/i);
      if (mIspb) {
        const b = buscarPorIspb(mIspb[1]);
        return b ? json({ ok: true, ...b }, 200, rh) : naoEncontrado('ISPB', mIspb[1], rh);
      }

      const mCnpj = path.match(/^\/api\/bancos\/cnpj\/([0-9.\-\/%]+)$/i);
      if (mCnpj) {
        const v = decodeURIComponent(mCnpj[1]);
        const b = buscarPorCnpj(v);
        return b ? json({ ok: true, ...b }, 200, rh) : naoEncontrado('CNPJ', v, rh);
      }

      const mCod = path.match(/^\/api\/bancos\/(\d{1,14})$/i);
      if (mCod) {
        const b = mCod[1].length <= 3 ? buscarPorCodigo(mCod[1]) : identificar(mCod[1]);
        return b ? json({ ok: true, ...b }, 200, { ...rh, 'Cache-Control': 'public, max-age=3600' }) : naoEncontrado('código', mCod[1], rh);
      }

      return json({ ok: false, erro: 'ROTA_NAO_ENCONTRADA', mensagem: `Rota "${path}" não existe. Consulte GET /health.` }, 404, rh);
    } catch (e) {
      return json({ ok: false, erro: 'ERRO_INTERNO', mensagem: 'Falha inesperada ao processar a requisição.' }, 500, rh);
    }
  }
};
