/**
 * bancos-pro.js
 * SDK Oficial para Node.js, Browser e Edge Runtimes
 * Bancos, ISPB & Contas Pro API — Base oficial BACEN (STR + Pix), DV de contas e IBAN
 *
 * @license MIT
 * @see https://github.com/clepta2/bancos-pro
 */

export class BancosPro {
  static baseUrl = 'https://bancos-pro-api.maputo2.workers.dev';
  static apiKey = '';

  /** @param {{ apiKey?: string, baseUrl?: string }} config */
  static configure(config = {}) {
    if (config.baseUrl) this.baseUrl = config.baseUrl.replace(/\/$/, '');
    if (config.apiKey) this.apiKey = config.apiKey;
  }

  static _headers(extra = {}) {
    const h = { 'Accept': 'application/json', 'User-Agent': 'BancosPro-SDK/1.0.0', ...extra };
    if (this.apiKey) {
      h['Authorization'] = `Bearer ${this.apiKey}`;
      h['x-api-key'] = this.apiKey;
    }
    return h;
  }

  static async _get(path, params = {}) {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
    const resp = await fetch(`${this.baseUrl}${path}${qs ? '?' + qs : ''}`, { headers: this._headers() });
    const body = await resp.json();
    if (!resp.ok && resp.status !== 404) throw new Error(`BancosPro: HTTP ${resp.status} — ${body.mensagem || path}`);
    return body;
  }

  /** Busca/lista instituições. Filtros: q, pix, compe, tipo, pagina, limite. */
  static listar(filtros = {}) {
    return this._get('/api/bancos', filtros);
  }

  static porCodigo(codigo) {
    return this._get(`/api/bancos/${encodeURIComponent(codigo)}`);
  }

  static porIspb(ispb) {
    return this._get(`/api/bancos/ispb/${encodeURIComponent(ispb)}`);
  }

  static porCnpj(cnpj) {
    return this._get(`/api/bancos/cnpj/${encodeURIComponent(String(cnpj).replace(/\D/g, ''))}`);
  }

  /** Valida agência/conta pelo algoritmo de DV do banco (BB, Itaú, Bradesco, Santander, Caixa). */
  static async validarConta({ banco, agencia, conta }) {
    const resp = await fetch(`${this.baseUrl}/api/bancos/conta/validar`, {
      method: 'POST',
      headers: this._headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ banco, agencia, conta })
    });
    return resp.json();
  }

  static gerarIban({ banco, ispb, agencia, conta, tipoConta = 'C', titular = '1' }) {
    return this._get('/api/bancos/iban/gerar', { banco, ispb, agencia, conta, tipoConta, titular });
  }

  static validarIban(iban) {
    return this._get(`/api/bancos/iban/validar/${encodeURIComponent(String(iban).replace(/\s/g, ''))}`);
  }

  static bancoDoBoleto(linhaDigitavel) {
    return this._get(`/api/bancos/boleto/${String(linhaDigitavel).replace(/\D/g, '')}`);
  }

  /**
   * Valida e classifica qualquer chave Pix no padrão do DICT (CPF, CNPJ, Email, Telefone E.164, EVP/UUID)
   * @param {string} chave - Ex: '123e4567-e89b-12d3-a456-426614174000', '11999998888', 'user@domain.com'
   */
  static validarChavePix(chave) {
    return this._get('/api/bancos/pix/validar', { chave });
  }
}

export default BancosPro;
