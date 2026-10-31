import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { registroMd, validarContratacao, agenteEhNosso } from '../scripts/lib/time.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
let base, remoto;
const GIT_ENV = { GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_GLOBAL: '/dev/null' };
// core.autocrlf=true (padrão do Git for Windows) forçado pelo ambiente, em qualquer sistema
const AUTOCRLF = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.autocrlf', GIT_CONFIG_VALUE_0: 'true' };
const maquina = (nome, extra = {}) => ({ ...process.env, ...GIT_ENV, NABUCO_HOME: join(base, nome), CODEX_HOME: join(base, `${nome}-codex`), CLAUDE_CONFIG_DIR: join(base, `${nome}-claude`), NABUCO_HARNESS: 'teste', ...extra });
const run = (env, script, args = []) => spawnSync(process.execPath, [join(RAIZ, 'scripts', script), ...args], { cwd: base, encoding: 'utf8', env });
const git = (dir, ...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
const gitCom = (env, dir, ...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env });
const linhas = arq => readFileSync(arq, 'utf8').trim().split('\n');

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'nabuco sync-'));
  remoto = join(base, 'remoto.git');
  spawnSync('git', ['init', '-q', '--bare', '-b', 'main', remoto]);
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

test('sincronizar sem remoto configurado não faz nada', () => {
  const A = maquina('a');
  assert.equal(run(A, 'setup.mjs').status, 0);
  const r = run(A, 'sincronizar.mjs');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /não configurada/);
});

test('duas máquinas: a primeira envia, a segunda traz, e o histórico das duas se junta sem conflito', () => {
  const A = maquina('a'), B = maquina('b');
  const homeA = A.NABUCO_HOME, homeB = B.NABUCO_HOME;
  // máquina A com cérebro já em uso (casos, histórico) e arquivos que são só dela
  assert.equal(run(A, 'setup.mjs').status, 0);
  mkdirSync(join(homeA, 'casos', 'dev'), { recursive: true });
  writeFileSync(join(homeA, 'casos', 'dev', 'c1.md'), 'sintoma: x\n');
  writeFileSync(join(homeA, 'historico.jsonl'), '{"tipo":"a1"}\n');
  writeFileSync(join(homeA, 'limite.jsonl'), '{"h5":{"pct":1}}\n');
  git(homeA, 'add', '-A'); git(homeA, 'commit', '-q', '-m', 'inicio');
  const r = run(A, 'setup.mjs', ['--cerebro-remoto', remoto]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /cérebro sincronizado com/);
  const noRemoto = git(remoto, 'ls-tree', '-r', '--name-only', 'main').stdout.trim().split('\n');
  assert.ok(noRemoto.includes('casos/dev/c1.md'));
  assert.ok(noRemoto.includes('historico.jsonl'));
  assert.ok(!noRemoto.includes('limite.jsonl') && !noRemoto.includes('config.json'), 'o que é da máquina não sobe');
  assert.equal(JSON.parse(readFileSync(join(homeA, 'config.json'), 'utf8')).sincronizar, true);

  // máquina B nova (já com um evento local antes do setup): traz o cérebro e mantém o evento
  mkdirSync(homeB, { recursive: true });
  writeFileSync(join(homeB, 'historico.jsonl'), '{"tipo":"b0"}\n');
  const rb = run(B, 'setup.mjs', ['--cerebro-remoto', remoto]);
  assert.equal(rb.status, 0, rb.stderr + rb.stdout);
  assert.match(rb.stdout, /cérebro trazido de/);
  assert.ok(existsSync(join(homeB, 'casos', 'dev', 'c1.md')));
  assert.deepEqual(linhas(join(homeB, 'historico.jsonl')), ['{"tipo":"a1"}', '{"tipo":"b0"}']);

  // as duas gravam eventos ao mesmo tempo e sincronizam: union junta tudo, sem conflito
  appendFileSync(join(homeA, 'historico.jsonl'), '{"tipo":"a2"}\n');
  appendFileSync(join(homeB, 'historico.jsonl'), '{"tipo":"b1"}\n');
  for (const [m, quem] of [[A, 'A'], [B, 'B'], [A, 'A de novo']]) {
    const s = run(m, 'sincronizar.mjs');
    assert.equal(s.status, 0, `${quem}: ${s.stderr}`);
  }
  for (const h of [homeA, homeB]) {
    assert.deepEqual(linhas(join(h, 'historico.jsonl')).sort(), ['{"tipo":"a1"}', '{"tipo":"a2"}', '{"tipo":"b0"}', '{"tipo":"b1"}']);
  }
  assert.match(readFileSync(join(homeA, 'sync.log'), 'utf8'), /"ok":true/);
});

