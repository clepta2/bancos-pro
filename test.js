import assert from 'node:assert/strict';
import {
  buscarPorCodigo,
  buscarPorIspb,
  buscarPorCnpj,
  listarBancos,
  estatisticas,
  validarConta,
  gerarIban,
  validarIban,
  identificarBancoBoleto
} from './bancos-engine.js';
import worker from './worker.js';

console.log('🧪 Iniciando bateria de testes do Bancos, ISPB & Contas Pro...');

let pass = 0;
async function t(nome, fn) {
  await fn();
  pass++;
  console.log('  ✅ ' + nome);
}

const call = async (path, init) => {
  const res = await worker.fetch(new Request('https://api.test' + path, init));
  return { res, body: await res.json() };
};

await t('Base oficial BACEN carregada (>400 com COMPE, >800 no Pix)', () => {
  const s = estatisticas();
  assert.ok(s.totalInstituicoes > 1000);
  assert.ok(s.comCodigoCompe > 400);
  assert.ok(s.pixAtivos > 800);
});

await t('Busca por código COMPE (001, 341, 260)', () => {
  assert.equal(buscarPorCodigo('1').ispb, '00000000');
  assert.equal(buscarPorCodigo('341').nomeReduzido, 'ITAÚ UNIBANCO S.A.');
  assert.equal(buscarPorCodigo('260').ispb, '18236120');
  assert.equal(buscarPorCodigo('999999'), null);
});

await t('Busca por ISPB e CNPJ', () => {
  assert.equal(buscarPorIspb('360305').codigo, '104');
  assert.equal(buscarPorCnpj('60.701.190/0001-04').codigo, '341');
});

await t('Listagem com filtro de texto sem acento e Pix', () => {
  const r = listarBancos({ q: 'itau', pix: true });
  assert.ok(r.total >= 1);
  assert.ok(r.bancos.every(b => b.pix?.status === 'ATIVO'));
  assert.equal(listarBancos({ q: 'nubank' }).bancos[0].codigo, '260');
  assert.equal(listarBancos({ q: 'banrisul' }).bancos[0].codigo, '041');
  assert.equal(listarBancos({ limite: 10, pagina: 2 }).bancos.length, 10);
});

await t('DV: toda resposta traz verificacao e aviso; Bradesco/Santander/Caixa saem como NÃO verificados', () => {
  const casos = [['001','1584-9','00210169-6','exemplo'], ['341','2545','02366-1','exemplo'], ['237','1425','0238069-2','nao_verificado'], ['033','0189','01017417-9','nao_verificado'], ['104','0001','00100000448-4','nao_verificado']];
  for (const [banco, agencia, conta, esperado] of casos) {
    const r = validarConta({ banco, agencia, conta });
    assert.equal(r.verificacao, esperado, banco);
    assert.ok(r.aviso && r.aviso.length > 20, banco);
    if (esperado === 'nao_verificado') assert.match(r.aviso, /NÃO foi conferido/);
  }
});

await t('DV Banco do Brasil (agência 1584-9, conta 00210169-6)', () => {
  const r = validarConta({ banco: '001', agencia: '1584-9', conta: '00210169-6' });
  assert.equal(r.valido, true);
  assert.equal(validarConta({ banco: '001', agencia: '1584-9', conta: '00210169-5' }).valido, false);
  assert.equal(validarConta({ banco: '001', agencia: '1584-1', conta: '00210169-6' }).agencia.valida, false);
});

await t('DV Itaú (agência 2545, conta 02366-1)', () => {
  assert.equal(validarConta({ banco: '341', agencia: '2545', conta: '02366-1' }).valido, true);
  assert.equal(validarConta({ banco: '341', agencia: '2545', conta: '023662' }).valido, false);
});

await t('DV Bradesco (conta 0238069-2) e Santander (0189 / 01017417-9)', () => {
  assert.equal(validarConta({ banco: '237', agencia: '1425', conta: '0238069-2' }).conta.valida, true);
  assert.equal(validarConta({ banco: '033', agencia: '0189', conta: '01017417-9' }).valido, true);
  assert.equal(validarConta({ banco: '033', agencia: '0189', conta: '01017417-8' }).valido, false);
});

await t('DV Caixa autoconsistente e banco sem algoritmo valida só formato', () => {
  const c = validarConta({ banco: '104', agencia: '0001', conta: '00100000448-4' });
  assert.equal(c.valido, true);
  const nu = validarConta({ banco: '260', agencia: '0001', conta: '1234567-8' });
  assert.equal(nu.valido, true);
  assert.equal(nu.nivelValidacao, 'FORMATO');
});

await t('IBAN do registro SWIFT (BR1800360305000010009795493C1) é válido', () => {
  const r = validarIban('BR18 0036 0305 0000 1000 9795 493C 1');
  assert.equal(r.valido, true);
  assert.equal(r.banco.codigo, '104');
  assert.equal(r.componentes.tipoConta, 'CORRENTE');
  assert.equal(validarIban('BR1900360305000010009795493C1').valido, false);
});

await t('Gerar IBAN reproduz o exemplo oficial', () => {
  const r = gerarIban({ ispb: '00360305', agencia: '00001', conta: '0009795493', tipoConta: 'C', titular: '1' });
  assert.equal(r.iban, 'BR1800360305000010009795493C1');
  const bb = gerarIban({ banco: '001', agencia: '1584', conta: '00210169-6' });
  assert.equal(validarIban(bb.iban).valido, true);
});

await t('Identifica banco emissor de boleto', () => {
  const r = identificarBancoBoleto('34191.79001 01043.510047 91020.150008 5 84230000016000');
  assert.equal(r.codigoBanco, '341');
  assert.equal(r.banco.ispb, '60701190');
  assert.equal(identificarBancoBoleto('836200000005 667800481000 180975657313 001589636081').tipo, 'ARRECADACAO');
});

await t('HTTP /health e /api/bancos/001', async () => {
  assert.equal((await call('/health')).body.ok, true);
  const { res, body } = await call('/api/bancos/001');
  assert.equal(res.status, 200);
  assert.equal(body.cnpj, '00000000000191');
});

await t('HTTP ISPB, CNPJ e 404', async () => {
  assert.equal((await call('/api/bancos/ispb/18236120')).body.codigo, '260');
  assert.equal((await call('/api/bancos/cnpj/60701190000104')).body.codigo, '341');
  assert.equal((await call('/api/bancos/998')).res.status, 404);
});

await t('HTTP POST validar conta e GET gerar IBAN', async () => {
  const { body } = await call('/api/bancos/conta/validar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ banco: '341', agencia: '2545', conta: '02366-1' })
  });
  assert.equal(body.valido, true);
  const ib = await call('/api/bancos/iban/gerar?banco=104&agencia=1&conta=0009795493');
  assert.equal(ib.body.ok, true);
  assert.equal((await call('/api/bancos/iban/validar/' + ib.body.iban)).body.valido, true);
});

await t('HTTP busca, boleto e rota inexistente', async () => {
  const b = await call('/api/bancos?q=nu%20pagamentos&limite=5');
  assert.ok(b.body.bancos.some(x => x.codigo === '260'));
  assert.equal((await call('/api/bancos/boleto/34191790010104351004791020150008584230000016000')).body.codigoBanco, '341');
  assert.equal((await call('/api/bancos/boleto/123')).res.status, 400);
  assert.equal((await call('/api/xyz')).res.status, 404);
});

console.log(`\n🎉 Todos os ${pass} testes do Bancos Pro passaram!`);
