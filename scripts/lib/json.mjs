import { readFileSync, writeFileSync, renameSync } from 'node:fs';

export function lerJson(caminho) {
  return JSON.parse(readFileSync(caminho, 'utf8').replace(/^\uFEFF/, ''));
}

export function escreverJson(caminho, dados) {
  const tmp = caminho + '.tmp';
  writeFileSync(tmp, JSON.stringify(dados, null, 2) + '\n');
  renameSync(tmp, caminho);
}
