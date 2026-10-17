#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { acharProjeto, nabucoHome, dirTarefas, lerAtiva } from './lib/caminhos.mjs';
import { coletarSinais, propostasHigiene } from './lib/sinais.mjs';
import { lerJson } from './lib/json.mjs';
import { registrar } from './lib/eventos.mjs';
import { CUSTO_ALTO_TURNOS, PAPEIS_CEREBRO, LIMITE_LICOES, LIMIAR_DUPLICATA } from './lib/constantes.mjs';
import { similaridade } from './lib/texto.mjs';
import { validarCaso, gravarCaso, lerCasos } from './lib/casos.mjs';
import { calcularMetricas, lerHistorico } from './lib/metricas.mjs';
import { commitHome } from './lib/git.mjs';
import { ranquear } from './lib/busca.mjs';
import { serializarBloco, substituirBloco, acrescentarBloco, proximoId, lerLicoes } from './lib/licoes.mjs';
import {
  ESCOPOS, hoje, arquivoLicoes, arquivoMorto, lerArquivo, gravarArquivo, blocosDe, ativas,
  acharLicao, blocoComExtras, normalizarEvidencia, semProjeto,
} from './lib/repositorio-licoes.mjs';

class ErroUso extends Error {}
class ErroRegra extends Error {}

const projeto = acharProjeto(process.cwd());
const [comando, ...resto] = process.argv.slice(2);

function opcoes(spec) {
  try {
    return parseArgs({ args: resto, options: spec, allowPositionals: true });
  } catch (e) { throw new ErroUso(e.message); }
}
function exigir(v, nome) { if (!v || !String(v).trim()) throw new ErroUso(`falta --${nome}`); return v; }
function lerEntrada(arq) {
  exigir(arq, 'de');
  try { return lerJson(arq); }
  catch (e) { throw new ErroUso(`não foi possível ler --de "${arq}": ${e.message}`); }
}
const textoSimilar = c => `${c.sintoma ?? ''} ${(c.tags ?? []).join(' ')}`;

// ---------- lições ----------
const CAMPOS_TEXTO = ['titulo', 'gatilho', 'expectativa', 'faca', 'porque'];
const EDITAVEIS = [...CAMPOS_TEXTO, 'evidencia'];

// Valida campos de lição; `parcial` = edição (só os campos presentes). Devolve lista de erros.
function errosLicao(l, parcial) {
  if (!l || typeof l !== 'object' || Array.isArray(l)) return ['esperado um objeto JSON'];
  const erros = [];
  for (const c of CAMPOS_TEXTO) {
    if (parcial && !(c in l)) continue;
    if (typeof l[c] !== 'string' || !l[c].trim()) erros.push(`${c} deve ser texto não vazio`);
    else if (/[\r\n]/.test(l[c])) erros.push(`${c} deve ter uma linha só`);
  }
  if (!parcial || 'evidencia' in l) {
    if (!Array.isArray(l.evidencia) || !l.evidencia.some(x => typeof x === 'string' && x.trim())
      || l.evidencia.some(x => typeof x !== 'string' || /[\r\n]/.test(x))) erros.push('evidencia deve ser lista não vazia de textos');
  }
  return erros;
}

function exigirLicao(id) {
  const achada = acharLicao(id, projeto);
  if (!achada) throw new ErroRegra(`lição "${id}" não encontrada`);
  return achada;
}

function limite(texto, papel) {
  if (ativas(lerLicoes(texto).blocos).length >= LIMITE_LICOES)
    throw new ErroRegra(`${papel} já tem ${LIMITE_LICOES} lições ativas neste escopo; rode a higiene (fundir, aposentar ou promover) antes de criar outra`);
}

// Grava `novoTexto` no arquivo da lição achada, commita se global e registra o evento.
function salvar(achada, novoTexto, msg, evento) {
  gravarArquivo(achada.arquivo, novoTexto);
  if (achada.escopo === 'global') commitHome(nabucoHome(), msg);
  registrar({ ...evento, papel: achada.papel, projeto });
}

function idsDoPapel(papel) {
  return [lerArquivo(arquivoLicoes('global', papel, projeto)), lerArquivo(arquivoMorto(papel)), lerArquivo(arquivoLicoes('projeto', papel, projeto))];
}

