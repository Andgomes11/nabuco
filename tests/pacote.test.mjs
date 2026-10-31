import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const j = rel => JSON.parse(readFileSync(join(RAIZ, rel), 'utf8'));

test('manifestos: mesmo nome e versão do package.json', () => {
  const v = j('package.json').version;
  for (const m of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json']) {
    assert.equal(j(m).name, 'nabuco', m);
    assert.equal(j(m).version, v, m);
  }
});

test('codex plugin aponta para skills e hooks existentes', () => {
  const m = j('.codex-plugin/plugin.json');
  assert.equal(m.skills, './skills/');
  assert.equal(m.hooks, './hooks/hooks.json');
  assert.ok(existsSync(join(RAIZ, 'hooks', 'hooks.json')));
});

test('marketplaces apontam para a raiz do repositório', () => {
  const c = j('.claude-plugin/marketplace.json');
  assert.equal(c.name, 'nabuco');
  assert.equal(c.plugins[0].name, 'nabuco');
  assert.equal(c.plugins[0].source, './');
  const x = j('.agents/plugins/marketplace.json');
  assert.equal(x.plugins[0].name, 'nabuco');
  assert.deepEqual(x.plugins[0].source, { source: 'url', url: './' });
});

test('hooks: Stop chama o gate; SubagentStart/Stop chamam evento --hook; caminhos via CLAUDE_PLUGIN_ROOT', () => {
  const h = j('hooks/hooks.json').hooks;
  const cmd = ev => h[ev][0].hooks[0];
  assert.equal(cmd('Stop').type, 'command');
  assert.equal(cmd('Stop').command, 'node "${CLAUDE_PLUGIN_ROOT}/scripts/gate-evidencia.mjs"');
  for (const ev of ['SubagentStart', 'SubagentStop']) assert.equal(cmd(ev).command, 'node "${CLAUDE_PLUGIN_ROOT}/scripts/evento.mjs" --hook');
  assert.equal(h.SessionStart[0].hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/scripts/sincronizar.mjs" --fundo');
  assert.equal(h.PostToolUse[0].matcher, 'Bash');
  assert.equal(h.PostToolUse[0].hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/scripts/dono.mjs"');
  assert.equal(h.SubagentStop.length, 1); // SubagentStop NÃO roda o gate
});

test('README documenta instalação nos dois harnesses', () => {
  const r = readFileSync(join(RAIZ, 'README.md'), 'utf8');
  for (const s of ['/plugin marketplace add Andgomes11/nabuco', 'codex plugin marketplace add Andgomes11/nabuco', '/nabuco:setup', '$setup', '/hooks', 'npm run build']) assert.ok(r.includes(s), s);
});

test('avatares: nomes válidos e até 200 KB', () => {
  const dir = join(RAIZ, 'assets', 'avatares');
  const re = /^(gerente|arquiteto|debugger|designer|dev|devops|docs|revisor|seguranca|tester)-[1-4]\.jpg$/;
  const arqs = readdirSync(dir);
  assert.ok(arqs.length > 0);
  for (const a of arqs) {
    assert.match(a, re, a);
    assert.ok(statSync(join(dir, a)).size <= 200 * 1024, `${a} passou de 200 KB`);
  }
});

test('versão 0.8.0 nos três lugares', () => {
  for (const m of ['package.json', '.claude-plugin/plugin.json', '.codex-plugin/plugin.json']) assert.equal(j(m).version, '0.8.0', m);
});
