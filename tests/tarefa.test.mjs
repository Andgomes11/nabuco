import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { pendencias } from '../scripts/lib/criterios.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'tarefa.mjs');
let proj, home;

function run(...args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: proj, encoding: 'utf8', env: { ...process.env, NABUCO_HOME: home, NABUCO_HARNESS: 'teste' } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const linhas = f => readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l));

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'nabuco tarefa-'));
  proj = join(base, 'Nova pasta'); home = join(base, 'home');
  mkdirSync(join(proj, '.git'), { recursive: true });
});
afterEach(() => rmSync(dirname(proj), { recursive: true, force: true }));

test('pendencias', () => {
  assert.deepEqual(pendencias({ criterios: [] }), [{ id: '-', motivo: 'nenhum critério definido' }]);
  assert.deepEqual(pendencias({}), [{ id: '-', motivo: 'criterios.json sem lista "criterios"' }]);
  assert.deepEqual(pendencias({ criterios: [
    { id: 'a', status: 'passou', evidencia: 'ok' },
    { id: 'b', status: 'passou', evidencia: '  ' },
    { id: 'c' },
  ] }), [{ id: 'b', motivo: 'passou sem evidência registrada' }, { id: 'c', motivo: 'status "pendente"' }]);
});

test('ciclo completo: nova → critério → aprovar → passou → concluir', () => {
  const n = run('nova', '--slug', 'Login Social!', '--tamanho', 'media', '--tipo', 'feature');
  assert.equal(n.code, 0, n.err);
  const dir = n.out.trim();
  assert.match(dir, /\.nabuco[\\/]tarefas[\\/]\d{4}-\d{2}-\d{2}-login-social$/);
  for (const f of ['estado.json', 'plano.md', 'progresso.md', 'criterios.json']) assert.ok(existsSync(join(dir, f)), f);
  assert.equal(JSON.parse(readFileSync(join(dir, 'estado.json'), 'utf8')).fase, 'planejando');

  assert.equal(run('criterio-add', '--id', 'c1', '--descricao', 'testes passam', '--verificacao', 'npm test').code, 0);
  assert.equal(run('aprovar').code, 0);
  assert.equal(JSON.parse(readFileSync(join(dir, 'estado.json'), 'utf8')).fase, 'executando');

  const c = run('concluir');
  assert.equal(c.code, 1);
  assert.match(c.err, /c1: status "pendente"/);

  assert.equal(run('criterio', '--id', 'c1', '--status', 'passou').code, 2); // passou sem evidência = uso incorreto
  assert.equal(run('criterio', '--id', 'c1', '--status', 'passou', '--evidencia', '12 passed').code, 0);
  assert.equal(run('log', '--texto', 'Dev entregou').code, 0);
  assert.match(readFileSync(join(dir, 'progresso.md'), 'utf8'), /- .+ Dev entregou\n$/);

  assert.equal(run('concluir').code, 0);
  assert.equal(JSON.parse(readFileSync(join(dir, 'estado.json'), 'utf8')).fase, 'concluida');
  assert.equal(JSON.parse(run('status').out).ativa, null);

  const tipos = linhas(join(dir, 'eventos.jsonl')).map(e => e.tipo);
  assert.deepEqual(tipos, ['tarefa_criada', 'criterio', 'plano_aprovado', 'criterio', 'nota', 'tarefa_fechada']);
  const hist = linhas(join(home, 'historico.jsonl'));
  assert.equal(hist.length, 6);
  assert.equal(hist[0].harness, 'teste');
  assert.equal(hist[0].projeto, 'Nova pasta');
});

test('nova recusa segunda tarefa ativa; abandonar libera', () => {
  run('nova', '--slug', 'a', '--tamanho', 'trivial', '--tipo', 'bug');
  const r = run('nova', '--slug', 'b', '--tamanho', 'trivial', '--tipo', 'bug');
  assert.equal(r.code, 1);
  assert.match(r.err, /já existe uma tarefa ativa/);
  assert.equal(run('abandonar', '--motivo', 'mudou o plano').code, 0);
  assert.equal(run('nova', '--slug', 'b', '--tamanho', 'trivial', '--tipo', 'bug').code, 0);
});

