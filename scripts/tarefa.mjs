#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { existsSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { acharProjeto, dirProjeto, dirTarefas, lerAtiva, escreverAtiva, limparAtiva, nabucoHome } from './lib/caminhos.mjs';
import { lerJson, escreverJson } from './lib/json.mjs';
import { pendencias } from './lib/criterios.mjs';
import { registrar } from './lib/eventos.mjs';
import { TAMANHOS, TIPOS, FASES } from './lib/constantes.mjs';

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
function exigirAtiva() {
  const a = lerAtiva(projeto);
  if (!a) throw new ErroRegra('nenhuma tarefa ativa neste projeto (rode "nova")');
  return a;
}
function slugify(s) {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/, '');
}
const hoje = () => new Date().toLocaleDateString('sv-SE'); // AAAA-MM-DD local
const agora = () => new Date().toISOString();
const ler = (a, f) => lerJson(join(a.dir, f));
const gravar = (a, f, d) => escreverJson(join(a.dir, f), d);
const normalizar = p => process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p);
const ehPastaGlobal = p => [nabucoHome(), join(homedir(), '.nabuco')].some(g => normalizar(g) === normalizar(p));

function mudarFase(a, fase, motivo) {
  const estado = ler(a, 'estado.json');
  const de = estado.fase;
  estado.fase = fase;
  gravar(a, 'estado.json', estado);
  registrar({ tipo: 'fase', dados: { de, para: fase, ...(motivo ? { motivo } : {}) }, projeto });
}

