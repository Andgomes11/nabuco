import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '../scripts/lib/frontmatter.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const PERMITIDOS = new Set(['name', 'description', 'license', 'metadata', 'allowed-tools', 'compatibility']);
const skills = readdirSync(join(RAIZ, 'skills'));

test('skills da Fase 1 existem', () => {
  for (const s of ['tarefa', 'setup', 'status', 'docs-atuais']) assert.ok(skills.includes(s), s);
});

for (const s of skills) {
  test(`skill ${s}: frontmatter no padrão aberto`, () => {
    const arq = join(RAIZ, 'skills', s, 'SKILL.md');
    assert.ok(existsSync(arq));
    const { dados } = parseFrontmatter(readFileSync(arq, 'utf8'));
    assert.equal(dados.name, s);
    assert.ok(dados.description && dados.description.length <= 1024);
    for (const k of Object.keys(dados)) assert.ok(PERMITIDOS.has(k), `campo não portável "${k}" em ${s}`);
  });
}

test('tarefa: cobre os comandos do CLI e as regras-chave', () => {
  const t = readFileSync(join(RAIZ, 'skills', 'tarefa', 'SKILL.md'), 'utf8');
  for (const c of ['nova', 'criterio-add', 'aprovar', 'criterio --id', 'fase aguardando_usuario', 'fase checando', 'concluir', 'abandonar', 'status', 'log --texto=']) {
    assert.ok(t.includes(c), `faltou "${c}"`);
  }
  assert.ok(t.includes('--evidencia="'), 'evidência deve usar a forma com =');
  assert.match(t, /gate_liberado/);
  assert.match(t, /nabuco:<papel>/);
  assert.match(t, /nabuco-<papel>/);
  assert.match(t, /checadores_locais/);
  assert.match(t, /no máximo 2 rodadas/i);
});
