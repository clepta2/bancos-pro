/**
 * bancos-engine.js — Motor de Instituições Financeiras do Brasil (BACEN STR + Pix),
 * validação de dígito verificador de agência/conta (BB, Itaú, Bradesco, Santander, Caixa),
 * geração/validação de IBAN brasileiro (ISO 13616) e identificação do banco emissor de boletos.
 *
 * @license MIT
 * @see https://github.com/clepta2/bancos-pro
 */

import { BANCOS_DB, BANCOS_DB_GERADO_EM } from './bancos-db.js';

export { BANCOS_DB_GERADO_EM };

const somenteDigitos = s => String(s ?? '').replace(/\D/g, '');
const semAcento = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function expandir(b) {
  if (!b) return null;
  return {
    codigo: b.c,
    ispb: b.i,
    cnpj: b.cnpj || null,
    nomeReduzido: b.n,
    nomeExtenso: b.e,
    tipoInstituicao: b.t || null,
    participaCompe: !!b.cp,
    acessoPrincipal: b.ap,
    inicioOperacaoStr: b.io,
    pix: b.px ? {
      status: b.px.st,
      participacaoSpi: b.px.spi,
      tipoParticipacao: b.px.tp,
      modalidade: b.px.md,
      iniciacaoPagamento: !!b.px.it,
      saqueETroco: !!b.px.fss,
      ...(b.px.etapa ? { etapaAdesao: b.px.etapa } : {})
    } : null,
    validacaoDvConta: VALIDADORES[b.c] ? VALIDADORES[b.c].nome : null
  };
}

const porCodigo = new Map();
const porIspb = new Map();
const porCnpj = new Map();
for (const b of BANCOS_DB) {
  if (b.c && !porCodigo.has(b.c)) porCodigo.set(b.c, b);
  porIspb.set(b.i, b);
  if (b.cnpj) porCnpj.set(b.cnpj, b);
}

// Nomes comerciais populares que não aparecem no nome oficial registrado no BACEN
const APELIDOS = {
  '260': 'nubank nu', '077': 'inter', '336': 'c6 bank', '380': 'picpay', '323': 'mercado pago mercadopago',
  '290': 'pagseguro pagbank', '212': 'original', '756': 'sicoob', '748': 'sicredi', '208': 'btg',
  '102': 'xp', '422': 'safra', '041': 'banrisul', '197': 'stone', '218': 'bs2', '623': 'pan',
  '536': 'neon', '403': 'cora', '332': 'acesso bank', '001': 'bb banco do brasil', '104': 'caixa cef',
  '033': 'santander', '341': 'itau', '237': 'bradesco', '070': 'brb', '004': 'bnb', '037': 'banpara',
  '021': 'banestes', '047': 'banese', '121': 'agibank', '069': 'crefisa', '413': 'bv votorantim',
  '085': 'ailos', '133': 'cresol', '136': 'unicred'
};
const apelidoDe = b => (b.c && APELIDOS[b.c]) || '';

export function buscarPorCodigo(codigo) {
  const c = somenteDigitos(codigo);
  if (!c || c.length > 3) return null;
  return expandir(porCodigo.get(c.padStart(3, '0')));
}

export function buscarPorIspb(ispb) {
  const i = somenteDigitos(ispb);
  if (!i || i.length > 8) return null;
  return expandir(porIspb.get(i.padStart(8, '0')));
}

export function buscarPorCnpj(cnpj) {
  return expandir(porCnpj.get(somenteDigitos(cnpj).padStart(14, '0')));
}

/** Resolve automaticamente: 1-3 dígitos = COMPE, 8 dígitos = ISPB, 14 dígitos = CNPJ. */
export function identificar(termo) {
  const d = somenteDigitos(termo);
  if (d && d === String(termo).replace(/[.\-\/\s]/g, '')) {
    if (d.length <= 3) return buscarPorCodigo(d);
    if (d.length === 8) return buscarPorIspb(d);
    if (d.length === 14) return buscarPorCnpj(d);
  }
  return null;
}

/**
 * Lista/busca instituições.
 * @param {{ q?: string, compe?: boolean, pix?: boolean, comCodigo?: boolean, tipo?: string, pagina?: number, limite?: number }} f
 */
