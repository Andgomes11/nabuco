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

function janela(eventos) {
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
    .slice(-JANELA_TAREFAS)
    .map(([k]) => k));
}

export function calcularMetricas(eventos) {
  const evs = (Array.isArray(eventos) ? eventos : []).filter(e => ehObj(e) && typeof e.tipo === 'string');
  const naJanela = janela(evs);
  const resultado = {};
  for (const papel of PAPEIS_CEREBRO) {
    const meus = evs.filter(e => e.papel === papel);
    // eventos da janela, por tarefa
    const porTarefa = new Map();
    for (const e of evs) {
      const k = chave(e);
      if (k === null || !naJanela.has(k)) continue;
      if (!porTarefa.has(k)) porTarefa.set(k, []);
      porTarefa.get(k).push(e);
    }
    const participadas = [...porTarefa.values()].filter(t => t.some(e => e.papel === papel));
    const amostra = participadas.length;
    const escritor = ESCRITORES.includes(papel);
    const comoEscritor = escritor ? participadas.filter(t => t.some(e => e.tipo === 'agente_inicio' && e.papel === papel)) : [];

    const aceitacao_1a = comoEscritor.length
      ? media(comoEscritor.map(t => (t.some(e => e.tipo === 'rodada_correcao' && e.papel === papel) ? 0 : 1)))
      : null;
    const tentativas_ate_verde = comoEscritor.length
      ? media(comoEscritor.map(t => 1 + t.filter(e => e.tipo === 'criterio' && dadosDe(e).status === 'falhou').length))
      : null;

    const casos = meus.filter(e => e.tipo === 'caso_criado');
    const recorrencia = casos.length ? casos.filter(e => dadosDe(e).recorrencia_de).length / casos.length : null;
    const turnos_ate_causa = media(casos.map(e => dadosDe(e).turnos).filter(n => typeof n === 'number' && Number.isFinite(n)));

    // escape só existe para quem escreve: checador/gerente não ganham nível por participar (spec 7.5)
    const escapes = !escritor ? null : participadas.flat().filter(e => e.tipo === 'correcao_usuario' && e.papel === papel && dadosDe(e).apos_pronto === true).length;

    const votos = meus.filter(e => e.tipo === 'licao_usada' && typeof dadosDe(e).util === 'boolean');
    const pct_util = votos.length ? votos.filter(e => dadosDe(e).util).length / votos.length : null;
    const promocoes = meus.filter(e => e.tipo === 'licao_promovida').length;

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
  }
  return resultado;
}
