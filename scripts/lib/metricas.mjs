import { readFileSync, existsSync, statSync, openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { PAPEIS_CEREBRO, ESCRITORES, AMOSTRA_MINIMA, JANELA_TAREFAS, AMOSTRA_NIVEL } from './constantes.mjs';

const ehObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const dadosDe = e => (ehObj(e.dados) ? e.dados : {});
const media = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const chave = e => (typeof e.projeto === 'string' && typeof e.tarefa === 'string' ? `${e.projeto}/${e.tarefa}` : null);
const tempo = e => { const t = Date.parse(e.ts); return Number.isNaN(t) ? -Infinity : t; };

// Lê ~/.nabuco/historico.jsonl; arquivo ausente => []; ignora linhas inválidas e eventos sem `tipo` textual.
export function lerHistorico(home) {
  return lerHistoricoDetalhado(home).eventos;
}

// Como lerHistorico, mas conta o que ignorou: { eventos, ilegiveis, existe } (ilegível = JSON inválido ou sem `tipo`).
export function lerHistoricoDetalhado(home) {
  const arq = join(home, 'historico.jsonl');
  if (!existsSync(arq)) return { eventos: [], ilegiveis: 0, existe: false };
  const q = { ilegiveis: 0 };
  return { eventos: parsearLinhas(readFileSync(arq, 'utf8'), [], q), ilegiveis: q.ilegiveis, existe: true };
}

function parsearLinhas(texto, eventos = [], q = null) {
  for (const linha of texto.split(/\r?\n/)) {
    if (!linha.trim()) continue;
    let e = null;
    try { e = JSON.parse(linha); } catch { /* linha corrompida: ignora */ }
    if (ehObj(e) && typeof e.tipo === 'string') eventos.push(e);
    else if (q) q.ilegiveis++;
  }
  return eventos;
}

const PREFIXO = 256; // bytes do começo guardados para notar um arquivo regravado (não só crescido)

// Leitor de historico.jsonl com cache, para o painel (que lê a cada requisição e a cada recálculo).
// O histórico é append-only: sem mudança de (mtime, tamanho) devolve o cache; se só cresceu, lê apenas o
// trecho novo. Só linhas terminadas em \n entram no cache; o resto (linha parcial de uma escrita em curso)
// é relido na próxima vez, mas se já for um evento válido entra no resultado, igual a lerHistorico.
// Encolheu, começo diferente ou arquivo trocado => releitura completa. Devolve sempre uma cópia do array.
export function leitorHistorico(home) {
  const arq = join(home, 'historico.jsonl');
  let c = null; // { tam, mtime, ino, prefixo, pos (bytes consumidos, logo após um \n), eventos, cauda }
  const estatisticas = { completas: 0, incrementais: 0 };

  const lerTrecho = (fd, ini, fim) => {
    const buf = Buffer.alloc(fim - ini);
    let lidos = 0;
    while (lidos < buf.length) {
      const n = readSync(fd, buf, lidos, buf.length - lidos, ini + lidos);
      if (n === 0) break;
      lidos += n;
    }
    return buf.subarray(0, lidos);
  };
  // consome os bytes novos: até o último \n vai para o cache; o resto vira a cauda provisória
  const consumir = (buf, eventos) => {
    const nl = buf.lastIndexOf(0x0a);
    const completo = nl < 0 ? 0 : nl + 1;
    parsearLinhas(buf.subarray(0, completo).toString('utf8'), eventos);
    return { consumidos: completo, cauda: parsearLinhas(buf.subarray(completo).toString('utf8')) };
  };

  function ler() {
    let st;
    try { st = statSync(arq); } catch { c = null; return []; }
    if (c && st.size === c.tam && st.mtimeMs === c.mtime && st.ino === c.ino) return [...c.eventos, ...c.cauda];
    let fd;
    try { fd = openSync(arq, 'r'); } catch { c = null; return []; }
    try {
      const tam = fstatSync(fd).size;
      const prefixo = lerTrecho(fd, 0, Math.min(PREFIXO, tam));
      const cresceu = c && st.ino === c.ino && tam >= c.pos && tam >= c.tam
        && prefixo.subarray(0, c.prefixo.length).equals(c.prefixo);
      if (cresceu) {
        estatisticas.incrementais++;
        const { consumidos, cauda } = consumir(lerTrecho(fd, c.pos, tam), c.eventos);
        c.pos += consumidos; c.cauda = cauda;
      } else {
        estatisticas.completas++;
        const eventos = [];
        const { consumidos, cauda } = consumir(lerTrecho(fd, 0, tam), eventos);
        c = { pos: consumidos, eventos, cauda };
      }
      Object.assign(c, { tam, mtime: st.mtimeMs, ino: st.ino, prefixo });
      return [...c.eventos, ...c.cauda];
    } finally { closeSync(fd); }
  }
  ler.estatisticas = estatisticas;
  return ler;
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
// `papeis`/`escritores`: padrão nos embutidos; quem chama inclui os contratados (scripts/lib/time.mjs).
// `janela`: quantas tarefas fechadas mais recentes entram (padrão JANELA_TAREFAS; Infinity = todas).
export function calcularMetricas(eventos, { fontes: comFontes = false, papeis = PAPEIS_CEREBRO, escritores = ESCRITORES, janela: n = JANELA_TAREFAS } = {}) {
  const pares = (Array.isArray(eventos) ? eventos : []).map((e, i) => ({ e, i })).filter(({ e }) => ehObj(e) && typeof e.tipo === 'string');
  const naJanela = janela(pares.map(p => p.e), n);
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
  for (const papel of papeis) {
    const meus = pares.filter(p => p.e.papel === papel);
    const doPapel = p => p.e.papel === papel;
    const participadas = [...porTarefa.values()].filter(t => t.some(doPapel));
    const amostra = participadas.length;
    const escritor = escritores.includes(papel);
    const comoEscritor = escritor ? participadas.filter(t => t.some(p => p.e.tipo === 'agente_inicio' && doPapel(p))) : [];

    const ehCorrecao = p => p.e.tipo === 'rodada_correcao' && doPapel(p);
    const ehFalha = p => p.e.tipo === 'criterio' && dadosDe(p.e).status === 'falhou';
    const aceitacao_1a = comoEscritor.length ? media(comoEscritor.map(t => (t.some(ehCorrecao) ? 0 : 1))) : null;
    const tentativas_ate_verde = comoEscritor.length ? media(comoEscritor.map(t => 1 + t.filter(ehFalha).length)) : null;

    const casos = meus.filter(p => p.e.tipo === 'caso_criado');
    const recorrencia = casos.length ? casos.filter(p => dadosDe(p.e).recorrencia_de).length / casos.length : null;
    const comTurnos = casos.filter(p => { const n = dadosDe(p.e).turnos; return typeof n === 'number' && Number.isFinite(n); });
    const turnos_ate_causa = media(comTurnos.map(p => dadosDe(p.e).turnos));

    // checador: achado alto/médio que levou a correção (rodada ou caso depois dele) é acerto; tarefa
    // checada por ele com problema que você pegou depois do "pronto" é escape dele também
    const checador = !escritor && papel !== 'gerente';
    const relevante = p => p.e.tipo === 'achado' && doPapel(p) && ['alta', 'media'].includes(dadosDe(p.e).severidade);
    const comAchado = checador ? participadas.filter(t => t.some(relevante)) : [];
    const levouACorrecao = t => {
      const i = t.findIndex(relevante);
      return t.slice(i + 1).some(p => p.e.tipo === 'rodada_correcao' || p.e.tipo === 'caso_criado');
    };
    const achados_uteis = comAchado.length ? media(comAchado.map(t => (levouACorrecao(t) ? 1 : 0))) : null;

    const escapou = escritor
      ? participadas.flat().filter(p => p.e.tipo === 'correcao_usuario' && doPapel(p) && dadosDe(p.e).apos_pronto === true)
      : checador ? participadas.flat().filter(p => p.e.tipo === 'correcao_usuario' && dadosDe(p.e).apos_pronto === true) : [];
    const escapes = escritor || checador ? escapou.length : null;
    // spec 7.5: ninguém ganha nível só por participar. O checador é avaliado por escapes quando tem
    // achados avaliáveis ou a partir de AMOSTRA_NIVEL tarefas: aí "nada escapou depois da verificação
    // dele" já é resultado (tester e arquiteto quase nunca geram achado alto), não mera presença
    const contaEscapes = escritor || (checador && (achados_uteis !== null || amostra >= AMOSTRA_NIVEL));

    const votos = meus.filter(p => p.e.tipo === 'licao_usada' && typeof dadosDe(p.e).util === 'boolean');
    const pct_util = votos.length ? votos.filter(p => dadosDe(p.e).util).length / votos.length : null;
    const promovidas = meus.filter(p => p.e.tipo === 'licao_promovida');
    const promocoes = promovidas.length;

    const indicadores = [
      aceitacao_1a,
      recorrencia === null ? null : 1 - recorrencia,
      contaEscapes && amostra > 0 ? 1 - Math.min(1, escapes / amostra) : null,
      achados_uteis,
      pct_util,
    ].filter(x => x !== null);
    const score = media(indicadores);

    resultado[papel] = {
      amostra, aceitacao_1a, tentativas_ate_verde, recorrencia, turnos_ate_causa, escapes, achados_uteis, pct_util, promocoes,
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
        achados_uteis: idx(comAchado.flat().filter(p => relevante(p) || p.e.tipo === 'rodada_correcao' || p.e.tipo === 'caso_criado')),
        pct_util: idx(votos),
        promocoes: idx(promovidas),
      };
    }
  }
  return resultado;
}
