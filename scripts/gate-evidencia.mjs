#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acharProjeto, lerAtiva } from './lib/caminhos.mjs';
import { lerJson, escreverJson } from './lib/json.mjs';
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

  // Trava anti-loop: contador de bloqueios seguidos.
  const arqContador = join(ativa.dir, 'gate-bloqueios');
  const lerContador = () => { try { return parseInt(readFileSync(arqContador, 'utf8'), 10) || 0; } catch { return 0; } };
  const gravarContador = n => { try { writeFileSync(arqContador, String(n)); } catch { /* ignora */ } };
  const reativado = payload.stop_hook_active === true;
  if (!reativado) gravarContador(0);

  const cmdTarefa = `node "${join(dirname(fileURLToPath(import.meta.url)), 'tarefa.mjs')}"`;
  const r = decidirGate({ estado, criterios, cmdTarefa });
  if (!r.bloquear) process.exit(0);

  const n = lerContador() + 1;
  if (n >= 3 && reativado) {
    gravarContador(0);
    try {
      escreverJson(join(ativa.dir, 'estado.json'), { ...estado, fase: 'aguardando_usuario' });
      registrar({ tipo: 'gate_liberado', dados: { bloqueios: n, pendencias: r.pendencias }, projeto, harness: undefined });
    } catch (e) {
      process.stderr.write(`nabuco: falha ao registrar a liberação do gate (${e.message}).\n`);
    }
    process.stderr.write('nabuco: gate bloqueou 3 vezes seguidas; tarefa movida para aguardando_usuario.\n');
    process.exit(0);
  }

  gravarContador(n);
  process.stdout.write(JSON.stringify({ decision: 'block', reason: r.motivo }) + '\n');
  try {
    registrar({ tipo: 'gate_bloqueou', dados: { fase: estado.fase, pendencias: r.pendencias }, projeto, harness: undefined });
  } catch (e) {
    process.stderr.write(`nabuco: não consegui registrar o evento (${e.message}).\n`);
  }
} catch (e) {
  process.stderr.write(`nabuco: erro interno no gate (${e.message}); gate ignorado.\n`);
  process.exit(0);
}
