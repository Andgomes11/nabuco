import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { sincronizarEmFundo } from '../sincronizar.mjs';

// Commit no git da home (~/.nabuco). Nunca lança e nunca escreve em stdout.
export function commitHome(home, mensagem) {
  try {
    if (!existsSync(join(home, '.git'))) {
      console.error(`nabuco: aviso: ${home} não é um repositório git; commit ignorado`);
      return false;
    }
    const git = args => spawnSync('git', ['-C', home, ...args], { encoding: 'utf8' });
    const add = git(['add', '-A']);
    if (add.error || add.status !== 0) throw new Error((add.error?.message || add.stderr || '').trim() || 'git add falhou');
    const c = git(['commit', '-q', '-m', mensagem]);
    if (c.error || c.status !== 0) throw new Error((c.error?.message || c.stderr || c.stdout || '').trim() || 'git commit falhou');
    sincronizarEmFundo(home); // com remoto configurado, envia em segundo plano (não atrasa o comando)
    return true;
  } catch (e) {
    console.error(`nabuco: aviso: git falhou (${e.message})`);
    return false;
  }
}

// Ponto de partida do diff de uma tarefa, sem mexer nos arquivos, no HEAD nem na lista do stash:
// `git stash create` (commit solto com as mudanças rastreadas de agora) ou, sem mudanças, o HEAD.
// Fora de um repositório ou sem commit nenhum: null. Nunca lança.
export function baseDoDiff(projeto) {
  const RE_SHA = /^[0-9a-f]{40,64}$/;
  const git = args => {
    const r = spawnSync('git', ['-C', projeto, ...args], { encoding: 'utf8' });
    const sha = (r.stdout ?? '').trim();
    return !r.error && r.status === 0 && RE_SHA.test(sha) ? sha : null;
  };
  try { return git(['stash', 'create']) ?? git(['rev-parse', '--verify', '--quiet', 'HEAD']); } catch { return null; }
}

// Arquivos rastreados que mudaram (inclusive apagados) entre `base` e a árvore de agora, ordenados, sem
// a pasta .nabuco. Sem detecção de renomeação: os dois caminhos aparecem. Falha do git: null. Nunca lança.
export function rastreadosAlterados(projeto, base) {
  if (typeof base !== 'string' || !/^[0-9a-f]{40,64}$/.test(base)) return null; // só o sha gravado por `baseDoDiff`
  try {
    const r = spawnSync('git', ['-C', projeto, 'diff', '--name-only', '--no-renames', '-z', base, '--', '.', ':(exclude).nabuco'],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (r.error || r.status !== 0) return null;
    return (r.stdout ?? '').split('\0').filter(Boolean).sort();
  } catch { return null; }
}

// Arquivos não rastreados de agora (`git ls-files --others --exclude-standard`), ordenados, sem a pasta
// .nabuco (arquivos da própria tarefa). `git stash create` não guarda não rastreados: a tarefa grava esta
// lista ao nascer para separar depois os arquivos novos dela dos que já existiam.
// Fora de um repositório, falha do git ou mais de `limite` arquivos: null. Nunca lança.
export const MAX_NAO_RASTREADOS = 5000;
export function naoRastreados(projeto, limite = MAX_NAO_RASTREADOS) {
  try {
    const r = spawnSync('git', ['-C', projeto, 'ls-files', '--others', '--exclude-standard', '-z', '--', '.', ':(exclude).nabuco'],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (r.error || r.status !== 0) return null;
    const lista = (r.stdout ?? '').split('\0').filter(Boolean);
    return lista.length > limite ? null : lista.sort();
  } catch { return null; }
}
