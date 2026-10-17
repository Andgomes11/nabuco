import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'cerebro.mjs');
let base, proj, home;
const run = args => spawnSync(process.execPath, [CLI, ...args], { cwd: proj, encoding: 'utf8', env: { ...process.env, NABUCO_HOME: home, NABUCO_HARNESS: 'claude' } });
const caso = (o = {}) => ({ papel: 'dev', sintoma: 'Falha no build por cache', causa_raiz: 'cache velho', correcao: 'limpar', verificacao: 'npm test → ok', tags: ['cache', 'build'], ...o });
const arq = (nome, dados) => { const p = join(base, nome); writeFileSync(p, typeof dados === 'string' ? dados : JSON.stringify(dados)); return p; };
const hist = () => readFileSync(join(home, 'historico.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'nabuco cb-'));
  proj = join(base, 'Nova pasta'); home = join(base, 'home');
  mkdirSync(join(proj, '.git'), { recursive: true });
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

test('caso-add grava e registra evento', () => {
  const r = run(['caso-add', '--de', arq('caso.json', caso())]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(home, r.stdout.trim())));
  const e = hist().find(x => x.tipo === 'caso_criado');
  assert.equal(e.papel, 'dev'); assert.equal(e.dados.arquivo, r.stdout.trim());
});

test('caso-add commita na home com git', () => {
  mkdirSync(home, { recursive: true });
  spawnSync('git', ['init', '-q', home]);
  spawnSync('git', ['-C', home, 'config', 'user.email', 't@t']);
  spawnSync('git', ['-C', home, 'config', 'user.name', 'T']);
  spawnSync('git', ['-C', home, 'config', 'commit.gpgsign', 'false']);
  const r = run(['caso-add', '--de', arq('caso.json', caso())]);
  assert.equal(r.status, 0, r.stderr);
  const log = spawnSync('git', ['-C', home, 'log', '--oneline'], { encoding: 'utf8' }).stdout.trim().split('\n');
  assert.equal(log.length, 1); assert.match(log[0], /caso: casos\/dev\//);
});

test('caso-add sem git na home: exit 0 e aviso em stderr', () => {
  const r = run(['caso-add', '--de', arq('caso.json', caso())]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /git/);
  assert.doesNotMatch(r.stdout, /git/);
});

test('caso-add sem verificacao → exit 1 e nada gravado', () => {
  const c = caso(); delete c.verificacao;
  const r = run(['caso-add', '--de', arq('caso.json', c)]);
  assert.equal(r.status, 1);
  assert.ok(!existsSync(join(home, 'casos')));
});

test('--de inexistente, ausente ou JSON inválido → exit 2', () => {
  assert.equal(run(['caso-add', '--de', join(base, 'nada.json')]).status, 2);
  assert.equal(run(['caso-add']).status, 2);
  assert.equal(run(['caso-add', '--de', arq('ruim.json', '{nao json')]).status, 2);
});

test('casos lista e filtra por papel; home vazia → []', () => {
  assert.deepEqual(JSON.parse(run(['casos']).stdout), []);
  run(['caso-add', '--de', arq('c.json', caso())]);
  const l = JSON.parse(run(['casos', '--papel', 'dev']).stdout);
  assert.equal(l.length, 1); assert.deepEqual(l[0].tags, ['cache', 'build']); assert.equal(l[0].papel, 'dev');
  assert.deepEqual(JSON.parse(run(['casos', '--papel', 'revisor']).stdout), []);
  assert.equal(run(['casos', '--papel', 'chefe']).status, 2);
});

test('similares', () => {
  const vazio = run(['similares', '--de', arq('n.json', caso())]);
  assert.equal(vazio.status, 0, vazio.stderr);
  assert.deepEqual(JSON.parse(vazio.stdout), { similares: [], destilar: false });
  run(['caso-add', '--de', arq('c.json', caso())]);
  const par = JSON.parse(run(['similares', '--de', arq('n.json', caso({ sintoma: 'Falha no build, cache' }))]).stdout);
  assert.equal(par.destilar, true); assert.equal(par.similares.length, 1); assert.ok(par.similares[0].score >= 0.4);
  const dif = JSON.parse(run(['similares', '--de', arq('d.json', caso({ sintoma: 'Layout quebrado no mobile', tags: ['css'] }))]).stdout);
  assert.deepEqual(dif, { similares: [], destilar: false });
  const caro = JSON.parse(run(['similares', '--de', arq('k.json', caso({ sintoma: 'Layout quebrado no mobile', tags: ['css'], turnos: 8 }))]).stdout);
  assert.equal(caro.destilar, true);
});

test('comando desconhecido → exit 2', () => {
  assert.equal(run(['xyz']).status, 2);
});

// ---------- lições ----------
const licao = (o = {}) => ({ papel: 'dev', titulo: 'Limpe o cache antes de rebuildar', gatilho: 'build falha com módulo desatualizado', expectativa: 'após limpar, build passa', faca: 'apagar node_modules/.cache', porque: 'cache guarda versão velha', evidencia: ['casos/dev/2026-10-cache.md'], escopo: 'global', ...o });
const gitHome = () => {
  mkdirSync(home, { recursive: true });
  spawnSync('git', ['init', '-q', home]);
  for (const [k, v] of [['user.email', 't@t'], ['user.name', 'T'], ['commit.gpgsign', 'false']]) spawnSync('git', ['-C', home, 'config', k, v]);
};
const logHome = () => { const r = spawnSync('git', ['-C', home, 'log', '--oneline'], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim().split('\n').filter(Boolean) : []; };
const globalDev = () => join(home, 'licoes', 'dev.md');
let nLic = 0;
const addLicao = (o, extra = []) => run(['licao-add', '--de', arq(`l${nLic++}.json`, licao(o)), ...extra]);
const distintas = i => ({ titulo: `Assunto${i} alfa${i}`, gatilho: `beta${i} gama${i} delta${i}` });

test('licao-add imprime dev-0001, grava cabeçalho e bloco, registra evento e commita', () => {
  gitHome();
  const r = addLicao();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'dev-0001');
  const t = readFileSync(globalDev(), 'utf8');
  assert.match(t, /^# Lições — dev\n/);
  assert.match(t, /^## dev-0001 · Limpe o cache antes de rebuildar$/m);
  assert.match(t, /^- 👍 0  👎 0 · última: \d{4}-\d{2}-\d{2}$/m);
  assert.match(t, /^- evidência: casos\/dev\/2026-10-cache\.md · escopo: global$/m);
  const e = hist().find(x => x.tipo === 'licao_criada');
  assert.equal(e.papel, 'dev'); assert.deepEqual(e.dados, { id: 'dev-0001', escopo: 'global' });
  assert.match(logHome()[0], /licao: criar dev-0001/);
});

test('licao-add sem evidência, papel ou escopo inválido → exit 1 e nada gravado', () => {
  assert.equal(addLicao({ evidencia: [] }).status, 1);
  assert.equal(addLicao({ papel: 'chefe' }).status, 1);
  assert.equal(addLicao({ escopo: 'mundo' }).status, 1);
  assert.ok(!existsSync(globalDev()));
});

test('licao-add duplicata → exit 1 citando o id; --forcar cria dev-0002', () => {
  addLicao();
  const dup = addLicao({ titulo: 'Limpe o cache antes de rebuildar!' });
  assert.equal(dup.status, 1);
  assert.match(dup.stdout + dup.stderr, /dev-0001/);
  const f = addLicao({ titulo: 'Limpe o cache antes de rebuildar!' }, ['--forcar']);
  assert.equal(f.status, 0, f.stderr);
  assert.equal(f.stdout.trim(), 'dev-0002');
});

test('limite de 30 ativas: a 31ª é recusada; promovidas não contam', () => {
  for (let i = 0; i < 30; i++) assert.equal(addLicao(distintas(i)).status, 0);
  const r = addLicao(distintas(30));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /higiene/);
  assert.equal(run(['promover', '--id', 'dev-0001', '--regra=lint no-cache']).status, 0);
  const ok = addLicao(distintas(31));
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stdout.trim(), 'dev-0031');
});

test('voto incrementa e é delta: o resto do arquivo fica byte a byte igual', () => {
  addLicao();
  addLicao(distintas(1));
  writeFileSync(globalDev(), readFileSync(globalDev(), 'utf8') + '\nTexto livre do usuário.\n');
  const antes = readFileSync(globalDev(), 'utf8');
  assert.equal(run(['voto', '--id', 'dev-0001', '--util', 'sim']).status, 0);
  assert.equal(run(['voto', '--id', 'dev-0001', '--util', 'sim']).status, 0);
  const r = run(['voto', '--id', 'dev-0001', '--util', 'nao']);
  assert.equal(r.status, 0, r.stderr);
  const depois = readFileSync(globalDev(), 'utf8');
  const esperado = antes.replace(/- 👍 0  👎 0 · última: (\S+)/, (_, d) => `- 👍 2  👎 1 · última: ${d}`);
  assert.equal(depois, esperado);
  const usos = hist().filter(x => x.tipo === 'licao_usada');
  assert.equal(usos.length, 3);
  assert.equal(usos[0].papel, 'dev');
  assert.deepEqual(usos.map(u => u.dados.util), [true, true, false]);
  assert.equal(run(['voto', '--id', 'dev-0001', '--util', 'talvez']).status, 2);
});

test('aposentar → some de licoes e aparece no arquivo morto', () => {
  addLicao(); addLicao(distintas(1));
  const r = run(['aposentar', '--id', 'dev-0001', '--motivo=obsoleta']);
  assert.equal(r.status, 0, r.stderr);
  const l = JSON.parse(run(['licoes']).stdout);
  assert.deepEqual(l.map(x => x.id), ['dev-0002']);
  const morto = readFileSync(join(home, 'licoes', 'arquivo', 'dev.md'), 'utf8');
  assert.match(morto, /^## dev-0001 · /m);
  assert.match(morto, /^- aposentada: \d{4}-\d{2}-\d{2} · obsoleta$/m);
  assert.doesNotMatch(readFileSync(globalDev(), 'utf8'), /dev-0001/);
  assert.ok(hist().some(x => x.tipo === 'licao_aposentada' && x.dados.id === 'dev-0001'));
  // id do arquivo morto não é reutilizado
  assert.equal(addLicao(distintas(2)).stdout.trim(), 'dev-0003');
});

test('promover → licoes não lista; --todas lista com regra', () => {
  addLicao();
  const r = run(['promover', '--id', 'dev-0001', '--regra=hook pre-commit']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(run(['licoes']).stdout), []);
  const todas = JSON.parse(run(['licoes', '--todas']).stdout);
  assert.equal(todas.length, 1); assert.equal(todas[0].regra, 'hook pre-commit'); assert.equal(todas[0].escopo, 'global');
  assert.equal(todas[0].bruto, undefined);
  const e = hist().find(x => x.tipo === 'licao_promovida');
  assert.deepEqual(e.dados, { id: 'dev-0001', regra: 'hook pre-commit' });
});

test('licoes filtra por papel e marca escopo', () => {
  addLicao();
  addLicao({ papel: 'tester', escopo: 'projeto' });
  const l = JSON.parse(run(['licoes']).stdout);
  assert.deepEqual(l.map(x => [x.id, x.escopo]).sort(), [['dev-0001', 'global'], ['tester-0001', 'projeto']]);
  assert.deepEqual(JSON.parse(run(['licoes', '--papel', 'tester']).stdout).map(x => x.id), ['tester-0001']);
  assert.equal(run(['licoes', '--papel', 'chefe']).status, 2);
});

test('escopo projeto não commita; mover para global com id ocupado renumera (Review Focus 5)', () => {
  gitHome();
  const g = addLicao(distintas(1));
  assert.equal(g.stdout.trim(), 'dev-0001');
  const commitsAntes = logHome().length;
  // lição de projeto numerada independentemente (outro projeto / antes da global)
  const arqProj = join(proj, '.nabuco', 'licoes', 'dev.md');
  mkdirSync(dirname(arqProj), { recursive: true });
  writeFileSync(arqProj, '# Lições — dev\n\n## dev-0001 · Rode o lint antes\n- gatilho: lint quebra no CI\n- expectativa: x\n- faça: npm run lint\nnota do usuário\n- por quê: y\n- evidência: casos/dev/a.md · escopo: projeto\n- 👍 3  👎 0 · última: 2026-01-01\n\nTexto livre do projeto.\n');
  const p = addLicao({ ...distintas(2), escopo: 'projeto' });
  assert.equal(p.status, 0, p.stderr);
  assert.equal(p.stdout.trim(), 'dev-0002');
  assert.match(readFileSync(arqProj, 'utf8'), /^## dev-0002 · /m);
  assert.equal(logHome().length, commitsAntes);
  const m = run(['licao-editar', '--id', 'dev-0001', '--escopo', 'global']);
  assert.equal(m.status, 0, m.stderr);
  assert.equal(m.stdout.trim(), 'dev-0003');
  const gt = readFileSync(globalDev(), 'utf8');
  assert.match(gt, /^## dev-0001 · Assunto1/m);
  assert.match(gt, /^## dev-0003 · Rode o lint antes$/m);
  assert.match(gt, /^- 👍 3  👎 0 · última: 2026-01-01$/m);
  assert.match(gt, /evidência: casos\/dev\/a\.md · escopo: global/);
  assert.match(gt, /^nota do usuário$/m);
  const pt = readFileSync(arqProj, 'utf8');
  assert.doesNotMatch(pt, /Rode o lint|nota do usuário/);
  assert.match(pt, /^Texto livre do projeto\.$/m);
  assert.match(pt, /^## dev-0002 · /m);
  const e = hist().filter(x => x.tipo === 'licao_editada').at(-1);
  assert.equal(e.dados.id, 'dev-0003'); assert.equal(e.dados.id_anterior, 'dev-0001');
  assert.ok(e.dados.campos.includes('escopo'));
  assert.equal(logHome().length, commitsAntes + 1);
});

test('licao-editar mescla campos como delta e licao-reforcar acrescenta evidência', () => {
  addLicao(); addLicao(distintas(1));
  const antes = readFileSync(globalDev(), 'utf8');
  const r = run(['licao-editar', '--id', 'dev-0001', '--de', arq('ed.json', { faca: 'rodar npm run clean' })]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(globalDev(), 'utf8'), antes.replace(/- faça: apagar node_modules\/\.cache/, '- faça: rodar npm run clean'));
  assert.deepEqual(hist().filter(x => x.tipo === 'licao_editada').at(-1).dados, { id: 'dev-0001', campos: ['faca'] });
  assert.equal(run(['licao-editar', '--id', 'dev-0001', '--de', arq('ed2.json', { positivos: 99 })]).status, 1);
  const f = run(['licao-reforcar', '--id', 'dev-0001', '--caso', 'casos/dev/2026-10-novo.md']);
  assert.equal(f.status, 0, f.stderr);
  const b = JSON.parse(run(['licoes']).stdout).find(x => x.id === 'dev-0001');
  assert.deepEqual(b.evidencia, ['casos/dev/2026-10-cache.md', 'casos/dev/2026-10-novo.md']);
  assert.deepEqual(hist().filter(x => x.tipo === 'licao_editada').at(-1).dados, { id: 'dev-0001', campos: ['evidencia'] });
});

test('id inexistente → exit 1 em todos os comandos', () => {
  addLicao();
  for (const args of [['voto', '--id', 'dev-9999', '--util', 'sim'], ['aposentar', '--id', 'dev-9999', '--motivo=x'], ['promover', '--id', 'dev-9999', '--regra=x'], ['licao-reforcar', '--id', 'dev-9999', '--caso', 'c.md'], ['licao-editar', '--id', 'dev-9999', '--escopo', 'global'], ['voto', '--id', 'chefe-0001', '--util', 'sim']]) {
    const r = run(args);
    assert.equal(r.status, 1, args.join(' '));
    assert.match(r.stderr, /lição "[a-z]+-\d+" não encontrada/);
  }
});

// ---------- buscar ----------
const licaoBusca = (o = {}) => ({ papel: 'dev', titulo: 'Checar undefined', gatilho: 'TypeError undefined ao chamar map', expectativa: 'array', faca: 'validar antes', porque: 'dados vazios', evidencia: ['[caso](casos/dev/2026-10-x.md)'], ...o });

test('buscar com home vazia → exit 0 e (nenhuma lição relevante)', () => {
  const r = run(['buscar', '--papel', 'dev', '--texto', 'TypeError undefined']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\(nenhuma lição relevante\)/);
  assert.deepEqual(JSON.parse(run(['buscar', '--papel', 'dev', '--texto', 'x y z', '--json']).stdout), []);
});

test('buscar: lição de projeto e global aparecem, projeto primeiro em empate; mostra bloco e caso', () => {
  assert.equal(run(['licao-add', '--de', arq('g.json', licaoBusca())]).status, 0);
  assert.equal(run(['licao-add', '--de', arq('p.json', licaoBusca({ escopo: 'projeto', titulo: 'Outro nome', gatilho: 'TypeError undefined ao chamar map', faca: 'conferir', evidencia: ['[caso2](casos/dev/b.md)'] })), '--forcar']).status, 0);
  const r = run(['buscar', '--papel', 'dev', '--texto', "TypeError: undefined (reading 'map')"]);
  assert.equal(r.status, 0, r.stderr);
  const ordem = [...r.stdout.matchAll(/^## (dev-\d+)/gm)].map(m => m[1]);
  assert.equal(ordem.length, 2);
  const j = JSON.parse(run(['buscar', '--papel', 'dev', '--texto', "TypeError undefined map", '--json']).stdout);
  assert.equal(j.length, 2);
  assert.equal(j[0].id, ordem[0]);
  assert.match(r.stdout, /^caso: \[caso2\]\(casos\/dev\/b\.md\)$/m);
  assert.match(r.stdout, /^- gatilho: /m);
});

test('buscar valida --papel e --texto → exit 2', () => {
  assert.equal(run(['buscar', '--texto', 'x']).status, 2);
  assert.equal(run(['buscar', '--papel', 'chefe', '--texto', 'x']).status, 2);
  assert.equal(run(['buscar', '--papel', 'dev']).status, 2);
});

test('buscar por --arquivos', () => {
  run(['licao-add', '--de', arq('g.json', licaoBusca({ gatilho: 'quebra em user.ts', faca: 'x' }))]);
  const j = JSON.parse(run(['buscar', '--papel', 'dev', '--texto', 'zzzz', '--arquivos', 'src/a/user.ts,b.ts', '--json']).stdout);
  assert.equal(j.length, 1);
});

test('sinais sem nenhuma tarefa → exit 1', () => {
  assert.equal(run(['sinais']).status, 1);
});

test('sinais usa a pasta mais recente e --tarefa inexistente → exit 1', () => {
  for (const n of ['2026-01-01-a', '2026-02-01-b']) mkdirSync(join(proj, '.nabuco', 'tarefas', n), { recursive: true });
  assert.equal(JSON.parse(run(['sinais']).stdout).tarefa, '2026-02-01-b');
  assert.equal(JSON.parse(run(['sinais', '--tarefa', '2026-01-01-a']).stdout).tarefa, '2026-01-01-a');
  assert.equal(run(['sinais', '--tarefa', 'nao-existe']).status, 1);
});

test('higiene com home vazia → []', () => {
  const r = run(['higiene']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), []);
});

test('metricas: home vazia => exit 0 e aviso de sem dados', () => {
  const r = run(['metricas']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /sem dados|não há dados/i);
  const j = run(['metricas', '--json']);
  assert.equal(j.status, 0, j.stderr);
  assert.equal(Object.keys(JSON.parse(j.stdout)).length, 10);
});

test('metricas: tabela e --papel', () => {
  mkdirSync(home, { recursive: true });
  const linhas = [];
  for (let i = 0; i < 4; i++) {
    const b = { projeto: 'p', harness: 'claude', ts: `2026-01-0${i + 1}T00:00:00Z` };
    linhas.push({ ...b, tipo: 'agente_inicio', tarefa: `t${i}`, papel: 'dev', dados: {} }, { ...b, tipo: 'tarefa_fechada', tarefa: `t${i}`, papel: 'gerente', dados: {} });
  }
  writeFileSync(join(home, 'historico.jsonl'), linhas.map(l => JSON.stringify(l)).join('\n') + '\nlixo\n');
  const r = run(['metricas', '--papel', 'dev']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /dev/); assert.match(r.stdout, /provisório/); assert.match(r.stdout, /100%/); assert.match(r.stdout, /—/);
  assert.doesNotMatch(r.stdout, /designer/);
  assert.equal(JSON.parse(run(['metricas', '--papel', 'dev', '--json']).stdout).dev.aceitacao_1a, 1);
  assert.equal(run(['metricas', '--papel', 'xx']).status, 2);
});