const comandos = {
  nova() {
    const { values: v } = opcoes({ slug: { type: 'string' }, tamanho: { type: 'string' }, tipo: { type: 'string' } });
    const slug = slugify(exigir(v.slug, 'slug'));
    if (!slug) throw new ErroUso('slug vazio depois de normalizar; use letras ou números');
    if (!TAMANHOS.includes(v.tamanho)) throw new ErroUso(`--tamanho deve ser: ${TAMANHOS.join(', ')}`);
    if (!TIPOS.includes(v.tipo)) throw new ErroUso(`--tipo deve ser: ${TIPOS.join(', ')}`);
    if (ehPastaGlobal(dirProjeto(projeto))) throw new ErroRegra('esta pasta é a pasta global do nabuco; rode dentro de um projeto');
    const atual = lerAtiva(projeto);
    if (atual) {
      let fase;
      try { fase = ler(atual, 'estado.json').fase; } catch { /* ilegível: trata como ativa */ }
      if (fase === 'concluida' || fase === 'abandonada') limparAtiva(projeto); // "ativa" velha
      else throw new ErroRegra(`já existe uma tarefa ativa: ${atual.nome} (conclua ou rode "abandonar")`);
    }
    let nome = `${hoje()}-${slug}`;
    for (let i = 2; existsSync(join(dirTarefas(projeto), nome)); i++) nome = `${hoje()}-${slug}-${i}`;
    const dir = join(dirTarefas(projeto), nome);
    mkdirSync(dir, { recursive: true });
    escreverJson(join(dir, 'estado.json'), { slug, tamanho: v.tamanho, tipo: v.tipo, fase: 'planejando', criada: agora() });
    escreverJson(join(dir, 'criterios.json'), { tarefa: nome, criterios: [] });
    writeFileSync(join(dir, 'plano.md'), `# Plano — ${slug}\n\n## Objetivo\n\n## Método\n\n## Restrições\n\n## Validação\n`);
    writeFileSync(join(dir, 'progresso.md'),
      `# Progresso — ${slug}\n\n## Estado atual\nPlanejando.\n\n## Próximo passo\nEscrever o plano e os critérios.\n\n## Decisões\n\n## Log\n- ${agora()} tarefa criada (${v.tamanho}, ${v.tipo})\n`);
    writeFileSync(join(dir, 'eventos.jsonl'), '');
    escreverAtiva(projeto, nome);
    registrar({ tipo: 'tarefa_criada', dados: { tamanho: v.tamanho, tipo: v.tipo }, projeto });
    console.log(dir);
  },

  'criterio-add'() {
    const { values: v } = opcoes({ id: { type: 'string' }, descricao: { type: 'string' }, verificacao: { type: 'string' } });
    const a = exigirAtiva();
    const c = ler(a, 'criterios.json');
    if (!Array.isArray(c?.criterios)) throw new ErroRegra('criterios.json inválido (sem lista "criterios")');
    const id = exigir(v.id, 'id');
    if (c.criterios.some(x => x.id === id)) throw new ErroRegra(`critério "${id}" já existe`);
    c.criterios.push({ id, descricao: exigir(v.descricao, 'descricao'), verificacao: exigir(v.verificacao, 'verificacao'), status: 'pendente', evidencia: '', em: null });
    gravar(a, 'criterios.json', c);
    registrar({ tipo: 'criterio', dados: { id, acao: 'criado' }, projeto });
    console.log(`critério ${id} adicionado`);
  },

  criterio() {
    const { values: v } = opcoes({ id: { type: 'string' }, status: { type: 'string' }, evidencia: { type: 'string' } });
    const id = exigir(v.id, 'id');
    if (!['passou', 'falhou', 'pendente'].includes(v.status)) throw new ErroUso('--status deve ser: passou, falhou, pendente');
    if (v.status === 'passou' && !(v.evidencia ?? '').trim()) throw new ErroUso('--status passou exige --evidencia com a saída do comando');
    const a = exigirAtiva();
    const c = ler(a, 'criterios.json');
    const item = c.criterios.find(x => x.id === id);
    if (!item) throw new ErroRegra(`critério "${id}" não existe`);
    Object.assign(item, { status: v.status, evidencia: v.evidencia ?? '', em: agora() });
    gravar(a, 'criterios.json', c);
    registrar({ tipo: 'criterio', dados: { id, status: v.status }, projeto });
    console.log(`critério ${id}: ${v.status}`);
  },

  aprovar() {
    const a = exigirAtiva();
    registrar({ tipo: 'plano_aprovado', projeto });
    const estado = ler(a, 'estado.json');
    estado.fase = 'executando';
    gravar(a, 'estado.json', estado);
    console.log('plano aprovado; fase: executando');
  },

  fase() {
    const { values: v, positionals: [fase] } = opcoes({ motivo: { type: 'string' } });
    if (!FASES.includes(fase) || fase === 'concluida' || fase === 'abandonada') {
      throw new ErroUso(`fase inválida; use: ${FASES.filter(f => f !== 'concluida' && f !== 'abandonada').join(', ')} (para encerrar use "concluir" ou "abandonar")`);
    }
    mudarFase(exigirAtiva(), fase, v.motivo);
    console.log(`fase: ${fase}`);
  },

  log() {
    const { values: v } = opcoes({ texto: { type: 'string' } });
    const a = exigirAtiva();
    appendFileSync(join(a.dir, 'progresso.md'), `- ${agora()} ${exigir(v.texto, 'texto')}\n`);
    console.log('registrado no progresso.md');
  },

  concluir() {
    const a = exigirAtiva();
    const p = pendencias(ler(a, 'criterios.json'));
    if (p.length) throw new ErroRegra('não é possível concluir — critérios sem evidência:\n' + p.map(x => `  - ${x.id}: ${x.motivo}`).join('\n'));
    const estado = ler(a, 'estado.json');
    estado.fase = 'concluida';
    gravar(a, 'estado.json', estado);
    registrar({ tipo: 'tarefa_fechada', projeto });
    limparAtiva(projeto);
    console.log(`tarefa ${a.nome} concluída`);
  },

  abandonar() {
    const { values: v } = opcoes({ motivo: { type: 'string' } });
    const a = exigirAtiva();
    const estado = ler(a, 'estado.json');
    estado.fase = 'abandonada';
    gravar(a, 'estado.json', estado);
    registrar({ tipo: 'tarefa_abandonada', dados: v.motivo ? { motivo: v.motivo } : {}, projeto });
    limparAtiva(projeto);
    console.log(`tarefa ${a.nome} abandonada`);
  },

  status() {
    const a = lerAtiva(projeto);
    if (!a) { console.log(JSON.stringify({ ativa: null })); return; }
    const c = ler(a, 'criterios.json');
    const p = pendencias(c);
    const lista = Array.isArray(c.criterios) ? c.criterios : [];
    console.log(JSON.stringify({
      ativa: a.nome, dir: a.dir, estado: ler(a, 'estado.json'),
      criterios: { total: lista.length, passou: lista.filter(x => x.status === 'passou' && String(x.evidencia ?? '').trim()).length, pendencias: lista.length ? p : [] },
    }, null, 2));
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
