#!/usr/bin/env node
// Auditor de release: confere tarefas, versões, comandos e changelog desde a release anterior.
// Só lê o projeto; grava apenas .nabuco/releases/<versao>.md. Nunca cria tag, commit, push nem publica.
// Saída: 0 liberada, 1 reprovada, 2 uso incorreto.
import { parseArgs } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { acharProjeto, dirProjeto, ehPastaGlobal } from './lib/caminhos.mjs';
import {
  dirReleases, semverValida, relatorioLiberado, acharBase, listarTarefas, auditarTarefas, lerManifestos, auditarVersoes,
  lerComandos, auditarComandos, auditarChangelog, resultadoFinal, montarRelatorio, ICONES,
} from './lib/release.mjs';

let v;
try {
  ({ values: v } = parseArgs({ args: process.argv.slice(2), options: { versao: { type: 'string' } } }));
  if (v.versao !== undefined && !semverValida(v.versao)) throw new Error(`--versao "${v.versao}" não é semver (X.Y.Z)`);
} catch (e) {
  console.error(`nabuco: ${e.message}`);
  console.error('uso: release.mjs [--versao X.Y.Z]');
  process.exit(2);
}

const projeto = acharProjeto(process.cwd());
if (ehPastaGlobal(dirProjeto(projeto))) {
  console.error('nabuco: esta pasta é a pasta global do nabuco; rode dentro de um projeto');
  process.exit(2);
}
const versaoPedida = v.versao?.replace(/^v/, '') ?? null;
const manifestos = lerManifestos(projeto);
const versao = versaoPedida ?? manifestos.find(m => m.versao)?.versao ?? null;
const nomeArquivo = semverValida(versao) ? versao.replace(/[^0-9A-Za-z.+-]/g, '_') : 'sem-versao';

// Relatório liberado é o registro da release (e base da próxima, sem tag): não sobrescreve.
const liberado = semverValida(versao) ? relatorioLiberado(projeto, versao) : null;
if (liberado) {
  console.error(`nabuco: a versão ${versao} já foi liberada (${relative(projeto, join(dirReleases(projeto), liberado.arquivo))}); suba a versão para auditar de novo`);
  process.exit(1);
}

const base = acharBase(projeto, versao);
const tarefas = listarTarefas(projeto, base.data);
const itens = [
  auditarTarefas(tarefas),
  auditarVersoes({
    manifestos, versaoPedida,
    tag: base.tipo === 'tag' ? base.tag : null,
    versaoBase: base.tipo === 'relatorio' ? base.versao : null,
  }),
  auditarComandos(projeto, lerComandos(projeto)),
  auditarChangelog(projeto, versao),
];
const resultado = resultadoFinal(itens);

const arq = join(dirReleases(projeto), `${nomeArquivo}.md`);
try {
  mkdirSync(dirReleases(projeto), { recursive: true });
  writeFileSync(arq, montarRelatorio({ versao: versao ?? nomeArquivo, base, itens, tarefas, gerado: new Date().toISOString() }));
} catch (e) {
  console.error(`nabuco: não consegui gravar o relatório (${e.message})`);
  process.exit(1);
}

console.log(`base: ${base.descricao}\n`);
for (const i of itens) console.log(`${ICONES[i.status].split(' ')[0]} ${i.nome}: ${i.resumo}`);
console.log(`\nnabuco: release ${versao ?? '(sem versão)'} ${resultado} — relatório em ${relative(projeto, arq)}`);
process.exitCode = resultado === 'liberada' ? 0 : 1;