test('nova: "ativa" velha apontando para tarefa já concluída/abandonada é limpa', () => {
  for (const fase of ['concluida', 'abandonada']) {
    const dir = run('nova', '--slug', `a-${fase}`, '--tamanho', 'trivial', '--tipo', 'bug').out.trim();
    const est = JSON.parse(readFileSync(join(dir, 'estado.json'), 'utf8'));
    writeFileSync(join(dir, 'estado.json'), JSON.stringify({ ...est, fase }));
    const r = run('nova', '--slug', `b-${fase}`, '--tamanho', 'trivial', '--tipo', 'bug');
    assert.equal(r.code, 0, r.err);
    assert.match(readFileSync(join(proj, '.nabuco', 'ativa'), 'utf8'), new RegExp(`b-${fase}`));
    run('abandonar');
  }
});

test('nova: recusa rodar na pasta global do nabuco', () => {
  const base = mkdtempSync(join(tmpdir(), 'nabuco global-'));
  try {
    const r = spawnSync(process.execPath, [CLI, 'nova', '--slug', 'x', '--tamanho', 'trivial', '--tipo', 'bug'],
      { cwd: base, encoding: 'utf8', env: { ...process.env, NABUCO_HOME: join(base, '.nabuco'), NABUCO_HARNESS: 'teste' } });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /pasta global do nabuco; rode dentro de um projeto/);
    assert.ok(!existsSync(join(base, '.nabuco', 'tarefas')));
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('criterio-add: criterios.json sem lista → erro de regra', () => {
  const dir = run('nova', '--slug', 'x', '--tamanho', 'media', '--tipo', 'bug').out.trim();
  writeFileSync(join(dir, 'criterios.json'), '{"tarefa":"x"}');
  const r = run('criterio-add', '--id', 'c1', '--descricao', 'd', '--verificacao', 'v');
  assert.equal(r.code, 1);
  assert.match(r.err, /criterios\.json inválido/);
});

test('mesmo slug no mesmo dia gera sufixo', () => {
  const a = run('nova', '--slug', 'x', '--tamanho', 'trivial', '--tipo', 'bug').out.trim();
  run('abandonar');
  const b = run('nova', '--slug', 'x', '--tamanho', 'trivial', '--tipo', 'bug').out.trim();
  assert.notEqual(a, b);
  assert.match(b, /-x-2$/);
});

test('validação de argumentos', () => {
  assert.equal(run('nova', '--slug', 'x', '--tamanho', 'enorme', '--tipo', 'bug').code, 2);
  assert.equal(run('nova', '--slug', '!!!', '--tamanho', 'media', '--tipo', 'bug').code, 2);
  assert.equal(run('fase', 'executando').code, 1); // sem tarefa ativa
  run('nova', '--slug', 'x', '--tamanho', 'media', '--tipo', 'bug');
  assert.equal(run('fase', 'voando').code, 2);
  assert.equal(run('criterio', '--id', 'nao-existe', '--status', 'falhou').code, 1);
  assert.equal(run('criterio-add', '--id', 'c1', '--descricao', 'd', '--verificacao', 'v').code, 0);
  assert.equal(run('criterio-add', '--id', 'c1', '--descricao', 'd', '--verificacao', 'v').code, 1); // id duplicado
  assert.equal(run('comando-inexistente').code, 2);
});

test('status com tarefa ativa', () => {
  run('nova', '--slug', 'x', '--tamanho', 'media', '--tipo', 'bug');
  run('criterio-add', '--id', 'c1', '--descricao', 'd', '--verificacao', 'v');
  const s = JSON.parse(run('status').out);
  assert.equal(s.estado.fase, 'planejando');
  assert.deepEqual(s.criterios, { total: 1, passou: 0, pendencias: [{ id: 'c1', motivo: 'status "pendente"' }] });
});

test('criterio --status falhou grava evidência (500 chars) no evento', () => {
  run('nova', '--slug', 'ev', '--tamanho', 'media', '--tipo', 'bug');
  run('criterio-add', '--id', 'c1', '--descricao', 'd', '--verificacao', 'v');
  assert.equal(run('criterio', '--id', 'c1', '--status', 'falhou', '--evidencia=X').code, 0);
  run('criterio', '--id', 'c1', '--status', 'falhou', '--evidencia', 'y'.repeat(600));
  const nome = readFileSync(join(proj, '.nabuco', 'ativa'), 'utf8').trim();
  const evs = linhas(join(proj, '.nabuco', 'tarefas', nome, 'eventos.jsonl')).filter(e => e.tipo === 'criterio' && e.dados.status === 'falhou');
  assert.equal(evs[0].dados.evidencia, 'X');
  assert.equal(evs[1].dados.evidencia.length, 500);
});

test('histórico global não gravável: comando da tarefa avisa e não falha (evento não duplica no retry)', () => {
  assert.equal(run('nova', '--slug', 'x', '--tamanho', 'trivial', '--tipo', 'bug').code, 0);
  const ativa = readFileSync(join(proj, '.nabuco', 'ativa'), 'utf8').trim();
  writeFileSync(join(dirname(proj), 'arquivo'), 'x');
  home = join(dirname(proj), 'arquivo', 'sub'); // mkdir falha: o "pai" é um arquivo
  const r = run('aprovar');
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /histórico global/);
  const tipos = linhas(join(proj, '.nabuco', 'tarefas', ativa, 'eventos.jsonl')).map(e => e.tipo);
  assert.deepEqual(tipos, ['tarefa_criada', 'plano_aprovado']);
});

test('criterio-editar: livre antes do plano aprovado; evento registra a edição', () => {
  run('nova', '--slug', 'x', '--tamanho', 'media', '--tipo', 'bug');
  run('criterio-add', '--id', 'c1', '--descricao', 'd', '--verificacao', 'npm test');
  const r = run('criterio-editar', '--id', 'c1', '--verificacao=node --test');
  assert.equal(r.code, 0, r.err);
  const ativa = readFileSync(join(proj, '.nabuco', 'ativa'), 'utf8').trim();
  const dir = join(proj, '.nabuco', 'tarefas', ativa);
  const [c1] = JSON.parse(readFileSync(join(dir, 'criterios.json'), 'utf8')).criterios;
  assert.equal(c1.verificacao, 'node --test'); assert.equal(c1.descricao, 'd');
  const ev = linhas(join(dir, 'eventos.jsonl')).at(-1);
  assert.equal(ev.tipo, 'criterio');
  assert.deepEqual(ev.dados, { id: 'c1', acao: 'editado', verificacao: { de: 'npm test', para: 'node --test' } });
});

test('criterio-editar: depois do plano aprovado exige --ok-usuario e --motivo; verificação nova zera a evidência', () => {
  run('nova', '--slug', 'x', '--tamanho', 'media', '--tipo', 'bug');
  run('criterio-add', '--id', 'c1', '--descricao', 'd', '--verificacao', 'npm test');
  run('aprovar');
  run('criterio', '--id', 'c1', '--status', 'passou', '--evidencia', '3 passed');
  const sem = run('criterio-editar', '--id', 'c1', '--verificacao=node --test');
  assert.equal(sem.code, 1);
  assert.match(sem.err, /plano já aprovado/);
  assert.equal(run('criterio-editar', '--id', 'c1', '--verificacao=node --test', '--ok-usuario').code, 2); // falta --motivo
  const ok = run('criterio-editar', '--id', 'c1', '--verificacao=node --test', '--motivo=sandbox bloqueia npm', '--ok-usuario');
  assert.equal(ok.code, 0, ok.err);
  const ativa = readFileSync(join(proj, '.nabuco', 'ativa'), 'utf8').trim();
  const dir = join(proj, '.nabuco', 'tarefas', ativa);
  const [c1] = JSON.parse(readFileSync(join(dir, 'criterios.json'), 'utf8')).criterios;
  assert.equal(c1.status, 'pendente'); assert.equal(c1.evidencia, '');
  const ev = linhas(join(dir, 'eventos.jsonl')).at(-1);
  assert.equal(ev.dados.motivo, 'sandbox bloqueia npm'); assert.equal(ev.dados.ok_usuario, true);
});

test('criterio-editar: sem campo para mudar → exit 2; id inexistente → exit 1', () => {
  run('nova', '--slug', 'x', '--tamanho', 'trivial', '--tipo', 'bug');
  run('criterio-add', '--id', 'c1', '--descricao', 'd', '--verificacao', 'v');
  assert.equal(run('criterio-editar', '--id', 'c1').code, 2);
  assert.equal(run('criterio-editar', '--id', 'c9', '--descricao=x').code, 1);
});

test('delegar: registra o passo com o destino em dados.para (papel nulo, para não contar como participação)', () => {
  assert.equal(run('delegar', '--papel', 'dev', '--passo=x').code, 1); // sem tarefa ativa
  const dir = run('nova', '--slug', 'd', '--tamanho', 'trivial', '--tipo', 'feature').out.trim();
  assert.equal(run('delegar', '--papel', 'gerente', '--passo=x').code, 2);
  assert.equal(run('delegar', '--papel', 'dev').code, 2);
  const r = run('delegar', '--papel', 'dev', '--passo=implementar o login');
  assert.equal(r.code, 0, r.err);
  const e = linhas(join(dir, 'eventos.jsonl')).find(x => x.tipo === 'delegacao');
  assert.equal(e.papel, null);
  assert.deepEqual(e.dados, { para: 'dev', passo: 'implementar o login' });
});

// ---------- fila ----------

const FILA_CLI = join(dirname(CLI), 'fila.mjs');
const envTeste = () => ({ ...process.env, NABUCO_HOME: home, NABUCO_HARNESS: 'teste' });
const fila = (...args) => spawnSync(process.execPath, [FILA_CLI, ...args], { cwd: proj, encoding: 'utf8', env: envTeste() });
const arqFila = () => join(proj, '.nabuco', 'fila.json');
const lerFilaJson = () => JSON.parse(readFileSync(arqFila(), 'utf8'));
const estadoDe = dir => JSON.parse(readFileSync(join(dir, 'estado.json'), 'utf8'));
const nomeDe = dir => dir.split(/[\\/]/).pop();

test('fila: nova --fila marca o item em_andamento com a pasta; tarefa_criada leva dados.fila', () => {
  fila('add', '--pedido=a'); fila('add', '--pedido=b');
  const n = run('nova', '--slug', 'b', '--tamanho', 'media', '--tipo', 'feature', '--fila', 'f2');
  assert.equal(n.code, 0, n.err);
  const dir = n.out.trim();
  assert.deepEqual(lerFilaJson().itens.map(i => [i.id, i.status, i.tarefa]), [['f1', 'pendente', null], ['f2', 'em_andamento', nomeDe(dir)]]);
  const ev = linhas(join(dir, 'eventos.jsonl'))[0];
  assert.equal(ev.tipo, 'tarefa_criada');
  assert.deepEqual(ev.dados, { tamanho: 'media', tipo: 'feature', fila: 'f2' });
  // sem --fila, nada muda na fila e o evento fica como antes
  run('abandonar');
  const sem = run('nova', '--slug', 'c', '--tamanho', 'trivial', '--tipo', 'bug');
  assert.deepEqual(linhas(join(sem.out.trim(), 'eventos.jsonl'))[0].dados, { tamanho: 'trivial', tipo: 'bug' });
});

test('fila: nova --fila recusa item inexistente, não pendente ou fila ilegível, sem pasta órfã nem "ativa"', () => {
  const semPasta = () => !existsSync(join(proj, '.nabuco', 'tarefas')) || readdirSync(join(proj, '.nabuco', 'tarefas')).length === 0;
  const nova = id => run('nova', '--slug', 'x', '--tamanho', 'trivial', '--tipo', 'bug', '--fila', id);

  let r = nova('f1'); // fila não existe
  assert.equal(r.code, 1);
  assert.match(r.err, /item "f1" não existe na fila/);
  fila('add', '--pedido=a');
  const f = lerFilaJson(); f.itens[0].status = 'feito'; f.itens[0].tarefa = 'velha';
  writeFileSync(arqFila(), JSON.stringify(f));
  r = nova('f1');
  assert.equal(r.code, 1);
  assert.match(r.err, /f1 não está pendente \(feito, tarefa velha\)/);
  writeFileSync(arqFila(), '{quebrado');
  r = nova('f1');
  assert.equal(r.code, 1);
  assert.match(r.err, /fila\.json ilegível/);
  assert.equal(readFileSync(arqFila(), 'utf8'), '{quebrado');
  assert.equal(nova('../x').code, 2);
  assert.equal(nova('').code, 2);
  assert.ok(semPasta(), 'nenhuma pasta de tarefa criada');
  assert.ok(!existsSync(join(proj, '.nabuco', 'ativa')));
  assert.ok(!existsSync(join(home, 'historico.jsonl')), 'nenhum evento registrado');
});

test('fila: falha ao marcar o item desfaz a tarefa criada (sem pasta órfã)', () => {
  fila('add', '--pedido=a');
  mkdirSync(arqFila() + '.tmp'); // escreverJson grava o .tmp antes do rename: como diretório, a escrita falha
  const r = run('nova', '--slug', 'x', '--tamanho', 'trivial', '--tipo', 'bug', '--fila', 'f1');
  assert.equal(r.code, 1);
  assert.match(r.err, /não consegui marcar o item f1 na fila/);
  assert.deepEqual(readdirSync(join(proj, '.nabuco', 'tarefas')), []);
  assert.ok(!existsSync(join(proj, '.nabuco', 'ativa')));
  assert.ok(!existsSync(join(home, 'historico.jsonl')), 'nenhum evento registrado');
  assert.equal(lerFilaJson().itens[0].status, 'pendente');
});

test('fila: concluir marca o item feito; abandonar marca abandonado', () => {
  fila('add', '--pedido=a'); fila('add', '--pedido=b');
  run('nova', '--slug', 'a', '--tamanho', 'trivial', '--tipo', 'bug', '--fila', 'f1');
  run('criterio-add', '--id', 'c1', '--descricao', 'd', '--verificacao', 'v');
  run('aprovar');
  run('criterio', '--id', 'c1', '--status', 'passou', '--evidencia=ok');
  const c = run('concluir');
  assert.equal(c.code, 0, c.err);
  assert.match(c.out, /f1 marcado como feito na fila/);
  run('nova', '--slug', 'b', '--tamanho', 'trivial', '--tipo', 'bug', '--fila', 'f2');
  const a = run('abandonar', '--motivo=mudou');
  assert.equal(a.code, 0, a.err);
  assert.match(a.out, /f2 marcado como abandonado na fila/);
  assert.match(a.out, /fila parada: .*retomar/);
  assert.deepEqual(lerFilaJson().itens.map(i => i.status), ['feito', 'abandonado']);
  // tarefa sem fila: concluir/abandonar não tocam na fila
  const antes = readFileSync(arqFila(), 'utf8');
  run('nova', '--slug', 'c', '--tamanho', 'trivial', '--tipo', 'bug');
  assert.equal(run('abandonar').code, 0);
  assert.equal(readFileSync(arqFila(), 'utf8'), antes);
});

test('fila: falha ao gravar a fila no concluir/abandonar só avisa (a tarefa fecha)', () => {
  fila('add', '--pedido=a'); fila('add', '--pedido=b');
  run('nova', '--slug', 'a', '--tamanho', 'trivial', '--tipo', 'bug', '--fila', 'f1');
  writeFileSync(arqFila(), '{quebrado');
  const r = run('abandonar');
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /aviso: .*fila/);
  assert.equal(JSON.parse(run('status').out).ativa, null);
  assert.equal(readFileSync(arqFila(), 'utf8'), '{quebrado');
});

