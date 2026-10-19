import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { consumoDesde, normalizarAmostras, resumirLimite, DURACAO } from '../scripts/lib/limite.mjs';
import { resumoLimite } from '../scripts/painel/publico/modelo.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIN = 60000;
const T0 = Date.parse('2026-10-19T12:00:00Z');
const iso = ms => new Date(ms).toISOString();
const seg = ms => Math.floor(ms / 1000);
// janela de 5 h que renova em `renovaMs`
const am = (ms, pct, renovaMs, semPct) => ({ ts: iso(ms), h5: { pct, renova: seg(renovaMs) }, ...(semPct !== undefined && { sem: { pct: semPct, renova: seg(T0 + 3 * 24 * 60 * MIN) } }) });

test('consumoDesde: soma os aumentos desde o início, a partir da amostra anterior', () => {
  const r = T0 + 2 * 60 * MIN;
  const lista = normalizarAmostras([am(T0 - 10 * MIN, 30, r), am(T0 + 5 * MIN, 34, r), am(T0 + 20 * MIN, 41.5, r)]);
  assert.equal(consumoDesde(lista, T0, 'h5'), 11.5);
});

test('duas sessões: amostra menor na mesma janela é dado velho — não infla o consumo nem baixa o atual', () => {
  const r = T0 + 2 * 60 * MIN;
  const oscila = [am(T0 - MIN, 51, r), am(T0 + MIN, 59, r), am(T0 + 2 * MIN, 51, r), am(T0 + 3 * MIN, 60, r), am(T0 + 4 * MIN, 51, r), am(T0 + 5 * MIN, 63, r), am(T0 + 6 * MIN, 51, r)];
  assert.equal(consumoDesde(normalizarAmostras(oscila), T0, 'h5'), 12); // 51 → 63, não 8+9+12
  assert.equal(resumirLimite(oscila, { agora: T0 + 7 * MIN }).h5.pct, 63);
});

test('consumoDesde: janela renovada no meio conta o valor novo inteiro', () => {
  const r1 = T0 + 30 * MIN, r2 = r1 + DURACAO.h5;
  const lista = normalizarAmostras([am(T0 - MIN, 90, r1), am(T0 + 10 * MIN, 95, r1), am(T0 + 40 * MIN, 6, r2)]);
  assert.equal(consumoDesde(lista, T0, 'h5'), 11);
});

test('consumoDesde: sem amostra anterior, só conta se a janela começou depois do início', () => {
  const velha = normalizarAmostras([am(T0 + 10 * MIN, 50, T0 + 60 * MIN)]); // janela começou 4 h antes
  assert.equal(consumoDesde(velha, T0, 'h5'), 0);
  const nova = normalizarAmostras([am(T0 + 10 * MIN, 7, T0 + 10 * MIN + DURACAO.h5)]);
  assert.equal(consumoDesde(nova, T0, 'h5'), 7);
  assert.equal(consumoDesde([], T0, 'h5'), null);
});

test('resumirLimite: atual, defasado, janela vencida e tarefa', () => {
  assert.equal(resumirLimite([], { agora: T0 }), null);
  assert.equal(resumirLimite(undefined, { agora: T0 }), null);
  const r = T0 + 60 * MIN;
  const amostras = [am(T0 - 5 * MIN, 20, r, 10), am(T0 + 5 * MIN, 25, r, 11), { lixo: true }, 'x'];
  const s = resumirLimite(amostras, { agora: T0 + 10 * MIN, inicioTarefa: iso(T0) });
  assert.deepEqual(s.h5, { pct: 25, renova: iso(seg(r) * 1000) });
  assert.equal(s.sem.pct, 11);
  assert.equal(s.antigo, false);
  assert.deepEqual(s.tarefa, { h5: 5, sem: 1 });
  const depois = resumirLimite(amostras, { agora: r + MIN });
  assert.equal(depois.h5, null); // a janela de 5 h já renovou: o 25% é de um período encerrado
  assert.equal(depois.antigo, true);
  assert.equal(depois.tarefa, null);
});

test('resumoLimite (painel): texto das janelas, alto e consumo da tarefa', () => {
  assert.equal(resumoLimite(null), null);
  const r = resumoLimite({ atualizado: 'x', antigo: false, h5: { pct: 85.4, renova: '2026-10-19T16:30:00.000Z' }, sem: null, tarefa: { h5: 12.5, sem: null } });
  assert.equal(r.janelas.length, 1);
  assert.equal(r.janelas[0].texto, '85%');
  assert.equal(r.janelas[0].alto, true);
  assert.equal(r.tarefa, 'esta tarefa ≈ +12,5% 5h');
  assert.equal(resumoLimite({ h5: { pct: 10 }, tarefa: null }).tarefa, null);
});

