import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ErroFila, adicionar, remover, mover, proximo, resumoFila, validarFila, filaVazia, encerrarItem, retomar, paradaDe, abandonarOrfaos } from '../scripts/lib/fila.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'fila.mjs');
let base, proj, home;

function run(...args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: proj, encoding: 'utf8', env: { ...process.env, NABUCO_HOME: home, NABUCO_HARNESS: 'teste' } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const arqFila = () => join(proj, '.nabuco', 'fila.json');
const lerFila = () => JSON.parse(readFileSync(arqFila(), 'utf8'));

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'nabuco fila-'));
  proj = join(base, 'Nova pasta'); home = join(base, 'home');
  mkdirSync(join(proj, '.git'), { recursive: true });
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

// ---------- lib (puras) ----------

test('lib: adicionar gera ids f1, f2… sem reaproveitar o maior existente', () => {
  const f = filaVazia();
  assert.deepEqual(f, { commit_por_item: false, parada: null, itens: [] });
  const a = adicionar(f, '  login social  ', '2026-10-31T00:00:00.000Z');
  assert.deepEqual(a, { id: 'f1', pedido: 'login social', criado: '2026-10-31T00:00:00.000Z', status: 'pendente', tarefa: null });
  assert.equal(adicionar(f, 'b', 'x').id, 'f2');
  f.itens.push({ id: 'f9', pedido: 'c', criado: 'x', status: 'feito', tarefa: 't' });
  assert.equal(adicionar(f, 'd', 'x').id, 'f10');
  assert.throws(() => adicionar(f, '   ', 'x'), ErroFila);
});

test('lib: remover recusa item em andamento e id inexistente', () => {
  const f = filaVazia();
  adicionar(f, 'a', 'x'); adicionar(f, 'b', 'x');
  f.itens[0].status = 'em_andamento';
  assert.throws(() => remover(f, 'f1'), /em andamento/);
  assert.throws(() => remover(f, 'f7'), /não existe/);
  remover(f, 'f2');
  assert.deepEqual(f.itens.map(i => i.id), ['f1']);
});

test('lib: mover reordena só os pendentes; os demais ficam no lugar', () => {
  const f = filaVazia();
  for (const p of ['a', 'b', 'c', 'd']) adicionar(f, p, 'x');
  f.itens[0].status = 'feito';
  mover(f, 'f4', 1); // f4 vira o primeiro pendente
  assert.deepEqual(f.itens.map(i => i.id), ['f1', 'f4', 'f2', 'f3']);
  assert.equal(proximo(f).id, 'f4');
  mover(f, 'f4', 3);
  assert.deepEqual(f.itens.map(i => i.id), ['f1', 'f2', 'f3', 'f4']);
  assert.throws(() => mover(f, 'f1', 1), /não está pendente/);
  assert.throws(() => mover(f, 'f2', 4), /posição/);
  assert.throws(() => mover(f, 'f2', 0), /posição/);
});

test('lib: validarFila recusa forma inválida; resumo conta pendentes e aponta o próximo', () => {
  assert.throws(() => validarFila([]), ErroFila);
  assert.throws(() => validarFila({ itens: {} }), ErroFila);
  assert.throws(() => validarFila({ itens: [{ id: 'f1', pedido: 'a', status: 'talvez' }] }), ErroFila);
  assert.throws(() => validarFila({ itens: [{ id: 'f1', pedido: 'a', status: 'pendente' }, { id: 'f1', pedido: 'b', status: 'pendente' }] }), /repetido/);
  const f = validarFila({ itens: [
    { id: 'f1', pedido: 'a', status: 'feito', tarefa: 't1' },
    { id: 'f2', pedido: 'b', status: 'em_andamento', tarefa: 't2' },
    { id: 'f3', pedido: 'c', status: 'pendente', tarefa: null },
  ] });
  assert.equal(f.commit_por_item, false); // ausente = false
  assert.deepEqual(resumoFila(f), { pendentes: 1, proximo: { id: 'f3', pedido: 'c' }, em_andamento: { id: 'f2', tarefa: 't2' }, commit_por_item: false, parada: null, total: 3 });
  assert.equal(proximo(filaVazia()), null);
});

// ---------- CLI ----------

