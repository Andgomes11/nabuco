import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { dirProjeto, dirTarefas, lerAtiva } from './caminhos.mjs';
import { lerJson } from './json.mjs';

// Auditor de release: funções puras ou só de leitura; quem grava o relatório é scripts/release.mjs.

export const dirReleases = projeto => join(dirProjeto(projeto), 'releases');
const MARCA = 'nabuco-release';
const LINHAS_SAIDA = 10;
const esc = s => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

// --- semver ---
const RE_SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
export const semverValida = v => RE_SEMVER.test(String(v ?? '').trim());

// -1, 0 ou 1 (precedência semver: build ignorado, pré-release < release); null se alguma for inválida.
export function compararSemver(a, b) {
  const pa = RE_SEMVER.exec(String(a ?? '').trim()), pb = RE_SEMVER.exec(String(b ?? '').trim());
  if (!pa || !pb) return null;
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d) return Math.sign(d);
  }
  if (!pa[4] || !pb[4]) return pa[4] ? -1 : pb[4] ? 1 : 0;
  const xa = pa[4].split('.'), xb = pb[4].split('.');
  for (let i = 0; i < Math.max(xa.length, xb.length); i++) {
    if (xa[i] === undefined) return -1;
    if (xb[i] === undefined) return 1;
    const na = /^\d+$/.test(xa[i]), nb = /^\d+$/.test(xb[i]);
    if (na && nb) { const d = Number(xa[i]) - Number(xb[i]); if (d) return Math.sign(d); continue; }
    if (na !== nb) return na ? -1 : 1;
    if (xa[i] !== xb[i]) return xa[i] < xb[i] ? -1 : 1;
  }
  return 0;
}

// --- base (desde quando auditar) ---
function git(projeto, args) {
  const r = spawnSync('git', ['-C', projeto, ...args], { encoding: 'utf8' });
  return r.error || r.status !== 0 ? null : r.stdout.trim();
}

// Maior tag semver (com ou sem v) alcançável do HEAD e a data do seu commit; tags como "deploy-prod"
// são ignoradas. null sem git, sem commits ou sem tag semver.
export function ultimaTag(projeto) {
  const tags = (git(projeto, ['tag', '--merged', 'HEAD']) ?? '').split(/\r?\n/).map(t => t.trim()).filter(semverValida);
  const tag = tags.sort((a, b) => compararSemver(b, a))[0];
  if (!tag) return null;
  const data = git(projeto, ['log', '-1', '--format=%cI', tag]);
  return data ? { tag, data } : null;
}

// Relatórios em .nabuco/releases/, pelo cabeçalho <!-- nabuco-release {...} -->; ignora os ilegíveis.
export function lerRelatorios(projeto) {
  const dir = dirReleases(projeto);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir).filter(f => f.endsWith('.md'))) {
    try {
      const m = readFileSync(join(dir, f), 'utf8').match(new RegExp(`^<!-- ${MARCA} (\\{.*\\}) -->`));
      const d = m && JSON.parse(m[1]);
      if (d?.versao && !Number.isNaN(Date.parse(d.gerado))) out.push({ ...d, arquivo: f });
    } catch { /* relatório ilegível: ignora */ }
  }
  return out;
}

// Relatório liberado desta versão, se houver (a versão já saiu; não reauditar por cima).
export const relatorioLiberado = (projeto, versao) =>
  lerRelatorios(projeto).find(r => r.resultado === 'liberada' && r.versao === versao) ?? null;

// Base: commit da última tag; sem tag, o último relatório liberado de outra versão; sem nada, todas as tarefas.
export function acharBase(projeto, versaoAlvo) {
  const t = ultimaTag(projeto);
  if (t) return { tipo: 'tag', tag: t.tag, data: t.data, descricao: `tag ${t.tag} (${t.data})` };
  const r = lerRelatorios(projeto)
    .filter(x => x.resultado === 'liberada' && x.versao !== versaoAlvo)
    .sort((a, b) => Date.parse(b.gerado) - Date.parse(a.gerado))[0];
  if (r) return { tipo: 'relatorio', versao: r.versao, data: r.gerado, descricao: `relatório da release ${r.versao} (${r.gerado})` };
  return { tipo: 'nenhuma', data: null, descricao: 'nenhuma tag nem relatório anterior (todas as tarefas)' };
}