test('remoto inacessível: setup avisa e sai com erro, sem marcar a sincronização', () => {
  const A = maquina('a');
  assert.equal(run(A, 'setup.mjs').status, 0);
  const r = run(A, 'setup.mjs', ['--cerebro-remoto', join(base, 'nao-existe.git')]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /não consegui acessar/);
  assert.notEqual(JSON.parse(readFileSync(join(A.NABUCO_HOME, 'config.json'), 'utf8')).sincronizar, true);
});

// ---------- fim de linha (Windows) e o que nunca sobe ----------

test('core.autocrlf=true: a máquina nova traz o cérebro sem CRLF', () => {
  const A = maquina('a', AUTOCRLF), B = maquina('b', AUTOCRLF);
  assert.equal(run(A, 'setup.mjs').status, 0);
  mkdirSync(join(A.NABUCO_HOME, 'casos', 'dev'), { recursive: true });
  writeFileSync(join(A.NABUCO_HOME, 'casos', 'dev', 'c1.md'), 'sintoma: x\ncausa: y\n');
  writeFileSync(join(A.NABUCO_HOME, 'historico.jsonl'), '{"tipo":"a1"}\n');
  assert.equal(run(A, 'setup.mjs', ['--cerebro-remoto', remoto]).status, 0);
  assert.deepEqual(linhas(join(A.NABUCO_HOME, '.gitattributes')), ['* -text', 'historico.jsonl merge=union']);
  const rb = run(B, 'setup.mjs', ['--cerebro-remoto', remoto]);
  assert.equal(rb.status, 0, rb.stderr + rb.stdout);
  for (const n of ['historico.jsonl', 'casos/dev/c1.md', '.gitignore', '.gitattributes']) {
    assert.ok(!readFileSync(join(B.NABUCO_HOME, n), 'utf8').includes('\r'), `${n} veio com CRLF`);
  }
});

test('cérebro configurado no formato antigo: sincronizar corrige .gitattributes e CRLF e tira relatorios/ do remoto', () => {
  const A = maquina('a', AUTOCRLF);
  const h = A.NABUCO_HOME;
  assert.equal(run(A, 'setup.mjs').status, 0);
  mkdirSync(join(h, 'casos', 'dev'), { recursive: true });
  writeFileSync(join(h, 'casos', 'dev', 'c1.md'), 'sintoma: x\ncausa: y\n');
  assert.equal(run(A, 'setup.mjs', ['--cerebro-remoto', remoto]).status, 0);
  // como ficava um cérebro configurado antes da correção: sem "* -text", sem relatorios/ no .gitignore,
  // relatório versionado e checkout com CRLF (autocrlf=true)
  writeFileSync(join(h, '.gitattributes'), 'historico.jsonl merge=union\n');
  writeFileSync(join(h, '.gitignore'), readFileSync(join(h, '.gitignore'), 'utf8').replace('relatorios/\n', ''));
  mkdirSync(join(h, 'relatorios'), { recursive: true });
  writeFileSync(join(h, 'relatorios', 'r.md'), '# relatório\n');
  gitCom(A, h, 'add', '-A'); gitCom(A, h, 'commit', '-q', '-m', 'formato antigo'); gitCom(A, h, 'push', '-q', 'origin', 'main');
  assert.ok(git(remoto, 'ls-tree', '-r', '--name-only', 'main').stdout.includes('relatorios/r.md'));
  writeFileSync(join(h, 'casos', 'dev', 'c1.md'), 'sintoma: x\r\ncausa: y\r\n');

  const s = run(A, 'sincronizar.mjs');
  assert.equal(s.status, 0, s.stderr);
  assert.deepEqual(linhas(join(h, '.gitattributes')).sort(), ['* -text', 'historico.jsonl merge=union']);
  assert.ok(linhas(join(h, '.gitignore')).includes('relatorios/'));
  assert.ok(!git(remoto, 'ls-tree', '-r', '--name-only', 'main').stdout.includes('relatorios/'), 'relatório não fica no remoto');
  assert.ok(existsSync(join(h, 'relatorios', 'r.md')), 'o relatório local continua no disco');
  assert.equal(git(remoto, 'show', 'main:casos/dev/c1.md').stdout, 'sintoma: x\ncausa: y\n');
  assert.equal(readFileSync(join(h, 'casos', 'dev', 'c1.md'), 'utf8'), 'sintoma: x\ncausa: y\n');
  assert.equal(gitCom(A, h, 'status', '--porcelain').stdout, '');
});

