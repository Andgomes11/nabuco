import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lerJson, escreverJson } from '../scripts/lib/json.mjs';
import { parseFrontmatter } from '../scripts/lib/frontmatter.mjs';
import { acharProjeto, lerAtiva, escreverAtiva, limparAtiva, dirTarefas, nabucoHome } from '../scripts/lib/caminhos.mjs';
import { PAPEIS, FASES, FASES_ATIVAS } from '../scripts/lib/constantes.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'nabuco pasta ç-'));

test('json: escreve e lê, tolera BOM', () => {
  const d = tmp(); const f = join(d, 'a.json');
  escreverJson(f, { x: 1 });
  assert.deepEqual(lerJson(f), { x: 1 });
  assert.ok(readFileSync(f, 'utf8').endsWith('\n'));
  writeFileSync(f, '﻿{"y":2}');
  assert.deepEqual(lerJson(f), { y: 2 });
  rmSync(d, { recursive: true, force: true });
});

test('frontmatter: separa dados e corpo, aceita CRLF e ":" no valor', () => {
  const r = parseFrontmatter('---\r\nnome: Dev\r\ndescricao: faz: coisas\r\n---\r\n# Corpo\r\nlinha\r\n');
  assert.deepEqual(r.dados, { nome: 'Dev', descricao: 'faz: coisas' });
  assert.equal(r.corpo, '# Corpo\nlinha\n');
});

test('frontmatter: sem frontmatter devolve corpo inteiro; sem fechamento lança', () => {
  assert.deepEqual(parseFrontmatter('oi'), { dados: {}, corpo: 'oi' });
  assert.throws(() => parseFrontmatter('---\nnome: x\n'), /fechamento/);
});

test('acharProjeto: acha .nabuco subindo diretórios, com espaço no caminho', () => {
  const d = tmp(); const sub = join(d, 'a b', 'c');
  mkdirSync(join(d, '.nabuco'), { recursive: true }); mkdirSync(sub, { recursive: true });
  assert.equal(acharProjeto(sub), d);
  rmSync(d, { recursive: true, force: true });
});

test('acharProjeto: sem .nabuco usa raiz git; sem git usa o início', () => {
  const d = tmp(); const sub = join(d, 'x');
  mkdirSync(join(d, '.git'), { recursive: true }); mkdirSync(sub);
  assert.equal(acharProjeto(sub), d);
  const e = tmp();
  mkdirSync(join(e, '.git'));
  assert.equal(acharProjeto(e), e);
  rmSync(d, { recursive: true, force: true }); rmSync(e, { recursive: true, force: true });
});

test('acharProjeto: não sobe além da raiz git, nem confunde a pasta global ~/.nabuco com projeto', () => {
  const d = tmp();
  const global = join(d, '.nabuco'); mkdirSync(global);
  const repo = join(d, 'repo'); mkdirSync(join(repo, '.git'), { recursive: true });
  const solto = join(d, 'solto'); mkdirSync(solto);
  process.env.NABUCO_HOME = global;
  try {
    assert.equal(acharProjeto(repo), repo);   // para no .git, não sobe até d
    assert.equal(acharProjeto(solto), solto); // ignora d/.nabuco por ser a pasta global
  } finally { delete process.env.NABUCO_HOME; }
  rmSync(d, { recursive: true, force: true });
});

test('ativa: escreve, lê, ignora pasta inexistente, limpa', () => {
  const d = tmp();
  assert.equal(lerAtiva(d), null);
  escreverAtiva(d, '2026-10-17-x');
  assert.equal(lerAtiva(d), null); // pasta da tarefa não existe
  mkdirSync(join(dirTarefas(d), '2026-10-17-x'), { recursive: true });
  assert.deepEqual(lerAtiva(d), { nome: '2026-10-17-x', dir: join(dirTarefas(d), '2026-10-17-x') });
  limparAtiva(d);
  assert.equal(lerAtiva(d), null);
  rmSync(d, { recursive: true, force: true });
});

test('nabucoHome respeita NABUCO_HOME', () => {
  process.env.NABUCO_HOME = '/tmp/xyz';
  assert.equal(nabucoHome(), '/tmp/xyz');
  delete process.env.NABUCO_HOME;
});

test('constantes', () => {
  assert.deepEqual(PAPEIS, ['arquiteto', 'debugger', 'designer', 'dev', 'devops', 'docs', 'revisor', 'seguranca', 'tester']);
  assert.ok(FASES.includes('aguardando_usuario') && FASES.includes('abandonada'));
  assert.ok(FASES_ATIVAS.has('executando') && FASES_ATIVAS.has('checando') && !FASES_ATIVAS.has('aguardando_usuario'));
});
