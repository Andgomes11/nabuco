#!/usr/bin/env node
// Status line do nabuco: guarda o uso do limite do plano (janela de 5 h e semanal) em
// <NABUCO_HOME>/limite.jsonl para o painel, e imprime a linha de status.
// Autocontido de propósito: o setup copia este arquivo para <NABUCO_HOME>/bin/, fora da pasta
// versionada do plugin (que muda de caminho a cada atualização).
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

const home = process.env.NABUCO_HOME || join(homedir(), '.nabuco');
const ARQ = join(home, 'limite.jsonl');
const LIMITE_BYTES = 1024 * 1024; // acima disso, mantém só as últimas MANTER linhas
const MANTER = 5000;

const finito = x => typeof x === 'number' && Number.isFinite(x);
function janela(j) {
  if (!j || typeof j !== 'object' || !finito(j.used_percentage)) return null;
  return { pct: Math.round(j.used_percentage * 10) / 10, renova: finito(j.resets_at) ? j.resets_at : null };
}

function ultimaLinha() {
  try {
    const linhas = readFileSync(ARQ, 'utf8').trimEnd().split('\n');
    return JSON.parse(linhas[linhas.length - 1]);
  } catch { return null; }
}

const igual = (a, b) => (a?.pct ?? null) === (b?.pct ?? null) && (a?.renova ?? null) === (b?.renova ?? null);

// grava só quando muda: a status line roda a cada atualização da tela
function registrarAmostra(entrada) {
  const rl = entrada?.rate_limits;
  const h5 = janela(rl?.five_hour);
  const sem = janela(rl?.seven_day);
  if (!h5 && !sem) return null;
  const amostra = { ts: new Date().toISOString(), ...(h5 && { h5 }), ...(sem && { sem }) };
  const ult = ultimaLinha();
  if (ult && igual(ult.h5, h5) && igual(ult.sem, sem)) return amostra;
  mkdirSync(home, { recursive: true });
  appendFileSync(ARQ, JSON.stringify(amostra) + '\n');
  try {
    if (statSync(ARQ).size > LIMITE_BYTES) {
      const linhas = readFileSync(ARQ, 'utf8').trimEnd().split('\n').slice(-MANTER);
      writeFileSync(ARQ, linhas.join('\n') + '\n');
    }
  } catch { /* poda é melhor esforço */ }
  return amostra;
}

function texto(a) {
  if (!a) return 'nabuco';
  const partes = ['nabuco'];
  if (a.h5) partes.push(`5h ${Math.round(a.h5.pct)}%`);
  if (a.sem) partes.push(`semana ${Math.round(a.sem.pct)}%`);
  return partes.join(' · ');
}

// status line que o usuário já tinha antes do setup: continua sendo a que aparece
function anterior() {
  try {
    const cfg = JSON.parse(readFileSync(join(home, 'config.json'), 'utf8'));
    return typeof cfg.status_line_anterior === 'string' && cfg.status_line_anterior.trim() ? cfg.status_line_anterior : null;
  } catch { return null; }
}

let bruto = '';
try { bruto = readFileSync(0, 'utf8'); } catch { /* sem stdin */ }
let entrada = {};
try { entrada = JSON.parse(bruto || '{}') ?? {}; } catch { entrada = {}; }
let amostra = null;
try { amostra = registrarAmostra(entrada); } catch { /* nunca quebra a status line */ }
const cmd = anterior();
if (cmd) {
  const r = spawnSync(cmd, { input: bruto, shell: true, encoding: 'utf8', timeout: 5000 });
  process.stdout.write(r.stdout ?? '');
} else {
  process.stdout.write(texto(amostra) + '\n');
}
