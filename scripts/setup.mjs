#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { nabucoHome } from './lib/caminhos.mjs';
import { lerJson, escreverJson } from './lib/json.mjs';
import { construir, diferencas } from './lib/build.mjs';
import { lerTime } from './lib/time.mjs';
import { garantirCerebroGit } from './sincronizar.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECADORES = ['arquiteto', 'revisor', 'seguranca', 'tester'];
export const codexHome = () => process.env.CODEX_HOME || join(homedir(), '.codex');
export const claudeHome = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');

let v;
try {
  ({ values: v } = parseArgs({ options: { codex: { type: 'string', default: 'auto' }, 'checadores-locais': { type: 'boolean', default: false }, 'status-line': { type: 'boolean', default: false }, 'cerebro-remoto': { type: 'string' } } }));
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
let config = { versao: 1, checadores_locais: false };
if (existsSync(arqConfig)) {
  try { config = lerJson(arqConfig); } catch (e) { aviso(`config.json ilegível (${e.message}); usando os padrões`); }
}

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

// 6. status line (limite do plano no painel). Instala só com --status-line; depois de instalada, cada
// setup recopia o script (o caminho do plugin muda a cada versão, por isso ele mora em ~/.nabuco/bin)
if (v['status-line'] || config.status_line) {
  const destino = join(home, 'bin', 'status-line.mjs');
  mkdirSync(dirname(destino), { recursive: true });
  copyFileSync(join(RAIZ, 'scripts', 'status-line.mjs'), destino);
  const comando = `node "${destino}"`;
  const arqSettings = join(claudeHome(), 'settings.json');
  let settings = {};
  let legivel = true;
  if (existsSync(arqSettings)) {
    try { settings = lerJson(arqSettings); } catch (e) { legivel = false; aviso(`${arqSettings} ilegível (${e.message}); não instalei a status line`); }
  }
  if (legivel) {
    const atual = settings.statusLine?.command;
    if (atual !== comando) {
      // status line que já existia continua aparecendo: a do nabuco só registra o limite e repassa
      if (typeof atual === 'string' && atual.trim() && !atual.includes('status-line.mjs')) config.status_line_anterior = atual;
      settings.statusLine = { ...(settings.statusLine ?? {}), type: 'command', command: comando };
      mkdirSync(claudeHome(), { recursive: true });
      escreverJson(arqSettings, settings);
    }
    config.status_line = true;
    ok(`status line do nabuco em ${arqSettings} (registra o limite do plano para o painel)`);
    if (config.status_line_anterior) console.log(`ℹ️ sua status line anterior continua aparecendo: ${config.status_line_anterior}`);
  }
}

// 7. sincronização do cérebro com um repositório git remoto (privado): casos, lições e histórico seguem
// para todas as máquinas. O que é da máquina (limite do plano, bin/, config, relatórios) fica fora
// (.gitignore e .gitattributes: IGNORAR e ATRIBUTOS em sincronizar.mjs, que os garante a cada sincronização).
if (v['cerebro-remoto'] !== undefined) {
  const url = v['cerebro-remoto'].trim();
  const git = args => spawnSync('git', ['-C', home, ...args], { encoding: 'utf8', timeout: 120000 });
  const erro = r => (r.error?.message || r.stderr || r.stdout || '').trim();
  const temCommit = () => git(['rev-parse', '--verify', '-q', 'HEAD']).status === 0;
  if (!url) { console.error('nabuco: --cerebro-remoto precisa da URL do repositório'); process.exit(2); }
  if (!existsSync(join(home, '.git'))) { console.error(`❌ ${home} não é um repositório git (instale o git e rode o setup de novo)`); process.exit(1); }
  if (git(['remote', 'get-url', 'origin']).status === 0) git(['remote', 'set-url', 'origin', url]);
  else git(['remote', 'add', 'origin', url]);
  const f = git(['fetch', '-q', 'origin']);
  if (f.status !== 0) { console.error(`❌ não consegui acessar ${url}: ${erro(f)}`); process.exit(1); }
  const remotoTem = git(['rev-parse', '--verify', '-q', 'origin/main']).status === 0;
  if (remotoTem && !temCommit()) {
    // máquina nova: o cérebro vem do remoto. Eventos já gravados aqui (sem commit) são reaplicados no fim
    const arqHist = join(home, 'historico.jsonl');
    const local = existsSync(arqHist) ? readFileSync(arqHist, 'utf8') : '';
    for (const n of ['historico.jsonl', '.gitignore', '.gitattributes']) rmSync(join(home, n), { force: true });
    const c = git(['checkout', '-q', '-B', 'main', 'origin/main']);
    if (c.status !== 0) {
      if (local) writeFileSync(arqHist, local);
      console.error(`❌ não consegui trazer o cérebro do remoto: ${erro(c)}`);
      process.exit(1);
    }
    if (local.trim()) appendFileSync(arqHist, local.endsWith('\n') ? local : local + '\n');
    ok(`cérebro trazido de ${url}`);
  }
  garantirCerebroGit(home, git);
  git(['add', '-A']);
  if (git(['diff', '--cached', '--quiet']).status === 1) git(['commit', '-q', '-m', 'sync: configura sincronização']);
  if (remotoTem && temCommit()) {
    const m = git(['merge', '-q', '--no-edit', '--allow-unrelated-histories', 'origin/main']);
    if (m.status !== 0) {
      git(['merge', '--abort']);
      console.error(`❌ o cérebro local e o remoto divergem e não deu para juntar sozinho: ${erro(m)}`);
      process.exit(1);
    }
  }
  git(['branch', '-q', '-M', 'main']);
  const p = git(['push', '-q', '-u', 'origin', 'main']);
  if (p.status !== 0) { console.error(`❌ não consegui enviar para ${url}: ${erro(p)}`); process.exit(1); }
  config.cerebro_remoto = url;
  config.sincronizar = true;
  ok(`cérebro sincronizado com ${url} (no início de cada sessão e depois de cada caso ou lição)`);
}

// 8. contratados (~/.nabuco/time): reinstala pelo contratar.mjs, que nunca sobrescreve agente alheio.
// O Codex segue a mesma decisão do passo 4.
const time = lerTime(home);
if (time.contratados.length || time.avisos.length) {
  const r = spawnSync(process.execPath, [join(RAIZ, 'scripts', 'contratar.mjs'), 'instalar', '--codex', instalarCodex ? 'sim' : 'nao'], { encoding: 'utf8' });
  for (const l of `${r.stdout ?? ''}`.split('\n').filter(Boolean)) console.log(l);
  for (const l of `${r.stderr ?? ''}`.split('\n').filter(Boolean)) aviso(l.replace(/^nabuco: (aviso: )?/, ''));
  if (r.status !== 0) aviso('contratados: instalação incompleta (veja acima); corrija e rode "contratar instalar"');
}

escreverJson(arqConfig, config);
console.log('ℹ️ dica: adicione `.nabuco/` ao .gitignore do projeto se não quiser versionar as tarefas');
console.log('\nSetup concluído.');
