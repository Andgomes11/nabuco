#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acharProjeto, lerAtiva } from './lib/caminhos.mjs';
import { lerJson } from './lib/json.mjs';
import { decidirGate } from './lib/gate.mjs';
import { registrar } from './lib/eventos.mjs';

function lerPayload() {
  try { return JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { return {}; }
}

try {
  const payload = lerPayload();
  const projeto = acharProjeto(payload.cwd || process.cwd());
  const ativa = lerAtiva(projeto);
  if (!ativa) process.exit(0);

  let estado, criterios;
  try {
    estado = lerJson(join(ativa.dir, 'estado.json'));
    criterios = lerJson(join(ativa.dir, 'criterios.json'));
  } catch (e) {
    process.stderr.write(`nabuco: não consegui ler a tarefa ativa (${e.message}); gate ignorado.\n`);
    process.exit(0);
  }

  const cmdTarefa = `node "${join(dirname(fileURLToPath(import.meta.url)), 'tarefa.mjs')}"`;
  const r = decidirGate({ estado, criterios, cmdTarefa });
  if (!r.bloquear) process.exit(0);

  registrar({ tipo: 'gate_bloqueou', dados: { fase: estado.fase, pendencias: r.pendencias }, projeto, harness: undefined });
  process.stdout.write(JSON.stringify({ decision: 'block', reason: r.motivo }) + '\n');
} catch (e) {
  process.stderr.write(`nabuco: erro interno no gate (${e.message}); gate ignorado.\n`);
  process.exit(0);
}
