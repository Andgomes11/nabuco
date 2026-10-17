import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PAPEIS_CEREBRO, ESCRITORES, AMOSTRA_MINIMA, JANELA_TAREFAS } from './constantes.mjs';

const ehObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const dadosDe = e => (ehObj(e.dados) ? e.dados : {});
const media = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const chave = e => (typeof e.projeto === 'string' && typeof e.tarefa === 'string' ? `${e.projeto}/${e.tarefa}` : null);
const tempo = e => { const t = Date.parse(e.ts); return Number.isNaN(t) ? -Infinity : t; };

// Lê ~/.nabuco/historico.jsonl; arquivo ausente => []; ignora linhas inválidas e eventos sem `tipo` textual.
export function lerHistorico(home) {
  const arq = join(home, 'historico.jsonl');
  if (!existsSync(arq)) return [];
  const eventos = [];
  for (const linha of readFileSync(arq, 'utf8').split(/\r?\n/)) {
    if (!linha.trim()) continue;
    try {
      const e = JSON.parse(linha);
      if (ehObj(e) && typeof e.tipo === 'string') eventos.push(e);
    } catch { /* linha corrompida: ignora */ }
  }
  return eventos;
}

export function nivelDe(score) {
  if (score === null) return null;
  if (score < 0.5) return 'Júnior';
  if (score < 0.7) return 'Pleno';
  if (score < 0.85) return 'Sênior';
  return 'Especialista';
}

export const chaveTarefa = chave;

// Chaves (projeto/tarefa) das `n` tarefas fechadas mais recentes (por ts do último fechamento; empate pela ordem).
export function tarefasRecentes(eventos, n) {
  return janela((Array.isArray(eventos) ? eventos : []).filter(e => ehObj(e) && typeof e.tipo === 'string'), n);
}

function janela(eventos, n = JANELA_TAREFAS) {
  const fechamento = new Map();
  eventos.forEach((e, i) => {
    const k = e.tipo === 'tarefa_fechada' ? chave(e) : null;
    if (k === null) return;
    const t = tempo(e);
    const atual = fechamento.get(k);
    if (!atual || t >= atual.t) fechamento.set(k, { t, i });
  });
  return new Set([...fechamento.entries()]
    .sort((a, b) => a[1].t - b[1].t || a[1].i - b[1].i)
    .slice(n > 0 ? -n : Infinity)
    .map(([k]) => k));
}

// Com `{ fontes: true }`, cada papel ganha `fontes: { [indicador]: number[] }` — índices em `eventos` (o array
// recebido) dos eventos que alimentaram o indicador. Sem a opção, a saída é a mesma da Fase 2.
export function calcularMetricas(eventos, { fontes: comFontes = false } = {}) {
  const pares = (Array.isArray(eventos) ? eventos : []).map((e, i) => ({ e, i })).filter(({ e }) => ehObj(e) && typeof e.tipo === 'string');
  const naJanela = janela(pares.map(p => p.e));
  // eventos da janela, por tarefa
  const porTarefa = new Map();
  for (const p of pares) {
    const k = chave(p.e);
    if (k === null || !naJanela.has(k)) continue;
    if (!porTarefa.has(k)) porTarefa.set(k, []);
    porTarefa.get(k).push(p);
  }
  const idx = ps => ps.map(p => p.i).sort((a, b) => a - b);
  const resultado = {};
  for (const papel of PAPEIS_CEREBRO) {
    const meus = pares.filter(p => p.e.papel === papel);
    const doPapel = p => p.e.papel === papel;
    const participadas = [...porTarefa.values()].filter(t => t.some(doPapel));
    const amostra = participadas.length;
    const escritor = ESCRITORES.includes(papel);
    const comoEscritor = escritor ? participadas.filter(t => t.some(p => p.e.tipo === 'agente_inicio' && doPapel(p))) : [];

    const ehCorrecao = p => p.e.tipo === 'rodada_correcao' && doPapel(p);
    const ehFalha = p => p.e.tipo === 'criterio' && dadosDe(p.e).status === 'falhou';
    const aceitacao_1a = comoEscritor.length ? media(comoEscritor.map(t => (t.some(ehCorrecao) ? 0 : 1))) : null;
    const tentativas_ate_verde = comoEscritor.length ? media(comoEscritor.map(t => 1 + t.filter(ehFalha).length)) : null;

    const casos = meus.filter(p => p.e.tipo === 'caso_criado');
    const recorrencia = casos.length ? casos.filter(p => dadosDe(p.e).recorrencia_de).length / casos.length : null;
    const comTurnos = casos.filter(p => { const n = dadosDe(p.e).turnos; return typeof n === 'number' && Number.isFinite(n); });
    const turnos_ate_causa = media(comTurnos.map(p => dadosDe(p.e).turnos));

    // escape só existe para quem escreve: checador/gerente não ganham nível por participar (spec 7.5)
    const escapou = !escritor ? [] : participadas.flat().filter(p => p.e.tipo === 'correcao_usuario' && doPapel(p) && dadosDe(p.e).apos_pronto === true);
    const escapes = !escritor ? null : escapou.length;

    const votos = meus.filter(p => p.e.tipo === 'licao_usada' && typeof dadosDe(p.e).util === 'boolean');
    const pct_util = votos.length ? votos.filter(p => dadosDe(p.e).util).length / votos.length : null;
    const promovidas = meus.filter(p => p.e.tipo === 'licao_promovida');
    const promocoes = promovidas.length;

    const indicadores = [
      aceitacao_1a,
      recorrencia === null ? null : 1 - recorrencia,
      escapes !== null && amostra > 0 ? 1 - Math.min(1, escapes / amostra) : null,
      pct_util,
    ].filter(x => x !== null);
    const score = media(indicadores);

    resultado[papel] = {
      amostra, aceitacao_1a, tentativas_ate_verde, recorrencia, turnos_ate_causa, escapes, pct_util, promocoes,
      score, nivel: nivelDe(score), provisorio: amostra < AMOSTRA_MINIMA,
    };
    if (comFontes) {
      const inicio = p => p.e.tipo === 'agente_inicio' && doPapel(p);
      resultado[papel].fontes = {
        amostra: idx(participadas.flat().filter(doPapel)),
        aceitacao_1a: idx(comoEscritor.flat().filter(p => inicio(p) || ehCorrecao(p))),
        tentativas_ate_verde: idx(comoEscritor.flat().filter(p => inicio(p) || ehFalha(p))),
        recorrencia: idx(casos),
        turnos_ate_causa: idx(comTurnos),
        escapes: idx(escapou),
        pct_util: idx(votos),
        promocoes: idx(promovidas),
      };
    }
  }
  return resultado;
}
