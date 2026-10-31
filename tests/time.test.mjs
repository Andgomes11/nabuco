import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { PAPEIS, PAPEIS_CEREBRO, ESCRITORES } from '../scripts/lib/constantes.mjs';
import { normalizarPapel } from '../scripts/evento.mjs';
import { calcularMetricas } from '../scripts/lib/metricas.mjs';
import { validarCaso, lerCasos } from '../scripts/lib/casos.mjs';
import { montarEstado } from '../scripts/lib/painel-estado.mjs';
import { iniciar } from '../scripts/painel/servidor.mjs';

// Funcionário contratado reconhecido pelo resto do nabuco. Nunca toca ~/.nabuco, ~/.claude ou ~/.codex reais.
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
let base, env, home, claude, codex, proj;
const script = s => join(RAIZ, 'scripts', s);
const run = (s, args = [], { input = '', cwd = proj } = {}) =>
  spawnSync(process.execPath, [script(s), ...args], { cwd, input, encoding: 'utf8', env });

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'nabuco time-'));
  home = join(base, 'nabuco');
  claude = join(base, 'claude');
  codex = join(base, 'codex');
  proj = join(base, 'Meu projeto');
  mkdirSync(join(proj, '.git'), { recursive: true });
  env = { ...process.env, NABUCO_HOME: home, CLAUDE_CONFIG_DIR: claude, CODEX_HOME: codex, NABUCO_HARNESS: 'claude' };
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const CORPO = [
  '# Redator — time nabuco', '', 'Você é o Redator: escreve notas de release.', '',
  '## Entrega', '- **mudanças:** arquivos', '- **lições usadas:** id de cada lição com 👍 ou 👎', '- **bloqueios:** ou "nenhum"', '',
].join('\n');
const contratacao = (extra = {}) => ({
  papel: 'redator', nome: 'Redator', tipo: 'escritor', descricao: 'Escreve notas de release e changelog.',
  ferramentas: ['Read', 'Grep', 'Glob', 'Edit', 'Write'], corpo: CORPO,
  claude: { model: 'sonnet', effort: 'medium' }, codex: { model: null, effort: 'low' }, ...extra,
});
function contratar(extra = {}, codexModo = 'sim') {
  const arq = join(base, `contratacao-${extra.papel ?? 'redator'}.json`);
  writeFileSync(arq, JSON.stringify(contratacao(extra)));
  const r = run('contratar.mjs', ['novo', '--de', arq, '--codex', codexModo]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
}
const LICAO = {
  papel: 'redator', titulo: 'Conferir as datas do changelog', gatilho: 'ao escrever o changelog de uma versão',
  expectativa: 'datas iguais às das tags', faca: 'conferir a data de cada versão no git', porque: 'data errada confunde quem atualiza',
  evidencia: ['casos/redator/2026-10-changelog.md'],
};
function licaoAdd(l = LICAO) {
  const arq = join(base, 'licao.json');
  writeFileSync(arq, JSON.stringify(l));
  return run('cerebro.mjs', ['licao-add', '--de', arq]);
}
const hook = payload => run('evento.mjs', ['--hook'], { input: JSON.stringify({ cwd: proj, ...payload }) });
const hist = () => (existsSync(join(home, 'historico.jsonl'))
  ? readFileSync(join(home, 'historico.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []);
const novaTarefa = (slug = 'x') => {
  const r = run('tarefa.mjs', ['nova', '--slug', slug, '--tamanho', 'media', '--tipo', 'bug']);
  assert.equal(r.status, 0, r.stderr);
};

// ---------- libs: listas por parâmetro, padrão nos embutidos ----------

test('normalizarPapel: contratado só com prefixo nabuco- e só se estiver na lista', () => {
  const lista = [...PAPEIS, 'redator'];
  assert.equal(normalizarPapel('nabuco-redator', lista), 'redator');
  assert.equal(normalizarPapel('nabuco:redator', lista), 'redator');
  assert.equal(normalizarPapel('redator', lista), null); // agente alheio de mesmo nome não vira funcionário
  assert.equal(normalizarPapel('nabuco-redator'), null); // sem lista: só os embutidos
  assert.equal(normalizarPapel('nabuco-dev', lista), 'dev');
  assert.equal(normalizarPapel('dev'), 'dev');
});

test('calcularMetricas/validarCaso/lerCasos/montarEstado: padrão nos embutidos, contratado por parâmetro', () => {
  assert.deepEqual(Object.keys(calcularMetricas([])), PAPEIS_CEREBRO);
  const m = calcularMetricas([], { papeis: [...PAPEIS_CEREBRO, 'redator'], escritores: [...ESCRITORES, 'redator'] });
  assert.ok(m.redator && m.redator.escapes === 0);
  assert.match(validarCaso({ papel: 'redator', sintoma: 's', causa_raiz: 'c', correcao: 'c', verificacao: 'v' }).join(), /papel inválido/);
  assert.deepEqual(validarCaso({ papel: 'redator', sintoma: 's', causa_raiz: 'c', correcao: 'c', verificacao: 'v' }, [...PAPEIS_CEREBRO, 'redator']), []);
  mkdirSync(join(home, 'casos', 'redator'), { recursive: true });
  writeFileSync(join(home, 'casos', 'redator', '2026-10-a.md'), 'sintoma: s\n');
  assert.equal(lerCasos(home).length, 0);
  assert.equal(lerCasos(home, undefined, [...PAPEIS_CEREBRO, 'redator']).length, 1);
  assert.equal(montarEstado({ eventos: [], projeto: 'p', agora: 0 }).funcionarios.length, 10);
  const est = montarEstado({ eventos: [], projeto: 'p', agora: 0, funcionarios: ['gerente', ...PAPEIS, 'redator'] });
  assert.deepEqual(est.funcionarios.at(-1), { papel: 'redator', nome: 'redator', estado: 'ocioso', atividade: 0, nivel: null, nivelNum: null, amostra: 0, naTarefaAberta: false, provisorio: true, avatar: null, cinza: true });
});

// ---------- cérebro ----------

test('cérebro: licao-add, buscar, voto, licoes, casos e metricas aceitam --papel do contratado', () => {
  contratar();
  novaTarefa();
  const add = licaoAdd();
  assert.equal(add.status, 0, add.stderr);
  assert.equal(add.stdout.trim(), 'redator-0001');
  assert.ok(existsSync(join(home, 'licoes', 'redator.md')));

  const b = run('cerebro.mjs', ['buscar', '--papel', 'redator', '--texto', 'changelog datas versão', '--json']);
  assert.equal(b.status, 0, b.stderr);
  assert.deepEqual(JSON.parse(b.stdout).map(x => x.id), ['redator-0001']);

  const voto = run('cerebro.mjs', ['voto', '--id', 'redator-0001', '--util', 'sim']);
  assert.equal(voto.status, 0, voto.stderr);
  assert.match(readFileSync(join(home, 'licoes', 'redator.md'), 'utf8'), /👍 1/);

  const l = run('cerebro.mjs', ['licoes', '--papel', 'redator']);
  assert.equal(l.status, 0, l.stderr);
  assert.equal(JSON.parse(l.stdout)[0].id, 'redator-0001');
  assert.ok(JSON.parse(run('cerebro.mjs', ['licoes']).stdout).some(x => x.id === 'redator-0001'));

  const casoArq = join(base, 'caso.json');
  writeFileSync(casoArq, JSON.stringify({ papel: 'redator', sintoma: 'data errada', causa_raiz: 'copiou', correcao: 'git log', verificacao: 'conferido' }));
  const caso = run('cerebro.mjs', ['caso-add', '--de', casoArq]);
  assert.equal(caso.status, 0, caso.stderr);
  assert.equal(JSON.parse(run('cerebro.mjs', ['casos']).stdout).filter(c => c.papel === 'redator').length, 1);

  // escritor contratado: aceitação na 1ª calculada a partir do agente_inicio do hook
  assert.equal(hook({ hook_event_name: 'SubagentStart', agent_type: 'nabuco-redator', agent_id: 'r1' }).status, 0);
  assert.equal(run('evento.mjs', ['tarefa_fechada']).status, 0);
  const m = run('cerebro.mjs', ['metricas', '--papel', 'redator', '--json']);
  assert.equal(m.status, 0, m.stderr);
  const met = JSON.parse(m.stdout);
  assert.deepEqual(Object.keys(met), ['redator']);
  assert.equal(met.redator.amostra, 1);
  assert.equal(met.redator.aceitacao_1a, 1);
  assert.equal(met.redator.pct_util, 1);
  const todas = JSON.parse(run('cerebro.mjs', ['metricas', '--json']).stdout);
  assert.ok(todas.redator && todas.gerente && todas.dev);
  assert.match(run('cerebro.mjs', ['metricas']).stdout, /^redator\s/m);
});

test('cérebro: checador contratado não ganha aceitação na 1ª (não é escritor)', () => {
  contratar({ papel: 'leitor', nome: 'Leitor', tipo: 'checador', ferramentas: ['Read', 'Grep'] });
  novaTarefa();
  assert.equal(hook({ hook_event_name: 'SubagentStart', agent_type: 'nabuco-leitor', agent_id: 'l1' }).status, 0);
  run('evento.mjs', ['tarefa_fechada']);
  const met = JSON.parse(run('cerebro.mjs', ['metricas', '--papel', 'leitor', '--json']).stdout);
  assert.equal(met.leitor.amostra, 1);
  assert.equal(met.leitor.aceitacao_1a, null);
  assert.equal(met.leitor.escapes, 0); // checador também conta escapes (métricas dos checadores)
});

// ---------- eventos ----------

test('evento --hook: agent_type nabuco-<p> registra papel, modelo e effort do contratado', () => {
  contratar();
  novaTarefa();
  assert.equal(hook({ hook_event_name: 'SubagentStart', agent_type: 'nabuco-redator', agent_id: 'a1' }).status, 0);
  assert.equal(hook({ hook_event_name: 'SubagentStop', agent_type: 'nabuco-redator', agent_id: 'a1' }).status, 0);
  const [i, f] = hist().filter(e => e.tipo.startsWith('agente_'));
  assert.equal(i.papel, 'redator');
  assert.deepEqual([i.dados.modelo, i.dados.effort], ['sonnet', 'medium']);
  assert.equal(f.papel, 'redator');
  assert.equal(typeof f.dados.duracao_ms, 'number');
  // no Codex vale o modelo do Codex (null = herdado)
  env.NABUCO_HARNESS = 'codex';
  hook({ hook_event_name: 'SubagentStart', agent_type: 'nabuco-redator', agent_id: 'a2' });
  const c = hist().at(-1);
  assert.deepEqual([c.papel, c.dados.modelo, c.dados.effort], ['redator', 'herdado', 'low']);
  // embutido continua com o modelo do plugin
  env.NABUCO_HARNESS = 'claude';
  hook({ hook_event_name: 'SubagentStart', agent_type: 'nabuco:revisor', agent_id: 'a3' });
  assert.deepEqual([hist().at(-1).papel, hist().at(-1).dados.modelo], ['revisor', 'opus']);
});

test('tarefa delegar aceita o contratado e recusa papel desconhecido', () => {
  contratar();
  novaTarefa();
  const r = run('tarefa.mjs', ['delegar', '--papel', 'redator', '--passo=escrever o changelog']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(hist().filter(e => e.tipo === 'delegacao').at(-1).dados, { para: 'redator', passo: 'escrever o changelog' });
  assert.equal(run('tarefa.mjs', ['delegar', '--papel', 'fulano', '--passo=x']).status, 2);
});

// ---------- painel ----------

test('painel: /api/estado inclui o contratado com avatar null e /api/dossie/<p> responde 200', async () => {
  contratar();
  novaTarefa();
  licaoAdd();
  hook({ hook_event_name: 'SubagentStart', agent_type: 'nabuco-redator', agent_id: 'p1' });
  run('evento.mjs', ['tarefa_fechada']);
  const homeAntes = process.env.NABUCO_HOME;
  process.env.NABUCO_HOME = home; // lições do dossiê vêm de nabucoHome()
  const srv = await iniciar({ porta: 0, raiz: RAIZ, projeto: proj, home, observar: false });
  try {
    const pedir = async c => fetch(`http://127.0.0.1:${srv.porta}${c}`, { headers: { 'x-nabuco-chave': srv.chave } });
    const est = await (await pedir('/api/estado')).json();
    assert.equal(est.funcionarios.length, 11);
    const r = est.funcionarios.find(f => f.papel === 'redator');
    assert.equal(r.nome, 'Redator');
    assert.equal(r.avatar, null);
    assert.equal(r.amostra, 1);
    assert.equal(r.nivel, null); // 1 tarefa: em avaliação (nível só a partir de AMOSTRA_NIVEL tarefas)
    const d = await pedir('/api/dossie/redator');
    assert.equal(d.status, 200);
    const dossie = await d.json();
    assert.equal(dossie.nome, 'Redator');
    assert.deepEqual(dossie.equipamento, { claude: 'sonnet/medium', codex: '(sessão)/low' });
    assert.equal(dossie.metricas.aceitacao_1a, 1);
    assert.deepEqual(dossie.licoes.map(x => x.id), ['redator-0001']);
    const f = await pedir(`/api/fontes/redator/aceitacao_1a?v=${dossie.versao}`);
    assert.equal(f.status, 200);
    assert.equal((await f.json()).eventos.length, 1);
    const naoExiste = await pedir('/api/dossie/fulano');
    assert.equal(naoExiste.status, 404);
    await naoExiste.text();
  } finally {
    await srv.fechar();
    if (homeAntes === undefined) delete process.env.NABUCO_HOME; else process.env.NABUCO_HOME = homeAntes;
  }
});

// ---------- status ----------

test('status: seção Contratados com tipo, modelos e instalação; aviso de registro inválido aparece', () => {
  run('setup.mjs', ['--codex', 'sim']);
  contratar();
  let s = run('status.mjs');
  assert.equal(s.status, 0, s.stderr);
  assert.match(s.stdout, /Contratado\s+Tipo\s+Claude\s+Codex/);
  assert.match(s.stdout, /redator\s+escritor\s+sonnet\/medium\s+\(sessão\)\/low/);
  assert.match(s.stdout, /✅ redator: Claude atualizado · Codex atualizado/);

  // agente gerado editado à mão (marca mantida) e toml ausente: desatualizado / não instalado
  const md = join(claude, 'agents', 'nabuco-redator.md');
  writeFileSync(md, readFileSync(md, 'utf8').replace('Escreve notas', 'Mexido'));
  rmSync(join(codex, 'agents', 'nabuco-redator.toml'));
  // registro inválido ao lado: vira aviso, o válido continua listado
  writeFileSync(join(home, 'time', 'papeis', 'quebrado.md'), '---\nnome: Quebrado\n---\nsem nada\n');
  s = run('status.mjs');
  assert.equal(s.status, 0, s.stderr);
  assert.match(s.stdout, /⚠️ redator: Claude desatualizado · Codex não instalado — rode "contratar instalar --papel redator"/);
  assert.match(s.stdout, /⚠️ registro do time: time\/papeis\/quebrado\.md ignorado/);
  assert.match(s.stdout, /redator\s+escritor/);
});

test('status: agente Claude ou toml sem a marca do nabuco aparece como alheio', () => {
  contratar();
  writeFileSync(join(claude, 'agents', 'nabuco-redator.md'), '---\nname: nabuco-redator\n---\nmeu agente\n');
  writeFileSync(join(codex, 'agents', 'nabuco-redator.toml'), 'name = "meu"\n');
  const s = run('status.mjs');
  assert.equal(s.status, 0, s.stderr);
  assert.match(s.stdout, /⚠️ redator: Claude alheio \(não é do nabuco\) · Codex alheio \(não é do nabuco\)/);
  assert.doesNotMatch(s.stdout, /redator: Claude desatualizado/);
});

test('status: sem contratados avisa só o essencial; modelos.json do time ilegível vira aviso', () => {
  let s = run('status.mjs');
  assert.equal(s.status, 0, s.stderr);
  assert.match(s.stdout, /ℹ️ nenhum funcionário contratado/);
  contratar();
  writeFileSync(join(home, 'time', 'modelos.json'), '{quebrado');
  s = run('status.mjs');
  assert.equal(s.status, 0, s.stderr);
  assert.match(s.stdout, /⚠️ registro do time: time\/modelos\.json ilegível/);
  assert.doesNotMatch(s.stdout, /nenhum funcionário contratado/);
});

// ---------- setup ----------

test('setup: reinstala os contratados e respeita --codex', () => {
  contratar();
  const md = join(claude, 'agents', 'nabuco-redator.md');
  const toml = join(codex, 'agents', 'nabuco-redator.toml');
  const original = { md: readFileSync(md, 'utf8'), toml: readFileSync(toml, 'utf8') };
  rmSync(md); rmSync(toml);

  let r = run('setup.mjs', ['--codex', 'nao']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /redator: Claude criado, Codex pulado/);
  assert.equal(readFileSync(md, 'utf8'), original.md);
  assert.ok(!existsSync(toml));

  writeFileSync(md, original.md.replace('Escreve notas', 'Mexido'));
  r = run('setup.mjs', ['--codex', 'sim']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /redator: Claude atualizado, Codex criado/);
  assert.equal(readFileSync(md, 'utf8'), original.md);
  assert.equal(readFileSync(toml, 'utf8'), original.toml);
});

test('setup: agente Claude sem a marca do nabuco não é sobrescrito', () => {
  contratar();
  const md = join(claude, 'agents', 'nabuco-redator.md');
  writeFileSync(md, 'meu agente');
  const r = run('setup.mjs', ['--codex', 'nao']);
  assert.match(r.stdout + r.stderr, /redator: Claude alheio, Codex pulado/);
  assert.equal(readFileSync(md, 'utf8'), 'meu agente');
});

test('setup: registro inválido aparece como aviso e o setup conclui', () => {
  contratar();
  writeFileSync(join(home, 'time', 'papeis', 'quebrado.md'), '---\nnome: Quebrado\n---\nsem nada\n');
  const r = run('setup.mjs', ['--codex', 'nao']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /redator: Claude sem mudança, Codex pulado/);
  assert.match(r.stdout, /⚠️ .*quebrado\.md ignorado/);
  assert.match(r.stdout, /Setup concluído/);
});

test('setup sem contratados não mostra nada sobre eles', () => {
  const r = run('setup.mjs', ['--codex', 'nao']);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /contratad/i);
});

// ---------- remover ----------

test('depois de remover, o cérebro recusa --papel do ex-contratado e as lições ficam no disco', () => {
  contratar();
  novaTarefa();
  assert.equal(licaoAdd().status, 0);
  const rm = run('contratar.mjs', ['remover', '--papel', 'redator']);
  assert.equal(rm.status, 0, rm.stderr);

  for (const args of [['buscar', '--papel', 'redator', '--texto', 'changelog'], ['metricas', '--papel', 'redator'], ['licoes', '--papel', 'redator']]) {
    const r = run('cerebro.mjs', args);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, /--papel deve ser/);
  }
  const add = licaoAdd({ ...LICAO, titulo: 'Outra lição bem diferente', gatilho: 'ao revisar o readme' });
  assert.equal(add.status, 1);
  assert.match(add.stderr, /papel deve ser/);
  const voto = run('cerebro.mjs', ['voto', '--id', 'redator-0001', '--util', 'sim']);
  assert.equal(voto.status, 1);
  assert.match(voto.stderr, /não encontrada/);
  assert.match(readFileSync(join(home, 'licoes', 'redator.md'), 'utf8'), /redator-0001/);

  // evento do agente antigo não vira papel
  hook({ hook_event_name: 'SubagentStart', agent_type: 'nabuco-redator', agent_id: 'z' });
  const e = hist().at(-1);
  assert.equal(e.papel, null);
  assert.equal(e.dados.agente, 'nabuco-redator');
  // recontratar com o mesmo nome herda as lições
  contratar();
  const b = run('cerebro.mjs', ['buscar', '--papel', 'redator', '--texto', 'changelog datas versão', '--json']);
  assert.deepEqual(JSON.parse(b.stdout).map(x => x.id), ['redator-0001']);
});
