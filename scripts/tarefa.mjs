#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { existsSync, mkdirSync, writeFileSync, appendFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { acharProjeto, dirProjeto, dirTarefas, lerAtiva, escreverAtiva, limparAtiva, ehPastaGlobal, nomeTarefaValido } from './lib/caminhos.mjs';
import { lerJson, escreverJson } from './lib/json.mjs';
import { pendencias } from './lib/criterios.mjs';
import { registrar } from './lib/eventos.mjs';
import { slugify } from './lib/texto.mjs';
import { TAMANHOS, TIPOS, FASES } from './lib/constantes.mjs';
import { papeis } from './lib/time.mjs';
import { RE_ID_FILA, arquivoFila, lerFila, gravarFila, resumoFila, encerrarItem, paradaDe } from './lib/fila.mjs';
import { baseDoDiff, naoRastreados, rastreadosAlterados } from './lib/git.mjs';

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
const hoje = () => new Date().toLocaleDateString('sv-SE'); // AAAA-MM-DD local
const agora = () => new Date().toISOString();
const ler = (a, f) => lerJson(join(a.dir, f));
const gravar = (a, f, d) => escreverJson(join(a.dir, f), d);

// Fecha o item da fila que a tarefa executava. A tarefa já está encerrada: falhar aqui só avisa.
function encerrarNaFila(nome, status) {
  try {
    if (!existsSync(arquivoFila(projeto))) return;
    const fila = lerFila(projeto);
    const it = encerrarItem(fila, nome, status);
    if (!it) return;
    gravarFila(projeto, fila);
    console.log(`item ${it.id} marcado como ${status} na fila`);
    if (fila.parada) console.log('fila parada: o próximo item só roda depois do ok do usuário ("fila.mjs retomar")');
  } catch (e) {
    console.error(`nabuco: aviso: tarefa encerrada, mas não consegui atualizar a fila (${e.message}); o item ficou como estava em .nabuco/fila.json`);
  }
}

function mudarFase(a, fase, motivo) {
  const estado = ler(a, 'estado.json');
  const de = estado.fase;
  estado.fase = fase;
  gravar(a, 'estado.json', estado);
  registrar({ tipo: 'fase', dados: { de, para: fase, ...(motivo ? { motivo } : {}) }, projeto });
}