// --- item 1: tarefas ---
export function listarTarefas(projeto, desde) {
  const dir = dirTarefas(projeto);
  if (!existsSync(dir)) return [];
  const ativa = lerAtiva(projeto)?.nome;
  const limite = desde ? Date.parse(desde) : null;
  const out = [];
  for (const nome of readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)) {
    let estado;
    try { estado = lerJson(join(dir, nome, 'estado.json')); }
    catch (e) { out.push({ nome, fase: null, criada: null, ativa: nome === ativa, erro: `estado.json ilegível (${e.message})` }); continue; }
    const criada = Date.parse(estado?.criada);
    // Sem data legível não dá para saber se é do período: entra (melhor conferir a mais que a menos).
    if (limite !== null && !Number.isNaN(criada) && criada < limite) continue;
    out.push({ nome, fase: estado?.fase ?? null, criada: estado?.criada ?? null, ativa: nome === ativa });
  }
  return out.sort((a, b) => String(a.criada ?? '').localeCompare(String(b.criada ?? '')) || a.nome.localeCompare(b.nome));
}

export const descreverTarefa = t => `${t.nome} — ${t.erro ?? t.fase ?? 'sem fase'}${t.ativa ? ' (ativa)' : ''}`;

// Não concluída (inclusive a ativa) falha; abandonada é aviso. Ativa já concluída/abandonada é "ativa" velha (como em tarefa.mjs).
export function auditarTarefas(tarefas) {
  const pendentes = tarefas.filter(t => t.erro || (t.fase !== 'concluida' && t.fase !== 'abandonada'));
  const abandonadas = tarefas.filter(t => !pendentes.includes(t) && t.fase === 'abandonada');
  const item = { nome: 'Tarefas', prova: '.nabuco/tarefas/*/estado.json', detalhes: [...pendentes, ...abandonadas].map(descreverTarefa) };
  if (pendentes.length) return { ...item, status: 'falha', resumo: `${pendentes.length} de ${tarefas.length} não concluída(s)` };
  if (abandonadas.length) return { ...item, status: 'aviso', resumo: `${tarefas.length} no período, ${abandonadas.length} abandonada(s)` };
  return { ...item, status: 'ok', resumo: tarefas.length ? `${tarefas.length} concluída(s)` : 'nenhuma tarefa no período' };
}

// --- item 2: versões ---
// Valor de `chave = "..."` dentro de uma seção TOML (até o próximo cabeçalho [..]).
function versaoToml(texto, secoes) {
  let secao = null;
  for (const linha of texto.split(/\r?\n/)) {
    const cab = linha.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);
    if (cab) { secao = cab[1].trim(); continue; }
    if (!secoes.includes(secao)) continue;
    const m = linha.match(/^\s*version\s*=\s*["']([^"']+)["']/);
    if (m) return m[1];
  }
  return null;
}

const MANIFESTOS = [
  ['package.json', t => JSON.parse(t.replace(/^﻿/, '')).version ?? null],
  ['.claude-plugin/plugin.json', t => JSON.parse(t.replace(/^﻿/, '')).version ?? null],
  ['.codex-plugin/plugin.json', t => JSON.parse(t.replace(/^﻿/, '')).version ?? null],
  ['pyproject.toml', t => versaoToml(t, ['project', 'tool.poetry'])],
  ['Cargo.toml', t => versaoToml(t, ['package', 'workspace.package'])],
];

// Manifestos que existem no projeto; `versao` null quando não declaram versão ou não dá para ler.
export function lerManifestos(projeto) {
  const out = [];
  for (const [arquivo, extrair] of MANIFESTOS) {
    const f = join(projeto, arquivo);
    if (!existsSync(f)) continue;
    try { out.push({ arquivo, versao: extrair(readFileSync(f, 'utf8')) }); }
    catch (e) { out.push({ arquivo, versao: null, erro: e.message }); }
  }
  return out;
}

