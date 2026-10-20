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
