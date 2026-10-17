import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';

export function nabucoHome() {
  return process.env.NABUCO_HOME || join(homedir(), '.nabuco');
}
export function dirProjeto(projeto) { return join(projeto, '.nabuco'); }

// true se `p` é a pasta global do nabuco (NABUCO_HOME ou ~/.nabuco); no Windows ignora caixa.
const normalizar = p => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));
export const ehPastaGlobal = p => [nabucoHome(), join(homedir(), '.nabuco')].some(g => normalizar(g) === normalizar(p));
export function dirTarefas(projeto) { return join(projeto, '.nabuco', 'tarefas'); }

// Sobe a partir de `inicio` até achar um projeto: a primeira pasta com `.nabuco/`
// (exceto a pasta global do usuário, ~/.nabuco) ou com `.git/` (fronteira do repositório).
// Sem nenhuma das duas até a raiz do disco, devolve `inicio`.
export function acharProjeto(inicio) {
  const globais = new Set([resolve(nabucoHome()), resolve(join(homedir(), '.nabuco'))]);
  let atual = resolve(inicio);
  for (;;) {
    const marca = join(atual, '.nabuco');
    if (existsSync(marca) && !globais.has(marca)) return atual;
    if (existsSync(join(atual, '.git'))) return atual;
    const pai = dirname(atual);
    if (pai === atual) return resolve(inicio);
    atual = pai;
  }
}

export function lerAtiva(projeto) {
  const arq = join(dirProjeto(projeto), 'ativa');
  if (!existsSync(arq)) return null;
  const nome = readFileSync(arq, 'utf8').trim();
  if (!nome) return null;
  const dir = join(dirTarefas(projeto), nome);
  return existsSync(dir) ? { nome, dir } : null;
}

export function escreverAtiva(projeto, nome) {
  mkdirSync(dirProjeto(projeto), { recursive: true });
  writeFileSync(join(dirProjeto(projeto), 'ativa'), nome + '\n');
}

export function limparAtiva(projeto) {
  rmSync(join(dirProjeto(projeto), 'ativa'), { force: true });
}