test('fila: status mostra a fila com e sem tarefa ativa', () => {
  assert.equal(JSON.parse(run('status').out).fila, null); // sem fila.json
  fila('add', '--pedido=a'); fila('add', '--pedido=b');
  let s = JSON.parse(run('status').out);
  assert.equal(s.ativa, null);
  assert.deepEqual(s.fila, { pendentes: 2, proximo: { id: 'f1', pedido: 'a' }, em_andamento: null, commit_por_item: false, parada: null, total: 2 });
  const dir = run('nova', '--slug', 'a', '--tamanho', 'trivial', '--tipo', 'bug', '--fila', 'f1').out.trim();
  s = JSON.parse(run('status').out);
  assert.equal(s.ativa, nomeDe(dir));
  assert.deepEqual(s.fila.em_andamento, { id: 'f1', tarefa: s.ativa });
  assert.deepEqual(s.fila.proximo, { id: 'f2', pedido: 'b' });
  writeFileSync(arqFila(), '{quebrado');
  const q = run('status');
  assert.equal(q.code, 0);
  assert.match(JSON.parse(q.out).fila.erro, /fila\.json ilegível/);
});

test('fila: nova grava base (HEAD; stash create com mudanças, sem tocar a árvore); sem git → sem base', () => {
  // o projeto do beforeEach só tem uma pasta .git falsa: sem base
  const d0 = run('nova', '--slug', 'sem-git', '--tamanho', 'trivial', '--tipo', 'bug').out.trim();
  assert.equal('base' in estadoDe(d0), false);
  run('abandonar');

  const repo = join(dirname(proj), 'repo real');
  mkdirSync(repo);
  const git = (...a) => spawnSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' });
  assert.equal(git('init', '-q').status, 0);
  writeFileSync(join(repo, 'a.txt'), 'um\n');
  git('add', 'a.txt'); git('commit', '-q', '-m', 'inicial');
  const head = git('rev-parse', 'HEAD').stdout.trim();
  const em = (...a) => spawnSync(process.execPath, [CLI, ...a], { cwd: repo, encoding: 'utf8', env: envTeste() });

  const limpo = em('nova', '--slug', 'limpo', '--tamanho', 'trivial', '--tipo', 'bug');
  assert.equal(limpo.status, 0, limpo.stderr);
  assert.equal(estadoDe(limpo.stdout.trim()).base, head);
  em('abandonar');

  writeFileSync(join(repo, 'a.txt'), 'dois\n'); // mudança rastreada deixada por um item anterior
  const sujo = em('nova', '--slug', 'sujo', '--tamanho', 'trivial', '--tipo', 'bug');
  const base = estadoDe(sujo.stdout.trim()).base;
  assert.match(base, /^[0-9a-f]{40,64}$/);
  assert.notEqual(base, head);
  assert.equal(readFileSync(join(repo, 'a.txt'), 'utf8'), 'dois\n', 'árvore intacta');
  assert.equal(git('stash', 'list').stdout, '', 'nada guardado no stash');
  assert.equal(git('rev-parse', 'HEAD').stdout.trim(), head);
  assert.equal(git('diff', base, '--', 'a.txt').stdout, '', 'o diff a partir da base ignora o que já estava mudado');
  writeFileSync(join(repo, 'a.txt'), 'tres\n');
  assert.match(git('diff', base, '--', 'a.txt').stdout, /-dois\n\+tres/);
});