const comandos = {
  nova() {
    const { values: v } = opcoes({ slug: { type: 'string' }, tamanho: { type: 'string' }, tipo: { type: 'string' }, fila: { type: 'string' } });
    const slug = slugify(exigir(v.slug, 'slug'));
    if (!slug) throw new ErroUso('slug vazio depois de normalizar; use letras ou números');
    if (!TAMANHOS.includes(v.tamanho)) throw new ErroUso(`--tamanho deve ser: ${TAMANHOS.join(', ')}`);
    if (!TIPOS.includes(v.tipo)) throw new ErroUso(`--tipo deve ser: ${TIPOS.join(', ')}`);
    if (v.fila !== undefined && !RE_ID_FILA.test(v.fila)) throw new ErroUso(`--fila "${v.fila}" inválido (use o id da fila, ex.: f1)`);
    if (ehPastaGlobal(dirProjeto(projeto))) throw new ErroRegra('esta pasta é a pasta global do nabuco; rode dentro de um projeto');
    const atual = lerAtiva(projeto);
    if (atual) {
      let fase;
      try { fase = ler(atual, 'estado.json').fase; } catch { /* ilegível: trata como ativa */ }
      if (fase === 'concluida' || fase === 'abandonada') limparAtiva(projeto); // "ativa" velha
      else throw new ErroRegra(`já existe uma tarefa ativa: ${atual.nome} (conclua ou rode "abandonar")`);
    }
    // item da fila validado antes de criar qualquer coisa: recusa aqui não deixa pasta órfã
    let fila = null, item = null;
    if (v.fila !== undefined) {
      try { fila = lerFila(projeto); } catch (e) { throw new ErroRegra(e.message); }
      item = fila.itens.find(x => x.id === v.fila);
      if (!item) throw new ErroRegra(`item "${v.fila}" não existe na fila (veja "fila.mjs listar")`);
      if (item.status !== 'pendente') throw new ErroRegra(`item ${item.id} não está pendente (${item.status}${item.tarefa ? `, tarefa ${item.tarefa}` : ''})`);
      const parada = paradaDe(fila, null); // a "ativa" (se havia) já foi limpa acima: item em andamento aqui é órfão
      if (parada) throw new ErroRegra(`fila parada (${parada.motivo}); pergunte ao usuário e, com o ok dele, rode "fila.mjs retomar" antes`);
    }
    let nome = `${hoje()}-${slug}`;
    for (let i = 2; existsSync(join(dirTarefas(projeto), nome)); i++) nome = `${hoje()}-${slug}-${i}`;
    const dir = join(dirTarefas(projeto), nome);
    // base do diff (git diff <base>): isola esta tarefa das mudanças não commitadas de antes; a lista de
    // não rastreados de agora separa depois os arquivos novos desta tarefa (veja `arquivos-novos`)
    const base = baseDoDiff(projeto);
    const nr = naoRastreados(projeto);
    mkdirSync(dir, { recursive: true });
    escreverJson(join(dir, 'estado.json'), {
      slug, tamanho: v.tamanho, tipo: v.tipo, fase: 'planejando', criada: agora(), ...(base ? { base } : {}), ...(nr ? { nao_rastreados: nr } : {}),
    });
    escreverJson(join(dir, 'criterios.json'), { tarefa: nome, criterios: [] });
    writeFileSync(join(dir, 'plano.md'), `# Plano — ${slug}\n\n## Objetivo\n\n## Método\n\n## Restrições\n\n## Validação\n`);
    writeFileSync(join(dir, 'progresso.md'),
      `# Progresso — ${slug}\n\n## Estado atual\nPlanejando.\n\n## Próximo passo\nEscrever o plano e os critérios.\n\n## Decisões\n\n## Log\n- ${agora()} tarefa criada (${v.tamanho}, ${v.tipo})\n`);
    writeFileSync(join(dir, 'eventos.jsonl'), '');
    escreverAtiva(projeto, nome);
    if (item) {
      // marca antes do evento; sem conseguir marcar, desfaz a tarefa (nem pasta órfã, nem item solto)
      Object.assign(item, { status: 'em_andamento', tarefa: nome });
      try { gravarFila(projeto, fila); } catch (e) {
        limparAtiva(projeto);
        rmSync(dir, { recursive: true, force: true });
        throw new ErroRegra(`não consegui marcar o item ${item.id} na fila (${e.message}); nada foi criado`);
      }
    }
    registrar({ tipo: 'tarefa_criada', dados: { tamanho: v.tamanho, tipo: v.tipo, ...(item ? { fila: item.id } : {}) }, projeto });
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

  // Depois do plano aprovado, mudar um critério é mudar a meta: só com ok do usuário e fica no evento.
  'criterio-editar'() {
    const { values: v } = opcoes({ id: { type: 'string' }, descricao: { type: 'string' }, verificacao: { type: 'string' }, motivo: { type: 'string' }, 'ok-usuario': { type: 'boolean' } });
    const id = exigir(v.id, 'id');
    if (v.descricao === undefined && v.verificacao === undefined) throw new ErroUso('informe --descricao e/ou --verificacao');
    if (v.descricao !== undefined) exigir(v.descricao, 'descricao');
    if (v.verificacao !== undefined) exigir(v.verificacao, 'verificacao');
    const a = exigirAtiva();
    const aprovado = !['planejando', 'aguardando_aprovacao'].includes(ler(a, 'estado.json').fase);
    if (aprovado && !v['ok-usuario']) {
      throw new ErroRegra('plano já aprovado: mudar um critério muda a meta. Pergunte ao usuário (T fase aguardando_usuario --motivo="...") e, com o ok dele, rode de novo com --ok-usuario e --motivo');
    }
    if (aprovado) exigir(v.motivo, 'motivo');
    const c = ler(a, 'criterios.json');
    const item = c.criterios?.find(x => x.id === id);
    if (!item) throw new ErroRegra(`critério "${id}" não existe`);
    const dados = { id, acao: 'editado' };
    for (const campo of ['descricao', 'verificacao']) {
      if (v[campo] === undefined || v[campo] === item[campo]) continue;
      dados[campo] = { de: item[campo], para: v[campo] };
      item[campo] = v[campo];
    }
    if (dados.verificacao) Object.assign(item, { status: 'pendente', evidencia: '', em: null }); // a evidência provava o comando antigo
    if (v.motivo) dados.motivo = v.motivo;
    if (v['ok-usuario']) dados.ok_usuario = true;
    gravar(a, 'criterios.json', c);
    registrar({ tipo: 'criterio', dados, projeto });
    console.log(`critério ${id} editado${dados.verificacao ? ' (verificação nova: status pendente)' : ''}`);
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
    registrar({ tipo: 'criterio', dados: { id, status: v.status, ...(v.status === 'falhou' && v.evidencia ? { evidencia: v.evidencia.slice(0, 500) } : {}) }, projeto });
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
    const texto = exigir(v.texto, 'texto');
    appendFileSync(join(a.dir, 'progresso.md'), `- ${agora()} ${texto}\n`);
    registrar({ tipo: 'nota', dados: { texto: texto.slice(0, 500) }, projeto }); // linha do tempo do painel
    console.log('registrado no progresso.md');
  },

  // o passo entregue a um funcionário, para a linha do tempo do painel. O destino vai em dados.para
  // (não em papel): as métricas contam participação por papel, e delegar não é participar
  delegar() {
    const { values: v } = opcoes({ papel: { type: 'string' }, passo: { type: 'string' } });
    exigirAtiva();
    const para = exigir(v.papel, 'papel');
    // embutidos + contratados (~/.nabuco/time)
    const validos = papeis();
    if (!validos.includes(para)) throw new ErroUso(`--papel inválido; use: ${validos.join(', ')}`);
    registrar({ tipo: 'delegacao', dados: { para, passo: exigir(v.passo, 'passo').slice(0, 500) }, projeto });
    console.log(`delegação para ${para} registrada`);
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
    encerrarNaFila(a.nome, 'feito');
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
    encerrarNaFila(a.nome, 'abandonado');
  },

  // O que entregar aos checadores além do `git diff <base>`: não rastreados criados nesta tarefa (novos) e
  // não rastreados que já existiam e mudaram depois que ela nasceu (sem diff possível: vão inteiros).
  // Também a lista para o commit por item da fila: rastreados alterados desde a `base` + não rastreados
  // novos. `--tarefa <pasta>` lê aquela tarefa mesmo encerrada (o commit vem depois do `concluir`).
  'arquivos-novos'() {
    const { values: v } = opcoes({ json: { type: 'boolean' }, tarefa: { type: 'string' } });
    let a;
    if (v.tarefa === undefined) a = exigirAtiva();
    else {
      if (!nomeTarefaValido(v.tarefa)) throw new ErroUso('--tarefa deve ser só o nome da pasta da tarefa em .nabuco/tarefas (sem barra nem ..)');
      a = { nome: v.tarefa, dir: join(dirTarefas(projeto), v.tarefa) };
      if (!existsSync(join(a.dir, 'estado.json'))) throw new ErroRegra(`tarefa "${v.tarefa}" não existe em .nabuco/tarefas`);
    }
    const estado = ler(a, 'estado.json');
    const atuais = naoRastreados(projeto);
    const antes = Array.isArray(estado.nao_rastreados) ? new Set(estado.nao_rastreados) : null;
    const criada = Date.parse(estado.criada);
    const mudouDepois = f => { try { return statSync(join(projeto, f)).mtimeMs > criada; } catch { return false; } };
    const novos = (atuais ?? []).filter(f => !antes?.has(f));
    const rastreados = estado.base ? rastreadosAlterados(projeto, estado.base) : null;
    // confiável só com base, não rastreados de quando nasceu e as duas listas de agora
    const confiavel = Boolean(rastreados && antes && atuais);
    const r = {
      tarefa: a.nome,
      registrado: Boolean(antes),
      diff: estado.base ? `git diff ${estado.base}` : 'git diff',
      novos,
      alterados_sem_diff: antes && atuais ? atuais.filter(f => antes.has(f) && mudouDepois(f)) : [],
      listou: Boolean(atuais),
      rastreados_alterados: rastreados,
      confiavel,
      commit: confiavel ? [...new Set([...rastreados, ...novos])].sort() : null,
    };
    if (v.json) { console.log(JSON.stringify(r, null, 2)); return; }
    const itens = l => (l.length ? l.map(f => `  - ${f}`).join('\n') : '  (nenhum)');
    console.log(`diff: ${r.diff}`);
    if (r.listou) {
      if (!r.registrado) console.log('esta tarefa não gravou os não rastreados ao nascer: todos os atuais vão como novos');
      console.log(`não rastreados novos (entregue o conteúdo):\n${itens(r.novos)}`);
      console.log(`não rastreados de antes alterados nesta tarefa (sem diff possível: entregue o arquivo inteiro e avise o checador):\n${itens(r.alterados_sem_diff)}`);
    } else console.log('não consegui listar os não rastreados (fora de um repositório git ou lista grande demais)');
    if (r.confiavel) console.log(`para commit (rastreados alterados desde a base + não rastreados novos; git add só destes):\n${itens(r.commit)}`);
    else console.log('lista para commit não confiável (sem base, sem os não rastreados de quando a tarefa nasceu ou git falhou): pergunte ao usuário quais arquivos entram antes de commitar');
  },

  status() {
    // fila: null sem fila.json; { erro } se ilegível (o status nunca falha por causa dela)
    const a = lerAtiva(projeto);
    let fila = null;
    if (existsSync(arquivoFila(projeto))) {
      try { fila = resumoFila(lerFila(projeto), a?.nome ?? null); } catch (e) { fila = { erro: e.message }; }
    }
    if (!a) { console.log(JSON.stringify({ ativa: null, fila }, null, 2)); return; }
    const c = ler(a, 'criterios.json');
    const p = pendencias(c);
    const lista = Array.isArray(c.criterios) ? c.criterios : [];
    const estado = ler(a, 'estado.json');
    // a lista inteira fica no estado.json (e sai em `arquivos-novos`); aqui só a contagem
    if (Array.isArray(estado.nao_rastreados)) estado.nao_rastreados = estado.nao_rastreados.length;
    console.log(JSON.stringify({
      ativa: a.nome, dir: a.dir, estado,
      criterios: { total: lista.length, passou: lista.filter(x => x.status === 'passou' && String(x.evidencia ?? '').trim()).length, pendencias: lista.length ? p : [] },
      fila,
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
