import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { PAPEIS, ESCRITORES, PAPEIS_CEREBRO } from '../scripts/lib/constantes.mjs';
import { gerarAgenteClaude, gerarAgenteCodex } from '../scripts/lib/gerar.mjs';
import { carregarModelos, carregarModelosTodos } from '../scripts/lib/modelos.mjs';
import {
  RE_PAPEL, RESERVADOS, MAX_CORPO, validarContratacao, lerTime, contratados, papeis, papeisCerebro, escritores, registroMd,
} from '../scripts/lib/time.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
let base, env, home, claude, codex;
const run = (args = []) => spawnSync(process.execPath, [join(RAIZ, 'scripts', 'contratar.mjs'), ...args], { cwd: base, encoding: 'utf8', env });

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'nabuco contratar-'));
  home = join(base, 'nabuco');
  claude = join(base, 'claude');
  codex = join(base, 'codex');
  env = { ...process.env, NABUCO_HOME: home, CLAUDE_CONFIG_DIR: claude, CODEX_HOME: codex, NABUCO_HARNESS: 'teste' };
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const CORPO = [
  '# Analista — time nabuco', '', 'Você é o Analista: lê dados e aponta inconsistências.', '',
  '## Entrega', '- **mudanças:** nenhuma', '- **lições usadas:** id de cada lição com 👍 ou 👎', '- **bloqueios:** ou "nenhum"', '',
].join('\n');
const contratacao = (extra = {}) => ({
  papel: 'analista', nome: 'Analista', tipo: 'checador', descricao: 'Analisa dados e aponta inconsistências. Somente leitura.',
  ferramentas: ['Read', 'Grep'], corpo: CORPO,
  claude: { model: 'sonnet', effort: 'medium' }, codex: { model: null, effort: 'medium' }, ...extra,
});
function arquivoJson(dados, nome = 'contratacao.json') {
  const arq = join(base, nome);
  writeFileSync(arq, typeof dados === 'string' ? dados : JSON.stringify(dados));
  return arq;
}
const erros = d => validarContratacao(d).erros.join('\n');
const agenteClaude = p => join(claude, 'agents', `nabuco-${p}.md`);
const agenteCodex = p => join(codex, 'agents', `nabuco-${p}.toml`);
const registro = p => join(home, 'time', 'papeis', `${p}.md`);
const contratar = (extra = {}, args = []) => run(['novo', '--de', arquivoJson(contratacao(extra)), ...args]);

// ---------- validação ----------

test('validarContratacao: contratação correta passa e sai normalizada', () => {
  const { erros: e, dados } = validarContratacao(contratacao({ nome: '  Analista  ', corpo: CORPO.replace(/\n/g, '\r\n') }));
  assert.deepEqual(e, []);
  assert.equal(dados.nome, 'Analista');
  assert.ok(!dados.corpo.includes('\r'));
  assert.deepEqual(dados.ferramentas, ['Read', 'Grep']);
});

test('validarContratacao: slug inválido em todas as formas', () => {
  const ruins = ['Analista', 'ana-lista', 'ana_lista', 'ana1', 'análise', 'ana lista', '../x', '..', 'a/b', 'a\\b', 'a',
    'x'.repeat(21), '', ' analista', 'analista\n', null, undefined, 42, ['analista'], { p: 1 }];
  for (const papel of ruins) assert.match(erros(contratacao({ papel })), /papel inválido/, JSON.stringify(papel));
  assert.ok(RE_PAPEL.test('ab') && RE_PAPEL.test('x'.repeat(20)));
});

test('validarContratacao: reservados, gerente e embutidos são recusados', () => {
  for (const papel of ['gerente', 'arquivo', 'con', 'prn', 'aux', 'nul']) {
    assert.ok(RESERVADOS.includes(papel));
    assert.match(erros(contratacao({ papel })), /reservado/, papel);
  }
  for (const papel of PAPEIS) assert.match(erros(contratacao({ papel })), /funcionário embutido/, papel);
});

