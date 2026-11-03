import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { registroMd, validarContratacao, agenteEhNosso } from '../scripts/lib/time.mjs';
import { IGNORAR, ATRIBUTOS } from '../scripts/sincronizar.mjs';
import { juntarCerebros, MENSAGEM_PREPARO } from '../scripts/lib/juntar-cerebros.mjs';

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

// ---------- cérebros criados separados (sem ancestral comum) ----------

const licao = (id, titulo, caso) => [`## ${id} · ${titulo}`, '- gatilho: g', '- expectativa: e', '- faça: f', '- por quê: p',
  `- evidência: ${caso} · escopo: global`, '- 👍 1  👎 0 · última: 2026-10-01', ''].join('\n');
const arquivoDeLicoes = (papel, ...blocos) => `# Lições — ${papel}\n\n${blocos.join('\n')}`;
const evento = (tipo, dados) => JSON.stringify({ em: '2026-10-01T00:00:00.000Z', tipo, papel: 'dev', dados });
function escrever(home, rel, txt) {
  mkdirSync(dirname(join(home, rel)), { recursive: true });
  writeFileSync(join(home, rel), txt);
}
function commitarTudo(env, home, msg) {
  gitCom(env, home, 'add', '-A');
  const c = gitCom(env, home, 'commit', '-q', '-m', msg);
  assert.equal(c.status, 0, c.stderr);
}
const CASO = 'casos/dev/2026-10-build-quebrado.md';
// texto livre no arquivo de lições da máquina B (fora dos blocos): não pode sumir na junção
const NOTA_B = 'Notas da máquina B: revisar em dezembro.\n';
const SECAO_B = '## Pendências\n\nconferir a lição do build no CI\n';