// `tag`: última tag semver; sem tag, `versaoBase` é a versão do relatório usado como base.
export function auditarVersoes({ manifestos, versaoPedida = null, tag = null, versaoBase = null }) {
  const item = { nome: 'Versões', prova: manifestos.map(m => m.arquivo).join(', ') || '(nenhum manifesto)' };
  const detalhes = manifestos.map(m => `${m.arquivo}: ${m.versao ?? (m.erro ? `ilegível (${m.erro})` : 'sem versão')}`);
  const com = manifestos.filter(m => m.versao);
  const falha = resumo => ({ ...item, status: 'falha', resumo, detalhes, versao: com[0]?.versao ?? null });
  const ilegiveis = manifestos.filter(m => m.erro);
  if (ilegiveis.length) return falha(ilegiveis.map(m => `${m.arquivo} ilegível`).join(', '));
  if (!com.length) return falha('nenhum manifesto com versão (package.json, plugin.json, pyproject.toml, Cargo.toml)');
  const unicas = [...new Set(com.map(m => m.versao))];
  if (unicas.length > 1) return falha(`versões divergem: ${unicas.join(', ')}`);
  const versao = unicas[0];
  if (!semverValida(versao)) return falha(`versão "${versao}" não é semver (X.Y.Z)`);
  if (versaoPedida && compararSemver(versaoPedida, versao) !== 0) return falha(`--versao ${versaoPedida} não bate com os manifestos (${versao})`);
  if (tag) {
    const c = compararSemver(versao, tag);
    if (c === null) return { ...item, status: 'aviso', resumo: `${versao}; tag ${tag} não é semver, comparação ignorada`, detalhes, versao };
    if (c <= 0) return falha(`${versao} não é maior que a última tag (${tag})`);
    detalhes.push(`última tag: ${tag}`);
  } else if (versaoBase) {
    if (!(compararSemver(versao, versaoBase) > 0)) return falha(`${versao} não é maior que a release anterior ${versaoBase} (relatório)`);
    detalhes.push(`release anterior (relatório): ${versaoBase}`);
  }
  const anterior = tag ?? versaoBase;
  return { ...item, status: 'ok', resumo: anterior ? `${versao} (> ${anterior})` : versao, detalhes, versao };
}

// --- item 3: comandos ---
// .nabuco/release.json {"comandos": [...]}; sem ele, `npm test` se o package.json tiver script test.
export function lerComandos(projeto) {
  const arq = join(dirProjeto(projeto), 'release.json');
  if (existsSync(arq)) {
    let cfg;
    try { cfg = lerJson(arq); } catch (e) { return { fonte: '.nabuco/release.json', comandos: [], erro: `release.json ilegível (${e.message})` }; }
    const c = cfg?.comandos;
    if (!Array.isArray(c) || !c.every(x => typeof x === 'string' && x.trim())) {
      return { fonte: '.nabuco/release.json', comandos: [], erro: 'release.json: "comandos" deve ser uma lista de textos não vazios' };
    }
    return { fonte: '.nabuco/release.json', comandos: c };
  }
  const pkg = join(projeto, 'package.json');
  if (existsSync(pkg)) {
    try {
      if (lerJson(pkg)?.scripts?.test) return { fonte: 'package.json (script test)', comandos: ['npm test'] };
    } catch (e) { return { fonte: 'package.json', comandos: [], erro: `package.json ilegível (${e.message})` }; }
  }
  return { fonte: '(nenhuma)', comandos: [] };
}