test('CLI: add, listar (texto e --json), proximo e config', () => {
  assert.equal(run('listar').out.trim(), 'fila vazia');
  const a = run('add', '--pedido=corrigir o login');
  assert.equal(a.code, 0, a.err);
  assert.match(a.out, /f1 adicionado/);
  assert.equal(run('add', '--pedido=-começa com hífen').code, 0); // forma com = aceita valor com "-"
  const f = lerFila();
  assert.equal(f.commit_por_item, false);
  assert.deepEqual(f.itens.map(i => [i.id, i.pedido, i.status, i.tarefa]), [['f1', 'corrigir o login', 'pendente', null], ['f2', '-começa com hífen', 'pendente', null]]);
  assert.ok(!Number.isNaN(Date.parse(f.itens[0].criado)));

  const l = run('listar');
  assert.match(l.out, /1\. f1 · pendente · corrigir o login/);
  assert.match(l.out, /commit por item: não/);
  assert.deepEqual(JSON.parse(run('listar', '--json').out), f);

  const p = run('proximo');
  assert.equal(p.code, 0);
  assert.match(p.out, /^f1: corrigir o login/);
  assert.deepEqual(JSON.parse(run('proximo', '--json').out), { item: f.itens[0], pendentes: 2, parada: null });
  assert.deepEqual(lerFila(), f); // proximo só lê

  assert.equal(run('config', '--commit-por-item', 'sim').code, 0);
  assert.equal(lerFila().commit_por_item, true);
  assert.match(run('listar').out, /commit por item: sim/);
  assert.equal(run('config', '--commit-por-item', 'nao').code, 0);
  assert.equal(lerFila().commit_por_item, false);
});

test('CLI: remover e mover, com recusas', () => {
  for (const p of ['a', 'b', 'c']) run('add', `--pedido=${p}`);
  assert.equal(run('mover', '--id', 'f3', '--para', '1').code, 0);
  assert.deepEqual(lerFila().itens.map(i => i.id), ['f3', 'f1', 'f2']);
  assert.match(run('proximo').out, /^f3: c/);
  assert.equal(run('remover', '--id', 'f1').code, 0);
  assert.deepEqual(lerFila().itens.map(i => i.id), ['f3', 'f2']);

  const r = run('remover', '--id', 'f9');
  assert.equal(r.code, 1);
  assert.match(r.err, /não existe/);
  assert.equal(run('mover', '--id', 'f2', '--para', '5').code, 1);

  // item em andamento não sai da fila
  const f = lerFila(); f.itens[0].status = 'em_andamento'; f.itens[0].tarefa = 't';
  writeFileSync(arqFila(), JSON.stringify(f));
  const e = run('remover', '--id', 'f3');
  assert.equal(e.code, 1);
  assert.match(e.err, /em andamento/);
});

test('CLI: erros de uso saem com 2', () => {
  assert.equal(run().code, 2);
  assert.equal(run('xpto').code, 2);
  assert.equal(run('add').code, 2);
  assert.equal(run('add', '--pedido=   ').code, 2);
  assert.equal(run('remover').code, 2);
  assert.equal(run('remover', '--id', '../x').code, 2);
  assert.equal(run('mover', '--id', 'f1').code, 2);
  assert.equal(run('mover', '--id', 'f1', '--para', 'dois').code, 2);
  assert.equal(run('config', '--commit-por-item', 'talvez').code, 2);
  assert.equal(run('listar', '--extra').code, 2);
  assert.ok(!existsSync(arqFila()), 'erro de uso não cria a fila');
});

test('CLI: proximo sem itens pendentes avisa e sai 0; item em andamento aparece no aviso', () => {
  const v = run('proximo');
  assert.equal(v.code, 0);
  assert.match(v.out, /nenhum item pendente/);
  assert.equal(JSON.parse(run('proximo', '--json').out).item, null);
  run('add', '--pedido=a');
  const f = lerFila(); f.itens[0].status = 'em_andamento'; f.itens[0].tarefa = '2026-10-31-a';
  writeFileSync(arqFila(), JSON.stringify(f));
  const p = run('proximo');
  assert.match(p.out, /nenhum item pendente/);
  assert.match(p.err, /f1 em andamento \(tarefa 2026-10-31-a\)/);
});

test('CLI: fila.json ilegível → erro claro (exit 1) e nunca sobrescreve', () => {
  mkdirSync(join(proj, '.nabuco'), { recursive: true });
  for (const conteudo of ['{quebrado', JSON.stringify({ itens: 'x' })]) {
    writeFileSync(arqFila(), conteudo);
    for (const args of [['add', '--pedido=a'], ['listar'], ['proximo'], ['config', '--commit-por-item', 'sim'], ['remover', '--id', 'f1']]) {
      const r = run(...args);
      assert.equal(r.code, 1, args.join(' '));
      assert.match(r.err, /fila\.json ilegível/);
    }
    assert.equal(readFileSync(arqFila(), 'utf8'), conteudo);
  }
});

