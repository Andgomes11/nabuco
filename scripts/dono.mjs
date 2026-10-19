#!/usr/bin/env node
// Hook PostToolUse (Bash): a sessão que roda a CLI de tarefa (tarefa.mjs) é a do Gerente dessa tarefa.
// Grava o session_id em <tarefa>/sessao; o gate de evidência só segura o turno dessa sessão, e outra
// sessão aberta no mesmo projeto não é bloqueada nem conta na trava anti-loop. Quem retoma a tarefa em
// outra sessão (rodando a CLI de novo) passa a ser o dono. Nunca falha: erro aqui não pode atrapalhar o Bash.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { acharProjeto, lerAtiva } from './lib/caminhos.mjs';

try {
  const payload = JSON.parse(readFileSync(0, 'utf8') || '{}') ?? {};
  const cmd = payload.tool_input?.command;
  const sessao = payload.session_id;
  if (typeof cmd === 'string' && cmd.includes('tarefa.mjs') && typeof sessao === 'string' && sessao) {
    const ativa = lerAtiva(acharProjeto(payload.cwd || process.cwd()));
    if (ativa) {
      const arq = join(ativa.dir, 'sessao');
      let atual = null;
      try { atual = readFileSync(arq, 'utf8').trim(); } catch { /* ainda sem dono */ }
      if (atual !== sessao) writeFileSync(arq, sessao + '\n');
    }
  }
} catch { /* silencioso de propósito */ }
process.exit(0);
