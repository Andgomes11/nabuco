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
else { config = lerJson(join(home, 'config.json')); ok(`pasta do nabuco: ${home}`); }

const destCodex = join(codexHome(), 'agents');
const tomls = readdirSync(join(RAIZ, 'codex-agents')).filter(f => f.endsWith('.toml'));
const instalados = existsSync(destCodex) ? tomls.filter(f => existsSync(join(destCodex, f))) : [];
if (instalados.length === tomls.length && instalados.every(f => readFileSync(join(destCodex, f), 'utf8') === readFileSync(join(RAIZ, 'codex-agents', f), 'utf8'))) {
  ok(`agentes do Codex instalados e atualizados (${tomls.length})`);
} else if (instalados.length) aviso(`agentes do Codex desatualizados ou incompletos (${instalados.length}/${tomls.length}) — rode o setup`);
else console.log('ℹ️ agentes do Codex não instalados');
if (config?.checadores_locais) console.log('ℹ️ checadores rodando como agentes locais (nabuco-<papel>)');

const projeto = acharProjeto(process.cwd());
const ativa = lerAtiva(projeto);
if (!ativa) { console.log('\nNenhuma tarefa ativa neste projeto.'); process.exit(0); }
try {
  const estado = lerJson(join(ativa.dir, 'estado.json'));
  const crit = lerJson(join(ativa.dir, 'criterios.json'));
  const lista = Array.isArray(crit.criterios) ? crit.criterios : [];
  const passou = lista.length - (lista.length ? pendencias(crit).length : 0);
  console.log(`\nTarefa ativa: ${ativa.nome} · fase ${estado.fase} · critérios ${passou}/${lista.length}`);
} catch (e) {
  aviso(`tarefa ativa ${ativa.nome} com arquivos ilegíveis: ${e.message}`);
}
