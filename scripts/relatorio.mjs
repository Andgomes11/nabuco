#!/usr/bin/env node
// Relatório do time: o que o time fez num período, a partir de ~/.nabuco/historico.jsonl.
// Só lê os dados do nabuco; com --gravar grava apenas o próprio relatório (.nabuco/relatorios/ do projeto,
// ou ~/.nabuco/relatorios/ com --projeto todos). Nunca envia nada. Saída: 0 ok, 1 falha ao gravar, 2 uso incorreto.
import { parseArgs } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, basename, relative } from 'node:path';
import { acharProjeto, dirProjeto, ehPastaGlobal, nabucoHome } from './lib/caminhos.mjs';
import { lerHistoricoDetalhado } from './lib/metricas.mjs';
import { papeisCerebro, escritores } from './lib/time.mjs';
import { acharBase } from './lib/release.mjs';
import { periodoPorDias, periodoPorDatas, periodoDesde, montarRelatorio, formatarRelatorio, nomeArquivo } from './lib/relatorio.mjs';

const USO = 'uso: relatorio.mjs [--dias N (padrão 7) | --desde AAAA-MM-DD [--ate AAAA-MM-DD] | --desde-release] [--projeto atual|todos] [--json] [--gravar]';
function usoErrado(msg) {
  console.error(`nabuco: ${msg}`);
  console.error(USO);
  process.exit(2);
}

let v;
try {
  ({ values: v } = parseArgs({
    args: process.argv.slice(2),
    options: {
      dias: { type: 'string' }, desde: { type: 'string' }, ate: { type: 'string' }, 'desde-release': { type: 'boolean' },
      projeto: { type: 'string' }, json: { type: 'boolean' }, gravar: { type: 'boolean' },
    },
  }));
} catch (e) { usoErrado(e.message); }

const modos = [v.dias !== undefined && '--dias', v.desde !== undefined && '--desde', v['desde-release'] && '--desde-release'].filter(Boolean);
if (modos.length > 1) usoErrado(`use só um período: ${modos.join(', ')}`);
if (v.ate !== undefined && v.desde === undefined) usoErrado('--ate só vale junto com --desde');
const escopo = v.projeto ?? 'atual';
if (!['atual', 'todos'].includes(escopo)) usoErrado(`--projeto "${escopo}" inválido (use atual ou todos)`);

const projeto = acharProjeto(process.cwd());
let periodo;
try {
  if (v.desde !== undefined) periodo = periodoPorDatas(v.desde, v.ate ?? null);
  else if (v['desde-release']) {
    const base = acharBase(projeto, null);
    if (base.tipo === 'nenhuma') usoErrado('--desde-release: nenhuma tag semver nem relatório de release liberado neste projeto');
    periodo = periodoDesde(base.data, base.tipo === 'tag' ? `desde a tag ${base.tag}` : `desde a release ${base.versao}`);
  } else {
    if (v.dias !== undefined && !/^\d+$/.test(v.dias)) usoErrado(`--dias "${v.dias}" deve ser um inteiro positivo`);
    periodo = periodoPorDias(v.dias === undefined ? 7 : Number(v.dias));
  }
} catch (e) { usoErrado(e.message); }

const nome = escopo === 'todos' ? null : basename(projeto);
const destino = escopo === 'todos' ? join(nabucoHome(), 'relatorios') : join(dirProjeto(projeto), 'relatorios');
if (v.gravar && escopo === 'atual' && ehPastaGlobal(dirProjeto(projeto))) {
  usoErrado('esta pasta é a pasta global do nabuco; rode dentro de um projeto ou use --projeto todos');
}

const home = nabucoHome();
const { eventos, ilegiveis, existe } = lerHistoricoDetalhado(home);
const r = montarRelatorio(eventos, {
  periodo, projeto: nome, papeis: papeisCerebro(home), escritores: escritores(home), ilegiveis, historicoExiste: existe,
});

let arq = null;
if (v.gravar) {
  arq = join(destino, nomeArquivo(periodo));
  try {
    mkdirSync(destino, { recursive: true });
    writeFileSync(arq, formatarRelatorio(r));
  } catch (e) {
    console.error(`nabuco: não consegui gravar o relatório (${e.message})`);
    process.exit(1);
  }
}
const mostrado = arq && (escopo === 'todos' ? arq : relative(projeto, arq));
if (v.json) console.log(JSON.stringify(arq ? { ...r, arquivo: mostrado } : r, null, 2));
else if (arq) console.log(`nabuco: relatório gravado em ${mostrado}`);
else process.stdout.write(formatarRelatorio(r));
