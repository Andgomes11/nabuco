import { appendFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { nabucoHome, lerAtiva } from './caminhos.mjs';

export function detectarHarness(payload = {}) {
  if (process.env.NABUCO_HARNESS) return process.env.NABUCO_HARNESS;
  if (process.env.CLAUDECODE || process.env.CLAUDE_PROJECT_DIR) return 'claude';
  if (payload.turn_id || process.env.CODEX_HOME || process.env.CODEX_SANDBOX) return 'codex';
  return 'desconhecido';
}

export function registrar({ tipo, papel = null, dados = {}, projeto, harness }) {
  const ativa = lerAtiva(projeto);
  const ev = {
    ts: new Date().toISOString(),
    tarefa: ativa?.nome ?? null,
    projeto: basename(projeto),
    harness: harness ?? detectarHarness(),
    tipo,
    papel,
    dados,
  };
  const linha = JSON.stringify(ev) + '\n';
  if (ativa) appendFileSync(join(ativa.dir, 'eventos.jsonl'), linha);
  const home = nabucoHome();
  mkdirSync(home, { recursive: true });
  appendFileSync(join(home, 'historico.jsonl'), linha);
  return ev;
}