// Roda pelo shell; guarda só o código de saída e as últimas linhas (sem despejar a saída inteira).
export function rodarComando(comando, cwd) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // um `node --test` aninhado reportaria ao processo de teste pai
  const r = spawnSync(comando, { cwd, shell: true, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  const linhas = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.split(/\r?\n/).filter(l => l.trim());
  return {
    comando,
    codigo: r.status,
    ultimas: linhas.slice(-LINHAS_SAIDA),
    ...(r.error ? { erro: r.error.message } : r.status === null ? { erro: `encerrado por ${r.signal}` } : {}),
  };
}

export function auditarComandos(projeto, { fonte, comandos, erro }, rodar = rodarComando) {
  const item = { nome: 'Comandos', prova: comandos.join(' ; ') || fonte };
  if (erro) return { ...item, status: 'falha', resumo: erro, detalhes: [], execucoes: [] };
  if (!comandos.length) {
    return { ...item, status: 'aviso', resumo: 'nenhum comando configurado (crie .nabuco/release.json com {"comandos": [...]})', detalhes: [], execucoes: [] };
  }
  const execucoes = comandos.map(c => rodar(c, projeto));
  const ruins = execucoes.filter(e => e.codigo !== 0);
  const detalhes = execucoes.map(e => `\`${e.comando}\` → ${e.erro ? `erro: ${e.erro}` : `saída ${e.codigo}`}`);
  return {
    ...item, detalhes, execucoes,
    status: ruins.length ? 'falha' : 'ok',
    resumo: ruins.length ? `${ruins.length} de ${execucoes.length} falharam (fonte: ${fonte})` : `${execucoes.length} passaram (fonte: ${fonte})`,
  };
}

// --- item 4: changelog ---
export function auditarChangelog(projeto, versao) {
  const item = { nome: 'Changelog', prova: 'CHANGELOG.md', detalhes: [] };
  const arq = join(projeto, 'CHANGELOG.md');
  if (!existsSync(arq)) return { ...item, status: 'falha', resumo: 'CHANGELOG.md não existe' };
  if (!versao) return { ...item, status: 'falha', resumo: 'sem versão para procurar no CHANGELOG.md' };
  const linhas = readFileSync(arq, 'utf8').split(/\r?\n/);
  const reVersao = new RegExp(`(?<![\\w.])v?${esc(String(versao).replace(/^v/, ''))}(?![\\w.-])`);
  const i = linhas.findIndex(l => /^#{1,6}\s/.test(l) && reVersao.test(l));
  if (i < 0) return { ...item, status: 'falha', resumo: `CHANGELOG.md sem seção para ${versao}` };
  const nivel = linhas[i].match(/^#+/)[0].length;
  const conteudo = [];
  for (const l of linhas.slice(i + 1)) {
    const h = l.match(/^(#{1,6})\s/);
    if (h && h[1].length <= nivel) break;
    if (l.trim() && !h) conteudo.push(l);
  }
  if (!conteudo.length) return { ...item, status: 'falha', resumo: `seção "${linhas[i].trim()}" sem conteúdo` };
  return { ...item, status: 'ok', resumo: `seção "${linhas[i].trim()}" com ${conteudo.length} linha(s)` };
}

// --- relatório ---
export const resultadoFinal = itens => (itens.some(i => i.status === 'falha') ? 'reprovada' : 'liberada');
export const ICONES = { ok: '✅ ok', falha: '❌ falha', aviso: '⚠️ aviso' };
const celula = s => String(s ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
const cerca = linhas => '`'.repeat(Math.max(3, ...linhas.map(l => Math.max(0, ...(l.match(/`+/g) ?? []).map(x => x.length + 1)))));

export function montarRelatorio({ versao, base, itens, tarefas, gerado }) {
  const resultado = resultadoFinal(itens);
  const md = [
    `<!-- ${MARCA} ${JSON.stringify({ versao, resultado, gerado })} -->`,
    `# Release ${versao} — ${resultado}`,
    '',
    `Gerado em ${gerado} · base: ${base.descricao}`,
    '',
    '| Item | Status | Prova | Resumo |',
    '|---|---|---|---|',
    ...itens.map(i => `| ${i.nome} | ${ICONES[i.status]} | \`${celula(i.prova)}\` | ${celula(i.resumo)} |`),
    '',
    '## Detalhes',
  ];
  for (const i of itens) {
    md.push('', `### ${i.nome}`, '', `${ICONES[i.status]} — ${i.resumo}`);
    if (i.detalhes?.length) md.push('', ...i.detalhes.map(d => `- ${d}`));
    for (const e of i.execucoes ?? []) {
      if (!e.ultimas.length) continue;
      const f = cerca(e.ultimas);
      md.push('', `Últimas linhas de \`${e.comando}\` (${e.erro ? `erro: ${e.erro}` : `saída ${e.codigo}`}):`, '', f, ...e.ultimas, f);
    }
  }
  md.push('', '## Tarefas do período', '', 'Confira se o changelog cobre cada uma:', '');
  md.push(...(tarefas.length ? tarefas.map(t => `- ${descreverTarefa(t)}`) : ['- (nenhuma)']));
  return md.join('\n') + '\n';
}
