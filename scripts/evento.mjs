#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { acharProjeto, lerAtiva } from './lib/caminhos.mjs';
import { registrar, detectarHarness } from './lib/eventos.mjs';
import { carregarModelos, configDe } from './lib/modelos.mjs';
import { PAPEIS } from './lib/constantes.mjs';

const RAIZ_PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAPA = { SubagentStart: 'agente_inicio', SubagentStop: 'agente_fim' };

export function normalizarPapel(agentType) {
  if (!agentType) return null;
  const p = String(agentType).replace(/^nabuco[:-]/, '');
  return PAPEIS.includes(p) ? p : null;
}

function inicioCorrespondente(projeto, agentId) {
  const ativa = lerAtiva(projeto);
  if (!ativa || !agentId) return null;
  const arq = join(ativa.dir, 'eventos.jsonl');
  if (!existsSync(arq)) return null;
  const linhas = readFileSync(arq, 'utf8').trim().split('\n').reverse();
  for (const l of linhas) {
    try {
      const e = JSON.parse(l);
      if (e.tipo === 'agente_inicio' && e.dados?.agent_id === agentId) return e;
    } catch { /* linha corrompida: ignora */ }
  }
  return null;
}

function modoHook() {
  let payload = {};
  try { payload = JSON.parse(readFileSync(0, 'utf8') || '{}') ?? {}; } catch { payload = {}; }
  if (typeof payload !== 'object' || !Object.hasOwn(MAPA, payload.hook_event_name)) return;
  const tipo = MAPA[payload.hook_event_name];
  const projeto = acharProjeto(payload.cwd || process.cwd());
  const harness = detectarHarness(payload);
  const papel = normalizarPapel(payload.agent_type);
  const dados = {};
  if (payload.agent_id) dados.agent_id = payload.agent_id;
  if (!papel && payload.agent_type) dados.agente = payload.agent_type;
  const cfg = papel ? configDe(carregarModelos(RAIZ_PLUGIN), harness === 'codex' ? 'codex' : 'claude', papel) : null;
  if (cfg) { dados.modelo = cfg.model ?? 'herdado'; dados.effort = cfg.effort; }
  if (tipo === 'agente_fim') {
    const ini = inicioCorrespondente(projeto, payload.agent_id);
    if (ini) dados.duracao_ms = Date.now() - Date.parse(ini.ts);
  }
  registrar({ tipo, papel, dados, projeto, harness });
}

function modoCli(argv) {
  const { values: v, positionals: [tipo] } = parseArgs({ args: argv, options: { papel: { type: 'string' }, dados: { type: 'string' } }, allowPositionals: true });
  if (!tipo) { console.error('uso: evento.mjs <tipo> [--papel P] [--dados JSON]'); process.exit(2); }
  let dados = {};
  if (v.dados) {
    try { dados = JSON.parse(v.dados); } catch { console.error('nabuco: --dados não é JSON válido'); process.exit(2); }
  }
  registrar({ tipo, papel: v.papel ?? null, dados, projeto: acharProjeto(process.cwd()) });
}

const executadoDireto = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (executadoDireto) {
  const args = process.argv.slice(2);
  if (args[0] === '--hook') {
    try { modoHook(); } catch (e) { process.stderr.write(`nabuco: erro ao registrar evento (${e.message})\n`); }
    process.exit(0);
  }
  try { modoCli(args); } catch (e) { console.error(`nabuco: ${e.message}`); process.exit(2); }
}