test('CLI: fila com BOM (editada no Windows) é lida', () => {
  mkdirSync(join(proj, '.nabuco'), { recursive: true });
  writeFileSync(arqFila(), '﻿' + JSON.stringify({ commit_por_item: true, itens: [{ id: 'f1', pedido: 'a', status: 'pendente', tarefa: null }] }));
  assert.equal(run('add', '--pedido=b').code, 0);
  assert.equal(lerFila().commit_por_item, true); // fila em curso: a escolha lida do arquivo vale
});

test('CLI: recusa gravar na pasta global do nabuco', () => {
  const r = spawnSync(process.execPath, [CLI, 'add', '--pedido=a'], { cwd: base, encoding: 'utf8', env: { ...process.env, NABUCO_HOME: join(base, '.nabuco'), NABUCO_HARNESS: 'teste' } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /pasta global do nabuco; rode dentro de um projeto/);
  assert.ok(!existsSync(join(base, '.nabuco', 'fila.json')));
});

// ---------- correção 1: commit_por_item por fila e estado "parada" ----------

test('lib: add numa fila nova (sem pendente nem em andamento) volta commit_por_item e parada ao padrão', () => {
  const f = filaVazia();
  f.commit_por_item = true;
  adicionar(f, 'a', 'x');
  assert.equal(f.commit_por_item, false, 'fila nova não herda a escolha da anterior');
  f.commit_por_item = true;
  adicionar(f, 'b', 'x'); // fila em curso: a escolha vale
  assert.equal(f.commit_por_item, true);
  f.itens[0].status = 'em_andamento'; f.itens[1].status = 'feito';
  adicionar(f, 'c', 'x'); // ainda em curso (item em andamento)
  assert.equal(f.commit_por_item, true);
  for (const it of f.itens) it.status = 'feito';
  f.parada = { motivo: 'item f1 abandonado', desde: 'x', item: 'f1' };
  adicionar(f, 'd', 'x');
  assert.equal(f.commit_por_item, false);
  assert.equal(f.parada, null);
});

test('lib: encerrarItem abandonado grava a parada; feito não; parar/retomar', () => {
  const f = filaVazia();
  assert.equal(f.parada, null);
  adicionar(f, 'a', 'x'); adicionar(f, 'b', 'x'); adicionar(f, 'c', 'x');
  Object.assign(f.itens[0], { status: 'em_andamento', tarefa: 't1' });
  encerrarItem(f, 't1', 'feito', '2026-10-31T10:00:00.000Z');
  assert.equal(f.parada, null);
  Object.assign(f.itens[1], { status: 'em_andamento', tarefa: 't2' });
  encerrarItem(f, 't2', 'abandonado', '2026-10-31T11:00:00.000Z');
  assert.deepEqual(f.parada, { motivo: 'item f2 abandonado', desde: '2026-10-31T11:00:00.000Z', item: 'f2' });
  assert.deepEqual(resumoFila(f).parada, f.parada);
  assert.equal(retomar(f), true);
  assert.equal(f.parada, null);
  assert.equal(retomar(f), false, 'retomar sem parada não muda nada');
});

test('lib: validarFila aceita parada null/ausente e recusa parada malformada', () => {
  assert.equal(validarFila({ itens: [] }).parada, null);
  assert.deepEqual(validarFila({ itens: [], parada: { motivo: 'm', desde: 'd', item: 'f1' } }).parada, { motivo: 'm', desde: 'd', item: 'f1' });
  for (const p of ['sim', [], { motivo: '' }, { motivo: 'm', desde: 1, item: 'f1' }, { motivo: 'm', desde: 'd', item: '../x' }]) {
    assert.throws(() => validarFila({ itens: [], parada: p }), /parada/, JSON.stringify(p));
  }
});

test('CLI: config sim numa fila; fila nova depois volta para "não"', () => {
  run('add', '--pedido=a');
  run('config', '--commit-por-item', 'sim');
  const f = lerFila(); f.itens[0].status = 'feito'; f.itens[0].tarefa = 't';
  writeFileSync(arqFila(), JSON.stringify(f));
  assert.equal(run('add', '--pedido=b').code, 0);
  assert.equal(lerFila().commit_por_item, false);
});

test('CLI: fila parada → proximo devolve a parada (texto e --json, exit 0); retomar limpa', () => {
  run('add', '--pedido=a'); run('add', '--pedido=b');
  const f = lerFila();
  Object.assign(f.itens[0], { status: 'abandonado', tarefa: 't1' });
  f.parada = { motivo: 'item f1 abandonado', desde: '2026-10-31T11:00:00.000Z', item: 'f1' };
  writeFileSync(arqFila(), JSON.stringify(f));

  const p = run('proximo');
  assert.equal(p.code, 0);
  assert.match(p.out, /^fila parada: item f1 abandonado/);
  assert.doesNotMatch(p.out, /^f2:/m, 'não devolve o item como pronto para rodar');
  assert.match(p.out, /retomar/);
  const j = JSON.parse(run('proximo', '--json').out);
  assert.equal(j.item, null);
  assert.deepEqual(j.parada, f.parada);
  assert.equal(j.seguinte.id, 'f2');
  assert.match(run('listar').out, /parada: item f1 abandonado/);

  const r = run('retomar');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /retomada/);
  assert.equal(lerFila().parada, null);
  assert.match(run('proximo').out, /^f2: b/);
  assert.deepEqual(JSON.parse(run('proximo', '--json').out), { item: lerFila().itens[1], pendentes: 1, parada: null });
  const deNovo = run('retomar');
  assert.equal(deNovo.code, 0);
  assert.match(deNovo.out, /não estava parada/);
  assert.equal(run('retomar', '--extra').code, 2);
});

