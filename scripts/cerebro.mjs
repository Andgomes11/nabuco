#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { acharProjeto, nabucoHome } from './lib/caminhos.mjs';
import { lerJson } from './lib/json.mjs';
import { registrar } from './lib/eventos.mjs';
import { CUSTO_ALTO_TURNOS, PAPEIS_CEREBRO } from './lib/constantes.mjs';
import { similaridade } from './lib/texto.mjs';
import { validarCaso, gravarCaso, lerCasos } from './lib/casos.mjs';
import { commitHome } from './lib/git.mjs';

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
};

try {
  const fn = comandos[comando];
  if (!fn) throw new ErroUso(`comando desconhecido "${comando ?? ''}". Comandos: ${Object.keys(comandos).join(', ')}`);
  fn();
} catch (e) {
  console.error(`nabuco: ${e.message}`);
  process.exit(e instanceof ErroUso ? 2 : 1);
}
