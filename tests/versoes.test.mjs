import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { detectarVersoes } from '../scripts/lib/versoes.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'versoes.mjs');
function projeto(arquivos) {
  const d = mkdtempSync(join(tmpdir(), 'nabuco vers-'));
  for (const [n, c] of Object.entries(arquivos)) writeFileSync(join(d, n), c);
  return d;
}

test('npm: lockfile vence package.json; scoped funciona', () => {
  const d = projeto({
    'package.json': JSON.stringify({ dependencies: { react: '^19.0.0', vite: '^7.0.0' } }),
    'package-lock.json': JSON.stringify({ packages: { 'node_modules/react': { version: '19.2.1' }, 'node_modules/@tanstack/query': { version: '6.1.0' } } }),
  });
  assert.deepEqual(detectarVersoes(d, ['react', '@tanstack/query', 'vite', 'nada']), {
    react: { versao: '19.2.1', fonte: 'package-lock.json' },
    '@tanstack/query': { versao: '6.1.0', fonte: 'package-lock.json' },
    vite: { versao: '^7.0.0', fonte: 'package.json (faixa)' },
    nada: { versao: null, fonte: null },
  });
  rmSync(d, { recursive: true, force: true });
});

test('pnpm, yarn, cargo, gemfile, go, pubspec, poetry, requirements', () => {
  const d = projeto({
    'pnpm-lock.yaml': "packages:\n  /zod@4.1.2:\n    resolution: {}\n  '@scope/pkg@1.0.0':\n    resolution: {}\n",
    'yarn.lock': '"lodash@^4.17.0":\n  version "4.17.21"\n',
    'Cargo.lock': '[[package]]\nname = "serde"\nversion = "1.0.228"\n',
    'Gemfile.lock': 'GEM\n  specs:\n    rails (8.1.0)\n',
    'go.mod': 'module x\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.11.0\n)\n',
    'pubspec.lock': 'packages:\n  http:\n    dependency: "direct main"\n    source: hosted\n    version: "1.5.0"\n',
    'poetry.lock': '[[package]]\nname = "django"\nversion = "5.2.1"\n',
    'requirements.txt': 'Flask==3.1.0\nrequests>=2\n',
  });
  const r = detectarVersoes(d, ['zod', '@scope/pkg', 'lodash', 'serde', 'rails', 'github.com/gin-gonic/gin', 'http', 'django', 'flask']);
  assert.equal(r.zod.versao, '4.1.2');
  assert.equal(r['@scope/pkg'].versao, '1.0.0');
  assert.equal(r.lodash.versao, '4.17.21');
  assert.equal(r.serde.versao, '1.0.228');
  assert.equal(r.rails.versao, '8.1.0');
  assert.equal(r['github.com/gin-gonic/gin'].versao, 'v1.11.0');
  assert.equal(r.http.versao, '1.5.0');
  assert.equal(r.django.versao, '5.2.1');
  assert.deepEqual(r.flask, { versao: '3.1.0', fonte: 'requirements.txt' });
  rmSync(d, { recursive: true, force: true });
});

test('lockfile corrompido não quebra; cai para a próxima fonte', () => {
  const d = projeto({ 'package-lock.json': '{quebrado', 'package.json': JSON.stringify({ devDependencies: { vitest: '~4.0.0' } }) });
  assert.deepEqual(detectarVersoes(d, ['vitest']).vitest, { versao: '~4.0.0', fonte: 'package.json (faixa)' });
  rmSync(d, { recursive: true, force: true });
});

test('CLI', () => {
  const d = projeto({ 'requirements.txt': 'fastapi==0.120.0\n' });
  const r = spawnSync(process.execPath, [CLI, 'fastapi'], { cwd: d, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).fastapi.versao, '0.120.0');
  assert.equal(spawnSync(process.execPath, [CLI], { cwd: d }).status, 2);
  rmSync(d, { recursive: true, force: true });
});
