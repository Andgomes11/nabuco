#!/usr/bin/env node
import { acharProjeto } from './lib/caminhos.mjs';
import { detectarVersoes } from './lib/versoes.mjs';

const pacotes = process.argv.slice(2);
if (!pacotes.length) {
  console.error('uso: versoes.mjs <pacote> [pacote...]');
  process.exit(2);
}
console.log(JSON.stringify(detectarVersoes(acharProjeto(process.cwd()), pacotes), null, 2));