// ---------- correção 2: item em andamento sem tarefa ativa (gravar a fila falhou no abandonar) ----------

test('lib: item em andamento cuja tarefa não é a ativa conta como parada; abandonarOrfaos o fecha', () => {
  const f = filaVazia();
  adicionar(f, 'a', 'x'); adicionar(f, 'b', 'x');
  Object.assign(f.itens[0], { status: 'em_andamento', tarefa: 't1' });
  assert.equal(paradaDe(f, 't1'), null, 'item da tarefa ativa não é parada');
  const orfa = { motivo: 'item f1 ficou em andamento sem tarefa ativa', desde: null, item: 'f1' };
  assert.deepEqual(paradaDe(f, null), orfa);
  assert.deepEqual(paradaDe(f, 'outra'), orfa);
  assert.deepEqual(resumoFila(f, null).parada, orfa);
  assert.equal(resumoFila(f, 't1').parada, null);
  // a parada gravada vem primeiro
  f.parada = { motivo: 'item f9 abandonado', desde: 'd', item: 'f9' };
  assert.deepEqual(paradaDe(f, null), f.parada);
  f.parada = null;
  assert.deepEqual(abandonarOrfaos(f, 't1'), []);
  assert.deepEqual(abandonarOrfaos(f, null).map(i => i.id), ['f1']);
  assert.equal(f.itens[0].status, 'abandonado');
  assert.equal(paradaDe(f, null), null);
});

test('CLI: item em andamento sem tarefa ativa → proximo e listar mostram a parada; retomar marca abandonado', () => {
  run('add', '--pedido=a'); run('add', '--pedido=b');
  const f = lerFila(); Object.assign(f.itens[0], { status: 'em_andamento', tarefa: '2026-10-31-a' });
  writeFileSync(arqFila(), JSON.stringify(f));

  const p = run('proximo');
  assert.equal(p.code, 0);
  assert.match(p.out, /^fila parada: item f1 ficou em andamento sem tarefa ativa/);
  assert.doesNotMatch(p.out, /^f2:/m);
  const j = JSON.parse(run('proximo', '--json').out);
  assert.equal(j.item, null);
  assert.equal(j.parada.motivo, 'item f1 ficou em andamento sem tarefa ativa');
  assert.match(run('listar').out, /parada: item f1 ficou em andamento sem tarefa ativa/);

  // com a tarefa do item ativa, nada de parada
  mkdirSync(join(proj, '.nabuco', 'tarefas', '2026-10-31-a'), { recursive: true });
  writeFileSync(join(proj, '.nabuco', 'ativa'), '2026-10-31-a\n');
  assert.equal(JSON.parse(run('proximo', '--json').out).parada, null);
  const r0 = run('retomar');
  assert.match(r0.out, /não estava parada/);
  assert.equal(lerFila().itens[0].status, 'em_andamento', 'retomar não mexe no item da tarefa ativa');
  rmSync(join(proj, '.nabuco', 'ativa'));

  const r = run('retomar');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /f1 .*abandonado/);
  assert.match(r.out, /retomada/);
  assert.equal(lerFila().itens[0].status, 'abandonado');
  assert.equal(lerFila().parada, null);
  assert.match(run('proximo').out, /^f2: b/);
});
