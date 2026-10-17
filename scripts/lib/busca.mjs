import { tokenizar } from './texto.mjs';
import { MAX_BUSCA } from './constantes.mjs';

const DIA = 86400000;
const NOME_ARQUIVO = /[\w.-]*\w\.[A-Za-z][A-Za-z0-9]{0,7}\b/g;

const nomeBase = p => String(p).trim().split(/[\\/]/).pop().toLowerCase();
const nomesCitados = s => new Set((String(s ?? '').match(NOME_ARQUIVO) ?? []).map(nomeBase));
const cruzamento = (tokens, consulta) => tokens.reduce((n, t) => n + (consulta.has(t) ? 1 : 0), 0);

function dias(de, ate) {
  const a = Date.parse(de), b = Date.parse(ate);
  return Number.isNaN(a) || Number.isNaN(b) ? Infinity : (b - a) / DIA;
}

// Ranqueia lições (já com `escopo`) para a consulta. Puro: `hoje` (AAAA-MM-DD) vem de fora.
export function ranquear(blocos, { texto, arquivos = [], hoje }) {
  const consulta = new Set(tokenizar(texto));
  const pedidos = new Set(arquivos.map(nomeBase).filter(Boolean));
  return blocos
    .filter(b => !b.regra)
    .map(bloco => {
      const gat = [...new Set(tokenizar(bloco.gatilho))];
      const tf = [...new Set(tokenizar(`${bloco.titulo} ${bloco.faca}`))];
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
