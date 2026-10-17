#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { nabucoHome } from './lib/caminhos.mjs';
import { lerJson, escreverJson } from './lib/json.mjs';
import { construir, diferencas } from './lib/build.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECADORES = ['arquiteto', 'revisor', 'seguranca', 'tester'];
export const codexHome = () => process.env.CODEX_HOME || join(homedir(), '.codex');
export const claudeHome = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');

let v;
try {
  ({ values: v } = parseArgs({ options: { codex: { type: 'string', default: 'auto' }, 'checadores-locais': { type: 'boolean', default: false } } }));
} catch (e) { console.error(`nabuco: ${e.message}`); process.exit(2); }
if (!['auto', 'sim', 'nao'].includes(v.codex)) { console.error('nabuco: --codex deve ser auto, sim ou nao'); process.exit(2); }

const ok = m => console.log(`✅ ${m}`);
const aviso = m => console.log(`⚠️ ${m}`);

// 1. Node
const maior = Number(process.versions.node.split('.')[0]);
if (maior < 20) { console.error(`❌ Node ${process.versions.node} — o nabuco precisa de Node 20 ou mais novo.`); process.exit(1); }
ok(`Node ${process.versions.node}`);

// 2. ~/.nabuco
const home = nabucoHome();
mkdirSync(home, { recursive: true });
if (!existsSync(join(home, '.git'))) {
  const g = spawnSync('git', ['init', '-q'], { cwd: home });
  if (g.status === 0) ok(`histórico versionado: git iniciado em ${home}`);
  else aviso(`git não disponível; ${home} ficará sem versionamento`);
} else ok(`pasta do nabuco: ${home}`);
const arqConfig = join(home, 'config.json');
const config = existsSync(arqConfig) ? lerJson(arqConfig) : { versao: 1, checadores_locais: false };

// 3. build
const { arquivos, erros } = construir(RAIZ);
if (erros.length) aviso('configuração dos funcionários com erros:\n' + erros.map(e => '   - ' + e).join('\n'));
else ok('configuração dos funcionários válida');
const dif = diferencas(RAIZ, arquivos);
if (dif.length) aviso(`agentes gerados desatualizados (${dif.length}); rode "npm run build" no plugin`);

// 4. Codex
const instalarCodex = v.codex === 'sim' || (v.codex === 'auto' && existsSync(codexHome()));
if (instalarCodex) {
  const destino = join(codexHome(), 'agents');
  mkdirSync(destino, { recursive: true });
  const tomls = readdirSync(join(RAIZ, 'codex-agents')).filter(f => f.endsWith('.toml'));
  for (const f of tomls) copyFileSync(join(RAIZ, 'codex-agents', f), join(destino, f));
  ok(`${tomls.length} agentes do Codex instalados em ${destino}`);
  aviso('no Codex, rode /hooks e confie nos hooks do nabuco (necessário a cada atualização do plugin)');
} else if (v.codex === 'auto') {
  console.log('ℹ️ Codex não encontrado; pulei os agentes do Codex (use --codex sim para forçar)');
}

// 5. checadores locais (fallback de restrição de ferramentas no Claude Code)
if (v['checadores-locais']) {
  const destino = join(claudeHome(), 'agents');
  mkdirSync(destino, { recursive: true });
  for (const p of CHECADORES) {
    const txt = readFileSync(join(RAIZ, 'agents', p + '.md'), 'utf8').replace(/^name: .*$/m, `name: nabuco-${p}`);
    writeFileSync(join(destino, `nabuco-${p}.md`), txt);
  }
  config.checadores_locais = true;
  ok(`checadores instalados como agentes locais em ${destino} (nabuco-<papel>)`);
}

escreverJson(arqConfig, config);
console.log('\nSetup concluído.');