test('validarContratacao: checador só com ferramentas de leitura', () => {
  for (const f of ['Edit', 'Write', 'Bash', 'NotebookEdit', 'Skill']) {
    assert.match(erros(contratacao({ ferramentas: ['Read', f] })), new RegExp(`checador não pode usar "${f}"`), f);
  }
  assert.deepEqual(validarContratacao(contratacao({ ferramentas: ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch'] })).erros, []);
});

test('validarContratacao: escritor e checador precisam de lista de ferramentas válida', () => {
  for (const tipo of ['escritor', 'checador']) {
    assert.match(erros(contratacao({ tipo, ferramentas: undefined })), /ferramentas é obrigatória/);
    assert.match(erros(contratacao({ tipo, ferramentas: [] })), /ferramentas é obrigatória/);
    assert.match(erros(contratacao({ tipo, ferramentas: 'Read, Grep' })), /ferramentas é obrigatória/);
  }
  assert.match(erros(contratacao({ tipo: 'escritor', ferramentas: ['Read', 'mcp__x'] })), /ferramenta desconhecida "mcp__x"/);
  assert.match(erros(contratacao({ tipo: 'escritor', ferramentas: ['Read', 'Read'] })), /repetida/);
  assert.deepEqual(validarContratacao(contratacao({ tipo: 'escritor', ferramentas: ['Read', 'Edit', 'Write', 'Bash'] })).erros, []);
  assert.match(erros(contratacao({ tipo: 'gerente' })), /tipo inválido/);
});

test('validarContratacao: nome e descrição numa linha, sem controle e com limite', () => {
  for (const nome of ['Ana\nlista', 'Ana\rlista', 'Ana\u2028lista', 'Ana\u0007', '', '   ', 7]) {
    assert.match(erros(contratacao({ nome })), /nome/, JSON.stringify(nome));
  }
  for (const descricao of ['linha 1\nlinha 2', 'a\r\nb', 'x\u0085y', '']) {
    assert.match(erros(contratacao({ descricao })), /descricao/, JSON.stringify(descricao));
  }
  assert.match(erros(contratacao({ nome: 'x'.repeat(200) })), /nome.*longo/);
});

test('validarContratacao: corpo grande demais, sem Entrega, sem "lições usadas" ou com caractere de controle', () => {
  assert.match(erros(contratacao({ corpo: CORPO + 'x'.repeat(MAX_CORPO) })), /corpo grande demais/);
  assert.match(erros(contratacao({ corpo: CORPO.replace('lições usadas', 'votos') })), /lições usadas/);
  assert.match(erros(contratacao({ corpo: CORPO.replace('## Entrega', '## Saída') })), /Entrega/);
  // "lições usadas" fora da seção de entrega não vale
  assert.match(erros(contratacao({ corpo: 'lições usadas\n\n## Entrega\n- **mudanças:** x\n' })), /lições usadas/);
  assert.match(erros(contratacao({ corpo: CORPO + '\u007f' })), /caractere de controle/);
  assert.match(erros(contratacao({ corpo: '' })), /corpo/);
});

test('validarContratacao: texto mal formado (surrogate UTF-16 solto) é recusado em todo campo de texto', () => {
  for (const s of ['\ud800', 'a\udfffb', 'x\ud83d']) {
    assert.match(erros(contratacao({ nome: `Ana${s}` })), /"nome".*mal formado/, JSON.stringify(s));
    assert.match(erros(contratacao({ descricao: `Analisa ${s}` })), /"descricao".*mal formado/);
    assert.match(erros(contratacao({ corpo: CORPO + s })), /corpo.*mal formado/);
    assert.match(erros(contratacao({ codex: { model: `gpt${s}`, effort: 'medium' } })), /codex\.model/);
  }
  // par válido (emoji) continua aceito
  assert.deepEqual(validarContratacao(contratacao({ nome: 'Ana 🧪', descricao: 'Analisa 👍' })).erros, []);
});

test('validarContratacao: modelos, campos desconhecidos e objeto inválido', () => {
  assert.match(erros(contratacao({ claude: { model: 'gpt-x', effort: 'high' } })), /claude\.analista\.model inválido/);
  assert.match(erros(contratacao({ codex: { model: null, effort: 'turbo' } })), /codex\.analista\.effort inválido/);
  assert.match(erros(contratacao({ claude: undefined })), /falta "claude"/);
  assert.match(erros(contratacao({ extra: 1 })), /campo desconhecido "extra"/);
  for (const d of [null, [], 'x']) assert.match(validarContratacao(d).erros.join('\n'), /objeto/);
});

// ---------- gerar (parâmetros opcionais) ----------

test('gerar: parâmetros opcionais nome e origem; padrões inalterados', () => {
  const fm = { descricao: 'd', ferramentas: 'Read' };
  assert.match(gerarAgenteClaude('rev', fm, 'c', { model: 'opus', effort: 'high' }), /^---\nname: rev\n/);
  assert.match(gerarAgenteClaude('rev', fm, 'c', { model: 'opus', effort: 'high' }, { nome: 'nabuco-rev' }), /^---\nname: nabuco-rev\n/);
  assert.match(gerarAgenteCodex('rev', fm, 'c', { model: null, effort: 'high' }), /^# GERADO por build\.mjs a partir de papeis\/rev\.md — não edite à mão\.\n/);
  assert.match(gerarAgenteCodex('rev', fm, 'c', { model: null, effort: 'high' }, { origem: 'x.mjs' }), /^# GERADO por x\.mjs — não edite à mão\.\n/);
});

// ---------- CLI: validar ----------

test('validar: mostra a prévia dos dois arquivos e não grava nada', () => {
  mkdirSync(codex, { recursive: true });
  const r = run(['validar', '--de', arquivoJson(contratacao())]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^---\n# GERADO por contratar\.mjs .*\nname: nabuco-analista\ndescription: "Analisa dados/m);
  assert.match(r.stdout, /^tools: Read, Grep$/m);
  assert.match(r.stdout, /^name = "nabuco-analista"$/m);
  assert.ok(r.stdout.includes(agenteClaude('analista')));
  assert.ok(!existsSync(join(home, 'time')));
  assert.ok(!existsSync(join(claude, 'agents')));
  assert.ok(!existsSync(join(codex, 'agents')));
});

test('validar: sem Codex avisa que não instala; avisa herança de lições e casos', () => {
  mkdirSync(join(home, 'licoes'), { recursive: true });
  writeFileSync(join(home, 'licoes', 'analista.md'), '# Lições — analista\n\n## analista-0001 · Algo\n- gatilho: g\n- expectativa: e\n- faça: f\n- por quê: p\n- 👍 0  👎 0\n');
  mkdirSync(join(home, 'casos', 'analista'), { recursive: true });
  writeFileSync(join(home, 'casos', 'analista', '2026-01-x.md'), 'sintoma: s\n');
  writeFileSync(join(home, 'casos', 'analista', '2026-02-y.md'), 'sintoma: s\n');
  const r = run(['validar', '--de', arquivoJson(contratacao())]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Codex.*não será instalado/);
  assert.match(r.stdout, /herdará 1 lições e 2 casos/);
});

test('validar: contratação inválida → 1 com os erros; uso errado → 2', () => {
  const r = run(['validar', '--de', arquivoJson(contratacao({ papel: '../x', tipo: 'checador', ferramentas: ['Bash'] }))]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^nabuco: contratação inválida/);
  assert.ok(r.stderr.includes('papel inválido "../x"'));
  assert.match(r.stderr, /checador não pode usar "Bash"/);
  assert.equal(run(['validar']).status, 2);
  assert.equal(run(['validar', '--de', join(base, 'nao-existe.json')]).status, 2);
  assert.equal(run(['validar', '--de', arquivoJson('{quebrado')]).status, 2);
  assert.equal(run(['validar', '--de', arquivoJson(contratacao()), '--extra']).status, 2);
  assert.equal(run(['demitir']).status, 2);
  assert.equal(run([]).status, 2);
});

// ---------- CLI: novo ----------

test('novo: grava o registro e gera nabuco-<p> no Claude e no Codex', () => {
  mkdirSync(codex, { recursive: true });
  const r = contratar();
  assert.equal(r.status, 0, r.stderr);
  const md = readFileSync(agenteClaude('analista'), 'utf8');
  assert.equal(md, `---\n# GERADO por contratar.mjs a partir de time/papeis/analista.md — não edite à mão.\nname: nabuco-analista\ndescription: "Analisa dados e aponta inconsistências. Somente leitura."\nmodel: sonnet\neffort: medium\ntools: Read, Grep\n---\n\n${CORPO.trimEnd()}\n`);
  const toml = readFileSync(agenteCodex('analista'), 'utf8');
  assert.match(toml, /^# GERADO por contratar\.mjs/);
  assert.match(toml, /^name = "nabuco-analista"$/m);
  assert.doesNotMatch(toml, /^model = /m);
  assert.match(toml, /^model_reasoning_effort = "medium"$/m);
  const reg = readFileSync(registro('analista'), 'utf8');
  assert.match(reg, /^---\nnome: Analista\ndescricao: Analisa dados.*\ntipo: checador\nferramentas: Read, Grep\n---\n/);
  const modelos = JSON.parse(readFileSync(join(home, 'time', 'modelos.json'), 'utf8'));
  assert.deepEqual(modelos, { claude: { analista: { model: 'sonnet', effort: 'medium' } }, codex: { analista: { model: null, effort: 'medium' } } });
  assert.match(r.stdout, /reinicie a sessão/i);
  // o registro relido é o mesmo contratado
  assert.deepEqual(contratados(home).map(c => [c.papel, c.tipo, c.nome]), [['analista', 'checador', 'Analista']]);
});

test('novo: Codex auto sem pasta do Codex não instala; --codex nao também não', () => {
  assert.equal(contratar().status, 0);
  assert.ok(existsSync(agenteClaude('analista')));
  assert.ok(!existsSync(codex));
  mkdirSync(codex, { recursive: true });
  assert.equal(contratar({ papel: 'outro' }, ['--codex', 'nao']).status, 0);
  assert.ok(!existsSync(agenteCodex('outro')));
});

test('novo: nunca sobrescreve agente alheio no Claude ou no Codex', () => {
  mkdirSync(join(claude, 'agents'), { recursive: true });
  writeFileSync(agenteClaude('analista'), 'meu agente');
  const r = contratar();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /não sobrescrevo/);
  assert.equal(readFileSync(agenteClaude('analista'), 'utf8'), 'meu agente');
  assert.ok(!existsSync(registro('analista')));

  mkdirSync(join(codex, 'agents'), { recursive: true });
  writeFileSync(agenteCodex('outro'), 'meu toml');
  // mesmo com --codex nao: o toml alheio bloquearia um instalar futuro
  const r2 = contratar({ papel: 'outro' }, ['--codex', 'nao']);
  assert.equal(r2.status, 1);
  assert.equal(readFileSync(agenteCodex('outro'), 'utf8'), 'meu toml');
  assert.ok(!existsSync(agenteClaude('outro')));
  assert.ok(!existsSync(registro('outro')));
});

test('novo: papel já contratado é recusado (edição é pelo registro + instalar)', () => {
  assert.equal(contratar().status, 0);
  const r = contratar({ nome: 'Outro nome' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /já está contratado/);
});

test('novo: slug hostil não vira caminho', () => {
  const r = contratar({ papel: '../../fora' });
  assert.equal(r.status, 1);
  assert.ok(!existsSync(join(home, 'time')));
  assert.ok(!existsSync(join(base, 'fora.md')));
  assert.ok(!existsSync(join(claude, 'agents')));
});

test('novo: escritor com Edit/Write/Bash gera tools completas', () => {
  const r = contratar({ papel: 'redator', tipo: 'escritor', ferramentas: ['Read', 'Edit', 'Write', 'Bash'] });
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(agenteClaude('redator'), 'utf8'), /^tools: Read, Edit, Write, Bash$/m);
  assert.deepEqual(escritores(home), [...ESCRITORES, 'redator']);
});

test('novo: modelos.json do time ilegível → recusa sem apagar o arquivo', () => {
  mkdirSync(join(home, 'time'), { recursive: true });
  writeFileSync(join(home, 'time', 'modelos.json'), '{quebrado');
  const r = contratar();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /modelos\.json/);
  assert.equal(readFileSync(join(home, 'time', 'modelos.json'), 'utf8'), '{quebrado');
  assert.ok(!existsSync(registro('analista')));
});

test('novo: faz commit no git do ~/.nabuco quando ele existe', (t) => {
  const g = spawnSync('git', ['init', '-q', home]);
  if (g.error || g.status !== 0) return t.skip('git indisponível');
  spawnSync('git', ['-C', home, 'config', 'user.email', 't@t']);
  spawnSync('git', ['-C', home, 'config', 'user.name', 't']);
  assert.equal(contratar().status, 0);
  const log = spawnSync('git', ['-C', home, 'log', '--oneline'], { encoding: 'utf8' });
  assert.match(log.stdout, /time: contratar analista/);
});

// ---------- registro ilegível / inválido nunca some em silêncio ----------

test('registro: arquivo quebrado, slug ruim ou regra violada → aviso, nunca lança', () => {
  assert.equal(contratar().status, 0);
  const dir = join(home, 'time', 'papeis');
  writeFileSync(join(dir, 'quebrado.md'), '---\nnome: X\nsem fechamento');
  writeFileSync(join(dir, 'Mau.md'), readFileSync(registro('analista'), 'utf8'));
  writeFileSync(join(dir, 'dev.md'), readFileSync(registro('analista'), 'utf8'));
  writeFileSync(join(dir, 'perigoso.md'), readFileSync(registro('analista'), 'utf8').replace('ferramentas: Read, Grep', 'ferramentas: Read, Bash'));
  writeFileSync(join(dir, 'lixo.md.tmp'), 'x'); // sobra de escrita atômica: não é registro
  const { contratados: cs, avisos, invalidos } = lerTime(home);
  assert.deepEqual(cs.map(c => c.papel), ['analista']);
  const txt = avisos.join('\n');
  assert.match(txt, /quebrado\.md.*sem fechamento/);
  assert.match(txt, /"Mau\.md"/);
  assert.match(txt, /dev\.md.*embutido/);
  assert.match(txt, /perigoso\.md.*checador não pode usar "Bash"/);
  assert.doesNotMatch(txt, /lixo/);
  assert.deepEqual(invalidos.sort(), ['perigoso', 'quebrado']);

  const l = run(['listar']);
  assert.equal(l.status, 0);
  assert.match(l.stdout, /analista/);
  assert.match(l.stderr, /aviso: .*quebrado\.md/);
  const j = JSON.parse(run(['listar', '--json']).stdout);
  assert.equal(j.avisos.length, 4);

  const i = run(['instalar']);
  assert.equal(i.status, 1, 'instalar com registro inválido não sai ok');
  assert.match(i.stderr, /perigoso\.md/);
  assert.equal(run(['instalar', '--papel', 'perigoso']).status, 1);
  assert.equal(run(['instalar', '--papel', 'analista']).status, 0);
});

test('registro: modelos.json ilegível → contratados vazio com aviso; listar avisa, instalar falha', () => {
  assert.equal(contratar().status, 0);
  writeFileSync(join(home, 'time', 'modelos.json'), '{quebrado');
  const t = lerTime(home);
  assert.deepEqual(t.contratados, []);
  assert.match(t.avisos.join('\n'), /modelos\.json ilegível/);
  assert.deepEqual(papeis(home), PAPEIS);
  const l = run(['listar']);
  assert.match(l.stderr, /modelos\.json ilegível/);
  assert.doesNotMatch(l.stdout, /nenhum funcionário contratado/);
  assert.equal(run(['instalar']).status, 1);
});

test('registro: pasta inexistente → listas embutidas, sem aviso', () => {
  assert.deepEqual(lerTime(home), { contratados: [], avisos: [], invalidos: [] });
  assert.deepEqual(papeis(home), PAPEIS);
  assert.deepEqual(papeisCerebro(home), PAPEIS_CEREBRO);
  assert.deepEqual(escritores(home), ESCRITORES);
});

// ---------- listar ----------

test('listar: vazio, texto e --json (sem corpo)', () => {
  let r = run(['listar']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /nenhum funcionário contratado/);
  assert.deepEqual(JSON.parse(run(['listar', '--json']).stdout), { contratados: [], avisos: [] });
  assert.equal(contratar().status, 0);
  r = run(['listar']);
  assert.match(r.stdout, /analista · checador · Analista — Analisa dados/);
  const j = JSON.parse(run(['listar', '--json']).stdout);
  assert.deepEqual(Object.keys(j.contratados[0]).sort(), ['claude', 'codex', 'descricao', 'ferramentas', 'nome', 'papel', 'tipo']);
});

test('listar: marca quem não está instalado no Claude Code (ausente ou agente alheio)', () => {
  assert.equal(contratar().status, 0);
  assert.doesNotMatch(run(['listar']).stdout, /não instalado/);
  rmSync(agenteClaude('analista'));
  let r = run(['listar']);
  assert.match(r.stdout, /analista · .*não instalado no Claude Code.*contratar instalar/);
  writeFileSync(agenteClaude('analista'), '---\nname: nabuco-analista\n---\nmeu\n');
  r = run(['listar']);
  assert.match(r.stdout, /analista · .*não instalado no Claude Code.*não é do nabuco/);
  assert.equal(r.status, 0);
});

// ---------- instalar ----------

test('instalar: reinstala a partir do registro, atualiza edições e instala no Codex quando pedido', () => {
  assert.equal(contratar().status, 0);
  assert.ok(!existsSync(agenteCodex('analista')));
  let r = run(['instalar', '--codex', 'sim']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(agenteCodex('analista'), 'utf8'), /^name = "nabuco-analista"$/m);
  assert.match(r.stdout, /analista: Claude sem mudança, Codex criado/);
  // edição = editar o registro + instalar
  writeFileSync(registro('analista'), readFileSync(registro('analista'), 'utf8').replace('Somente leitura.', 'Somente leitura, sempre.'));
  r = run(['instalar']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(agenteClaude('analista'), 'utf8'), /Somente leitura, sempre\./);
  assert.match(readFileSync(agenteCodex('analista'), 'utf8'), /Somente leitura, sempre\./);
  assert.match(r.stdout, /Claude atualizado, Codex atualizado/);
});

test('instalar: sem contratados avisa; --papel inexistente → 1; inválido → 2', () => {
  const r = run(['instalar']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /nenhum funcionário contratado/);
  assert.equal(run(['instalar', '--papel', 'fantasma']).status, 1);
  assert.equal(run(['instalar', '--papel', 'dev']).status, 1);
  assert.equal(run(['instalar', '--papel', '../x']).status, 2);
  assert.equal(run(['instalar', '--codex', 'talvez']).status, 2);
});

test('instalar: toml alheio no Codex não é sobrescrito', () => {
  assert.equal(contratar().status, 0);
  mkdirSync(join(codex, 'agents'), { recursive: true });
  writeFileSync(agenteCodex('analista'), 'meu toml');
  const r = run(['instalar', '--codex', 'sim']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /não sobrescrevo/);
  assert.equal(readFileSync(agenteCodex('analista'), 'utf8'), 'meu toml');
});

test('instalar: agente Claude sem a marca do nabuco não é sobrescrito (registro criado à mão ou ~/.nabuco clonado)', () => {
  // registro que não passou pelo `novo`: o agente do usuário já estava lá
  const { dados } = validarContratacao(contratacao());
  mkdirSync(join(home, 'time', 'papeis'), { recursive: true });
  writeFileSync(registro('analista'), registroMd(dados));
  writeFileSync(join(home, 'time', 'modelos.json'), JSON.stringify({ claude: { analista: dados.claude }, codex: { analista: dados.codex } }));
  mkdirSync(join(claude, 'agents'), { recursive: true });
  const meu = '---\nname: nabuco-analista\ndescription: meu\n---\nmeu agente\n';
  writeFileSync(agenteClaude('analista'), meu);
  const r = run(['instalar', '--codex', 'sim']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /nabuco-analista\.md não foi gerado pelo nabuco; não sobrescrevo/);
  assert.match(r.stdout, /analista: Claude alheio, Codex criado/);
  assert.equal(readFileSync(agenteClaude('analista'), 'utf8'), meu);
  // sem o agente alheio, instala com a marca
  rmSync(agenteClaude('analista'));
  assert.equal(run(['instalar']).status, 0);
  assert.match(readFileSync(agenteClaude('analista'), 'utf8'), /^---\n# GERADO por contratar\.mjs/);
});

// ---------- remover ----------

test('remover: apaga só os agentes registrados e o registro; lições e casos ficam', () => {
  mkdirSync(codex, { recursive: true });
  assert.equal(contratar().status, 0);
  assert.equal(contratar({ papel: 'outro' }).status, 0);
  mkdirSync(join(home, 'licoes'), { recursive: true });
  writeFileSync(join(home, 'licoes', 'analista.md'), '# Lições — analista\n');
  mkdirSync(join(home, 'casos', 'analista'), { recursive: true });
  writeFileSync(join(home, 'casos', 'analista', 'c.md'), 'sintoma: s\n');
  writeFileSync(join(claude, 'agents', 'meu.md'), 'alheio');
  const r = run(['remover', '--papel', 'analista']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!existsSync(agenteClaude('analista')));
  assert.ok(!existsSync(agenteCodex('analista')));
  assert.ok(!existsSync(registro('analista')));
  assert.ok(existsSync(agenteClaude('outro')) && existsSync(agenteCodex('outro')) && existsSync(registro('outro')));
  assert.ok(existsSync(join(claude, 'agents', 'meu.md')));
  assert.ok(existsSync(join(home, 'licoes', 'analista.md')));
  assert.ok(existsSync(join(home, 'casos', 'analista', 'c.md')));
  const modelos = JSON.parse(readFileSync(join(home, 'time', 'modelos.json'), 'utf8'));
  assert.deepEqual(Object.keys(modelos.claude), ['outro']);
  assert.deepEqual(Object.keys(modelos.codex), ['outro']);
  assert.deepEqual(papeis(home), [...PAPEIS, 'outro']);
  assert.match(r.stdout, /lições e casos/);
});

test('remover: toml alheio fica; não contratado, embutido e slug ruim são recusados', () => {
  assert.equal(contratar().status, 0);
  mkdirSync(join(codex, 'agents'), { recursive: true });
  writeFileSync(agenteCodex('analista'), 'meu toml');
  const r = run(['remover', '--papel', 'analista']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(agenteCodex('analista'), 'utf8'), 'meu toml');
  assert.match(r.stderr, /não é do nabuco/);
  assert.equal(run(['remover', '--papel', 'analista']).status, 1);
  assert.equal(run(['remover', '--papel', 'dev']).status, 1);
  assert.ok(existsSync(join(RAIZ, 'agents', 'dev.md')));
  assert.equal(run(['remover', '--papel', '../x']).status, 2);
  assert.equal(run(['remover']).status, 2);
});

test('remover: agente Claude sem a marca do nabuco fica e é avisado', () => {
  assert.equal(contratar().status, 0);
  writeFileSync(agenteClaude('analista'), 'meu agente');
  const r = run(['remover', '--papel', 'analista']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(agenteClaude('analista'), 'utf8'), 'meu agente');
  assert.match(r.stderr, /nabuco-analista\.md não é do nabuco; deixei como está/);
  assert.ok(!existsSync(registro('analista')));
});

test('remover: registro inválido ainda pode ser removido', () => {
  assert.equal(contratar().status, 0);
  writeFileSync(registro('analista'), '---\nsem fechamento');
  const r = run(['remover', '--papel', 'analista']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!existsSync(registro('analista')));
  assert.ok(!existsSync(agenteClaude('analista')));
});

// ---------- listas dinâmicas e modelos ----------

test('papeis/papeisCerebro/escritores e carregarModelosTodos incluem o contratado', () => {
  assert.equal(contratar().status, 0);
  assert.deepEqual(papeis(home), [...PAPEIS, 'analista']);
  assert.deepEqual(papeisCerebro(home), [...PAPEIS, 'analista', 'gerente']);
  assert.deepEqual(escritores(home), ESCRITORES);
  const m = carregarModelosTodos(RAIZ, home);
  assert.deepEqual(m.claude.analista, { model: 'sonnet', effort: 'medium' });
  assert.deepEqual(m.codex.analista, { model: null, effort: 'medium' });
  assert.deepEqual(m.claude.dev, carregarModelos(RAIZ).claude.dev);
  assert.deepEqual(carregarModelosTodos(RAIZ, join(base, 'vazio')), carregarModelos(RAIZ));
});

test('registroMd: relido pelo frontmatter devolve os mesmos dados', () => {
  const { dados } = validarContratacao(contratacao({ descricao: 'tem: dois pontos e # cerquilha' }));
  mkdirSync(join(home, 'time', 'papeis'), { recursive: true });
  writeFileSync(registro('analista'), registroMd(dados));
  writeFileSync(join(home, 'time', 'modelos.json'), JSON.stringify({ claude: { analista: dados.claude }, codex: { analista: dados.codex } }));
  assert.deepEqual(contratados(home), [dados]);
  assert.deepEqual(readdirSync(join(home, 'time', 'papeis')), ['analista.md']);
});
