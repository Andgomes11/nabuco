#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { nabucoHome, acharProjeto, lerAtiva } from './lib/caminhos.mjs';
import { lerJson } from './lib/json.mjs';
import { construir, diferencas } from './lib/build.mjs';
import { pendencias } from './lib/criterios.mjs';
import { detectarHarness } from './lib/eventos.mjs';
import { lerTime, destinos, gerarArquivos, agenteEhNosso } from './lib/time.mjs';
import { arquivoFila, lerFila, resumoFila } from './lib/fila.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const codexHome = () => process.env.CODEX_HOME || join(homedir(), '.codex');
const ok = m => console.log(`✅ ${m}`);
const aviso = m => console.log(`⚠️ ${m}`);

console.log(`nabuco · harness: ${detectarHarness()}\n`);

let modelos = null;
try { modelos = lerJson(join(RAIZ, 'modelos.json')); } catch (e) { aviso(`modelos.json ilegível: ${e.message}`); }
const { papeis, arquivos, erros } = construir(RAIZ);
const fmt = c => c ? `${c.model ?? '(sessão)'}/${c.effort}` : '—';
console.log('Papel        Claude              Codex');
for (const p of papeis) console.log(`${p.padEnd(12)} ${fmt(modelos?.claude?.[p]).padEnd(19)} ${fmt(modelos?.codex?.[p])}`);
console.log('');

if (erros.length) aviso('erros de configuração:\n' + erros.map(e => '   - ' + e).join('\n'));
else ok('configuração dos funcionários válida');
const dif = diferencas(RAIZ, arquivos);
if (dif.length) aviso(`agentes gerados desatualizados: ${dif.join(', ')}`);

const home = nabucoHome();
let config = null;
if (!existsSync(join(home, 'config.json'))) aviso(`${home} não configurado — rode o setup (/nabuco:setup ou $setup)`);
else {
  try { config = lerJson(join(home, 'config.json')); ok(`pasta do nabuco: ${home}`); }
  catch (e) { aviso(`config.json ilegível (${e.message}); usando os padrões`); }
}

const destCodex = join(codexHome(), 'agents');
const tomls = readdirSync(join(RAIZ, 'codex-agents')).filter(f => f.endsWith('.toml'));
const instalados = existsSync(destCodex) ? tomls.filter(f => existsSync(join(destCodex, f))) : [];
if (instalados.length === tomls.length && instalados.every(f => readFileSync(join(destCodex, f), 'utf8') === readFileSync(join(RAIZ, 'codex-agents', f), 'utf8'))) {
  ok(`agentes do Codex instalados e atualizados (${tomls.length})`);
} else if (instalados.length) aviso(`agentes do Codex desatualizados ou incompletos (${instalados.length}/${tomls.length}) — rode o setup`);
else console.log('ℹ️ agentes do Codex não instalados');
if (config?.checadores_locais) console.log('ℹ️ checadores rodando como agentes locais (nabuco-<papel>)');

// Contratados (~/.nabuco/time): modelos e se o agente instalado bate com o registro.
// Aviso do registro sempre aparece: um contratado inválido nunca some em silêncio.
const time = lerTime(home);
for (const a of time.avisos) aviso(`registro do time: ${a}`);
if (time.contratados.length) {
  console.log('\nContratado   Tipo      Claude              Codex');
  for (const c of time.contratados) console.log(`${c.papel.padEnd(12)} ${c.tipo.padEnd(9)} ${fmt(c.claude).padEnd(19)} ${fmt(c.codex)}`);
  const situacao = (arq, esperado) => {
    try {
      if (!existsSync(arq)) return 'não instalado';
      if (!agenteEhNosso(arq)) return 'alheio (não é do nabuco)';
      return readFileSync(arq, 'utf8') === esperado ? 'atualizado' : 'desatualizado';
    } catch (e) { return `ilegível (${e.message})`; }
  };
  for (const c of time.contratados) {
    const dst = destinos(c.papel);
    const g = gerarArquivos(c);
    const sc = situacao(dst.claude, g.claude);
    const sx = situacao(dst.codex, g.codex);
    const linha = `${c.papel}: Claude ${sc} · Codex ${sx}`;
    // Codex ausente não é problema (pode não ser usado); Claude fora do ar ou qualquer cópia velha é
    if (sc === 'atualizado' && ['atualizado', 'não instalado'].includes(sx)) ok(linha);
    // alheio: instalar recusaria; quem resolve é o usuário (mover o agente dele ou remover o contratado)
    else if ([sc, sx].some(s => s.startsWith('alheio'))) aviso(`${linha} — há agente do usuário com o mesmo nome; o nabuco não o sobrescreve`);
    else aviso(`${linha} — rode "contratar instalar --papel ${c.papel}"`);
  }
} else if (!time.avisos.length) console.log('ℹ️ nenhum funcionário contratado');

const projeto = acharProjeto(process.cwd());
const ativa = lerAtiva(projeto);
if (!ativa) console.log('\nNenhuma tarefa ativa neste projeto.');
else {
  try {
    const estado = lerJson(join(ativa.dir, 'estado.json'));
    const crit = lerJson(join(ativa.dir, 'criterios.json'));
    const lista = Array.isArray(crit.criterios) ? crit.criterios : [];
    const passou = lista.length - (lista.length ? pendencias(crit).length : 0);
    console.log(`\nTarefa ativa: ${ativa.nome} · fase ${estado.fase} · critérios ${passou}/${lista.length}`);
  } catch (e) {
    aviso(`tarefa ativa ${ativa.nome} com arquivos ilegíveis: ${e.message}`);
  }
}

// Fila do projeto (.nabuco/fila.json): só aparece quando existe.
if (existsSync(arquivoFila(projeto))) {
  try {
    const r = resumoFila(lerFila(projeto), ativa?.nome ?? null); // item em andamento sem tarefa ativa = parada
    const curto = t => { const u = t.replace(/\s+/g, ' ').trim(); return u.length > 60 ? `${u.slice(0, 59)}…` : u; };
    const partes = [`Fila: ${r.pendentes} pendente${r.pendentes === 1 ? '' : 's'}`];
    if (r.parada) partes.push(`parada: ${curto(r.parada.motivo)}`);
    if (r.proximo) partes.push(`próximo: ${r.proximo.id} ${curto(r.proximo.pedido)}`);
    if (r.em_andamento) partes.push(`em andamento: ${r.em_andamento.id}`);
    console.log(partes.join(' · '));
  } catch (e) {
    aviso(e.message);
  }
}
