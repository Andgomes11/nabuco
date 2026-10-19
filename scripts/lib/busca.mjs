import { tokenizar } from './texto.mjs';
import { MAX_BUSCA } from './constantes.mjs';

const DIA = 86400000;
const NOME_ARQUIVO = /[\w.-]*\w\.[A-Za-z][A-Za-z0-9]{0,7}\b/g;

const nomeBase = p => String(p).trim().split(/[\\/]/).pop().toLowerCase();
const nomesCitados = s => new Set((String(s ?? '').match(NOME_ARQUIVO) ?? []).map(nomeBase));
// plural simples (códigos → codigo, únicos → unico): sem isso a busca perde o caso mais relevante
const raiz = t => (t.length > 4 && t.endsWith('s') ? t.slice(0, -1) : t);
const termos = s => [...new Set(tokenizar(s).map(raiz))];
const cruzamento = (tokens, consulta) => tokens.reduce((n, t) => n + (consulta.has(t) ? 1 : 0), 0);

function dias(de, ate) {
  const a = Date.parse(de), b = Date.parse(ate);
  return Number.isNaN(a) || Number.isNaN(b) ? Infinity : (b - a) / DIA;
}

// Ranqueia lições (já com `escopo`) para a consulta. Puro: `hoje` (AAAA-MM-DD) vem de fora.
export function ranquear(blocos, { texto, arquivos = [], hoje }) {
  const consulta = new Set(termos(texto));
  const pedidos = new Set(arquivos.map(nomeBase).filter(Boolean));
  return blocos
    .filter(b => !b.regra)
    .map(bloco => {
      const gat = termos(bloco.gatilho);
      const tf = termos(`${bloco.titulo} ${bloco.faca}`);
      const citados = nomesCitados(`${bloco.gatilho} ${bloco.faca}`);
      const nArq = [...citados].filter(n => pedidos.has(n)).length;
      const correspondencia = 2 * cruzamento(gat, consulta) + cruzamento(tf, consulta) + 2 * nArq;
      const recente = bloco.ultima && dias(bloco.ultima, hoje) <= 30 ? 1 : 0;
      const score = correspondencia + 0.5 * ((bloco.positivos ?? 0) - (bloco.negativos ?? 0)) + recente + (bloco.escopo === 'projeto' ? 0.5 : 0);
      return { bloco, score, correspondencia };
    })
    .filter(x => x.correspondencia > 0)
    .sort((a, b) => b.score - a.score || (a.bloco.id < b.bloco.id ? -1 : a.bloco.id > b.bloco.id ? 1 : 0))
    .slice(0, MAX_BUSCA)
    .map(({ bloco, score }) => ({ bloco, score }));
}

// Ranqueia casos (sem lição ainda) para a consulta: sinal precoce e sintoma pesam mais que a causa,
// tags contam inteiras e arquivos citados no contexto casam com os da tarefa. Só entra quem casa.
export function ranquearCasos(casos, { texto, arquivos = [] }) {
  const consulta = new Set(termos(texto));
  const pedidos = new Set(arquivos.map(nomeBase).filter(Boolean));
  return casos
    .map(caso => {
      const fortes = termos(`${caso.sinal_precoce ?? ''} ${caso.sintoma ?? ''}`);
      const fracos = termos(`${caso.causa_raiz ?? ''} ${(caso.tags ?? []).join(' ')}`).filter(t => !fortes.includes(t));
      const nArq = [...nomesCitados(caso.contexto)].filter(n => pedidos.has(n)).length;
      return { caso, score: 2 * cruzamento(fortes, consulta) + cruzamento(fracos, consulta) + 2 * nArq };
    })
    // uma palavra em comum é acaso; o caso entra a partir de duas (ou de um arquivo em comum)
    .filter(x => x.score >= 2)
    .sort((a, b) => b.score - a.score || (a.caso.arquivo < b.caso.arquivo ? -1 : 1));
}
