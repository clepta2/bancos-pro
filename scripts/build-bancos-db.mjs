/**
 * scripts/build-bancos-db.mjs — Gera bancos-db.js a partir das listas oficiais do Banco Central:
 *  - data/ParticipantesSTR.csv  (UTF-8)  https://www.bcb.gov.br/content/estabilidadefinanceira/str1/ParticipantesSTR.csv
 *  - data/ParticipantesPix.csv  (Latin-1) https://www.bcb.gov.br/estabilidadefinanceira/participantespix
 *
 * Uso: node scripts/build-bancos-db.mjs [--download]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const strPath = path.join(root, 'data', 'ParticipantesSTR.csv');
const pixPath = path.join(root, 'data', 'ParticipantesPix.csv');

async function baixar() {
  const str = await fetch('https://www.bcb.gov.br/content/estabilidadefinanceira/str1/ParticipantesSTR.csv');
  if (!str.ok) throw new Error(`STR HTTP ${str.status}`);
  fs.writeFileSync(strPath, Buffer.from(await str.arrayBuffer()));

  const hoje = new Date();
  for (let i = 0; i < 10; i++) {
    const d = new Date(hoje.getTime() - i * 86400000);
    const ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
    const r = await fetch(`https://www.bcb.gov.br/content/estabilidadefinanceira/participantes_pix/lista-participantes-instituicoes-em-adesao-pix-${ymd}.csv`);
    if (r.ok) {
      fs.writeFileSync(pixPath, Buffer.from(await r.arrayBuffer()));
      console.log(`Lista Pix de ${ymd} baixada.`);
      return;
    }
  }
  throw new Error('Não foi possível baixar a lista de participantes Pix dos últimos 10 dias.');
}

function parseCsv(texto, sep) {
  const linhas = [];
  let campo = '', linha = [], aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      linha.push(campo); campo = '';
      if (linha.some(v => v.trim() !== '')) linhas.push(linha);
      linha = [];
    } else campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

const limpa = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const dataIso = s => { const m = limpa(s).match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

if (process.argv.includes('--download')) await baixar();

const strTexto = fs.readFileSync(strPath, 'utf8').replace(/^\uFEFF/, '');
const strLinhas = parseCsv(strTexto, ',').slice(1);
const pixTexto = new TextDecoder('latin1').decode(fs.readFileSync(pixPath));
const pixSecoes = pixTexto.split(/^Lista de instituições em processo de adesão ao Pix.*$/m);
const pixAtivos = parseCsv(pixSecoes[0], ';').filter(l => /^\d+$/.test(limpa(l[0])));
const pixAdesao = parseCsv(pixSecoes[1] || '', ';').filter(l => /^\d+$/.test(limpa(l[0])));

const porIspb = new Map();

for (const l of strLinhas) {
  const ispb = limpa(l[0]);
  if (!/^\d{8}$/.test(ispb)) continue;
  const codigo = limpa(l[2]);
  porIspb.set(ispb, {
    i: ispb,
    c: /^\d{1,3}$/.test(codigo) ? codigo.padStart(3, '0') : null,
    n: limpa(l[1]),
    e: limpa(l[5]) || limpa(l[1]),
    cp: limpa(l[3]).toLowerCase() === 'sim' ? 1 : 0,
    ap: limpa(l[4]) || null,
    io: dataIso(l[6])
  });
}

for (const l of pixAtivos) {
  const ispb = limpa(l[2]);
  if (!/^\d{8}$/.test(ispb)) continue;
  const reg = porIspb.get(ispb) || { i: ispb, c: null, n: limpa(l[1]), e: limpa(l[1]), cp: 0, ap: null, io: null };
  reg.cnpj = limpa(l[3]).replace(/\D/g, '') || undefined;
  reg.t = limpa(l[4]) || undefined;
  reg.px = {
    st: 'ATIVO',
    spi: limpa(l[6]) || null,
    tp: limpa(l[7]) || null,
    md: limpa(l[8]) || null,
    it: limpa(l[9]).toLowerCase() === 'sim' ? 1 : 0,
    fss: limpa(l[10]).toLowerCase() === 'sim' ? 1 : 0
  };
  porIspb.set(ispb, reg);
}

for (const l of pixAdesao) {
  const ispb = limpa(l[2]);
  if (!/^\d{8}$/.test(ispb) || porIspb.get(ispb)?.px) continue;
  const reg = porIspb.get(ispb) || { i: ispb, c: null, n: limpa(l[1]), e: limpa(l[1]), cp: 0, ap: null, io: null };
  reg.cnpj = reg.cnpj || limpa(l[3]).replace(/\D/g, '') || undefined;
  reg.t = reg.t || limpa(l[4]) || undefined;
  reg.px = { st: 'EM_ADESAO', spi: limpa(l[6]) || null, tp: limpa(l[7]) || null, md: limpa(l[8]) || null, it: 0, fss: 0, etapa: limpa(l[9]) || null };
  porIspb.set(ispb, reg);
}

const lista = [...porIspb.values()].sort((a, b) => (a.c || '999z').localeCompare(b.c || '999z') || a.n.localeCompare(b.n));
const geradoEm = new Date().toISOString().slice(0, 10);

const saida = `/**
 * bancos-db.js — GERADO AUTOMATICAMENTE por scripts/build-bancos-db.mjs. Não edite manualmente.
 * Fontes oficiais do Banco Central do Brasil: Participantes do STR e Participantes ativos do Pix.
 * Chaves: i=ISPB, c=código COMPE, n=nome reduzido, e=nome extenso, cp=participa da COMPE,
 * ap=acesso principal, io=início da operação, cnpj, t=tipo de instituição, px=dados Pix.
 */
export const BANCOS_DB_GERADO_EM = '${geradoEm}';
export const BANCOS_DB = ${JSON.stringify(lista)};
`;

fs.writeFileSync(path.join(root, 'bancos-db.js'), saida, 'utf8');
console.log(`✅ bancos-db.js gerado: ${lista.length} instituições (${lista.filter(b => b.c).length} com código COMPE, ${lista.filter(b => b.px?.st === 'ATIVO').length} ativas no Pix).`);