function moverEscopo(achada, bloco, destino, campos) {
  const { papel } = achada;
  const arqDestino = arquivoLicoes(destino, papel, projeto);
  if (!arqDestino) throw new ErroRegra(SEM_PROJETO);
  // origem e destino no mesmo arquivo: gravar o destino e apagar a origem perderia a lição
  if (resolve(arqDestino) === resolve(achada.arquivo)) throw new ErroRegra(`lição ${achada.bloco.id} já está no arquivo de destino (${arqDestino})`);
  const txtDestino = lerArquivo(arqDestino);
  if (!bloco.regra) limite(txtDestino, papel);
  const ocupados = new Set([...lerLicoes(txtDestino).blocos, ...(destino === 'global' ? lerLicoes(lerArquivo(arquivoMorto(papel))).blocos : [])].map(b => b.id));
  const id = ocupados.has(bloco.id) ? proximoId(papel, idsDoPapel(papel)) : bloco.id;
  const novo = { ...bloco, id, escopo: destino };
  // grava o destino primeiro: se algo falhar no meio, a lição fica duplicada, nunca perdida
  gravarArquivo(arqDestino, acrescentarBloco(txtDestino, papel, blocoComExtras(achada.bloco, novo)));
  gravarArquivo(achada.arquivo, substituirBloco(achada.texto, achada.bloco.id, null));
  commitHome(nabucoHome(), `licao: mover ${achada.bloco.id} para ${destino}${id !== achada.bloco.id ? ` como ${id}` : ''}`);
  registrar({
    tipo: 'licao_editada', papel, projeto,
    dados: { id, campos: [...campos, 'escopo'], ...(id !== achada.bloco.id ? { id_anterior: achada.bloco.id } : {}) },
  });
  return id;
}

const SEM_PROJETO = 'sem projeto: rode a partir da raiz de um projeto (pasta com .git ou .nabuco)';
function exigirProjeto(escopo) { if (escopo === 'projeto' && semProjeto(projeto)) throw new ErroRegra(SEM_PROJETO); }

const semBruto = ({ bruto, ...b }) => b;

const pct = n => (n === null ? '—' : `${Math.round(n * 100)}%`);
const dec = n => (n === null ? '—' : String(Number(n.toFixed(2))));
function tabelaMetricas(m, papeis) {
  const cab = ['papel', 'nível', 'amostra', 'aceit. 1ª', 'tentativas', 'recorr.', 'turnos', 'escapes', 'útil', 'promoções'];
  const linhas = papeis.map(p => {
    const x = m[p];
    const nivel = x.nivel === null ? '—' : x.provisorio ? `${x.nivel} (provisório)` : x.nivel;
    return [p, nivel, String(x.amostra), pct(x.aceitacao_1a), dec(x.tentativas_ate_verde), pct(x.recorrencia), dec(x.turnos_ate_causa), x.escapes === null ? '—' : String(x.escapes), pct(x.pct_util), String(x.promocoes)];
  });
  const larg = cab.map((c, i) => Math.max(c.length, ...linhas.map(l => l[i].length)));
  const fmt = l => l.map((c, i) => c.padEnd(larg[i])).join('  ').trimEnd();
  return [fmt(cab), ...linhas.map(fmt)].join('\n');
}

