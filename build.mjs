#!/usr/bin/env node
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { construir, escrever, diferencas } from './scripts/lib/build.mjs';

const raiz = dirname(fileURLToPath(import.meta.url));
const { arquivos, erros } = construir(raiz);
if (erros.length) {
  console.error('Erros de configuração:\n' + erros.map(e => '  - ' + e).join('\n'));
  process.exit(1);
}
if (process.argv.includes('--check')) {
  const dif = diferencas(raiz, arquivos);
  if (dif.length) {
    console.error('Arquivos gerados desatualizados (rode "npm run build"):\n' + dif.map(d => '  - ' + d).join('\n'));
    process.exit(1);
  }
  console.log(`OK: ${arquivos.size} arquivos gerados estão atualizados.`);
} else {
  escrever(raiz, arquivos);
  console.log(`Gerados ${arquivos.size} arquivos em agents/ e codex-agents/.`);
}
