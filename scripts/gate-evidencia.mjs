#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acharProjeto, lerAtiva } from './lib/caminhos.mjs';
import { lerJson, escreverJson } from './lib/json.mjs';
import { decidirGate } from './lib/gate.mjs';
import { registrar, detectarHarness } from './lib/eventos.mjs';

function lerPayload() {
  try { return JSON.parse(readFileSync(0, 'utf8') || '{}') ?? {}; } catch { return {}; }
}

try {
  const payload = lerPayload();
  const projeto = acharProjeto(payload.cwd || process.cwd());
  const ativa = lerAtiva(projeto);
  if (!ativa) process.exit(0);

  // tarefa com dono (sessão que rodou a CLI de tarefa, ver dono.mjs): outra sessão no mesmo projeto
  // não é do Gerente dela — não bloqueia nem mexe no contador
  let dono = null;
  try { dono = readFileSync(join(ativa.dir, 'sessao'), 'utf8').trim() || null; } catch { /* sem dono: vale para todos */ }
  if (dono && typeof payload.session_id === 'string' && payload.session_id && payload.session_id !== dono) process.exit(0);

  const arqEstado = join(ativa.dir, 'estado.json');
  const arqCriterios = join(ativa.dir, 'criterios.json');
  let estado, criterios, marca;
  try {
    estado = lerJson(arqEstado);
    criterios = lerJson(arqCriterios);
    marca = `${statSync(arqEstado).mtimeMs}|${statSync(arqCriterios).mtimeMs}`;
  } catch (e) {
    process.stderr.write(`nabuco: não consegui ler a tarefa ativa (${e.message}); gate ignorado.\n`);
    process.exit(0);
  }

  // Trava anti-loop: tentativas seguidas de encerrar sem progresso (independe do harness).
  // O contador guarda a "marca" (mtime de estado.json e criterios.json) do último bloqueio;
  // se a marca mudou, o Gerente avançou e a contagem recomeça.
  const arqContador = join(ativa.dir, 'gate-bloqueios');
  const lerContador = () => {
    try {
      const c = JSON.parse(readFileSync(arqContador, 'utf8'));
      return Number.isInteger(c?.n) && typeof c.marca === 'string' ? c : null;
    } catch { return null; }
  };
  const zerarContador = () => {
    if (!existsSync(arqContador)) return;
    try { rmSync(arqContador, { force: true }); } catch (e) {
      process.stderr.write(`nabuco: não consegui zerar o contador do gate (${e.message}).\n`);
    }
  };

  const cmdTarefa = `node "${join(dirname(fileURLToPath(import.meta.url)), 'tarefa.mjs')}"`;
  const r = decidirGate({ estado, criterios, cmdTarefa });
  if (!r.bloquear) { zerarContador(); process.exit(0); }

  const anterior = lerContador();
  const continua = anterior && payload.stop_hook_active !== false && anterior.marca === marca;
  const n = (continua ? anterior.n : 0) + 1;

  if (n >= 3) {
    zerarContador();
    try {
      escreverJson(arqEstado, { ...estado, fase: 'aguardando_usuario' });
      registrar({ tipo: 'gate_liberado', dados: { bloqueios: n, pendencias: r.pendencias }, projeto, harness: detectarHarness(payload) });
    } catch (e) {
      process.stderr.write(`nabuco: falha ao registrar a liberação do gate (${e.message}).\n`);
    }
    process.stderr.write(`nabuco: gate liberado após ${n} tentativas de encerrar sem progresso; tarefa movida para aguardando_usuario.\n`);
    process.exit(0);
  }

  try {
    writeFileSync(arqContador, JSON.stringify({ n, marca }));
  } catch (e) {
    // Sem contador não há trava anti-loop: melhor não bloquear do que prender o turno.
    process.stderr.write(`nabuco: não consegui gravar o contador do gate (${e.message}); gate ignorado.\n`);
    process.exit(0);
  }
  process.stdout.write(JSON.stringify({ decision: 'block', reason: r.motivo }) + '\n');
  try {
    registrar({ tipo: 'gate_bloqueou', dados: { fase: estado.fase, pendencias: r.pendencias }, projeto, harness: detectarHarness(payload) });
  } catch (e) {
    process.stderr.write(`nabuco: não consegui registrar o evento (${e.message}).\n`);
  }
} catch (e) {
  process.stderr.write(`nabuco: erro interno no gate (${e.message}); gate ignorado.\n`);
  process.exit(0);
}
