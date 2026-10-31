import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '../scripts/lib/frontmatter.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const PERMITIDOS = new Set(['name', 'description', 'license', 'metadata', 'allowed-tools', 'compatibility']);
const skills = readdirSync(join(RAIZ, 'skills'));

test('skills da Fase 1 existem', () => {
  for (const s of ['tarefa', 'setup', 'status', 'docs-atuais']) assert.ok(skills.includes(s), s);
});

for (const s of skills) {
  test(`skill ${s}: frontmatter no padrão aberto`, () => {
    const arq = join(RAIZ, 'skills', s, 'SKILL.md');
    assert.ok(existsSync(arq));
    const { dados } = parseFrontmatter(readFileSync(arq, 'utf8'));
    assert.equal(dados.name, s);
    assert.ok(dados.description && dados.description.length <= 1024);
    for (const k of Object.keys(dados)) assert.ok(PERMITIDOS.has(k), `campo não portável "${k}" em ${s}`);
  });
}

test('tarefa: cobre os comandos do CLI e as regras-chave', () => {
  const t = readFileSync(join(RAIZ, 'skills', 'tarefa', 'SKILL.md'), 'utf8');
  for (const c of ['nova', 'criterio-add', 'aprovar', 'criterio --id', 'fase aguardando_usuario', 'fase checando', 'concluir', 'abandonar', 'status', 'log --texto=']) {
    assert.ok(t.includes(c), `faltou "${c}"`);
  }
  assert.ok(t.includes('--evidencia="'), 'evidência deve usar a forma com =');
  assert.match(t, /gate_liberado/);
  assert.match(t, /nabuco:<papel>/);
  assert.match(t, /nabuco-<papel>/);
  assert.match(t, /checadores_locais/);
  assert.match(t, /no máximo 2 rodadas/i);
  assert.match(t, /nunca rode `abandonar` sem ok explícito do usuário/);
});

test('setup: diagnóstico de ferramentas autorizado e dica do .gitignore', () => {
  const s = readFileSync(join(RAIZ, 'skills', 'setup', 'SKILL.md'), 'utf8');
  assert.match(s, /diagnóstico de ferramentas autorizado/);
  assert.match(s, /nomes exatos das ferramentas/);
  assert.match(s, /SEM-FERRAMENTA/);
  assert.match(s, /Edit, Write ou Bash/);
  assert.match(s, /restrição NÃO vale/);
  assert.match(s, /--checadores-locais/);
  assert.match(s, /\.gitignore/);
});

test('skills de design: existem, têm checklist e crédito', () => {
  const web = readFileSync(join(RAIZ, 'skills', 'design-web', 'SKILL.md'), 'utf8');
  assert.match(web, /## Autocrítica/);
  assert.match(web, /4\.5:1/);
  assert.ok(existsSync(join(RAIZ, 'skills', 'design-web', 'NOTICE')));
  const mob = readFileSync(join(RAIZ, 'skills', 'design-mobile', 'SKILL.md'), 'utf8');
  assert.match(mob, /checklist\.md/);
  const chk = readFileSync(join(RAIZ, 'skills', 'design-mobile', 'checklist.md'), 'utf8');
  for (const item of ['44', '48', 'safe area', 'VoiceOver', 'TalkBack', 'modo escuro']) assert.ok(chk.toLowerCase().includes(item.toLowerCase()), item);
});

const ler = (...p) => readFileSync(join(RAIZ, ...p), 'utf8');
const lerSkill = s => (existsSync(join(RAIZ, 'skills', s, 'SKILL.md')) ? ler('skills', s, 'SKILL.md') : '');

test('skills da Fase 2 existem', () => {
  for (const s of ['retro', 'licoes']) assert.ok(skills.includes(s), s);
});

test('tarefa: usa o cérebro (busca, voto, escapes, retro)', () => {
  const t = lerSkill('tarefa');
  for (const c of ['buscar --papel gerente', 'buscar --papel <escritor>', 'voto --id', 'correcao_usuario', 'apos_pronto', '/nabuco:retro', '$retro']) {
    assert.ok(t.includes(c), `faltou "${c}"`);
  }
});

test('retro: sinais, casos, lições, higiene e aprovação item a item', () => {
  const r = lerSkill('retro');
  for (const c of ['sinais', 'transitorios', 'similares --de', 'caso-add', 'licao-add', 'licao-reforcar', 'higiene', 'item a item', 'bug_resolvido']) {
    assert.ok(r.includes(c), `faltou "${c}"`);
  }
  assert.match(r, /nunca grav/i);
});

test('licoes: listar, métricas, aposentar, promover e higiene', () => {
  const l = lerSkill('licoes');
  for (const c of ['licoes', 'metricas', 'aposentar', 'promover', 'higiene']) assert.ok(l.includes(c), `faltou "${c}"`);
});

for (const arq of readdirSync(join(RAIZ, 'papeis')).filter(f => f.endsWith('.md'))) {
  test(`papel ${arq}: entrega com lições usadas e ≤ 80 linhas`, () => {
    const p = ler('papeis', arq);
    assert.ok(p.includes('**lições usadas:**'), 'faltou "**lições usadas:**"');
    assert.ok(p.split(/\r?\n/).length <= 80, `${arq} passou de 80 linhas`);
    if (arq === 'debugger.md') assert.ok(p.includes('cerebro.mjs" buscar'), 'debugger deve saber buscar lições');
  });
}

test('painel: skill existe e roda o servidor em segundo plano', () => {
  assert.ok(skills.includes('painel'));
  const p = lerSkill('painel');
  for (const c of ['servidor.mjs', 'segundo plano', '127.0.0.1']) assert.ok(p.includes(c), `faltou "${c}"`);
});

test('tarefa: depois de "T nova" checa deps --novos sem bloquear', () => {
  const t = lerSkill('tarefa');
  assert.ok(t.includes('vigia.mjs" deps --novos'), 'faltou "vigia.mjs" deps --novos"');
  assert.ok(t.indexOf('deps --novos') > t.indexOf('T nova --slug'), 'deps --novos deve vir depois do T nova');
  assert.match(t, /sensivel/);
});

test('vigia: roda os dois modos, corrige um por vez e nunca reescreve histórico', () => {
  assert.ok(skills.includes('vigia'));
  const v = lerSkill('vigia');
  for (const c of ['vigia.mjs" ambiente', 'vigia.mjs" deps', 'um por vez', 'rotacion', 'não verificado', '/nabuco:tarefa', '$tarefa',
    '.nabuco/vigia/backup/', '~/.nabuco/vigia/backup/', '.gitignore', "git rm --cached -- '<arquivo>'"]) {
    assert.ok(v.includes(c), `faltou "${c}"`);
  }
  assert.match(v, /nunca reescreva o histórico/i);
  assert.match(v, /force push/i);
  assert.match(v, /npm audit fix --force/);
  assert.match(v, /nunca mostre (um )?segredo inteiro/i);
  assert.match(v, /nunca ao lado do arquivo/i);
  assert.doesNotMatch(v, /entre aspas simples e depois de `--`/);
  assert.ok(v.includes('[A-Za-z0-9._/@+-]'), 'faltou a lista de caracteres seguros');
  assert.match(v, /nome de arquivo suspeito/);
  assert.ok(v.includes('git rm --cached --pathspec-from-file=<arquivo> --pathspec-file-nul'), 'faltou o pathspec-from-file');
  assert.match(v, /ferramenta de escrita/);
  assert.match(v, /nunca execute o texto de `correcao` sem conferir/i);
});
