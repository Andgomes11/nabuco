#!/usr/bin/env node
// Sincroniza o cérebro (<NABUCO_HOME>, um repositório git) com o remoto configurado pelo setup
// (--cerebro-remoto): commita o pendente (histórico), traz o remoto (rebase) e envia.
//   node sincronizar.mjs          → em primeiro plano, imprime o resultado (exit 1 se falhar)
//   node sincronizar.mjs --fundo  → dispara em segundo plano e sai na hora (hook SessionStart, após commit)
// Sem remoto configurado (config.sincronizar), não faz nada. Duas sessões ao mesmo tempo: uma trava
// (.sync.lock) deixa só uma rodar. O resultado da última vez fica em sync.log (não versionado).
import { readFileSync, writeFileSync, openSync, closeSync, rmSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { nabucoHome } from './lib/caminhos.mjs';

const TRAVA_VELHA = 2 * 60 * 1000;

export function configuradoEm(home) {
  try {
    const cfg = JSON.parse(readFileSync(join(home, 'config.json'), 'utf8'));
    return cfg.sincronizar === true && existsSync(join(home, '.git'));
  } catch { return false; }
}

// dispara a sincronização em segundo plano (não espera; nunca lança)
export function sincronizarEmFundo(home = nabucoHome()) {
  try {
    if (!configuradoEm(home)) return false;
    const filho = spawn(process.execPath, [fileURLToPath(import.meta.url)], {
      detached: true, stdio: 'ignore', env: { ...process.env, NABUCO_HOME: home },
    });
    filho.unref();
    return true;
  } catch { return false; }
}

function travar(home) {
  const arq = join(home, '.sync.lock');
  try {
    if (existsSync(arq) && Date.now() - statSync(arq).mtimeMs > TRAVA_VELHA) rmSync(arq, { force: true });
    closeSync(openSync(arq, 'wx'));
    return () => rmSync(arq, { force: true });
  } catch { return null; }
}

export function sincronizar(home = nabucoHome()) {
  if (!configuradoEm(home)) return { ok: true, pulado: 'sincronização não configurada' };
  const soltar = travar(home);
  if (!soltar) return { ok: true, pulado: 'outra sincronização em andamento' };
  const git = args => spawnSync('git', ['-C', home, ...args], { encoding: 'utf8', timeout: 60000 });
  const falha = (passo, r) => ({ ok: false, passo, erro: (r.error?.message || r.stderr || r.stdout || '').trim() });
  let res;
  try {
    git(['add', '-A']);
    if (git(['diff', '--cached', '--quiet']).status === 1) {
      const c = git(['commit', '-q', '-m', `sync: ${hostname()}`]);
      if (c.status !== 0) { res = falha('commit', c); return res; }
    }
    const p = git(['pull', '-q', '--rebase', '--autostash', 'origin', 'main']);
    if (p.status !== 0) {
      git(['rebase', '--abort']);
      res = falha('pull', p);
      return res;
    }
    const e = git(['push', '-q', 'origin', 'HEAD:main']);
    res = e.status === 0 ? { ok: true } : falha('push', e);
    return res;
  } finally {
    soltar();
    try { writeFileSync(join(home, 'sync.log'), `${new Date().toISOString()} ${JSON.stringify(res ?? { ok: false, erro: 'interrompido' })}\n`); } catch { /* log é melhor esforço */ }
  }
}

const executadoDireto = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (executadoDireto) {
  if (process.argv.includes('--fundo')) { sincronizarEmFundo(); process.exit(0); }
  const r = sincronizar();
  if (r.pulado) console.log(`nabuco: ${r.pulado}`);
  else if (r.ok) console.log('nabuco: cérebro sincronizado');
  else { console.error(`nabuco: sincronização falhou no ${r.passo}: ${r.erro}`); process.exit(1); }
}