test('status-line.mjs: grava amostra só quando muda, imprime o uso e repassa a status line anterior', () => {
  const base = mkdtempSync(join(tmpdir(), 'nabuco limite-'));
  try {
    const env = { ...process.env, NABUCO_HOME: join(base, 'n') };
    const rodar = entrada => spawnSync(process.execPath, [join(RAIZ, 'scripts', 'status-line.mjs')], { input: JSON.stringify(entrada), encoding: 'utf8', env });
    const entrada = { rate_limits: { five_hour: { used_percentage: 42.04, resets_at: 1790000000 }, seven_day: { used_percentage: 18, resets_at: 1790500000 } } };
    let r = rodar(entrada);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, 'nabuco · 5h 42% · semana 18%\n');
    rodar(entrada);
    const arq = join(base, 'n', 'limite.jsonl');
    let linhas = readFileSync(arq, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.equal(linhas.length, 1);
    assert.deepEqual(linhas[0].h5, { pct: 42, renova: 1790000000 });
    rodar({ rate_limits: { five_hour: { used_percentage: 43, resets_at: 1790000000 } } });
    linhas = readFileSync(arq, 'utf8').trim().split('\n');
    assert.equal(linhas.length, 2);
    // outra sessão parada repassando valor velho (menor, mesma janela): não grava nem baixa a linha
    r = rodar({ rate_limits: { five_hour: { used_percentage: 30, resets_at: 1790000000 } } });
    assert.equal(r.stdout, 'nabuco · 5h 43%\n');
    assert.equal(readFileSync(arq, 'utf8').trim().split('\n').length, 2);
    // janela nova (renova diferente) com valor menor é real: grava
    rodar({ rate_limits: { five_hour: { used_percentage: 2, resets_at: 1790018000 } } });
    assert.equal(readFileSync(arq, 'utf8').trim().split('\n').length, 3);
    // sem rate_limits (API key, antes da 1ª resposta): não grava nada e não quebra
    r = rodar({ model: {} });
    assert.equal(r.stdout, 'nabuco\n');
    assert.equal(readFileSync(arq, 'utf8').trim().split('\n').length, 3);
    writeFileSync(join(base, 'n', 'config.json'), JSON.stringify({ status_line_anterior: 'echo minha-linha' }));
    assert.equal(rodar(entrada).stdout.trim(), 'minha-linha');
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('setup --status-line: copia o script, configura settings e preserva a status line anterior', () => {
  const base = mkdtempSync(join(tmpdir(), 'nabuco setup-sl-'));
  try {
    const env = { ...process.env, NABUCO_HOME: join(base, 'n'), CODEX_HOME: join(base, 'codex'), CLAUDE_CONFIG_DIR: join(base, 'claude'), NABUCO_HARNESS: 'teste' };
    const run = args => spawnSync(process.execPath, [join(RAIZ, 'scripts', 'setup.mjs'), ...args], { cwd: base, encoding: 'utf8', env });
    mkdirSync(join(base, 'claude'), { recursive: true });
    writeFileSync(join(base, 'claude', 'settings.json'), JSON.stringify({ model: 'opus', statusLine: { type: 'command', command: 'echo antiga', padding: 1 } }));
    const r = run(['--status-line']);
    assert.equal(r.status, 0, r.stderr);
    const destino = join(base, 'n', 'bin', 'status-line.mjs');
    assert.ok(existsSync(destino));
    const settings = JSON.parse(readFileSync(join(base, 'claude', 'settings.json'), 'utf8'));
    assert.deepEqual(settings.statusLine, { type: 'command', command: `node "${destino}"`, padding: 1 });
    assert.equal(settings.model, 'opus');
    const config = JSON.parse(readFileSync(join(base, 'n', 'config.json'), 'utf8'));
    assert.equal(config.status_line, true);
    assert.equal(config.status_line_anterior, 'echo antiga');
    // setup de novo (sem a flag) mantém e não troca a anterior pela do próprio nabuco
    assert.equal(run([]).status, 0);
    assert.equal(JSON.parse(readFileSync(join(base, 'n', 'config.json'), 'utf8')).status_line_anterior, 'echo antiga');
    // settings ilegível: avisa e não sobrescreve
    writeFileSync(join(base, 'claude', 'settings.json'), '{quebrado');
    const q = run(['--status-line']);
    assert.equal(q.status, 0);
    assert.match(q.stdout, /ilegível/);
    assert.equal(readFileSync(join(base, 'claude', 'settings.json'), 'utf8'), '{quebrado');
  } finally { rmSync(base, { recursive: true, force: true }); }
});