// ---------- correção 1: parada ao abandonar; não rastreados da base ----------

test('fila: abandonar tarefa da fila grava a parada; proximo devolve a parada; nova --fila recusa até retomar', () => {
  fila('add', '--pedido=a'); fila('add', '--pedido=b');
  run('nova', '--slug', 'a', '--tamanho', 'trivial', '--tipo', 'bug', '--fila', 'f1');
  assert.equal(run('abandonar', '--motivo=mudou').code, 0);
  const f = lerFilaJson();
  assert.equal(f.parada.motivo, 'item f1 abandonado');
  assert.equal(f.parada.item, 'f1');
  assert.ok(!Number.isNaN(Date.parse(f.parada.desde)));
  assert.deepEqual(JSON.parse(run('status').out).fila.parada, f.parada);

  const p = fila('proximo', '--json');
  assert.equal(p.status, 0);
  assert.equal(JSON.parse(p.stdout).item, null);

  const r = run('nova', '--slug', 'b', '--tamanho', 'trivial', '--tipo', 'bug', '--fila', 'f2');
  assert.equal(r.code, 1);
  assert.match(r.err, /fila parada \(item f1 abandonado\)/);
  assert.ok(!existsSync(join(proj, '.nabuco', 'ativa')));
  assert.equal(lerFilaJson().itens[1].status, 'pendente');

  assert.equal(fila('retomar').status, 0);
  assert.equal(run('nova', '--slug', 'b', '--tamanho', 'trivial', '--tipo', 'bug', '--fila', 'f2').code, 0);
  // concluir não grava parada; tarefa sem fila também não
  run('criterio-add', '--id', 'c1', '--descricao', 'd', '--verificacao', 'v');
  run('aprovar');
  run('criterio', '--id', 'c1', '--status', 'passou', '--evidencia=ok');
  assert.equal(run('concluir').code, 0);
  assert.equal(lerFilaJson().parada, null);
  run('nova', '--slug', 'c', '--tamanho', 'trivial', '--tipo', 'bug');
  run('abandonar');
  assert.equal(lerFilaJson().parada, null);
});