export function listarBancos(f = {}) {
  const q = semAcento(f.q || '').trim();
  const tipo = semAcento(f.tipo || '').trim();
  const termos = q.split(/\s+/).filter(Boolean);
  let res = BANCOS_DB.filter(b => {
    if (f.compe && !b.cp) return false;
    if (f.pix && b.px?.st !== 'ATIVO') return false;
    if (f.comCodigo && !b.c) return false;
    if (tipo && !semAcento(b.t).includes(tipo)) return false;
    if (termos.length) {
      const alvo = semAcento(`${b.n} ${b.e} ${apelidoDe(b)} ${b.c || ''} ${b.i} ${b.cnpj || ''}`);
      return termos.every(t => alvo.includes(t));
    }
    return true;
  });
  if (q) {
    const exato = b => (b.c === q.padStart(3, '0') || semAcento(b.n).startsWith(q) || apelidoDe(b).split(' ').includes(q) ? 0 : 1);
    res = res.slice().sort((a, b) => exato(a) - exato(b));
  }
  const limite = Math.min(Math.max(parseInt(f.limite, 10) || 50, 1), 1100);
  const pagina = Math.max(parseInt(f.pagina, 10) || 1, 1);
  const total = res.length;
  return {
    ok: true,
    total,
    pagina,
    limite,
    paginas: Math.max(1, Math.ceil(total / limite)),
    fonte: `Banco Central do Brasil — Participantes STR e Pix (${BANCOS_DB_GERADO_EM})`,
    bancos: res.slice((pagina - 1) * limite, pagina * limite).map(expandir)
  };
}

export function estatisticas() {
  const porTipo = {};
  for (const b of BANCOS_DB) {
    const t = b.t || 'Não informado';
    porTipo[t] = (porTipo[t] || 0) + 1;
  }
  return {
    ok: true,
    atualizadoEm: BANCOS_DB_GERADO_EM,
    totalInstituicoes: BANCOS_DB.length,
    comCodigoCompe: BANCOS_DB.filter(b => b.c).length,
    participantesCompe: BANCOS_DB.filter(b => b.cp).length,
    pixAtivos: BANCOS_DB.filter(b => b.px?.st === 'ATIVO').length,
    pixEmAdesao: BANCOS_DB.filter(b => b.px?.st === 'EM_ADESAO').length,
    pixIniciadoresPagamento: BANCOS_DB.filter(b => b.px?.it).length,
    porTipoInstituicao: Object.fromEntries(Object.entries(porTipo).sort((a, b) => b[1] - a[1]))
  };
}

// ─── Dígitos verificadores de agência e conta ───

function mod11Pesos(digitos, pesos) {
  return digitos.split('').reduce((s, d, i) => s + Number(d) * pesos[i], 0);
}

