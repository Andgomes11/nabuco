---
name: fila
description: Fila de pedidos do time nabuco - o usuário enfileira vários pedidos de uma vez e o Gerente executa um após o outro, cada um como uma tarefa normal (classificação, plano, aprovações, checadores e gate), mostrando a fila e o andamento. Use com /nabuco:fila ou $fila (com os pedidos para montar a fila; sem argumentos, mostra a fila e segue para o próximo item; fila parada só segue com o ok do usuário).
---

# Fila — time nabuco

`NABUCO` = a pasta dois níveis acima do diretório desta skill.
`F` = `node "$NABUCO/scripts/fila.mjs"` · `T` = `node "$NABUCO/scripts/tarefa.mjs"` — rode sempre a partir da raiz do projeto.
Saída do `F`: 0 ok, 1 regra violada (ex.: `fila.json` ilegível — mostre a mensagem e pare; nunca apague nem reescreva o arquivo sem ok do usuário), 2 uso incorreto.

Cada item vira uma tarefa comum: você é o Gerente e segue `$NABUCO/skills/tarefa/SKILL.md` item a item. A fila só decide a ordem.

## 1. Montar a fila (com o usuário presente)
- Separe a mensagem do usuário em pedidos independentes. Para cada um, faça a triagem **agora**, enquanto ele está aqui: pedido ambíguo, grande demais ou que depende de decisão dele → pergunte antes de enfileirar (uma pergunta por vez). Pedidos repetidos ou que se sobrepõem → proponha juntar.
- Enfileire na ordem combinada: `F add --pedido="<pedido claro, com as respostas da triagem>"` (um por item).
- Pergunte uma vez: "quer um commit ao concluir cada item?" e grave **sempre** a resposta: sim → `F config --commit-por-item sim` (isso conta como pedido explícito de commit a cada item concluído); não → `F config --commit-por-item nao` (acumula sem commit). A escolha vale só para esta fila: `F add` numa fila sem item pendente nem em andamento começa uma fila nova e volta para "não".
- Mostre `F listar` e confirme a ordem. Ajustes: `F mover --id <id> --para <posição>` (entre os pendentes; 1 = próximo) e `F remover --id <id>`.

## 2. Executar — um item por vez
- Rode `T status`. Havendo tarefa ativa, termine-a primeiro (skill tarefa §0) — uma tarefa ativa por vez; nada é planejado adiantado.
- `F proximo` mostra o próximo item (ou a parada, veja abaixo). Anuncie `→ fila: <id> — <pedido>` e siga a skill tarefa a partir do §1 com esse pedido, criando a tarefa com `T nova --slug <curto> --tamanho <t> --tipo <tipo> --fila <id>` (marca o item em andamento).
- A fila **nunca pula a aprovação**: em `media`/`sensivel` você para no plano e em cada checkpoint, como sempre. Só `trivial` encadeia sozinha até o próximo item.
- Ao concluir (`T concluir` marca o item como feito), feche o item pela skill tarefa §7, mostre `F listar` e siga para o próximo.
- Item abandonado (`T abandonar`, só com ok do usuário) ou falha (critério que não passa, divergência que sobrou depois das 2 rodadas, bloqueio do ambiente): a fila **para**. Mostre `F listar` e pergunte ao usuário se segue para o próximo item, ajusta a fila ou encerra.
- `T abandonar` de um item grava a fila como **parada** (`F listar` e `F proximo` mostram o motivo; `F proximo` não devolve item para rodar e `T nova --fila` recusa). Fila parada: mostre o motivo e pergunte; só quando o usuário mandar seguir rode `F retomar` e continue. Nunca rode `F retomar` por conta própria.
- Aviso de `T concluir`/`T abandonar` dizendo que não conseguiu atualizar a fila: mostre ao usuário e pare antes do próximo item. O item fica em andamento sem tarefa ativa e a fila conta como parada ("ficou em andamento sem tarefa ativa"); `F retomar`, com o ok do usuário, o marca como abandonado.

## 3. Fim da fila
- Sem item pendente (`F proximo` diz "nenhum item pendente"): resumo curto de cada item (feito/abandonado, tarefa, critérios) e dos commits feitos, se houve.
- Ofereça a retrospectiva **uma vez**, no fim da fila (não a cada item), listando as tarefas com falhas (critério que falhou, achado alto ou médio, rodada de correção): `/nabuco:retro` no Claude Code, `$retro` no Codex.

## Regras
- `commit_por_item` true (escolhido nesta fila): commit ao concluir cada item, só com os arquivos daquele item. Depois do `T concluir`, `T arquivos-novos --tarefa <nome>` (a pasta da tarefa do item) lista os arquivos "para commit" (rastreados alterados desde a `base` + não rastreados novos): `git add -- <arquivos>` só com eles, nunca `git add -A` nem `git add .`. Lista não confiável (sem `base` ou sem os não rastreados de quando a tarefa nasceu) ou não rastreado de antes alterado no item: mostre o que há e pergunte ao usuário quais arquivos entram antes de commitar. Sem `commit_por_item`, nada de commit.
- `fila.json` só muda pela CLI (`F` e `T`) — nunca à mão.
- Ver a fila sem executar: `F listar`. A fila também aparece em `/nabuco:status` (`$status`) e no painel.