test('nova grava nao_rastreados (sem git → ausente); arquivos-novos separa novos e não rastreados de antes alterados', () => {
  const d0 = run('nova', '--slug', 'sem-git', '--tamanho', 'trivial', '--tipo', 'bug').out.trim();
  assert.equal('nao_rastreados' in estadoDe(d0), false);
  const s0 = run('arquivos-novos', '--json');
  assert.equal(s0.code, 0, s0.err);
  assert.equal(JSON.parse(s0.out).registrado, false);
  run('abandonar');

  const repo = join(dirname(proj), 'repo novos');
  mkdirSync(repo);
  const git = (...a) => spawnSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' });
  git('init', '-q');
  writeFileSync(join(repo, 'a.txt'), 'um\n');
  git('add', 'a.txt'); git('commit', '-q', '-m', 'inicial');
  mkdirSync(join(repo, 'velha'));
  writeFileSync(join(repo, 'velha', 'solto.txt'), 'de antes\n');   // não rastreado de antes, será alterado
  writeFileSync(join(repo, 'parado.txt'), 'de antes\n');           // não rastreado de antes, intocado
  const antiga = new Date(Date.now() - 60_000);
  for (const f of ['velha/solto.txt', 'parado.txt']) utimesSync(join(repo, f), antiga, antiga);
  const em = (...a) => spawnSync(process.execPath, [CLI, ...a], { cwd: repo, encoding: 'utf8', env: envTeste() });

  const n = em('nova', '--slug', 'novos', '--tamanho', 'trivial', '--tipo', 'bug');
  assert.equal(n.status, 0, n.stderr);
  assert.deepEqual(estadoDe(n.stdout.trim()).nao_rastreados, ['parado.txt', 'velha/solto.txt']);

  writeFileSync(join(repo, 'novo.txt'), 'desta tarefa\n');
  writeFileSync(join(repo, 'velha', 'solto.txt'), 'mudou\n');
  const j = em('arquivos-novos', '--json');
  assert.equal(j.status, 0, j.stderr);
  const r = JSON.parse(j.stdout);
  assert.equal(r.registrado, true);
  assert.equal(r.diff, `git diff ${estadoDe(n.stdout.trim()).base}`);
  assert.deepEqual(r.novos, ['novo.txt'], 'a pasta .nabuco da tarefa fica de fora');
  assert.deepEqual(r.alterados_sem_diff, ['velha/solto.txt']);

  const t = em('arquivos-novos');
  assert.equal(t.status, 0);
  assert.match(t.stdout, /git diff [0-9a-f]{40}/);
  assert.match(t.stdout, /novo\.txt/);
  assert.match(t.stdout, /velha\/solto\.txt/);
  assert.match(t.stdout, /arquivo inteiro/);
  assert.doesNotMatch(t.stdout, /parado\.txt/);
});