const comandos = {
  'caso-add'() {
    const { values: v } = opcoes({ de: { type: 'string' } });
    const c = lerEntrada(v.de);
    const erros = validarCaso(c);
    if (erros.length) throw new ErroRegra('caso inválido:\n' + erros.map(e => `  - ${e}`).join('\n'));
    const home = nabucoHome();
    const arquivo = gravarCaso(home, c);
    registrar({
      tipo: 'caso_criado', papel: c.papel, projeto,
      dados: { arquivo, tags: c.tags ?? [], ...(c.turnos != null ? { turnos: c.turnos } : {}), ...(c.recorrencia_de ? { recorrencia_de: c.recorrencia_de } : {}) },
    });
    commitHome(home, `caso: ${arquivo}`);
    console.log(arquivo);
  },

  casos() {
    const { values: v } = opcoes({ papel: { type: 'string' } });
    if (v.papel && !PAPEIS_CEREBRO.includes(v.papel)) throw new ErroUso(`--papel deve ser: ${PAPEIS_CEREBRO.join(', ')}`);
    const lista = lerCasos(nabucoHome(), v.papel).map(c => ({ arquivo: c.arquivo, papel: c.papel, sintoma: c.sintoma ?? '', tags: c.tags }));
    console.log(JSON.stringify(lista, null, 2));
  },

  similares() {
    const { values: v } = opcoes({ de: { type: 'string' } });
    const c = lerEntrada(v.de);
    if (!c || !PAPEIS_CEREBRO.includes(c.papel) || typeof c.sintoma !== 'string') throw new ErroUso('--de precisa de papel válido e sintoma');
    const alvo = textoSimilar(c);
    const similares = lerCasos(nabucoHome(), c.papel)
      .map(x => ({ arquivo: x.arquivo, score: Number(similaridade(alvo, textoSimilar(x)).toFixed(3)) }))
      .filter(x => x.score >= 0.4)
      .sort((a, b) => b.score - a.score);
    const destilar = similares.length >= 1 || (Number.isInteger(c.turnos) && c.turnos >= CUSTO_ALTO_TURNOS);
    console.log(JSON.stringify({ similares, destilar }, null, 2));
  },

  'licao-add'() {
    const { values: v } = opcoes({ de: { type: 'string' }, forcar: { type: 'boolean' } });
    const l = lerEntrada(v.de);
    const erros = errosLicao(l, false);
    if (l && !PAPEIS_CEREBRO.includes(l.papel)) erros.unshift(`papel deve ser: ${PAPEIS_CEREBRO.join(', ')}`);
    const escopo = l?.escopo ?? 'global';
    if (!ESCOPOS.includes(escopo)) erros.push(`escopo deve ser: ${ESCOPOS.join(', ')}`);
    if (erros.length) throw new ErroRegra('lição inválida:\n' + erros.map(e => `  - ${e}`).join('\n'));
    const { papel } = l;
    exigirProjeto(escopo);
    if (!v.forcar) {
      const alvo = `${l.titulo} ${l.gatilho}`;
      const parecida = ativas([...blocosDe('projeto', papel, projeto), ...blocosDe('global', papel, projeto)])
        .map(b => ({ id: b.id, score: similaridade(alvo, `${b.titulo} ${b.gatilho}`) }))
        .filter(x => x.score >= LIMIAR_DUPLICATA)
        .sort((a, b) => b.score - a.score)[0];
      if (parecida) {
        console.log(parecida.id);
        throw new ErroRegra(`lição parecida já existe: ${parecida.id} (similaridade ${parecida.score.toFixed(2)}); use licao-reforcar ou --forcar`);
      }
    }
    const arquivo = arquivoLicoes(escopo, papel, projeto);
    const texto = lerArquivo(arquivo);
    limite(texto, papel);
    const id = proximoId(papel, idsDoPapel(papel));
    const bloco = {
      id, titulo: l.titulo.trim(), gatilho: l.gatilho.trim(), expectativa: l.expectativa.trim(), faca: l.faca.trim(), porque: l.porque.trim(),
      evidencia: normalizarEvidencia(l.evidencia), escopo, positivos: 0, negativos: 0, ultima: hoje(),
    };
    salvar({ papel, escopo, arquivo }, acrescentarBloco(texto, papel, bloco), `licao: criar ${id}`, { tipo: 'licao_criada', dados: { id, escopo } });
    console.log(id);
  },

  'licao-editar'() {
    const { values: v } = opcoes({ id: { type: 'string' }, de: { type: 'string' }, escopo: { type: 'string' } });
    exigir(v.id, 'id');
    if (!v.de && !v.escopo) throw new ErroUso('informe --de e/ou --escopo');
    if (v.escopo && !ESCOPOS.includes(v.escopo)) throw new ErroUso(`--escopo deve ser: ${ESCOPOS.join(', ')}`);
    if (v.escopo) exigirProjeto(v.escopo);
    const mudancas = v.de ? lerEntrada(v.de) : {};
    const achada = exigirLicao(v.id);
    const desconhecidos = Object.keys(mudancas ?? {}).filter(k => !EDITAVEIS.includes(k));
    const erros = [...desconhecidos.map(k => `campo "${k}" não é editável (editáveis: ${EDITAVEIS.join(', ')}; escopo via --escopo)`), ...errosLicao(mudancas, true)];
    if (erros.length) throw new ErroRegra('edição inválida:\n' + erros.map(e => `  - ${e}`).join('\n'));
    const campos = Object.keys(mudancas);
    const bloco = { ...achada.bloco };
    for (const c of campos) bloco[c] = c === 'evidencia' ? normalizarEvidencia(mudancas[c]) : mudancas[c].trim();
    if (v.escopo && v.escopo !== achada.escopo) {
      console.log(moverEscopo(achada, bloco, v.escopo, campos));
      return;
    }
    if (!campos.length) { console.log(achada.bloco.id); return; }
    salvar(achada, substituirBloco(achada.texto, v.id, bloco), `licao: editar ${v.id}`, { tipo: 'licao_editada', dados: { id: v.id, campos } });
    console.log(v.id);
  },

  'licao-reforcar'() {
    const { values: v } = opcoes({ id: { type: 'string' }, caso: { type: 'string' } });
    exigir(v.id, 'id'); exigir(v.caso, 'caso');
    if (/[\r\n]/.test(v.caso)) throw new ErroUso('--caso deve ter uma linha só');
    const achada = exigirLicao(v.id);
    const atual = achada.bloco.evidencia;
    const caso = v.caso.trim();
    if (atual.some(e => e === caso || e.includes(`](${caso})`))) { console.log(v.id); return; }
    const bloco = { ...achada.bloco, evidencia: normalizarEvidencia([...atual, caso]) };
    salvar(achada, substituirBloco(achada.texto, v.id, bloco), `licao: reforcar ${v.id}`, { tipo: 'licao_editada', dados: { id: v.id, campos: ['evidencia'] } });
    console.log(v.id);
  },

  voto() {
    const { values: v } = opcoes({ id: { type: 'string' }, util: { type: 'string' } });
    exigir(v.id, 'id');
    if (!['sim', 'nao'].includes(v.util)) throw new ErroUso('--util deve ser sim ou nao');
    const achada = exigirLicao(v.id);
    const util = v.util === 'sim';
    const b = achada.bloco;
    const bloco = { ...b, positivos: b.positivos + (util ? 1 : 0), negativos: b.negativos + (util ? 0 : 1), ultima: hoje() };
    salvar(achada, substituirBloco(achada.texto, v.id, bloco), `licao: votar ${v.id} ${v.util}`, { tipo: 'licao_usada', dados: { id: v.id, util } });
  },

  aposentar() {
    const { values: v } = opcoes({ id: { type: 'string' }, motivo: { type: 'string' } });
    exigir(v.id, 'id'); exigir(v.motivo, 'motivo');
    if (/[\r\n]/.test(v.motivo)) throw new ErroUso('--motivo deve ter uma linha só');
    const achada = exigirLicao(v.id);
    const morto = arquivoMorto(achada.papel);
    const bloco = { ...achada.bloco, aposentada: `${hoje()} · ${v.motivo.trim()}` };
    // arquivo morto primeiro: se algo falhar no meio, a lição fica duplicada, nunca perdida
    gravarArquivo(morto, acrescentarBloco(lerArquivo(morto), achada.papel, blocoComExtras(achada.bloco, bloco)));
    gravarArquivo(achada.arquivo, substituirBloco(achada.texto, v.id, null));
    commitHome(nabucoHome(), `licao: aposentar ${v.id}`);
    registrar({ tipo: 'licao_aposentada', papel: achada.papel, projeto, dados: { id: v.id, escopo: achada.escopo, motivo: v.motivo.trim() } });
  },

  promover() {
    const { values: v } = opcoes({ id: { type: 'string' }, regra: { type: 'string' } });
    exigir(v.id, 'id'); exigir(v.regra, 'regra');
    if (/[\r\n]/.test(v.regra)) throw new ErroUso('--regra deve ter uma linha só');
    const achada = exigirLicao(v.id);
    const regra = v.regra.trim();
    salvar(achada, substituirBloco(achada.texto, v.id, { ...achada.bloco, regra }), `licao: promover ${v.id}`, { tipo: 'licao_promovida', dados: { id: v.id, regra } });
  },

  licoes() {
    const { values: v } = opcoes({ papel: { type: 'string' }, todas: { type: 'boolean' } });
    if (v.papel && !PAPEIS_CEREBRO.includes(v.papel)) throw new ErroUso(`--papel deve ser: ${PAPEIS_CEREBRO.join(', ')}`);
    const lista = (v.papel ? [v.papel] : PAPEIS_CEREBRO)
      .flatMap(p => [...blocosDe('global', p, projeto), ...blocosDe('projeto', p, projeto)])
      .filter(b => v.todas || !b.regra)
      .map(semBruto);
    console.log(JSON.stringify(lista, null, 2));
  },

  buscar() {
    const { values: v } = opcoes({ papel: { type: 'string' }, texto: { type: 'string' }, arquivos: { type: 'string' }, json: { type: 'boolean' } });
    exigir(v.papel, 'papel'); exigir(v.texto, 'texto');
    if (!PAPEIS_CEREBRO.includes(v.papel)) throw new ErroUso(`--papel deve ser: ${PAPEIS_CEREBRO.join(', ')}`);
    const arquivos = (v.arquivos ?? '').split(',').map(x => x.trim()).filter(Boolean);
    const r = ranquear([...blocosDe('projeto', v.papel, projeto), ...blocosDe('global', v.papel, projeto)], { texto: v.texto, arquivos, hoje: hoje() });
    if (v.json) { console.log(JSON.stringify(r.map(x => ({ id: x.bloco.id, score: x.score })))); return; }
    if (!r.length) { console.log('(nenhuma lição relevante)'); return; }
    console.log(r.map(({ bloco }) => {
      const caso = bloco.evidencia[0];
      return serializarBloco(bloco) + (caso ? `caso: ${caso}\n` : '');
    }).join('\n'));
  },

  sinais() {
    const { values: v } = opcoes({ tarefa: { type: 'string' } });
    let dir;
    if (v.tarefa) {
      dir = join(dirTarefas(projeto), v.tarefa);
      if (!existsSync(dir)) throw new ErroRegra(`tarefa "${v.tarefa}" não encontrada`);
    } else {
      const ativa = lerAtiva(projeto);
      if (ativa) dir = ativa.dir;
      else {
        const pasta = dirTarefas(projeto);
        const nomes = existsSync(pasta) ? readdirSync(pasta, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort().reverse() : [];
        if (!nomes.length) throw new ErroRegra('nenhuma tarefa encontrada neste projeto');
        dir = join(pasta, nomes[0]);
      }
    }
    console.log(JSON.stringify(coletarSinais(dir), null, 2));
  },

  higiene() {
    const { values: v } = opcoes({ papel: { type: 'string' } });
    if (v.papel && !PAPEIS_CEREBRO.includes(v.papel)) throw new ErroUso(`--papel deve ser: ${PAPEIS_CEREBRO.join(', ')}`);
    const blocos = (v.papel ? [v.papel] : PAPEIS_CEREBRO)
      .flatMap(p => [...blocosDe('global', p, projeto), ...blocosDe('projeto', p, projeto)]);
    console.log(JSON.stringify(propostasHigiene(ativas(blocos), hoje()), null, 2));
  },

  metricas() {
    const { values: v } = opcoes({ papel: { type: 'string' }, json: { type: 'boolean' } });
    if (v.papel && !PAPEIS_CEREBRO.includes(v.papel)) throw new ErroUso(`--papel deve ser: ${PAPEIS_CEREBRO.join(', ')}`);
    const eventos = lerHistorico(nabucoHome());
    const todas = calcularMetricas(eventos);
    const papeis = v.papel ? [v.papel] : PAPEIS_CEREBRO;
    if (v.json) { console.log(JSON.stringify(Object.fromEntries(papeis.map(p => [p, todas[p]])), null, 2)); return; }
    if (!eventos.length) { console.log('Sem dados: o histórico de eventos está vazio, ainda não há métricas de senioridade.'); return; }
    console.log(tabelaMetricas(todas, papeis));
  },
};

try {
  const fn = comandos[comando];
  if (!fn) throw new ErroUso(`comando desconhecido "${comando ?? ''}". Comandos: ${Object.keys(comandos).join(', ')}`);
  fn();
} catch (e) {
  console.error(`nabuco: ${e.message}`);
  process.exit(e instanceof ErroUso ? 2 : 1);
}