// verificacao: 'exemplo' = só conferido com contas de exemplo; 'nao_verificado' = algoritmo escrito sem conferência com fonte oficial do banco.
// Nenhum dos cinco foi comparado com a especificação oficial publicada pelo próprio banco.
const VALIDADORES = {
  '001': {
    verificacao: 'exemplo',
    nome: 'Banco do Brasil — Módulo 11 (agência 4+DV, conta 8+DV, DV "X" para 10)',
    agencia: { tamanho: 4, dv: ag => { const r = 11 - (mod11Pesos(ag, [5, 4, 3, 2]) % 11); return r === 10 ? 'X' : r === 11 ? '0' : String(r); } },
    conta: { tamanho: 8, dv: (_ag, ct) => { const r = 11 - (mod11Pesos(ct, [9, 8, 7, 6, 5, 4, 3, 2]) % 11); return r === 10 ? 'X' : r === 11 ? '0' : String(r); } }
  },
  '237': {
    verificacao: 'nao_verificado',
    nome: 'Bradesco — Módulo 11 (agência 4+DV, conta 7+DV, DV "P" para 10)',
    agencia: { tamanho: 4, dv: ag => { const r = 11 - (mod11Pesos(ag, [5, 4, 3, 2]) % 11); return r === 10 ? 'P' : r === 11 ? '0' : String(r); } },
    conta: { tamanho: 7, dv: (_ag, ct) => { const r = mod11Pesos(ct, [2, 7, 6, 5, 4, 3, 2]) % 11; return r === 0 ? '0' : r === 1 ? 'P' : String(11 - r); } }
  },
  '341': {
    verificacao: 'exemplo',
    nome: 'Itaú — Módulo 10 sobre agência (4) + conta (5)',
    agencia: { tamanho: 4, dv: null },
    conta: { tamanho: 5, dv: (ag, ct) => {
      const soma = (ag + ct).split('').reduce((s, d, i) => { const p = Number(d) * (i % 2 === 0 ? 2 : 1); return s + Math.floor(p / 10) + (p % 10); }, 0);
      return String((10 - (soma % 10)) % 10);
    } }
  },
  '033': {
    verificacao: 'nao_verificado',
    nome: 'Santander — Módulo 10 ponderado sobre agência (4) + conta (8)',
    agencia: { tamanho: 4, dv: null },
    conta: { tamanho: 8, dv: (ag, ct) => {
      const pesos = [9, 7, 3, 1, 9, 7, 1, 3, 1, 9, 7, 3];
      const soma = (ag + ct).split('').reduce((s, d, i) => s + ((Number(d) * pesos[i]) % 10), 0);
      return String((10 - (soma % 10)) % 10);
    } }
  },
  '104': {
    verificacao: 'nao_verificado',
    nome: 'Caixa Econômica Federal — Módulo 11 sobre agência (4) + operação (3) + conta (8)',
    agencia: { tamanho: 4, dv: null },
    conta: { tamanho: 11, dv: (ag, ct) => {
      const r = (mod11Pesos(ag + ct, [8, 7, 6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) * 10) % 11;
      return String(r === 10 ? 0 : r);
    } }
  }
};

export const BANCOS_COM_VALIDACAO_DV = Object.fromEntries(Object.entries(VALIDADORES).map(([c, v]) => [c, `${v.nome} [${v.verificacao === 'exemplo' ? 'conferido só com contas de exemplo' : 'NÃO verificado'}]`]));

function separarDv(valor) {
  const s = String(valor ?? '').trim().toUpperCase().replace(/\s/g, '');
  const m = s.match(/^([0-9.]+)[-\/]([0-9XP])$/);
  if (m) return { numero: somenteDigitos(m[1]), dv: m[2] };
  return { numero: null, dv: null, bruto: s.replace(/[.\-]/g, '') };
}

/**
 * Valida agência e conta pelo algoritmo oficial do banco.
 * A conta pode vir como "02366-1" ou "023661" (último caractere = DV).
 */
export function validarConta({ banco, agencia, conta } = {}) {
  const codigo = somenteDigitos(banco).padStart(3, '0');
  const inst = buscarPorCodigo(codigo);
  if (!inst) return { ok: false, valido: false, erro: 'BANCO_DESCONHECIDO', mensagem: `Código de banco "${banco}" não encontrado na base do BACEN.` };
  if (!agencia || !conta) return { ok: false, valido: false, erro: 'PARAMETROS_OBRIGATORIOS', mensagem: 'Informe agência e conta.' };

  const v = VALIDADORES[codigo];
  const ag = separarDv(agencia);
  const ct = separarDv(conta);
  const agNum = ag.numero ?? (v?.agencia.dv ? ag.bruto.slice(0, -1) : ag.bruto);
  const agDv = ag.numero ? ag.dv : (v?.agencia.dv ? ag.bruto.slice(-1) : null);
  const ctNum = ct.numero ?? ct.bruto.slice(0, -1);
  const ctDv = ct.numero ? ct.dv : ct.bruto.slice(-1);

  const base = { ok: true, banco: { codigo, nome: inst.nomeReduzido, ispb: inst.ispb } };

  if (!/^\d+$/.test(agNum) || !/^\d+$/.test(ctNum)) {
    return { ...base, valido: false, motivo: 'Agência e conta devem conter apenas números (e o DV).' };
  }

  if (!v) {
    const formatoOk = agNum.length >= 1 && agNum.length <= 5 && ctNum.length >= 1 && ctNum.length <= 20 && /^[0-9X]$/i.test(ctDv || '');
    return {
      ...base,
      valido: formatoOk,
      nivelValidacao: 'FORMATO',
      motivo: formatoOk ? 'Formato aceito. Este banco não publica algoritmo de DV; só o formato foi validado.' : 'Formato de agência/conta inválido.',
      agencia: agNum,
      conta: ctNum,
      dvConta: ctDv
    };
  }

  const agPad = agNum.padStart(v.agencia.tamanho, '0');
  const ctPad = ctNum.padStart(v.conta.tamanho, '0');
  if (agPad.length !== v.agencia.tamanho || ctPad.length !== v.conta.tamanho) {
    return { ...base, valido: false, nivelValidacao: 'ALGORITMO', motivo: `Tamanho inválido: agência deve ter ${v.agencia.tamanho} dígitos e conta ${v.conta.tamanho} dígitos (sem o DV).` };
  }

  const dvAgEsperado = v.agencia.dv ? v.agencia.dv(agPad) : null;
  const dvCtEsperado = v.conta.dv(agPad, ctPad);
  const agOk = !v.agencia.dv || !agDv || agDv === dvAgEsperado || (codigo === '237' && agDv === '0' && dvAgEsperado === 'P');
  const ctOk = ctDv === dvCtEsperado || (codigo === '237' && ctDv === '0' && dvCtEsperado === 'P');

  return {
    ...base,
    valido: agOk && ctOk,
    nivelValidacao: 'ALGORITMO',
    algoritmo: v.nome,
    verificacao: v.verificacao,
    ...(v.verificacao === 'nao_verificado' ? { aviso: 'Algoritmo de DV deste banco ainda NÃO foi conferido com a especificação oficial. Um resultado válido ou inválido não é garantia; confirme com o banco.' } : { aviso: 'Algoritmo conferido apenas com contas de exemplo, não com a especificação oficial do banco. Confirme com o banco em operações financeiras.' }),
    agencia: { numero: agPad, dvInformado: agDv || null, dvEsperado: dvAgEsperado, valida: agOk },
    conta: { numero: ctPad, dvInformado: ctDv, dvEsperado: dvCtEsperado, valida: ctOk },
    formatado: `${agPad}${dvAgEsperado ? '-' + dvAgEsperado : ''} / ${ctPad}-${dvCtEsperado}`,
    motivo: agOk && ctOk ? 'Dígitos verificadores conferem.' : !agOk ? 'DV da agência não confere.' : 'DV da conta não confere.'
  };
}

// ─── IBAN brasileiro (ISO 13616): BR + 2 DV + 8 ISPB + 5 agência + 10 conta + tipo (C/P) + titular ───

function mod97(numStr) {
  let r = 0;
  for (let i = 0; i < numStr.length; i += 7) r = Number(String(r) + numStr.slice(i, i + 7)) % 97;
  return r;
}

function ibanParaNumero(s) {
  return s.replace(/[A-Z]/g, ch => String(ch.charCodeAt(0) - 55));
}

export function gerarIban({ banco, ispb, agencia, conta, tipoConta = 'C', titular = '1' } = {}) {
  let isp = somenteDigitos(ispb);
  if (!isp && banco) isp = buscarPorCodigo(banco)?.ispb || '';
  if (!isp) return { ok: false, erro: 'BANCO_DESCONHECIDO', mensagem: 'Informe "banco" (COMPE) ou "ispb" válidos.' };
  const ag = somenteDigitos(agencia);
  const ct = String(conta ?? '').toUpperCase().replace(/[^0-9X]/g, '').replace(/X/g, '0');
  const tipo = String(tipoConta).toUpperCase();
  const tit = String(titular).toUpperCase();
  if (!ag || ag.length > 5) return { ok: false, erro: 'AGENCIA_INVALIDA', mensagem: 'Agência deve ter até 5 dígitos.' };
  if (!ct || ct.length > 10) return { ok: false, erro: 'CONTA_INVALIDA', mensagem: 'Conta (com DV) deve ter até 10 dígitos.' };
  if (!/^[CP]$/.test(tipo)) return { ok: false, erro: 'TIPO_CONTA_INVALIDO', mensagem: 'tipoConta deve ser C (corrente) ou P (poupança).' };
  if (!/^[1-9A-Z]$/.test(tit)) return { ok: false, erro: 'TITULAR_INVALIDO', mensagem: 'titular deve ser 1 (primeiro titular) a 9 ou A-Z.' };

  const bban = isp.padStart(8, '0') + ag.padStart(5, '0') + ct.padStart(10, '0') + tipo + tit;
  const dv = String(98 - mod97(ibanParaNumero(bban + 'BR00'))).padStart(2, '0');
  const iban = `BR${dv}${bban}`;
  return { ok: true, iban, ibanFormatado: iban.replace(/(.{4})/g, '$1 ').trim(), ...decomporIban(iban) };
}

function decomporIban(iban) {
  const inst = buscarPorIspb(iban.slice(4, 12));
  return {
    componentes: {
      pais: 'BR',
      digitosVerificadores: iban.slice(2, 4),
      ispb: iban.slice(4, 12),
      agencia: iban.slice(12, 17),
      conta: iban.slice(17, 27),
      tipoConta: iban[27] === 'C' ? 'CORRENTE' : iban[27] === 'P' ? 'POUPANCA' : iban[27],
      titular: iban[28]
    },
    banco: inst ? { codigo: inst.codigo, nome: inst.nomeReduzido, ispb: inst.ispb } : null
  };
}

export function validarIban(valor) {
  const iban = String(valor ?? '').toUpperCase().replace(/\s/g, '');
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return { ok: true, valido: false, iban, motivo: 'Formato IBAN inválido.' };
  const rearranjado = iban.slice(4) + iban.slice(0, 4);
  const checksumOk = mod97(ibanParaNumero(rearranjado)) === 1;
  if (!iban.startsWith('BR')) return { ok: true, valido: checksumOk, iban, pais: iban.slice(0, 2), motivo: checksumOk ? 'Checksum ISO 13616 válido (IBAN estrangeiro).' : 'Checksum ISO 13616 inválido.' };
  if (iban.length !== 29) return { ok: true, valido: false, iban, motivo: 'IBAN brasileiro deve ter 29 caracteres.' };
  const dec = decomporIban(iban);
  return {
    ok: true,
    valido: checksumOk,
    iban,
    ibanFormatado: iban.replace(/(.{4})/g, '$1 ').trim(),
    motivo: checksumOk ? (dec.banco ? 'IBAN válido.' : 'Checksum válido, mas o ISPB não consta na base do BACEN.') : 'Checksum ISO 13616 inválido.',
    ...dec
  };
}

/** Identifica o banco emissor pelos 3 primeiros dígitos do código de barras ou linha digitável de boleto bancário. */
export function identificarBancoBoleto(linha) {
  const d = somenteDigitos(linha);
  if (d[0] === '8' && (d.length === 44 || d.length === 48)) return { ok: true, tipo: 'ARRECADACAO', mensagem: 'Boleto de arrecadação/convênio (concessionárias e tributos) — não identifica banco emissor.', segmento: d[1] };
  if (d.length !== 44 && d.length !== 47) return { ok: false, erro: 'BOLETO_INVALIDO', mensagem: 'Informe código de barras (44) ou linha digitável (47 bancário / 48 arrecadação).' };
  const codigo = d.slice(0, 3);
  const inst = buscarPorCodigo(codigo);
  return {
    ok: true,
    tipo: 'BANCARIO',
    codigoBanco: codigo,
    moeda: d[3] === '9' ? 'BRL' : d[3],
    banco: inst ? { codigo: inst.codigo, nome: inst.nomeReduzido, nomeExtenso: inst.nomeExtenso, ispb: inst.ispb, cnpj: inst.cnpj } : null,
    mensagem: inst ? `Boleto emitido por ${inst.nomeReduzido}.` : 'Código de banco não encontrado na base do BACEN.'
  };
}

// ─── VALIDAÇÃO OFICIAL DE CHAVES PIX (DICT / BACEN) ───

export function validarCpf(cpf) {
  const c = somenteDigitos(cpf);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += Number(c[i]) * (10 - i);
  let d1 = (soma * 10) % 11;
  if (d1 === 10) d1 = 0;
  if (d1 !== Number(c[9])) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += Number(c[i]) * (11 - i);
  let d2 = (soma * 10) % 11;
  if (d2 === 10) d2 = 0;
  return d2 === Number(c[10]);
}

export function validarCnpj(cnpj) {
  const c = somenteDigitos(cnpj);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let soma = 0;
  for (let i = 0; i < 12; i++) soma += Number(c[i]) * p1[i];
  let d1 = soma % 11 < 2 ? 0 : 11 - (soma % 11);
  if (d1 !== Number(c[12])) return false;
  const p2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  soma = 0;
  for (let i = 0; i < 13; i++) soma += Number(c[i]) * p2[i];
  let d2 = soma % 11 < 2 ? 0 : 11 - (soma % 11);
  return d2 === Number(c[13]);
}

export function validarChavePix(chaveInput) {
  const s = String(chaveInput || '').trim();
  if (!s) return { ok: false, erro: 'PARAMETRO_OBRIGATORIO', mensagem: 'Informe a chave Pix em "chave".' };

  // 1. Chave Aleatória (EVP - UUIDv4)
  const padraoEvp = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (padraoEvp.test(s)) {
    return {
      ok: true,
      valida: true,
      tipo: 'EVP_ALEATORIA',
      chave: s.toLowerCase(),
      normalizada: s.toLowerCase(),
      descricao: 'Chave Aleatória (EVP) no padrão UUIDv4'
    };
  }

  // 2. E-mail (RFC 5322 simplificado conforme DICT)
  if (s.includes('@') && /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/.test(s) && s.length <= 77) {
    return {
      ok: true,
      valida: true,
      tipo: 'EMAIL',
      chave: s,
      normalizada: s.toLowerCase(),
      descricao: 'E-mail conforme padrão RFC 5322'
    };
  }

  const digitos = somenteDigitos(s);

  // 3. Telefone internacional explícito (+...)
  if (s.startsWith('+')) {
    const e164 = '+' + digitos;
    const telValido = /^\+[1-9]\d{9,14}$/.test(e164);
    if (telValido) {
      return {
        ok: true,
        valida: true,
        tipo: 'TELEFONE',
        chave: s,
        normalizada: e164,
        descricao: 'Telefone celular no formato internacional E.164'
      };
    }
  }

  // 4. Formato de CPF (com máscara ou 11 dígitos sem +)
  if (s.includes('.') && s.includes('-') && digitos.length === 11) {
    const cpfOk = validarCpf(digitos);
    return {
      ok: true,
      valida: cpfOk,
      tipo: 'CPF',
      chave: s,
      normalizada: digitos,
      formatado: `${digitos.slice(0,3)}.${digitos.slice(3,6)}.${digitos.slice(6,9)}-${digitos.slice(9)}`,
      motivo: cpfOk ? 'CPF válido pelo algoritmo Módulo 11 da Receita Federal.' : 'Dígitos verificadores do CPF inválidos.'
    };
  }

  // 5. Formato de CNPJ (com máscara ou 14 dígitos)
  if (digitos.length === 14) {
    const cnpjOk = validarCnpj(digitos);
    return {
      ok: true,
      valida: cnpjOk,
      tipo: 'CNPJ',
      chave: s,
      normalizada: digitos,
      formatado: `${digitos.slice(0,2)}.${digitos.slice(2,5)}.${digitos.slice(5,8)}/${digitos.slice(8,12)}-${digitos.slice(12)}`,
      motivo: cnpjOk ? 'CNPJ válido pelo algoritmo Módulo 11 da Receita Federal.' : 'Dígitos verificadores do CNPJ inválidos.'
    };
  }

  // 6. 11 dígitos puros: verifica se é CPF ou Telefone celular (DDD + 9xxxx-xxxx)
  if (digitos.length === 11) {
    const cpfOk = validarCpf(digitos);
    // Se o CPF for matematicamente válido, classifica como CPF
    if (cpfOk) {
      return {
        ok: true,
        valida: true,
        tipo: 'CPF',
        chave: s,
        normalizada: digitos,
        formatado: `${digitos.slice(0,3)}.${digitos.slice(3,6)}.${digitos.slice(6,9)}-${digitos.slice(9)}`,
        motivo: 'CPF válido pelo algoritmo Módulo 11 da Receita Federal.'
      };
    }
    // Se não for CPF e o 3º dígito for 9 (celular BR), aceita como Telefone normalizado para +55
    if (digitos[2] === '9') {
      return {
        ok: true,
        valida: true,
        tipo: 'TELEFONE',
        chave: s,
        normalizada: '+55' + digitos,
        descricao: 'Telefone celular brasileiro normalizado para E.164 (+55...)'
      };
    }
    // Caso contrário, é um CPF inválido
    return {
      ok: true,
      valida: false,
      tipo: 'CPF',
      chave: s,
      normalizada: digitos,
      formatado: `${digitos.slice(0,3)}.${digitos.slice(3,6)}.${digitos.slice(6,9)}-${digitos.slice(9)}`,
      motivo: 'Dígitos verificadores do CPF inválidos.'
    };
  }

  // 7. Telefone fixo/celular com 10 dígitos (DDD + 8 dígitos)
  if (digitos.length === 10) {
    return {
      ok: true,
      valida: true,
      tipo: 'TELEFONE',
      chave: s,
      normalizada: '+55' + digitos,
      descricao: 'Telefone nacional normalizado para E.164 (+55...)'
    };
  }

  return {
    ok: true,
    valida: false,
    tipo: 'DESCONHECIDO',
    chave: s,
    motivo: 'Formato não reconhecido como chave Pix válida (esperado: CPF, CNPJ, E-mail, Telefone E.164 ou Chave Aleatória UUID).'
  };
}

export const BancosEngine = {
  BANCOS_DB_GERADO_EM,
  BANCOS_COM_VALIDACAO_DV,
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
  validarCpf,
  validarCnpj,
  validarChavePix
};

export default BancosEngine;
