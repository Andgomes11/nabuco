#!/usr/bin/env node
// Vigia: segurança além do diff. `ambiente` audita as configurações do Claude e do Codex e o
// repositório (.env versionado, segredos no histórico); `deps` checa vulnerabilidades conhecidas.
// Só lê e reporta; nunca imprime segredo inteiro. Saída: 0 sem achado alta/media, 1 com, 2 uso incorreto.
import { parseArgs } from 'node:util';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { acharProjeto, dirProjeto, ehPastaGlobal } from './lib/caminhos.mjs';
import { auditarAmbiente, verificarDeps, codigoSaida, formatarTabela, resumir, mascararTexto, MAX_COMMITS } from './lib/vigia.mjs';

const USO = 'uso: vigia.mjs ambiente [--json] [--max-commits N] | vigia.mjs deps [--json] [--novos]';
function usoErrado(msg) {
  console.error(`nabuco: ${msg}`);
  console.error(USO);
  process.exit(2);
}
function opcoes(args, spec) {
  try { return parseArgs({ args, options: spec, allowPositionals: false }).values; }
  catch (e) { return usoErrado(e.message); }
}

const [modo, ...resto] = process.argv.slice(2);
const projeto = acharProjeto(process.cwd());

// Pastas do Claude e do Codex: respeitam CLAUDE_CONFIG_DIR e CODEX_HOME, como as próprias ferramentas.
const configClaude = process.env.CLAUDE_CONFIG_DIR;
const homeClaude = configClaude || join(homedir(), '.claude');
const claudeJson = configClaude ? join(configClaude, '.claude.json') : join(homedir(), '.claude.json');
const homeCodex = process.env.CODEX_HOME || join(homedir(), '.codex');

const modos = {
  ambiente() {
    const v = opcoes(resto, { json: { type: 'boolean' }, 'max-commits': { type: 'string' } });
    let maxCommits = MAX_COMMITS;
    if (v['max-commits'] !== undefined) {
      if (!/^\d+$/.test(v['max-commits']) || Number(v['max-commits']) < 1) usoErrado(`--max-commits "${v['max-commits']}" deve ser um inteiro positivo`);
      maxCommits = Number(v['max-commits']);
    }
    const { achados } = auditarAmbiente({ projeto, homeClaude, claudeJson, homeCodex, maxCommits, homeUsuario: homedir() });
    const resumo = resumir(achados);
    if (v.json) console.log(JSON.stringify({ modo: 'ambiente', projeto, resumo, achados }, null, 2));
    else {
      console.log(formatarTabela(achados));
      console.log(`\nnabuco: vigia ambiente — ${resumo.alta} alta, ${resumo.media} media, ${resumo.baixa} baixa, ${resumo.info} info`);
    }
    return codigoSaida(achados);
  },
  async deps() {
    const v = opcoes(resto, { json: { type: 'boolean' }, novos: { type: 'boolean' } });
    // deps grava o cache em .nabuco/vigia/: nunca na pasta global do nabuco.
    if (ehPastaGlobal(dirProjeto(projeto))) {
      console.error('nabuco: esta pasta é a pasta global do nabuco; rode dentro de um projeto');
      return 2;
    }
    const r = await verificarDeps({ projeto, novos: Boolean(v.novos) });
    if (r.avisoCache) console.error(`nabuco: aviso: ${r.avisoCache}`);
    const resumo = resumir(r.achados);
    if (v.json) {
      console.log(JSON.stringify({ modo: 'deps', projeto, novos: Boolean(v.novos), ...r, resumo }, null, 2));
      return codigoSaida(r.achados);
    }
    if (r.recente) {
      const h = Math.floor(r.idade / 3600e3);
      console.log(`nabuco: deps já verificado há ${h < 1 ? 'menos de 1h' : `${h}h`} (${r.verificado_em}); com --novos só checa de novo depois de 24h (rode sem --novos para checar agora)`);
      return 0;
    }
    if (r.semFontes) {
      if (r.achados.length) console.log(`${formatarTabela(r.achados)}\n`);
      console.log(`nabuco: nada a verificar: nenhum lockfile de dependências (${LOCKFILES})`);
      return codigoSaida(r.achados);
    }
    // "nenhuma vulnerabilidade" só quando algo foi de fato verificado.
    const vazio = !r.algoVerificado ? 'nenhum pacote verificado' : v.novos ? 'nenhum achado novo' : 'nenhuma vulnerabilidade conhecida nos pacotes verificados';
    console.log(r.achados.length ? formatarTabela(r.achados) : vazio);
    const fontes = r.fontes.map(f => `${f.arquivo} (${f.via === 'npm audit' ? 'npm audit' : `${f.pacotes} pacotes, OSV`})`).join(', ') || 'nenhuma fonte legível';
    console.log(`\nnabuco: vigia deps — ${resumo.alta} alta, ${resumo.media} media, ${resumo.baixa} baixa, ${resumo.info} info${v.novos ? ` (só ids fora do cache; ${r.total} no total)` : ''} — ${fontes}`);
    if (r.pulados.length) console.log(`nabuco: sem mudança desde a checagem de menos de 24h (não rechecados): ${r.pulados.join(', ')}`);
    if (!r.algoVerificado && !r.achados.length) console.log('nabuco: nada foi verificado');
    else if (r.achados.some(a => a.categoria === 'nao_verificado')) console.log('nabuco: há dependências NÃO verificadas; o cache só guardou os lockfiles verificados por completo');
    return codigoSaida(r.achados);
  },
};
const LOCKFILES = 'package-lock.json, npm-shrinkwrap.json, requirements.txt, poetry.lock, Cargo.lock, go.mod, pnpm-lock.yaml, yarn.lock';

if (!Object.hasOwn(modos, modo ?? '')) usoErrado(modo ? `modo desconhecido "${modo}"` : 'falta o modo (ambiente ou deps)');
try {
  process.exitCode = await modos[modo]();
} catch (e) {
  console.error(`nabuco: falha inesperada no vigia (${mascararTexto(e.message)})`);
  process.exitCode = 2;
}
