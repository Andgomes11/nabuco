#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { acharProjeto, lerAtiva, nomeTarefaValido, nabucoHome } from './lib/caminhos.mjs';
import { registrar, detectarHarness } from './lib/eventos.mjs';
import { carregarModelosTodos, configDe } from './lib/modelos.mjs';
import { PAPEIS } from './lib/constantes.mjs';
import { papeis } from './lib/time.mjs';

const RAIZ_PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAPA = { SubagentStart: 'agente_inicio', SubagentStop: 'agente_fim' };

// `validos`: embutidos + contratados (padrão: só os embutidos). Contratado só vale com o prefixo
// nabuco- (o nome do agente instalado): um agente alheio de mesmo nome não vira funcionário.
export function normalizarPapel(agentType, validos = PAPEIS) {
  if (!agentType) return null;
  const s = String(agentType);
  const p = s.replace(/^nabuco[:-]/, '');
  if (PAPEIS.includes(p)) return p;
  return p !== s && validos.includes(p) ? p : null;
}

const CAUDA = 2 * 1024 * 1024; // do histórico global, só o fim interessa: o início é recente

function inicioEm(arq, agentId, cauda = false) {
  if (!existsSync(arq)) return null;
  let txt = readFileSync(arq, 'utf8');
  if (cauda && txt.length > CAUDA) txt = txt.slice(-CAUDA);
  for (const l of txt.trim().split('\n').reverse()) {
    try {
      const e = JSON.parse(l);
      if (e.tipo === 'agente_inicio' && e.dados?.agent_id === agentId) return e;
    } catch { /* linha corrompida (ou cortada pela cauda): ignora */ }
  }
  return null;
}

// início com o mesmo agent_id: primeiro na tarefa ativa, depois no histórico global
function inicioCorrespondente(projeto, agentId, global = false) {
  if (!agentId) return null;
  const ativa = lerAtiva(projeto);
  const naTarefa = ativa ? inicioEm(join(ativa.dir, 'eventos.jsonl'), agentId) : null;
  if (naTarefa || !global) return naTarefa;
  return inicioEm(join(nabucoHome(), 'historico.jsonl'), agentId, true);
}

function modoHook() {
  let payload = {};
  try { payload = JSON.parse(readFileSync(0, 'utf8') || '{}') ?? {}; } catch { payload = {}; }
  if (typeof payload !== 'object' || !Object.hasOwn(MAPA, payload.hook_event_name)) return;
  const tipo = MAPA[payload.hook_event_name];
  const projeto = acharProjeto(payload.cwd || process.cwd());
  const harness = detectarHarness(payload);
  let papel = normalizarPapel(payload.agent_type, papeis());
  // fim sem agent_type: o Claude Code também dispara SubagentStop para agentes internos dele, que não
  // têm início registrado. Só grava se houver o início (e herda o papel dele); senão é ruído no histórico
  let ini = null;
  if (tipo === 'agente_fim') {
    ini = inicioCorrespondente(projeto, payload.agent_id, !payload.agent_type);
    if (!payload.agent_type) {
      if (!ini) return;
      papel = ini.papel ?? null;
    }
  }
  const dados = {};
  if (payload.agent_id) dados.agent_id = payload.agent_id;
  const agente = payload.agent_type || ini?.dados?.agente;
  if (!papel && agente) dados.agente = agente;
  const cfg = papel ? configDe(carregarModelosTodos(RAIZ_PLUGIN), harness === 'codex' ? 'codex' : 'claude', papel) : null;
  if (cfg) { dados.modelo = cfg.model ?? 'herdado'; dados.effort = cfg.effort; }
  if (ini) dados.duracao_ms = Date.now() - Date.parse(ini.ts);
  registrar({ tipo, papel, dados, projeto, harness });
}

function modoCli(argv) {
  const { values: v, positionals: [tipo] } = parseArgs({ args: argv, options: { papel: { type: 'string' }, dados: { type: 'string' }, tarefa: { type: 'string' } }, allowPositionals: true });
  if (!tipo) { console.error('uso: evento.mjs <tipo> [--papel P] [--dados JSON] [--tarefa NOME]'); process.exit(2); }
  if (v.tarefa !== undefined && !nomeTarefaValido(v.tarefa)) { console.error('nabuco: --tarefa deve ser só o nome da pasta da tarefa (sem barra nem ..)'); process.exit(2); }
  let dados = {};
  if (v.dados) {
    try { dados = JSON.parse(v.dados); } catch { console.error('nabuco: --dados não é JSON válido'); process.exit(2); }
  }
  registrar({ tipo, papel: v.papel ?? null, dados, projeto: acharProjeto(process.cwd()), tarefa: v.tarefa });
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