// ---------- contratados entre máquinas ----------

const CORPO = ['# Analista — time nabuco', '', 'Lê dados.', '', '## Entrega', '- **lições usadas:** ids', ''].join('\n');
function registrar(home, papel) {
  const { dados, erros } = validarContratacao({
    papel, nome: 'Analista', tipo: 'checador', descricao: 'Analisa dados.', ferramentas: ['Read'], corpo: CORPO,
    claude: { model: 'sonnet', effort: 'medium' }, codex: { model: null, effort: 'medium' },
  });
  assert.deepEqual(erros, []);
  mkdirSync(join(home, 'time', 'papeis'), { recursive: true });
  writeFileSync(join(home, 'time', 'papeis', `${papel}.md`), registroMd(dados));
  writeFileSync(join(home, 'time', 'modelos.json'), JSON.stringify({ claude: { [papel]: dados.claude }, codex: { [papel]: dados.codex } }));
}
function duasMaquinas() {
  const A = maquina('a'), B = maquina('b');
  for (const m of [A, B]) {
    assert.equal(run(m, 'setup.mjs').status, 0);
    const r = run(m, 'setup.mjs', ['--cerebro-remoto', remoto]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
  }
  return [A, B];
}
function sincronizarOk(m) {
  const s = run(m, 'sincronizar.mjs');
  assert.equal(s.status, 0, s.stderr);
  return s;
}

test('contratado registrado em outra máquina é instalado (Claude e Codex) depois do pull; removido lá, sai daqui', () => {
  const [A, B] = duasMaquinas();
  const agB = join(B.CLAUDE_CONFIG_DIR, 'agents'), cxB = join(B.CODEX_HOME, 'agents');
  mkdirSync(agB, { recursive: true });
  mkdirSync(B.CODEX_HOME, { recursive: true });
  const alheio = '---\nname: nabuco-outro\n---\nmeu\n', local = '---\nname: nabuco-revisor\n---\nlocal\n';
  writeFileSync(join(agB, 'nabuco-outro.md'), alheio); // do usuário, sem a marca
  writeFileSync(join(agB, 'nabuco-revisor.md'), local); // checador local do setup

  registrar(A.NABUCO_HOME, 'analista');
  sincronizarOk(A);
  sincronizarOk(B);
  assert.ok(existsSync(join(agB, 'nabuco-analista.md')) && agenteEhNosso(join(agB, 'nabuco-analista.md')));
  assert.ok(existsSync(join(cxB, 'nabuco-analista.toml')) && agenteEhNosso(join(cxB, 'nabuco-analista.toml')));
  assert.match(readFileSync(join(B.NABUCO_HOME, 'sync.log'), 'utf8'), /analista/);

  // pull sem mudança em time/: não reconcilia (o agente apagado à mão continua apagado)
  rmSync(join(cxB, 'nabuco-analista.toml'));
  sincronizarOk(B);
  assert.ok(!existsSync(join(cxB, 'nabuco-analista.toml')));

  rmSync(join(A.NABUCO_HOME, 'time', 'papeis', 'analista.md'));
  sincronizarOk(A);
  sincronizarOk(B);
  assert.ok(!existsSync(join(agB, 'nabuco-analista.md')), 'o agente do contratado removido sai');
  assert.equal(readFileSync(join(agB, 'nabuco-outro.md'), 'utf8'), alheio);
  assert.equal(readFileSync(join(agB, 'nabuco-revisor.md'), 'utf8'), local);
});

test('falha ao instalar o contratado não quebra a sincronização: fica registrada no sync.log', () => {
  const [A, B] = duasMaquinas();
  mkdirSync(B.CLAUDE_CONFIG_DIR, { recursive: true });
  writeFileSync(join(B.CLAUDE_CONFIG_DIR, 'agents'), 'não é pasta'); // gravar o agente falha
  registrar(A.NABUCO_HOME, 'analista');
  sincronizarOk(A);
  const s = sincronizarOk(B);
  assert.match(s.stdout, /cérebro sincronizado/);
  assert.ok(existsSync(join(B.NABUCO_HOME, 'time', 'papeis', 'analista.md')), 'o registro chegou');
  const log = readFileSync(join(B.NABUCO_HOME, 'sync.log'), 'utf8');
  assert.match(log, /"ok":true/);
  assert.match(log, /"contratados":\{"ok":false/);
});