test('arquivos-novos sem tarefa ativa é regra violada', () => {
  const r = run('arquivos-novos');
  assert.equal(r.code, 1);
  assert.match(r.err, /nenhuma tarefa ativa/i);
});

// ---------- correção 2: arquivos-novos --tarefa (commit por item), item órfão na fila, status enxuto ----------

const repoGit = nome => {
  const repo = join(dirname(proj), nome);
  mkdirSync(repo);
  const git = (...a) => spawnSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' });
  git('init', '-q');
  const em = (...a) => spawnSync(process.execPath, [CLI, ...a], { cwd: repo, encoding: 'utf8', env: envTeste() });
  return { repo, git, em };
};
const fecharTarefa = em => {
  em('criterio-add', '--id', 'c1', '--descricao', 'd', '--verificacao', 'v');
  em('aprovar');
  em('criterio', '--id', 'c1', '--status', 'passou', '--evidencia=ok');
  const c = em('concluir');
  assert.equal(c.status, 0, c.stderr);
};

test('arquivos-novos --tarefa lê a tarefa já concluída e monta a lista para commit (rastreados alterados desde a base + novos)', () => {
  const { repo, git, em } = repoGit('repo commit');
  for (const f of ['a.txt', 'b.txt', 'c.txt']) writeFileSync(join(repo, f), `${f}\n`);
  git('add', '.'); git('commit', '-q', '-m', 'inicial');
  writeFileSync(join(repo, 'b.txt'), 'mudado antes da tarefa\n');   // de um item anterior: fica de fora
  writeFileSync(join(repo, 'velho.txt'), 'não rastreado de antes\n'); // idem
  const antiga = new Date(Date.now() - 60_000);
  utimesSync(join(repo, 'velho.txt'), antiga, antiga);
  const nome = nomeDe(em('nova', '--slug', 'item', '--tamanho', 'trivial', '--tipo', 'bug').stdout.trim());

  writeFileSync(join(repo, 'a.txt'), 'mudado nesta tarefa\n');
  rmSync(join(repo, 'c.txt'));
  mkdirSync(join(repo, 'pasta nova'));
  writeFileSync(join(repo, 'pasta nova', 'novo.txt'), 'novo\n');
  fecharTarefa(em);

  assert.equal(em('arquivos-novos').status, 1, 'sem --tarefa continua exigindo a ativa');
  const j = em('arquivos-novos', '--tarefa', nome, '--json');
  assert.equal(j.status, 0, j.stderr);
  const r = JSON.parse(j.stdout);
  assert.equal(r.tarefa, nome);
  assert.equal(r.confiavel, true);
  assert.deepEqual(r.rastreados_alterados, ['a.txt', 'c.txt']);
  assert.deepEqual(r.novos, ['pasta nova/novo.txt']);
  assert.deepEqual(r.commit, ['a.txt', 'c.txt', 'pasta nova/novo.txt']);

  const t = em('arquivos-novos', '--tarefa', nome);
  assert.equal(t.status, 0, t.stderr);
  assert.match(t.stdout, /para commit[^\n]*:\n  - a\.txt\n  - c\.txt\n  - pasta nova\/novo\.txt/);
  assert.doesNotMatch(t.stdout, /b\.txt|velho\.txt/);

  for (const ruim of ['../x', 'a/b', 'a\\b', '..', ' ']) assert.equal(em('arquivos-novos', '--tarefa', ruim).status, 2, ruim);
  const nao = em('arquivos-novos', '--tarefa', 'nao-existe');
  assert.equal(nao.status, 1);
  assert.match(nao.stderr, /nao-existe/);
});

