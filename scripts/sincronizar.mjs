#!/usr/bin/env node
// Sincroniza o cérebro (<NABUCO_HOME>, um repositório git) com o remoto configurado pelo setup
// (--cerebro-remoto): commita o pendente (histórico), traz o remoto (rebase) e envia.
//   node sincronizar.mjs          → em primeiro plano, imprime o resultado (exit 1 se falhar)
//   node sincronizar.mjs --fundo  → dispara em segundo plano e sai na hora (hook SessionStart, após commit)
// Sem remoto configurado (config.sincronizar), não faz nada. Duas sessões ao mesmo tempo: uma trava
// (.sync.lock) deixa só uma rodar. O resultado da última vez fica em sync.log (não versionado).
// Se o pull mudou time/ (contratados), os agentes nabuco-<p> desta máquina são reconciliados com o registro.
import { readFileSync, writeFileSync, openSync, closeSync, rmSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { nabucoHome } from './lib/caminhos.mjs';
import { reconciliarTime } from './lib/time.mjs';

const TRAVA_VELHA = 2 * 60 * 1000;
// O que é da máquina (limite do plano, bin/, config, relatórios) nunca sobe para o remoto.
export const IGNORAR = ['limite.jsonl', 'bin/', 'config.json', 'sync.log', '.sync.lock', '*.tmp', 'relatorios/'];
// Nada do cérebro é texto para o git: com core.autocrlf=true (Git for Windows) o checkout não vira CRLF.
// O histórico só recebe linhas no fim: o merge "union" junta as duas máquinas sem conflito.
export const ATRIBUTOS = ['* -text', 'historico.jsonl merge=union'];

// Acrescenta ao arquivo as linhas que faltam (as do usuário ficam). true se mudou.
function garantirLinhas(arq, linhas) {
  const atual = existsSync(arq) ? readFileSync(arq, 'utf8') : '';
  const tem = new Set(atual.split(/\r?\n/).map(l => l.trim()));
  const faltam = linhas.filter(l => !tem.has(l));
  if (!faltam.length) return false;
  writeFileSync(arq, (atual && !atual.endsWith('\n') ? atual + '\n' : atual) + faltam.join('\n') + '\n');
  return true;
}

// Arquivos versionados que estão com CRLF no disco (checkout antigo com autocrlf=true) voltam a LF.
export function normalizarFimDeLinha(home, git) {
  const r = git(['ls-files', '--eol', '-z']);
  if (r.status !== 0) return;
  for (const e of r.stdout.split('\0')) {
    const tab = e.indexOf('\t');
    if (tab < 0 || !/\bw\/(crlf|mixed)\b/.test(e.slice(0, tab))) continue;
    const arq = join(home, e.slice(tab + 1));
    try {
      const txt = readFileSync(arq, 'utf8');
      if (!txt.includes('\0')) writeFileSync(arq, txt.replace(/\r\n/g, '\n'));
    } catch { /* fica para a próxima */ }
  }
}

// .gitignore e .gitattributes do cérebro no formato atual, o ignorado fora do índice e nada com CRLF.
// Usado pelo setup ao configurar e a cada sincronização (cérebros configurados por versões antigas).
export function garantirCerebroGit(home, git) {
  garantirLinhas(join(home, '.gitignore'), IGNORAR);
  garantirLinhas(join(home, '.gitattributes'), ATRIBUTOS);
  git(['rm', '-r', '-q', '--cached', '--ignore-unmatch', ...IGNORAR.filter(x => !x.includes('*'))]);
  normalizarFimDeLinha(home, git);
}

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
  let res, contratados;
  try {
    try { garantirCerebroGit(home, git); } catch { /* melhor esforço: tenta de novo na próxima */ }
    git(['add', '-A']);
    if (git(['diff', '--cached', '--quiet']).status === 1) {
      const c = git(['commit', '-q', '-m', `sync: ${hostname()}`]);
      if (c.status !== 0) { res = falha('commit', c); return res; }
    }
    const antes = git(['rev-parse', '-q', '--verify', 'HEAD']).stdout.trim();
    const p = git(['pull', '-q', '--rebase', '--autostash', 'origin', 'main']);
    if (p.status !== 0) {
      git(['rebase', '--abort']);
      res = falha('pull', p);
      return res;
    }
    normalizarFimDeLinha(home, git); // o .gitattributes novo pode ter chegado agora
    // contratados de outra máquina: falha aqui só vai para o sync.log, nunca derruba a sincronização
    const mudouTime = antes ? git(['diff', '--quiet', antes, 'HEAD', '--', 'time']).status !== 0 : existsSync(join(home, 'time'));
    if (mudouTime) contratados = reconciliarTime(home);
    const e = git(['push', '-q', 'origin', 'HEAD:main']);
    res = { ...(e.status === 0 ? { ok: true } : falha('push', e)), ...(contratados && { contratados }) };
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
  else console.error(`nabuco: sincronização falhou no ${r.passo}: ${r.erro}`);
  if (r.contratados) {
    for (const l of r.contratados.linhas) console.log(`nabuco: contratados: ${l}`);
    for (const a of r.contratados.avisos) console.error(`nabuco: aviso: ${a.replace(/^nabuco: /, '')}`);
  }
  if (!r.ok) process.exit(1);
}
