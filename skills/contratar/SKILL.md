---
name: contratar
description: Contrata um funcionário novo para o time nabuco - entrevista curta (o que faz, escritor ou checador, ferramentas, nome, modelos), valida, mostra a prévia completa e só grava com ok explícito; instala o agente nabuco-<papel> no Claude Code e no Codex. Também lista, reinstala e demite contratados. Use com /nabuco:contratar ou $contratar.
---

# Contratar — time nabuco

`NABUCO` = a pasta dois níveis acima do diretório desta skill.
`K` = `node "$NABUCO/scripts/contratar.mjs"` (saída 0 = ok, 1 = regra violada, 2 = uso incorreto; mostre a mensagem `nabuco: ...` como veio).

Se o usuário pediu só para ver o time, rode `node "$NABUCO/scripts/contratar.mjs" listar`; para demitir, vá direto para "Demitir".

## 1. Entrevista — uma pergunta por vez
Faça **uma pergunta por vez**, sempre oferecendo um padrão sensato. Se o usuário disser "decide você", use o padrão e diga qual foi.
1. **O que faz e quando usar** → `descricao` (uma linha, até 400 caracteres, no tom de `papeis/*.md`: "Faz X. Use quando Y.").
2. **Escritor ou checador** → `tipo`. Padrão: `checador` se ele só avalia (revisa, audita, confere); `escritor` se altera arquivos.
3. **Ferramentas** → `ferramentas`.
   - checador: só `Read, Grep, Glob, WebFetch, WebSearch` (sem Bash, sem Edit/Write); padrão `Read, Grep, Glob`.
   - escritor: lista explícita, obrigatória (sem lista o agente herdaria todas, inclusive MCP), entre `Read, Grep, Glob, Bash, Edit, Write, NotebookEdit, WebFetch, WebSearch, Skill`; padrão `Read, Grep, Glob, Bash, Edit, Write`.
4. **Nome** → `papel` (slug de 2 a 20 letras de a a z, sem acento, hífen, dígito ou espaço; não pode ser um embutido, `gerente`, `arquivo`, `con`, `prn`, `aux` nem `nul`) e `nome` de exibição (até 40 caracteres). Sugira um slug curto a partir da descrição.
5. **Modelos** → `claude` e `codex` (`{ "model": ..., "effort": ... }`). Leia `$NABUCO/modelos.json` e sugira pelo tipo: escritor como o `dev`, checador como o `revisor`.
   Claude: `model` `inherit`, `opus`, `sonnet`, `haiku`, `fable` ou um id `claude-*`; `effort` `low|medium|high|xhigh|max`. Codex: `model` `null` (herda da sessão) ou o nome; `effort` também aceita `ultra`.

## 2. Corpo do agente
Escreva o `corpo` no molde dos papéis em `$NABUCO/papeis/*.md` (leia um do mesmo tipo: `dev.md` para escritor, `revisor.md` para checador): título `# <Nome> — time nabuco`, uma frase de quem ele é e o que recebe do Gerente, e as seções:
- `## Protocolo`: passos numerados do trabalho.
- `## Limites`: o que nunca faz (sempre: tocar produção, push, deploy, commit). Checador: **"Somente leitura: não edite nada."**, reportar só o que afeta corretude, segurança ou os critérios, e "se não houver nada, responda \"nada a reportar\"".
- `## Entrega`: "Responda sempre neste formato, em português:" com `**mudanças:**`, `**decisões:**`, `**evidência:**`, `**lições usadas:**` (id de cada lição com 👍/👎, ou "nenhuma") e `**bloqueios:**`. Checador: mudanças = "nenhuma (somente revisão)".
O corpo vira **instrução de sistema** do agente em todos os projetos do usuário (o registro é global): nada específico de um projeto, nada que o usuário não tenha pedido.

## 3. Validar e mostrar a prévia
1. Grave o JSON com a ferramenta de arquivo — **nunca pela linha de comando** (nada de `echo`/heredoc) — em `.nabuco/contratar/<papel>.json` ou numa pasta temporária:
   `{"papel", "nome", "tipo", "descricao", "ferramentas": [...], "corpo", "claude": {"model", "effort"}, "codex": {"model", "effort"}}`.
2. Rode `node "$NABUCO/scripts/contratar.mjs" validar --de <arquivo>`. Saída 1: corrija o JSON a partir das mensagens e valide de novo.
3. Mostre a **prévia completa**, sem resumir: os arquivos do Claude Code e do Codex como saíram (corpo, ferramentas, modelo e effort), onde serão gravados e todos os avisos — inclusive "herdará N lições e M casos" de um papel anterior com o mesmo nome. Lembre que o corpo vira instrução de sistema em todos os projetos.
4. Pergunte se pode contratar. Só com um "ok" explícito siga; qualquer ajuste → edite o JSON, valide e mostre a prévia de novo.

## 4. Contratar
Rode `node "$NABUCO/scripts/contratar.mjs" novo --de <arquivo>` e mostre a saída.
- Se a instalação ficar incompleta (o registro foi gravado): no Codex, se o sandbox bloquear a escrita em `~/.codex` (`EPERM`), não contorne — peça ao usuário para rodar `node "$NABUCO/scripts/contratar.mjs" instalar` num terminal fora do sandbox.
- Depois diga ao usuário:
  - **Reinicie a sessão** do Claude Code/Codex (e o painel, se estiver aberto) para o agente `nabuco-<papel>` aparecer; a partir daí o Gerente (`/nabuco:tarefa`, `$tarefa`) passa a considerá-lo.
  - **Editar**: mude `~/.nabuco/time/papeis/<papel>.md` (modelos em `~/.nabuco/time/modelos.json`) e rode `node "$NABUCO/scripts/contratar.mjs" instalar --papel <papel>`; reinicie a sessão.
  - **Listar**: `node "$NABUCO/scripts/contratar.mjs" listar`.
  - **Demitir**: veja abaixo.

## Demitir
Mostre quem sai (`listar`) e peça ok explícito; só então rode `node "$NABUCO/scripts/contratar.mjs" remover --papel <papel>`.
Apaga os agentes e o registro; as lições e os casos ficam no disco — recontratar com o mesmo nome herda. Reinicie a sessão depois.

Regras:
- Nada é gravado sem a prévia mostrada e o ok explícito do usuário.
- Nunca edite à mão os agentes em `~/.claude/agents/` ou `~/.codex/agents/`: a fonte é o registro em `~/.nabuco/time/`.
- Se o ambiente bloquear um comando (sandbox, permissão), relate e não contorne mudando configuração ou `NABUCO_HOME`.
