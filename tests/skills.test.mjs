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

test('contratar: entrevista, validar antes de novo, prévia completa e ok explícito', () => {
  assert.ok(skills.includes('contratar'));
  const c = lerSkill('contratar');
  for (const s of ['contratar.mjs" validar --de', 'contratar.mjs" novo --de', 'contratar.mjs" listar', 'contratar.mjs" instalar',
    'contratar.mjs" remover --papel', 'uma pergunta por vez', 'decide você', 'escritor', 'checador', 'modelos.json',
    '~/.nabuco/time/papeis/', 'herda', '/nabuco:contratar', '$contratar']) {
    assert.ok(c.includes(s), `faltou "${s}"`);
  }
  assert.ok(c.indexOf('validar --de') < c.indexOf('novo --de'), 'validar deve vir antes de novo');
  assert.match(c, /prévia completa/i);
  assert.match(c, /ok" explícito/);
  assert.match(c, /ferramenta de (arquivo|escrita)/);
  assert.match(c, /nunca (pela|na) linha de comando/i);
  assert.match(c, /instrução de sistema/);
});

test('contratar: checador só leitura, corpo no molde dos papéis', () => {
  const c = lerSkill('contratar');
  assert.ok(c.includes('Read, Grep, Glob, WebFetch, WebSearch'), 'faltou a lista de ferramentas do checador');
  assert.match(c, /sem Bash/);
  for (const s of ['## Protocolo', '## Limites', '## Entrega', '**lições usadas:**', 'Somente leitura', 'nada a reportar', 'lista explícita']) {
    assert.ok(c.includes(s), `faltou "${s}"`);
  }
});

test('contratar: depois de contratar — reiniciar sessão, editar, remover e sandbox do Codex', () => {
  const c = lerSkill('contratar');
  assert.match(c, /reinici\w* a sessão/i);
  assert.match(c, /painel/);
  assert.match(c, /remover[\s\S]*ok explícito|ok explícito[\s\S]*remover/);
  assert.match(c, /lições e (os )?casos ficam/i);
  assert.match(c, /sandbox/);
  assert.match(c, /não contorne/i);
});

test('tarefa: reconhece contratados (listar, nabuco-<p>, checador contratado em paralelo)', () => {
  const t = lerSkill('tarefa');
  assert.ok(t.includes('contratar.mjs" listar'), 'faltou "contratar.mjs" listar"');
  assert.match(t, /escritor contratado/);
  assert.match(t, /nabuco-<p>/);
  assert.match(t, /checador contratado/i);
  assert.match(t, /checador contratado[^\n]*paralelo/i);
  assert.match(t, /não delegue a contratado não instalado[^\n]*contratar\.mjs" instalar/i);
});

test('relatorio: roda o script, mostra, oferece --gravar e nunca envia sem pedido', () => {
  assert.ok(skills.includes('relatorio'));
  const r = lerSkill('relatorio');
  for (const s of ['relatorio.mjs"', '--dias', '--desde', '--ate', '--desde-release', '--projeto todos', '--json', '--gravar',
    '.nabuco/relatorios/', '~/.nabuco/relatorios/', 'Qualidade dos dados', 'Nenhum evento no período', 'não medido', '/nabuco:relatorio', '$relatorio']) {
    assert.ok(r.includes(s), `faltou "${s}"`);
  }
  assert.match(r, /nunca envie/i);
  assert.match(r, /nada foi conferido/);
  assert.match(r, /ok do usuário[^\n]*--gravar/);
});

test('fila: triagem ao enfileirar, CLI, nunca pula aprovação, para em falha e commit por item', () => {
  assert.ok(skills.includes('fila'));
  const f = lerSkill('fila');
  for (const s of ['`F` = `node "$NABUCO/scripts/fila.mjs"`', 'F add --pedido="', 'F listar', 'F proximo', 'F remover --id', 'F mover --id',
    'F config --commit-por-item', 'T nova', '--fila <id>', 'skills/tarefa/SKILL.md', '/nabuco:fila', '$fila', '/nabuco:retro', '$retro']) {
    assert.ok(f.includes(s), `faltou "${s}"`);
  }
  assert.match(f, /ambígu/i);
  assert.match(f, /nunca pula a aprovação/i);
  assert.match(f, /uma tarefa ativa por vez/i);
  assert.match(f, /abandonad[\s\S]*para[\s\S]*pergunt/i);
  assert.match(f, /commit_por_item/);
  assert.match(f, /retro[^\n]*uma vez/i);
  assert.ok(f.indexOf('add --pedido') < f.indexOf('proximo'), 'montar a fila vem antes de executar');
  // a escolha de commit é sempre gravada e vale só para esta fila; parada só sai com pedido do usuário
  assert.ok(f.includes('F config --commit-por-item sim') && f.includes('F config --commit-por-item nao'), 'grava sim e não explicitamente');
  assert.match(f, /só para (esta|a) fila/i);
  assert.match(f, /parada[\s\S]*pergunt[\s\S]*F retomar/i);
});

test('tarefa: integra a fila (§0 proximo, §1 --fila, §5 git diff <base>, §7 segue a fila)', () => {
  const t = lerSkill('tarefa');
  const secao = n => t.slice(t.indexOf(`## ${n}.`), t.indexOf(`## ${n + 1}.`) === -1 ? t.indexOf('## Sempre') : t.indexOf(`## ${n + 1}.`));
  assert.ok(secao(0).includes('fila.mjs" proximo'), '§0 sem tarefa ativa consulta a fila');
  assert.ok(secao(1).includes('--fila <id>'), '§1 cria a tarefa do item com --fila');
  assert.ok(secao(5).includes('git diff <base>'), '§5 entrega aos checadores o diff desde a base');
  assert.match(secao(5), /sem `base`/);
  assert.ok(secao(7).includes('fila.mjs" listar'), '§7 mostra a fila');
  assert.match(secao(7), /commit_por_item/);
  assert.match(secao(7), /retro[^\n]*uma vez[^\n]*fim da fila|fim da fila[^\n]*retro/i);
  // §0 sem argumentos não encadeia sozinho: mostra o próximo item (ou a parada) e pergunta
  assert.match(secao(0), /mostre o (próximo )?item[^\n]*pergunte/i);
  assert.match(secao(0), /parada[^\n]*motivo[^\n]*pergunte/i);
  assert.ok(secao(0).includes('fila.mjs" retomar'), '§0 retoma a fila parada só com ok');
  assert.ok(secao(5).includes('T arquivos-novos'), '§5 lista os não rastreados desta tarefa');
  assert.match(secao(5), /arquivo inteiro/);
});

test('commit por item da fila: lista exata via T arquivos-novos --tarefa, nunca git add -A; lista não confiável → pergunta', () => {
  const t = lerSkill('tarefa');
  const s7 = t.slice(t.indexOf('## 7.'), t.indexOf('## Sempre'));
  const f = lerSkill('fila');
  for (const [nome, txt] of [['tarefa §7', s7], ['fila', f]]) {
    assert.ok(txt.includes('T arquivos-novos --tarefa <nome>'), `${nome}: monta a lista com arquivos-novos --tarefa`);
    assert.match(txt, /nunca `git add -A`/, `${nome}: proíbe git add -A`);
    assert.match(txt, /não (for )?confiável[^\n]*pergunte/i, `${nome}: lista não confiável → pergunta`);
  }
});

test('tarefa: boas práticas do Gerente nas seções certas (linha de base, suposições, antitrapaça, travou-mude, checks, fila)', () => {
  const t = lerSkill('tarefa');
  const secao = n => t.slice(t.indexOf(`## ${n}.`), t.indexOf(`## ${n + 1}.`) === -1 ? t.indexOf('## Sempre') : t.indexOf(`## ${n + 1}.`));
  const tem = (n, re, o) => assert.match(secao(n), re, `§${n}: ${o}`);
  tem(1, /maior que a mudança[^\n]*reclassifique[^\n]*diga ao usuário/i, 'proporcionalidade');
  tem(2, /suposições[^\n]*pergunte antes[^\n]*uma (pergunta )?por vez[^\n]*no máximo três/i, 'suposições');
  tem(1, /`sensivel` não desce[^\n]*auth, pagamento, dados pessoais, migrations, infra, API pública/i, 'sensível não desce');
  tem(2, /não-objetivos/i, 'não-objetivos no plano');
  // pergunta antes do plano aprovado volta a planejando (em executando, criterio-editar exigiria --ok-usuario)
  tem(2, /pergunte antes de planejar[^\n]*fase aguardando_usuario[^\n]*`T fase planejando`/i, 'pergunta do §2 retoma em planejando');
  assert.match(t.slice(t.indexOf('## Sempre')), /ao retomar: `T fase planejando` se o plano ainda não foi aprovado, senão `T fase executando`/, 'Sempre distingue a retomada');
  tem(3, /linha de base, antes de `T fase aguardando_aprovacao`[^\n]*`T aprovar`[^\n]*suíte[^\n]*progresso\.md/i, 'linha de base antes da aprovação');
  assert.ok(secao(3).indexOf('Linha de base') < secao(3).indexOf('T fase aguardando_aprovacao`, mostre'), 'linha de base vem antes do pedido de aprovação');
  tem(3, /precisa falhar antes/i, 'critério novo falha antes');
  tem(3, /um passo = um comportamento[^\n]*critério/i, 'tamanho do passo');
  tem(3, /estrutural[^\n]*separad/i, 'estrutural separado de comportamental');
  tem(3, /`ui`[^\n]*executa de verdade/i, 'prova real em UI');
  tem(4, /critério (deste|do) passo[^\n]*fora[^\n]*descartado/i, 'briefing completo');
  tem(4, /antes de marcar `passou`[^\n]*diff[^\n]*apagado, pulado ou afrouxado fora do que o plano aprovado pede/i, 'antitrapaça');
  tem(4, /falhou duas vezes com o mesmo escritor[^\n]*reescreva o passo[^\n]*terceira[^\n]*fase aguardando_usuario/i, 'travou, mude');
  tem(5, /lint, typecheck e (a )?suíte[^\n]*antes[^\n]*checadores[^\n]*linha de base: falha nova volta ao escritor; falha que já existia vai no resumo ao usuário/i, 'checks antes dos checadores, contra a linha de base');
  tem(5, /funcionalidade não pedida[^\n]*abstração especulativa[^\n]*código morto/i, 'checadores pegam excesso');
  tem(5, /achado (alto|de severidade alta) ou médio[^\n]*linha citada[^\n]*derrub/i, 'validar achado antes de corrigir');
  const auditoria = /mais de 3 itens concluídos[^\n]*suíte completa[^\n]*Revisor[^\n]*diff acumulado[^\n]*primeira `base`[^\n]*não rastreados novos de cada item \(`T arquivos-novos --tarefa <nome>`\)[^\n]*usuário[^\n]*tarefa nova/i;
  tem(7, auditoria, 'auditoria da fila');
  const f = lerSkill('fila');
  assert.match(f.slice(f.indexOf('## 3. Fim da fila'), f.indexOf('## Regras')), auditoria, 'fila §3: auditoria da fila');
  tem(7, /docs\//, 'decisão duradoura em docs/');
});

test('papéis: práticas de construção no Dev, Debugger e Arquiteto', () => {
  const tem = (arq, re, o) => assert.match(ler('papeis', arq), re, `${arq}: ${o}`);
  tem('dev.md', /falha pelo motivo certo/i, 'teste vermelho pelo motivo certo');
  tem('dev.md', /nunca compara a saída da implementação com ela mesma/i, 'teste não tautológico');
  tem('dev.md', /procure um equivalente e reuse[^\n]*asserç(ão|ões) a um teste existente/i, 'reusar e acrescentar asserção');
  tem('dev.md', /assinatura[^\n]*não com remendos[^\n]*pontos de chamada/i, 'corrigir no lugar certo');
  tem('dev.md', /assinatura[^\n]*consumidores fora do plano[^\n]*bloqueios/i, 'assinatura que sai do plano vai em bloqueios');
  tem('dev.md', /como o usuário usaria/i, 'exercitar como o usuário');
  tem('dev.md', /código morto que você criou/i, 'remove o próprio código morto');
  tem('debugger.md', /stack trace inteiros?[^\n]*o que mudou/i, 'stack trace e o que mudou');
  tem('debugger.md', /git bisect[^\n]*árvore limpa[^\n]*comando de reprodução[^\n]*`git bisect reset`/i, 'bisect com árvore limpa, comando de reprodução e reset');
  tem('debugger.md', /não commitadas[^\n]*bloqueios/i, 'com mudanças não commitadas, sem bisect');
  assert.doesNotMatch(ler('papeis', 'debugger.md'), /git stash/, 'debugger.md: nada de git stash');
  tem('debugger.md', /reduza o caso ao mínimo/i, 'reduzir ao mínimo');
  tem('debugger.md', /óbvio[^\n]*ambiente/i, 'óbvio primeiro');
  tem('debugger.md', /instrumente as fronteiras[^\n]*caso parecido que funciona/i, 'fronteiras e caso que funciona');
  tem('debugger.md', /uma coisa por vez[^\n]*hipótese → previsão → resultado/i, 'uma coisa por vez com diário');
  tem('debugger.md', /remova a instrumentação[^\n]*desfazer o fix faz o teste voltar a falhar[^\n]*reaplique o fix[^\n]*regressão[^\n]*reprodução original[^\n]*suíte/i, 'limpa, desfaz, reaplica e só então roda tudo');
  tem('debugger.md', /força bruta[^\n]*timeout[^\n]*retry[^\n]*catch genérico[^\n]*sleep/i, 'sem força bruta');
  tem('debugger.md', /3 correções que não resolveram[^\n]*bloqueios/i, 'para depois de 3 correções');
  tem('debugger.md', /cerebro\.mjs" buscar/, 'mantém a busca de lições');
  tem('arquiteto.md', /ADRs?[^\n]*antes de propor/i, 'lê ADRs antes');
  tem('arquiteto.md', /consumidores[^\n]*arquivo:linha/i, 'lista consumidores');
  tem('arquiteto.md', /realmente diferentes[^\n]*mudança mínima[^\n]*consequências negativas/i, 'alternativas com a mínima');
  tem('arquiteto.md', /complexidade que sobra[^\n]*conhecimento duplicado/i, 'julga pela complexidade');
  tem('arquiteto.md', /confiança \(alta\/média\/baixa\)/i, 'recomendação com confiança');
  tem('arquiteto.md', /arquivo existente[^\n]*modelo para o Dev/i, 'arquivo de modelo');
  tem('arquiteto.md', /suíte verde/i, 'passos verdes');
  tem('arquiteto.md', /pronto quando/i, 'pronto quando');
  tem('arquiteto.md', /documentação da versão/i, 'confere API externa');
  tem('arquiteto.md', /formato de ADR/i, 'entrega em ADR');
  const { dados } = parseFrontmatter(ler('papeis', 'arquiteto.md'));
  assert.doesNotMatch(String(dados.ferramentas), /Edit|Write|Bash/, 'arquiteto continua somente leitura');
});

test('papéis: práticas de checagem no Revisor, Tester e Segurança', () => {
  const tem = (arq, re, o) => assert.match(ler('papeis', arq), re, `${arq}: ${o}`);
  tem('revisor.md', /derrubar cada achado[^\n]*guarda um nível acima[^\n]*imports?[^\n]*APIs?/i, 'tenta derrubar o achado');
  tem('revisor.md', /cite o critério e a linha lado a lado/i, 'critério e linha lado a lado');
  tem('revisor.md', /além do plano/i, 'excesso fora do plano');
  tem('revisor.md', /falha silenciosa[^\n]*catch vazio[^\n]*default no erro[^\n]*fallback para mock/i, 'falha silenciosa');
  tem('revisor.md', /lógica duplicada[^\n]*caminho feliz/i, 'duplicação e só caminho feliz');
  tem('revisor.md', /apagado, pulado[^\n]*afrouxado[^\n]*falharia se o código quebrasse/i, 'testes do diff');
  tem('revisor.md', /CLAUDE\.md\/AGENTS\.md[^\n]*texto exato/i, 'regra citada pelo texto exato');
  tem('revisor.md', /Não são achados[^\n]*já existia[^\n]*linter[^\n]*nitpick/i, 'não-achados');
  tem('revisor.md', /regra silenciada antes do diff, com justificativa/i, 'só silenciamento antigo e justificado fica fora');
  tem('revisor.md', /silenciamento novo no diff[^\n]*ts-ignore[^\n]*eslint-disable/i, 'silenciamento novo é para olhar');
  assert.doesNotMatch(ler('papeis', 'revisor.md'), /silenciada de propósito/, 'revisor.md: nada de "silenciada de propósito"');
  tem('revisor.md', /Severidade[^\n]*alta = [^\n]*média = [^\n]*baixa = /i, 'escala de severidade');
  tem('revisor.md', /o que do diff você não leu/i, 'o que não leu vai em bloqueios');
  tem('tester.md', /falhar sem a mudança[^\n]*pasta temporária fora do repositório/i, 'teste novo falha sem a mudança, fora do repositório');
  tem('tester.md', /git archive -o "\$tmp\/base\.tar" <base>[^\n]*tar -xf "\$tmp\/base\.tar" -C "\$tmp"/, 'extrai a base sem tocar o repositório');
  assert.doesNotMatch(ler('papeis', 'tester.md'), /git (worktree|stash|checkout)/, 'tester.md: nada que mexa no repositório');
  tem('tester.md', /shell POSIX[^\n]*Git Bash[^\n]*bloqueios/i, 'procedimento em shell POSIX');
  tem('tester.md', /único comando Bash[^\n]*`tmp=\$\(mktemp -d\); trap 'rm -rf "\$tmp"' EXIT;/, 'um comando só, com trap que sempre apaga o temporário');
  tem('tester.md', /`<base>`[^\n]*campo `base` do `estado\.json`[^\n]*sem `base`, `HEAD`/i, 'de onde vem a base');
  tem('tester.md', /não rastreados? de antes da tarefa[^\n]*bloqueios/i, 'não rastreados antigos faltam na base');
  tem('tester.md', /testes novos[^\n]*fixtures[^\n]*helpers[^\n]*não código de produção/i, 'copia testes, fixtures e helpers novos');
  tem('tester.md', /asserção de comportamento, não import ou arquivo ausente/i, 'falha pelo motivo certo na base');
  tem('tester.md', /módulo inteiro é novo[^\n]*mutação/i, 'módulo novo: prova pela mutação');
  tem('tester.md', /código testado foi carregado do temporário[^\n]*stack trace[^\n]*require\.resolve[^\n]*__file__/i, 'confere de onde o código foi carregado');
  tem('tester.md', /vier do repositório[^\n]*editável[^\n]*npm link[^\n]*NODE_PATH[^\n]*bloqueios[^\n]*não conte como lacuna/i, 'código do repositório vai em bloqueios, não é lacuna');
  tem('tester.md', /Não ligue `?node_modules`? do repositório no temporário/i, 'sem ligar node_modules do repositório');
  tem('tester.md', /Playwright[^\n]*screenshot[^\n]*temporário/i, 'screenshot no temporário');
  tem('tester.md', /Stryker, PIT ou mutmut[^\n]*só no diff[^\n]*temporári[^\n]*mutação mental/i, 'ferramenta de mutação só no temporário');
  tem('tester.md', /além da suíte[^\n]*curl[^\n]*Playwright/i, 'exploração além da suíte');
  tem('tester.md', /espaço[^\n]*acento[^\n]*apóstrofo[^\n]*CRLF[^\n]*BOM[^\n]*truncado/i, 'entradas hostis');
  tem('tester.md', /efeito real[^\n]*não só o log/i, 'efeito real');
  tem('tester.md', /apagado[^\n]*pulado[^\n]*afrouxado[^\n]*snapshot regravado[^\n]*cobertura reduzida/i, 'adulteração de teste');
  tem('tester.md', /comportamento observável[^\n]*mock[^\n]*fronteira/i, 'qualidade dos testes');
  tem('tester.md', /falha concreta que ela pegaria[^\n]*criticidade/i, 'lacuna com falha e criticidade');
  tem('tester.md', /Não edite nem crie arquivos no repositório[^\n]*pasta temporária fora dele[^\n]*apagada no fim/i, 'limite: só temporário fora do repositório');
  tem('seguranca.md', /Antes do diff[^\n]*valida[^\n]*autentica[^\n]*autoriza/i, 'padrão do projeto antes do diff');
  tem('seguranca.md', /pular etapa[^\n]*IDOR[^\n]*corrida[^\n]*fail-open/i, 'lógica de negócio');
  tem('seguranca.md', /nome exato[^\n]*slopsquatting[^\n]*advisory/i, 'pacote existe antes do advisory');
  tem('seguranca.md', /saída do modelo[^\n]*não confiável[^\n]*dados privados[^\n]*conteúdo externo[^\n]*canal de saída[^\n]*permissões mínimas/i, 'LLM/agente');
  tem('seguranca.md', /LGPD[^\n]*finalidade[^\n]*mínimo necessário[^\n]*sensível[^\n]*retenção[^\n]*eliminação[^\n]*titular/i, 'LGPD por campo');
  tem('seguranca.md', /^\d+\. Em qualquer log do diff[^\n]*tokens[^\n]*sessão[^\n]*senhas[^\n]*documentos[^\n]*sensíveis[^\n]*nome, e-mail e telefone mascarados/im, 'regra de logs vale para qualquer log');
  assert.doesNotMatch(ler('papeis', 'seguranca.md'), /dado pessoal novo[^\n]*Logs? sem/i, 'seguranca.md: logs fora do prefixo de dado pessoal novo');
  tem('seguranca.md', /achado de fluxo \(injeção, acesso, IDOR, SSRF[^\n]*fonte[^\n]*sink[^\n]*ausência de mitigação[^\n]*atacante[^\n]*ganha[^\n]*três linhas/i, 'três linhas para achado de fluxo');
  tem('seguranca.md', /Segredo, dependência e LGPD[^\n]*linha do problema[^\n]*advisory[^\n]*artigo da lei/i, 'segredo, dependência e LGPD: linha e fonte');
  tem('seguranca.md', /mitigação que você leu/i, 'mitigação só se lida');
  tem('seguranca.md', /anterior à mudança/i, 'falha anterior ao diff à parte');
  tem('seguranca.md', /confiança alta \(acima de 80%\) de exploração real \(ou, para LGPD, de violação concreta\)/i, 'confiança acima de 80%, também para LGPD');
  tem('seguranca.md', /salvo pedido[^\n]*DoS[^\n]*validação sem impacto provado/i, 'fora de escopo salvo pedido');
  tem('seguranca.md', /Severidade: alta = grave, sem obstáculo ou atrás de um obstáculo real; média = [^\n]*baixa = /i, 'escala alta/média/baixa do registro');
  tem('seguranca.md', /severidade \(alta\/média\/baixa\)/, 'entrega na escala do registro');
  assert.doesNotMatch(ler('papeis', 'seguranca.md'), /crítica/i, 'seguranca.md: nada de "crítica" (o registro só aceita alta|media|baixa)');
  for (const [arq, re] of [['revisor.md', /Edit|Write|Bash/], ['tester.md', /Edit|Write/], ['seguranca.md', /Edit|Write|Bash/]]) {
    const { dados } = parseFrontmatter(ler('papeis', arq));
    assert.doesNotMatch(String(dados.ferramentas), re, `${arq}: continua sem escrita`);
  }
});

test('práticas de entrega: design-web, design-mobile, Docs, DevOps e CHANGELOG', () => {
  const tem = (rel, re, o) => assert.match(ler(...rel.split('/')), re, `${rel}: ${o}`);
  const web = 'skills/design-web/SKILL.md';
  tem(web, /serviria para qualquer produto parecido[^\n]*refaça/i, 'revisar a direção');
  tem(web, /um elemento memorável[^\n]*resto quieto/i, 'um elemento memorável');
  tem(web, /primitivos[^\n]*semânticos[^\n]*componentes usam só os semânticos/i, 'primitivos x semânticos');
  tem(web, /arquivo de tokens novo[^\n]*DTCG 2025\.10[^\n]*`\$value`[^\n]*`\$type`[^\n]*já existe mantém o formato dele/, 'DTCG só no arquivo novo');
  tem(web, /WCAG 2\.2 AA/, 'WCAG 2.2 AA');
  tem(web, /≥ 24×24 px[^\n]*\(44 px em toque: AAA\/HIG\)/i, 'alvos 24 (AA) e 44 (AAA/HIG)');
  tem(web, /foco nunca fica escondido[^\n]*fixo/i, 'foco não escondido');
  tem(web, /arrastar[^\n]*alternativa por clique/i, 'alternativa ao arrastar');
  tem(web, /colar a senha[^\n]*gerenciador de senhas/i, 'autenticação acessível');
  tem(web, /não peça de novo[^\n]*já informado/i, 'sem pedir de novo');
  tem(web, /hierarquia por peso e cor[^\n]*cinza sobre fundo colorido/i, 'hierarquia por peso e cor');
  tem(web, /ao lado do campo[^\n]*específic[^\n]*próximo passo[^\n]*sem culpar[^\n]*preserv/i, 'mensagens de erro');
  tem(web, /estado vazio[^\n]*ação/i, 'estado vazio com ação');
  tem(web, /Inter\/Roboto\/Arial\/Space Grotesk[^\n]*creme com terracota[^\n]*eyebrow/i, 'lista de cara de IA');
  tem(web, /escolha o substituto/i, 'escolha o substituto');
  tem(web, /só pelo teclado/i, 'navegar só pelo teclado');
  tem(web, /algo que você acrescentou não faz falta, remova um elemento antes de entregar/i, 'remover um elemento acrescentado');
  tem(web, /4\.5:1/, 'mantém o contraste');
  assert.ok(existsSync(join(RAIZ, 'skills', 'design-web', 'NOTICE')), 'design-web: mantém o NOTICE');
  const mob = 'skills/design-mobile/SKILL.md';
  tem(mob, /Liquid Glass[^\n]*Material 3 Expressive[^\n]*componentes nativos atualizados/i, 'Liquid Glass e M3 Expressive pelos nativos');
  tem(mob, /regra[^\n]*não conferiu na página oficial/i, 'não cita regra não conferida');
  tem(mob, /checklist\.md/, 'mantém o checklist');
  const chk = 'skills/design-mobile/checklist.md';
  tem(chk, /Reduzir transparência[^\n]*Aumentar contraste[^\n]*\(iOS; no Android, contraste\/texto de alto contraste\)/i, 'transparência e contraste por plataforma');
  tem(chk, /swipe[^\n]*alternativa por toque/i, 'alternativa ao swipe');
  tem('papeis/docs.md', /Diátaxis[^\n]*tutorial[^\n]*how-to[^\n]*referência[^\n]*explicação/i, 'Diátaxis');
  tem('papeis/docs.md', /Keep a Changelog[^\n]*Não lançado[^\n]*grupos[^\n]*que o CHANGELOG do projeto já usa/i, 'Keep a Changelog com os grupos do projeto');
  tem('papeis/docs.md', /nunca cópia do git log[^\n]*breaking changes/i, 'para o usuário, com breaking changes');
  tem('papeis/docs.md', /README começa pelo problema[^\n]*instalação/i, 'README pelo problema e instalação');
  tem('papeis/docs.md', /AGENTS\.md\/CLAUDE\.md[^\n]*não descobre lendo o código[^\n]*curto/i, 'AGENTS/CLAUDE curtos');
  tem('papeis/docs.md', /llms\.txt[^\n]*existir/i, 'llms.txt quando existir');
  tem('papeis/docs.md', /rod(e|ar) o exemplo[^\n]*você não tem Bash: liste em decisões o comando exato[^\n]*Gerente rodar[^\n]*evidência que não rodou/i, 'rodar o exemplo via Gerente');
  tem('papeis/docs.md', /Edite \*\*somente\*\* arquivos de documentação[^\n]*`llms\.txt`/, 'llms.txt nos editáveis');
  const dev = 'papeis/devops.md';
  tem(dev, /SHA completo[^\n]*comentário da versão[^\n]*`git ls-remote --tags https:\/\/github\.com\/<dono>\/<repo>`[^\n]*tag do comentário[^\n]*actions\.lock/i, 'actions por SHA conferido ou lock');
  tem(dev, /digest[^\n]*providers?[^\n]*fixad/i, 'imagem por digest e providers fixados');
  tem(dev, /`permissions:`[^\n]*mínim/i, 'permissions mínimas');
  tem(dev, /`\$\{\{ \}\}` com dado controlado de fora \(`github\.event\.\*`, `github\.head_ref`, `inputs`\) em `run:` ou `script:`[^\n]*github-script[^\n]*`env:`/, 'sem dado externo em run/script');
  tem(dev, /`pull_request_target`[^\n]*checkout[^\n]*`persist-credentials: false`[^\n]*`secrets: inherit`/, 'pull_request_target, persist-credentials e secrets inherit');
  tem(dev, /OIDC[^\n]*proveniência[^\n]*plano pedir/i, 'OIDC e proveniência');
  tem(dev, /multi-stage[^\n]*não-root[^\n]*`RUN --mount=type=secret`[^\n]*docker\.sock/i, 'Dockerfile');
  tem(dev, /lockfile[^\n]*reprodutível[^\n]*`npm ci`/i, 'lockfile e instalação reprodutível');
  tem(dev, /`fmt -check`[^\n]*`validate`[^\n]*`plan`[^\n]*só contra staging[^\n]*sem credenciais reais[^\n]*bloqueios[^\n]*`\*\.tfstate`/i, 'IaC com plan só em staging');
  tem(dev, /Scripts de staging \(você escreve, não roda\)[^\n]*health check[^\n]*rollback[^\n]*expand-contract/i, 'staging: escreve, não roda');
  tem(dev, /`actionlint`[^\n]*`zizmor`[^\n]*`hadolint`[^\n]*instalad[^\n]*não instale/i, 'validadores só se instalados');
  tem(dev, /\*\*Nunca\*\* toque produção/, 'mantém o limite de produção');
  for (const arq of ['docs.md', 'devops.md']) {
    const p = ler('papeis', arq);
    assert.ok(p.startsWith('---\n'), `${arq}: frontmatter`);
    for (const s of ['## Limites', '## Entrega', '**lições usadas:**']) assert.ok(p.includes(s), `${arq}: faltou ${s}`);
  }
  const naoLancado = (ler('CHANGELOG.md').split(/^## Não lançado\s*$/m)[1] || '').split(/^## /m)[0];
  for (const [re, o] of [
    [/Regras do time/, 'Regras do time'],
    [/^- Gerente[^\n]*linha de base[^\n]*antes de pedir a aprovação do plano/m, 'Gerente: linha de base antes da aprovação'],
    [/^- Gerente[^\n]*`sensivel` não desce quando a mudança toca auth, pagamento, dados pessoais, migrations, infra ou API pública/m, 'Gerente: quando sensivel não desce'],
    [/^- Papéis escritores[^\n]*`papeis\/dev\.md`/m, 'escritores'],
    [/^- Papéis checadores[^\n]*`papeis\/revisor\.md`/m, 'checadores'],
    [/^- Designer[^\n]*`skills\/design-web`/m, 'Designer'],
    [/^- [^\n]*DevOps[^\n]*SHA completo/m, 'DevOps'],
  ]) assert.match(naoLancado, re, `CHANGELOG: "Não lançado" — ${o}`);
});
