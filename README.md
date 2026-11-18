# 🏦 Bancos, ISPB & Contas Pro API • Base Oficial BACEN, DV de Contas e IBAN

> **API e SDK oficial na borda Cloudflare Anycast (<2ms) com a lista oficial de instituições do Banco Central (participantes do STR e do Pix). Inclui código COMPE, ISPB, CNPJ, modalidade Pix, validação de dígito verificador de agência e conta, IBAN brasileiro e identificação do banco emissor de boletos.**

[![Status](https://img.shields.io/badge/Status-Produção%20Tier--1-success.svg)](#)
[![Infra](https://img.shields.io/badge/Infra-Cloudflare%20Workers%20Anycast-orange.svg)](#)
[![Fonte](https://img.shields.io/badge/Fonte-Banco%20Central%20do%20Brasil-blue.svg)](#)
[![License](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)

---

## 🧭 Visão Geral

1. **Base oficial BACEN**: junta a [lista de participantes do STR](https://www.bcb.gov.br/estabilidadefinanceira/participantesstr) (código COMPE, ISPB, acesso RSFN e início da operação) com a [lista de participantes do Pix](https://www.bcb.gov.br/estabilidadefinanceira/participantespix) (CNPJ, tipo de instituição, modalidade, iniciação de pagamento e saque/troco). São cerca de 1.080 instituições.
2. **Consulta** por código COMPE, ISPB ou CNPJ, e busca textual que ignora acentos.
3. **Validação de DV de agência e conta** para Banco do Brasil, Itaú, Bradesco, Santander e Caixa (veja o status abaixo). Nos demais bancos, só o formato é validado.
4. **IBAN brasileiro (ISO 13616)**: gera a partir de ISPB/COMPE, agência e conta, e valida o checksum mod-97.
5. **Banco emissor do boleto** a partir da linha digitável ou do código de barras.

## ⚠️ Status dos dados

| Dado | Status |
|---|---|
| Instituições, COMPE, ISPB, CNPJ e participação no Pix | Origem: listas oficiais do BACEN (STR e Pix) baixadas em 17/11/2026; o gerador está em `scripts/build-bancos-db.mjs` |
| IBAN (ISO 13616, mod-97) | Algoritmo padrão; conferido com o IBAN de exemplo `BR1800360305000010009795493C1` |
| DV de Banco do Brasil e Itaú | Conferido **só com contas de exemplo**, não com a especificação do banco |
| **DV de Bradesco, Santander e Caixa** | **NÃO verificado** com a especificação oficial |
| Apelidos de marca (nubank, inter, c6...) | Mapeamento feito à mão sobre os códigos COMPE da base |

A resposta de `/api/bancos/conta/validar` traz `verificacao` e `aviso`. Não use o resultado como garantia de que a conta existe: ele só indica se o dígito confere com o algoritmo implementado.

> Os dados vão embutidos no Worker (`bancos-db.js`), sem nenhuma chamada externa em tempo de execução.

### Atualizar a base

```bash
npm run update:db   # baixa os CSVs atuais do BACEN para data/ e regenera bancos-db.js
npm test
```

---

## 📦 Planos

| Plano | Limite RPM | Cota Diária | Prefixo de Chave |
|---|---|---|---|
| **Free / Sandbox** | 30 RPM | 500 req/dia | (sem chave) |
| **Starter** | 60 RPM | 86.400 req/dia | `bco_start_` / `pnt_start_` |
| **Pro** | 300 RPM | 250.000 req/dia | `bco_pro_` / `pnt_pro_` |
| **Business** | 1.200 RPM | 1.000.000 req/dia | `bco_biz_` / `pnt_biz_` |
| **Master Admin** | 3.000 RPM | Ilimitada | `bco_master_` / `pnt_master_` |

---

## 🚀 Endpoints REST

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/bancos?q=&pix=true&compe=true&tipo=&pagina=&limite=` | Busca e lista instituições |
| GET | `/api/bancos/:codigo` | Consulta por código COMPE (ex.: `341`) |
| GET | `/api/bancos/ispb/:ispb` | Consulta por ISPB |
| GET | `/api/bancos/cnpj/:cnpj` | Consulta por CNPJ |
| GET | `/api/bancos/estatisticas` | Totais por tipo de instituição |
| GET/POST | `/api/bancos/conta/validar?banco=&agencia=&conta=` | Valida o DV de agência e conta |
| GET/POST | `/api/bancos/iban/gerar?banco=&agencia=&conta=&tipoConta=C` | Gera IBAN |
| GET | `/api/bancos/iban/validar/:iban` | Valida e decompõe IBAN |
| GET | `/api/bancos/boleto/:linha` | Identifica o banco emissor do boleto |
| GET | `/api/bancos/pix/validar?chave=` | Valida e normaliza chave Pix (CPF, CNPJ, Email, E.164, EVP UUIDv4) |

```bash
curl "https://bancos-pro-api.maputo2.workers.dev/api/bancos/conta/validar?banco=341&agencia=2545&conta=02366-1"
```

---

## 💻 SDK

```javascript
import { BancosPro } from 'bancos-pro';

BancosPro.configure({ apiKey: process.env.PONTE_API_KEY });

const itau = await BancosPro.porCodigo('341');
const conta = await BancosPro.validarConta({ banco: '001', agencia: '1584-9', conta: '00210169-6' });
const iban = await BancosPro.gerarIban({ banco: '104', agencia: '00001', conta: '0009795493' });
```

---

## 📄 Licença

MIT — consulte [LICENSE](LICENSE). Os dados de instituições são públicos e foram publicados pelo Banco Central do Brasil.