// máquina A já sincronizada com o remoto, com .gitignore/.gitattributes no formato antigo (como no caso real)
function maquinaAComCerebro(extra = {}) {
  const A = maquina('a', AUTOCRLF);
  const h = A.NABUCO_HOME;
  assert.equal(run(A, 'setup.mjs').status, 0);
  escrever(h, 'licoes/dev.md', arquivoDeLicoes('dev', licao('dev-0001', 'lição A1', CASO), licao('dev-0002', 'lição A2', CASO)));
  escrever(h, 'licoes/analista.md', arquivoDeLicoes('analista', licao('analista-0001', 'contratado A', 'casos/analista/2026-10-a.md')));
  escrever(h, 'casos/analista/2026-10-a.md', 'sintoma: a\n');
  escrever(h, CASO, 'sintoma: caso da máquina A\n');
  escrever(h, 'historico.jsonl', [evento('licao_criada', { id: 'dev-0001', escopo: 'global' }), evento('licoes_entregues', { para: 'dev', ids: ['dev-0001', 'dev-0002'] })].join('\n') + '\n');
  for (const [rel, txt] of Object.entries(extra)) escrever(h, rel, txt);
  const r = run(A, 'setup.mjs', ['--cerebro-remoto', remoto]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  writeFileSync(join(h, '.gitattributes'), 'historico.jsonl merge=union\n');
  writeFileSync(join(h, '.gitignore'), readFileSync(join(h, '.gitignore'), 'utf8').replace('relatorios/\n', ''));
  commitarTudo(A, h, 'formato antigo');
  assert.equal(gitCom(A, h, 'push', '-q', 'origin', 'main').status, 0);
  return A;
}

// máquina B com cérebro próprio (commits locais, nenhum ancestral comum com o remoto)
function maquinaBComCerebro(extra = {}) {
  const B = maquina('b', AUTOCRLF);
  const h = B.NABUCO_HOME;
  assert.equal(run(B, 'setup.mjs').status, 0);
  escrever(h, 'licoes/dev.md', arquivoDeLicoes('dev', NOTA_B, licao('dev-0001', 'lição B1', CASO), SECAO_B));
  escrever(h, 'licoes/arquivo/dev.md', arquivoDeLicoes('dev', licao('dev-0002', 'lição B2 arquivada', 'casos/dev/2026-10-outro.md')));
  escrever(h, 'licoes/analista.md', arquivoDeLicoes('analista', licao('analista-0001', 'contratado B', 'casos/analista/2026-10-b.md')));
  escrever(h, 'casos/analista/2026-10-b.md', 'sintoma: b\n');
  escrever(h, CASO, 'sintoma: caso da máquina B\nrecorrência de: dev-0001\n');
  escrever(h, 'casos/dev/2026-10-outro.md', 'sintoma: outro\n');
  escrever(h, 'historico.jsonl', [
    evento('licao_criada', { id: 'dev-0001', escopo: 'global' }),
    evento('caso_criado', { arquivo: CASO, tags: [], recorrencia_de: 'dev-0001' }),
    evento('licoes_entregues', { para: 'dev', ids: ['dev-0001', 'dev-0002', 'analista-0001'] }),
    evento('licao_usada', { id: 'dev-0001', util: true }),
    evento('licao_aposentada', { id: 'dev-0002' }),
    evento('tarefa_criada', { id: 'dev-0001-nao-e-licao' }),
  ].join('\n') + '\n');
  for (const [rel, txt] of Object.entries(extra)) escrever(h, rel, txt);
  commitarTudo(B, h, 'cérebro da máquina B');
  return B;
}

const noRemoto = rel => git(remoto, 'show', `main:${rel}`).stdout;
const blocosDoTexto = txt => [...txt.matchAll(/^## (\S+) · (.*)$/gm)].map(m => `${m[1]} ${m[2]}`);

test('cérebros divergentes: setup junta os dois, renumera as lições repetidas, reescreve o histórico, preserva os casos e envia', () => {
  const A = maquinaAComCerebro();
  const B = maquinaBComCerebro();
  const hB = B.NABUCO_HOME;
  const r = run(B, 'setup.mjs', ['--cerebro-remoto', remoto]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /✅ cérebro desta máquina juntado ao remoto/);
  assert.match(r.stdout, /lições renumeradas: .*dev-0001 → dev-0003/);
  assert.match(r.stdout, /dev-0002 → dev-0004/);
  assert.match(r.stdout, /analista-0001 → analista-0002/);
  assert.match(r.stdout, /casos renomeados: casos\/dev\/2026-10-build-quebrado\.md → casos\/dev\/2026-10-build-quebrado-2\.md/);
  assert.match(r.stdout, /cérebro sincronizado com/);

  // push feito: o remoto é o HEAD local, sem pendências
  assert.equal(git(remoto, 'rev-parse', 'main').stdout, gitCom(B, hB, 'rev-parse', 'HEAD').stdout);
  assert.equal(gitCom(B, hB, 'status', '--porcelain').stdout, '');
  assert.match(gitCom(B, hB, 'log', '--format=%s').stdout, /sync: junta cérebro de outra máquina/);

  // o remoto mantém os IDs dele; as da máquina B viram o próximo livre
  assert.deepEqual(blocosDoTexto(noRemoto('licoes/dev.md')), ['dev-0001 lição A1', 'dev-0002 lição A2', 'dev-0003 lição B1']);
  assert.deepEqual(blocosDoTexto(noRemoto('licoes/arquivo/dev.md')), ['dev-0004 lição B2 arquivada']);
  assert.deepEqual(blocosDoTexto(noRemoto('licoes/analista.md')), ['analista-0001 contratado A', 'analista-0002 contratado B']);
  assert.ok(noRemoto('licoes/dev.md').includes(licao('dev-0001', 'lição A1', CASO)), 'bloco do remoto intacto');

  // nenhum caso perdido; o da máquina B ganhou sufixo e a evidência acompanha
  assert.equal(noRemoto(CASO), 'sintoma: caso da máquina A\n');
  const casoB = 'casos/dev/2026-10-build-quebrado-2.md';
  assert.equal(noRemoto(casoB), 'sintoma: caso da máquina B\nrecorrência de: dev-0003\n');
  assert.equal(noRemoto('casos/dev/2026-10-outro.md'), 'sintoma: outro\n');
  assert.ok(noRemoto('casos/analista/2026-10-a.md') && noRemoto('casos/analista/2026-10-b.md'));
  assert.ok(noRemoto('licoes/dev.md').includes(licao('dev-0003', 'lição B1', casoB)), 'evidência da lição renumerada aponta o caso renomeado');
  assert.ok(noRemoto('licoes/arquivo/dev.md').includes(licao('dev-0004', 'lição B2 arquivada', 'casos/dev/2026-10-outro.md')));
  assert.ok(noRemoto('licoes/dev.md').includes(NOTA_B.trim()), 'nota livre da máquina B preservada');
  assert.ok(noRemoto('licoes/dev.md').includes(SECAO_B.trim()), 'seção que não é lição preservada');
  assert.match(r.stdout, /⚠️ tarefas ativas em projetos desta máquina ainda citam os IDs antigos \(.*dev-0001 → dev-0003/);

  // histórico: eventos de A intactos, os de B com o ID novo, o resto igual
  const hist = noRemoto('historico.jsonl').trim().split('\n').map(l => JSON.parse(l));
  const de = tipo => hist.filter(e => e.tipo === tipo).map(e => e.dados);
  assert.deepEqual(de('licao_criada').map(d => d.id).sort(), ['dev-0001', 'dev-0003']);
  assert.deepEqual(de('licoes_entregues').map(d => d.ids.join(' ')).sort(), ['dev-0001 dev-0002', 'dev-0003 dev-0004 analista-0002']);
  assert.deepEqual(de('licao_usada').map(d => d.id), ['dev-0003']);
  assert.deepEqual(de('licao_aposentada').map(d => d.id), ['dev-0004']);
  assert.deepEqual(de('caso_criado'), [{ arquivo: casoB, tags: [], recorrencia_de: 'dev-0003' }]);
  assert.deepEqual(de('tarefa_criada'), [{ id: 'dev-0001-nao-e-licao' }]);

  // .gitignore/.gitattributes: união das linhas, no formato atual, sem marca de conflito nem CRLF
  const ga = noRemoto('.gitattributes').trim().split('\n');
  assert.deepEqual([...ga].sort(), ['* -text', 'historico.jsonl merge=union']);
  const gi = noRemoto('.gitignore').trim().split('\n');
  for (const l of IGNORAR) assert.ok(gi.includes(l), `.gitignore sem ${l}`);
  assert.equal(new Set(gi).size, gi.length, '.gitignore sem linhas repetidas');
  for (const rel of ['.gitignore', '.gitattributes', 'licoes/dev.md', 'historico.jsonl', casoB]) {
    const txt = readFileSync(join(hB, rel), 'utf8');
    assert.ok(!txt.includes('\r') && !txt.includes('<<<<<<<'), `${rel} com CRLF ou marca de conflito`);
  }

  // a máquina A recebe tudo na sincronização normal
  const s = run(A, 'sincronizar.mjs');
  assert.equal(s.status, 0, s.stderr);
  assert.deepEqual(blocosDoTexto(readFileSync(join(A.NABUCO_HOME, 'licoes', 'dev.md'), 'utf8')), ['dev-0001 lição A1', 'dev-0002 lição A2', 'dev-0003 lição B1']);
  assert.ok(existsSync(join(A.NABUCO_HOME, casoB)));
});

test('conflito irresolúvel entre cérebros divergentes: aborta, ~/.nabuco volta ao que era e a mensagem lista os arquivos', () => {
  maquinaAComCerebro({ 'notas.md': 'notas da máquina A\n', 'extras/equipe.txt': 'A\n' });
  const B = maquinaBComCerebro({
    'notas.md': 'notas da máquina B\n', 'extras/equipe.txt': 'B\n',
    // formato antigo: o setup configura (e commita) antes de juntar; a falha desfaz isso também
    '.gitignore': IGNORAR.filter(l => l !== 'relatorios/').join('\n') + '\n', '.gitattributes': 'historico.jsonl merge=union\n',
  });
  const hB = B.NABUCO_HOME;
  escrever(hB, 'casos/dev/2026-11-pendente.md', 'sintoma: ainda não commitado\n');
  const antes = gitCom(B, hB, 'rev-parse', 'HEAD').stdout.trim();
  const statusAntes = gitCom(B, hB, 'status', '--porcelain').stdout;
  assert.match(statusAntes, /casos\/dev\/2026-11-pendente\.md/);
  const arquivos = ['licoes/dev.md', 'licoes/arquivo/dev.md', 'historico.jsonl', CASO, 'notas.md', '.gitignore', '.gitattributes', 'casos/dev/2026-11-pendente.md'];
  const conteudo = Object.fromEntries(arquivos.map(rel => [rel, readFileSync(join(hB, rel), 'utf8')]));
  const remotoAntes = git(remoto, 'rev-parse', 'main').stdout;

  const r = run(B, 'setup.mjs', ['--cerebro-remoto', remoto]);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /divergem e não deu para juntar sozinho/);
  assert.match(r.stderr, /notas\.md/);
  assert.match(r.stderr, /extras\/equipe\.txt/);
  assert.doesNotMatch(r.stderr, /licoes\/|\.gitignore|\.gitattributes|historico\.jsonl|casos\//, 'o que a junção resolve não aparece como conflito');

  // ~/.nabuco como antes do setup: mesmo HEAD (configuração e preparação desfeitas), o pendente
  // continua pendente, sem merge pela metade
  assert.equal(gitCom(B, hB, 'rev-parse', 'HEAD').stdout.trim(), antes);
  assert.equal(gitCom(B, hB, 'status', '--porcelain').stdout, statusAntes);
  assert.notEqual(gitCom(B, hB, 'rev-parse', '-q', '--verify', 'MERGE_HEAD').status, 0);
  for (const rel of arquivos) assert.equal(readFileSync(join(hB, rel), 'utf8'), conteudo[rel], `${rel} mudou`);
  assert.ok(!existsSync(join(hB, 'casos/dev/2026-10-build-quebrado-2.md')));
  assert.equal(git(remoto, 'rev-parse', 'main').stdout, remotoAntes, 'o remoto não muda');
  assert.notEqual(JSON.parse(readFileSync(join(hB, 'config.json'), 'utf8')).sincronizar, true);
});

test('cérebros divergentes: IDs de lições de escopo projeto ficam reservados e os eventos delas não mudam', () => {
  maquinaAComCerebro();
  const ev = (projeto, tipo, dados) => JSON.stringify({ ts: '2026-10-01T00:00:00.000Z', tarefa: null, projeto, harness: 'teste', tipo, papel: 'dev', dados });
  const historico = [
    ev('app', 'licao_criada', { id: 'dev-0003', escopo: 'projeto' }), // só no arquivo do projeto, fora do cérebro
    ev('app', 'licao_usada', { id: 'dev-0003', util: true }),
    ev('outro', 'licao_criada', { id: 'dev-0001', escopo: 'projeto' }), // mesmo ID da global, em outro projeto
    ev('outro', 'licao_usada', { id: 'dev-0001', util: true }),
    ev('outro', 'licoes_entregues', { para: 'dev', ids: ['dev-0001'] }),
    ev('outro', 'licao_aposentada', { id: 'dev-0001', escopo: 'projeto', motivo: 'm' }),
    ev('app', 'licao_criada', { id: 'dev-0001', escopo: 'global' }),
    ev('app', 'licao_usada', { id: 'dev-0001', util: true }),
    ev('app', 'licoes_entregues', { para: 'dev', ids: ['dev-0001', 'dev-0003'] }),
  ];
  const B = maquinaBComCerebro({ 'historico.jsonl': historico.join('\n') + '\n' });
  const r = run(B, 'setup.mjs', ['--cerebro-remoto', remoto]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  // dev-0003 é de uma lição de projeto (só no histórico): a global renumerada pula para dev-0004
  assert.match(r.stdout, /dev-0001 → dev-0004, dev-0002 → dev-0005/);
  assert.deepEqual(blocosDoTexto(noRemoto('licoes/dev.md')), ['dev-0001 lição A1', 'dev-0002 lição A2', 'dev-0004 lição B1']);
  const deB = noRemoto('historico.jsonl').trim().split('\n').map(l => JSON.parse(l)).filter(e => e.projeto)
    .map(e => `${e.projeto} ${e.tipo} ${e.dados.ids ? e.dados.ids.join('+') : e.dados.id}`);
  assert.deepEqual(deB, [
    'app licao_criada dev-0003', 'app licao_usada dev-0003',
    'outro licao_criada dev-0001', 'outro licao_usada dev-0001', 'outro licoes_entregues dev-0001', 'outro licao_aposentada dev-0001',
    'app licao_criada dev-0004', 'app licao_usada dev-0004', 'app licoes_entregues dev-0004+dev-0003',
  ]);
});

test('cérebros divergentes: falha no meio da junção volta o ~/.nabuco ao que era', () => {
  maquinaAComCerebro();
  // como o setup deixa o cérebro antes de juntar (garantirCerebroGit já rodou)
  const B = maquinaBComCerebro({ '.gitignore': IGNORAR.join('\n') + '\n', '.gitattributes': ATRIBUTOS.join('\n') + '\n' });
  const hB = B.NABUCO_HOME;
  assert.equal(gitCom(B, hB, 'remote', 'add', 'origin', remoto).status, 0);
  assert.equal(gitCom(B, hB, 'fetch', '-q', 'origin').status, 0);
  const antes = gitCom(B, hB, 'rev-parse', 'HEAD').stdout.trim();
  const arquivos = ['licoes/dev.md', 'licoes/arquivo/dev.md', 'historico.jsonl', CASO];
  const conteudo = Object.fromEntries(arquivos.map(rel => [rel, readFileSync(join(hB, rel), 'utf8')]));
  const falhas = {
    'antes do commit da preparação': a => a[0] === 'commit' && a.includes(MENSAGEM_PREPARO),
    'no meio do merge': a => a[0] === 'diff' && a.includes('--diff-filter=U'),
  };
  for (const [quando, falhar] of Object.entries(falhas)) {
    const gitQueFalha = args => { if (falhar(args)) throw new Error('falha simulada'); return gitCom(B, hB, ...args); };
    const j = juntarCerebros(hB, gitQueFalha);
    assert.equal(j.ok, false, quando);
    assert.match(j.erro, /falha inesperada.*falha simulada/, quando);
    assert.equal(gitCom(B, hB, 'rev-parse', 'HEAD').stdout.trim(), antes, quando);
    assert.equal(gitCom(B, hB, 'status', '--porcelain').stdout, '', quando);
    assert.notEqual(gitCom(B, hB, 'rev-parse', '-q', '--verify', 'MERGE_HEAD').status, 0, quando);
    for (const rel of arquivos) assert.equal(readFileSync(join(hB, rel), 'utf8'), conteudo[rel], `${quando}: ${rel} mudou`);
    assert.ok(!existsSync(join(hB, 'casos/dev/2026-10-build-quebrado-2.md')), quando);
  }
  // e depois, sem falha, junta normalmente
  assert.equal(juntarCerebros(hB, args => gitCom(B, hB, ...args)).ok, true);
});

// lição de escopo projeto aposentada: o bloco vai para ~/.nabuco/licoes/arquivo/<papel>.md com "escopo: projeto"
const licaoDeProjeto = (id, titulo, caso) => licao(id, titulo, caso).replace('escopo: global', 'escopo: projeto') + `- aposentada: 2026-10-02 · obsoleta\n`;
const evProj = (projeto, tipo, dados) => JSON.stringify({ ts: '2026-10-01T00:00:00.000Z', tarefa: null, projeto, harness: 'teste', tipo, papel: 'dev', dados });

test('cérebros divergentes: lição de projeto aposentada no arquivo é renumerada com os eventos dela, separada da global de mesmo ID', () => {
  maquinaAComCerebro();
  const historico = [
    evProj('app', 'licao_criada', { id: 'dev-0001', escopo: 'global' }),
    evProj('app', 'licao_usada', { id: 'dev-0001', util: true }),
    evProj('web', 'licao_criada', { id: 'dev-0001', escopo: 'projeto' }), // mesmo ID, lição de projeto de web
    evProj('web', 'licoes_entregues', { para: 'dev', ids: ['dev-0001'] }),
    evProj('web', 'licao_usada', { id: 'dev-0001', util: false }),
    evProj('web', 'licao_aposentada', { id: 'dev-0001', escopo: 'projeto', motivo: 'obsoleta' }),
    evProj('app', 'licao_criada', { id: 'dev-0002', escopo: 'projeto' }),
    evProj('app', 'licao_usada', { id: 'dev-0002', util: true }),
    evProj('app', 'licao_aposentada', { id: 'dev-0002', escopo: 'projeto', motivo: 'obsoleta' }),
    evProj('app', 'caso_criado', { arquivo: CASO, tags: [], recorrencia_de: 'dev-0001' }),
    evProj('zzz', 'licao_criada', { id: 'dev-0001', escopo: 'projeto' }), // ativa no projeto zzz, fora do cérebro
    evProj('zzz', 'caso_criado', { arquivo: 'casos/dev/2026-10-outro.md', tags: [], recorrencia_de: 'dev-0001' }),
  ];
  const B = maquinaBComCerebro({
    'licoes/arquivo/dev.md': arquivoDeLicoes('dev', licaoDeProjeto('dev-0001', 'projeto web aposentada', 'casos/dev/2026-10-outro.md'), licaoDeProjeto('dev-0002', 'projeto app aposentada', 'casos/dev/2026-10-outro.md')),
    'historico.jsonl': historico.join('\n') + '\n',
    'casos/dev/2026-10-outro.md': 'sintoma: outro\nrecorrência de: dev-0001\n',
  });
  const r = run(B, 'setup.mjs', ['--cerebro-remoto', remoto]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /dev-0001 → dev-0003, dev-0001 \(projeto web\) → dev-0004, dev-0002 \(projeto app\) → dev-0005/);
  assert.deepEqual(blocosDoTexto(noRemoto('licoes/dev.md')), ['dev-0001 lição A1', 'dev-0002 lição A2', 'dev-0003 lição B1']);
  assert.deepEqual(blocosDoTexto(noRemoto('licoes/arquivo/dev.md')), ['dev-0004 projeto web aposentada', 'dev-0005 projeto app aposentada']);
  assert.ok(noRemoto('licoes/arquivo/dev.md').includes(licaoDeProjeto('dev-0005', 'projeto app aposentada', 'casos/dev/2026-10-outro.md')));

  const deB = noRemoto('historico.jsonl').trim().split('\n').map(l => JSON.parse(l)).filter(e => e.projeto)
    .map(e => `${e.projeto} ${e.tipo} ${e.dados.ids ? e.dados.ids.join('+') : e.dados.id ?? e.dados.recorrencia_de}`);
  assert.deepEqual(deB, [
    'app licao_criada dev-0003', 'app licao_usada dev-0003',
    'web licao_criada dev-0004', 'web licoes_entregues dev-0004', 'web licao_usada dev-0004', 'web licao_aposentada dev-0004',
    'app licao_criada dev-0005', 'app licao_usada dev-0005', 'app licao_aposentada dev-0005',
    'app caso_criado dev-0003',
    'zzz licao_criada dev-0001', 'zzz caso_criado dev-0001',
  ]);
  // "recorrência de:" do caso segue o evento caso_criado dele: troca no de app, fica no de zzz
  assert.equal(noRemoto('casos/dev/2026-10-build-quebrado-2.md'), 'sintoma: caso da máquina B\nrecorrência de: dev-0003\n');
  assert.equal(noRemoto('casos/dev/2026-10-outro.md'), 'sintoma: outro\nrecorrência de: dev-0001\n');
});

test('conflito irresolúvel: lição de projeto aposentada com o mesmo ID em dois projetos aborta a junção', () => {
  maquinaAComCerebro();
  const historico = [
    evProj('app', 'licao_criada', { id: 'dev-0002', escopo: 'projeto' }),
    evProj('app', 'licao_aposentada', { id: 'dev-0002', escopo: 'projeto', motivo: 'm' }),
    evProj('web', 'licao_criada', { id: 'dev-0002', escopo: 'projeto' }),
    evProj('web', 'licao_aposentada', { id: 'dev-0002', escopo: 'projeto', motivo: 'm' }),
  ];
  const B = maquinaBComCerebro({
    'licoes/arquivo/dev.md': arquivoDeLicoes('dev', licaoDeProjeto('dev-0002', 'de qual projeto?', 'casos/dev/2026-10-outro.md')),
    'historico.jsonl': historico.join('\n') + '\n',
    '.gitignore': IGNORAR.join('\n') + '\n', '.gitattributes': ATRIBUTOS.join('\n') + '\n',
  });
  const hB = B.NABUCO_HOME;
  const antes = gitCom(B, hB, 'rev-parse', 'HEAD').stdout.trim();
  const arquivo = readFileSync(join(hB, 'licoes/arquivo/dev.md'), 'utf8');
  const r = run(B, 'setup.mjs', ['--cerebro-remoto', remoto]);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /divergem e não deu para juntar sozinho: conflito em licoes\/arquivo\/dev\.md \(dev-0002.*app.*web/);
  assert.equal(gitCom(B, hB, 'rev-parse', 'HEAD').stdout.trim(), antes);
  assert.equal(gitCom(B, hB, 'status', '--porcelain').stdout, '');
  assert.equal(readFileSync(join(hB, 'licoes/arquivo/dev.md'), 'utf8'), arquivo);
});

// abordagem conservadora: lição que mudou de escopo (ou de projeto desconhecido) não é renumerada às cegas
function abortaSemMudar(extras, mensagem) {
  maquinaAComCerebro();
  const B = maquinaBComCerebro({ ...extras, '.gitignore': IGNORAR.join('\n') + '\n', '.gitattributes': ATRIBUTOS.join('\n') + '\n' });
  const hB = B.NABUCO_HOME;
  const antes = gitCom(B, hB, 'rev-parse', 'HEAD').stdout.trim();
  const arquivos = ['licoes/dev.md', 'licoes/arquivo/dev.md', 'historico.jsonl', CASO];
  const conteudo = Object.fromEntries(arquivos.map(rel => [rel, readFileSync(join(hB, rel), 'utf8')]));
  const remotoAntes = git(remoto, 'rev-parse', 'main').stdout;
  const r = run(B, 'setup.mjs', ['--cerebro-remoto', remoto]);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /divergem e não deu para juntar sozinho: conflito em /);
  assert.match(r.stderr, mensagem);
  assert.equal(gitCom(B, hB, 'rev-parse', 'HEAD').stdout.trim(), antes);
  assert.equal(gitCom(B, hB, 'status', '--porcelain').stdout, '');
  for (const rel of arquivos) assert.equal(readFileSync(join(hB, rel), 'utf8'), conteudo[rel], `${rel} mudou`);
  assert.equal(git(remoto, 'rev-parse', 'main').stdout, remotoAntes, 'o remoto não muda');
}

test('conflito irresolúvel: lição renumerada que passou de projeto para global (promovida de escopo) aborta a junção', () => {
  abortaSemMudar({
    'historico.jsonl': [
      evProj('app', 'licao_criada', { id: 'dev-0001', escopo: 'projeto' }),
      evProj('app', 'licao_usada', { id: 'dev-0001', util: true }),
      evProj('app', 'licao_editada', { id: 'dev-0001', campos: ['escopo'] }), // agora é a global dev-0001 de licoes/dev.md
    ].join('\n') + '\n',
  }, /licoes\/dev\.md \(dev-0001 mudou de escopo no histórico desta máquina, no projeto app/);
});

test('conflito irresolúvel: lição renumerada que passou de global para projeto e foi aposentada aborta a junção', () => {
  abortaSemMudar({
    'licoes/arquivo/dev.md': arquivoDeLicoes('dev', licaoDeProjeto('dev-0002', 'era global', 'casos/dev/2026-10-outro.md')),
    'historico.jsonl': [
      evProj('app', 'licao_criada', { id: 'dev-0002', escopo: 'global' }),
      evProj('app', 'licao_usada', { id: 'dev-0002', util: true }),
      evProj('app', 'licao_editada', { id: 'dev-0002', campos: ['escopo'] }),
      evProj('app', 'licao_aposentada', { id: 'dev-0002', escopo: 'projeto', motivo: 'm' }),
    ].join('\n') + '\n',
  }, /licoes\/arquivo\/dev\.md \(dev-0002 mudou de escopo/);
});

test('conflito irresolúvel: lição de projeto aposentada sem o projeto no histórico, mas com eventos do ID, aborta a junção', () => {
  abortaSemMudar({
    'licoes/arquivo/dev.md': arquivoDeLicoes('dev', licaoDeProjeto('dev-0002', 'cérebro antigo', 'casos/dev/2026-10-outro.md')),
    'historico.jsonl': [
      evProj('app', 'licao_usada', { id: 'dev-0002', util: true }),
      evProj('app', 'licao_aposentada', { id: 'dev-0002', motivo: 'sem escopo (versão antiga)' }),
    ].join('\n') + '\n',
  }, /licoes\/arquivo\/dev\.md \(dev-0002 é de escopo projeto, aposentada sem registro do projeto/);
});