test('arquivos-novos --tarefa sem base nem nao_rastreados: lista para commit não confiável (pergunte ao usuário)', () => {
  const nome = nomeDe(run('nova', '--slug', 'sem-git', '--tamanho', 'trivial', '--tipo', 'bug').out.trim());
  run('abandonar');
  const j = run('arquivos-novos', '--tarefa', nome, '--json');
  assert.equal(j.code, 0, j.err);
  const r = JSON.parse(j.out);
  assert.equal(r.confiavel, false);
  assert.equal(r.commit, null);
  assert.match(run('arquivos-novos', '--tarefa', nome).out, /não confiável[^\n]*pergunte ao usuário/);
});

test('fila: abandonar sem conseguir gravar a fila deixa o item em andamento → status mostra parada, nova --fila recusa, retomar o marca abandonado', () => {
  fila('add', '--pedido=a'); fila('add', '--pedido=b');
  run('nova', '--slug', 'a', '--tamanho', 'trivial', '--tipo', 'bug', '--fila', 'f1');
  mkdirSync(arqFila() + '.tmp'); // a gravação da fila falha
  const a = run('abandonar');
  assert.equal(a.code, 0, a.err);
  assert.match(a.err, /aviso: .*fila/);
  rmSync(arqFila() + '.tmp', { recursive: true });
  assert.equal(lerFilaJson().itens[0].status, 'em_andamento');
  assert.equal(lerFilaJson().parada, null);

  const motivo = 'item f1 ficou em andamento sem tarefa ativa';
  assert.equal(JSON.parse(run('status').out).fila.parada.motivo, motivo);
  const r = run('nova', '--slug', 'b', '--tamanho', 'trivial', '--tipo', 'bug', '--fila', 'f2');
  assert.equal(r.code, 1);
  assert.match(r.err, /fila parada \(item f1 ficou em andamento sem tarefa ativa\)/);
  assert.ok(!existsSync(join(proj, '.nabuco', 'ativa')));
  assert.equal(lerFilaJson().itens[1].status, 'pendente');

  const ret = fila('retomar');
  assert.equal(ret.status, 0, ret.stderr);
  assert.match(ret.stdout, /f1 .*abandonado/);
  assert.equal(lerFilaJson().itens[0].status, 'abandonado');
  assert.equal(run('nova', '--slug', 'b', '--tamanho', 'trivial', '--tipo', 'bug', '--fila', 'f2').code, 0);
  assert.equal(JSON.parse(run('status').out).fila.parada, null, 'item da tarefa ativa não é parada');
});

test('status mostra a contagem de nao_rastreados (o estado.json guarda a lista)', () => {
  const { repo, git, em } = repoGit('repo status');
  writeFileSync(join(repo, 'a.txt'), 'um\n');
  git('add', 'a.txt'); git('commit', '-q', '-m', 'inicial');
  writeFileSync(join(repo, 'solto1.txt'), 'x\n');
  writeFileSync(join(repo, 'solto2.txt'), 'x\n');
  const dir = em('nova', '--slug', 's', '--tamanho', 'trivial', '--tipo', 'bug').stdout.trim();
  assert.deepEqual(estadoDe(dir).nao_rastreados, ['solto1.txt', 'solto2.txt']);
  const s = JSON.parse(em('status').stdout);
  assert.equal(s.estado.nao_rastreados, 2);
  assert.equal(s.estado.slug, 's');
});
