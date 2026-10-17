import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { nabucoHome, lerAtiva, dirTarefas } from './caminhos.mjs';

export function detectarHarness(payload = {}) {
  if (process.env.NABUCO_HARNESS) return process.env.NABUCO_HARNESS;
  if (process.env.CLAUDECODE || process.env.CLAUDE_PROJECT_DIR) return 'claude';
  if (payload.turn_id || process.env.CODEX_HOME || process.env.CODEX_SANDBOX) return 'codex';
  return 'desconhecido';
}

// `tarefa` (nome da pasta) atribui o evento a uma tarefa já encerrada, em vez da ativa
// (ex.: correcao_usuario depois do "pronto"); quem chama valida o nome.
export function registrar({ tipo, papel = null, dados = {}, projeto, harness, tarefa }) {
  let ativa;
  if (tarefa) {
    const dir = join(dirTarefas(projeto), tarefa);
    ativa = existsSync(dir) ? { nome: tarefa, dir } : { nome: tarefa, dir: null };
  } else ativa = lerAtiva(projeto);
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
  if (ativa?.dir) appendFileSync(join(ativa.dir, 'eventos.jsonl'), linha);
  const home = nabucoHome();
  mkdirSync(home, { recursive: true });
  appendFileSync(join(home, 'historico.jsonl'), linha);
  return ev;
}
