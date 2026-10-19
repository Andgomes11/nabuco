import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { nabucoHome, lerAtiva, dirTarefas } from './caminhos.mjs';

// CLAUDECODE é herdado por tudo que nasce do Claude Code (inclusive um Codex aberto dali),
// então só vale depois das marcas do Codex; CLAUDE_PROJECT_DIR só existe em hook do Claude.
export function detectarHarness(payload = {}, env = process.env) {
  if (env.NABUCO_HARNESS) return env.NABUCO_HARNESS;
  if (payload.turn_id) return 'codex';
  if (env.CLAUDE_PROJECT_DIR) return 'claude';
  if (env.CODEX_THREAD_ID || env.CODEX_SESSION_ID || env.CODEX_HOME || env.CODEX_SANDBOX) return 'codex';
  if (env.CLAUDECODE) return 'claude';
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
