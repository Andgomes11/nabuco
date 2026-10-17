---
name: retro
description: Retrospectiva do time nabuco - transforma os erros resolvidos de uma tarefa em casos e lições, com aprovação do usuário item a item, e propõe a higiene das lições. Use com /nabuco:retro ou $retro, ao fechar uma tarefa ou quando o usuário pedir.
---

# Retrospectiva — time nabuco

Você conduz a retrospectiva como **Gerente**. Objetivo: o time não repetir o mesmo erro.

`NABUCO` = a pasta dois níveis acima do diretório desta skill (raiz do plugin).
`C` = `node "$NABUCO/scripts/cerebro.mjs"` — rode sempre a partir da raiz do projeto.

**Nunca grave nada no cérebro sem aprovação explícita do usuário.** Os rascunhos em `retro/` podem ser escritos à vontade; `caso-add`, `licao-add`, `licao-reforcar`, `licao-editar`, `aposentar` e `promover` só depois do "ok" de cada item.

## 1. Sinais
Rode `C sinais` (tarefa ativa ou a mais recente) ou `C sinais --tarefa <nome da tarefa>` (só o nome da pasta em `.nabuco/tarefas/`, ex.: `2026-10-17-login`). A saída é JSON: `tarefa`, `criterios_falhos`, `rodadas`, `achados`, `gate_bloqueios`, `correcoes_usuario`, `licoes_usadas`, `log`, `papeis`, `transitorios`, `bug_resolvido` (true se a tarefa é do tipo `bug` e foi concluída).
- `criterios_falhos` inclui os critérios que falharam e depois passaram — é justamente o sinal que interessa (o erro foi resolvido e há prova).
- Descarte `transitorios` (rede, token, PATH, serviço fora): não viram caso nem lição. A detecção é por padrão de texto e pode errar, então nunca descarte em silêncio: liste os descartados ao usuário numa linha (ex.: "Descartei como transitórios: c2 (ETIMEDOUT), c4 (429)") — se ele disser que algum era falha real, trate-o como `criterios_falhos`.
- `bug_resolvido` true: o próprio bug corrigido é candidato a caso, mesmo sem critério falho. `papel` = o escritor (normalmente `debugger`); `sintoma` = o erro ou teste que falhava no início; `hipotese_errada`/`causa_raiz` das decisões do debugger em `progresso.md` (Decisões/Log); `correcao` = o fix; `verificacao` = o teste de regressão falhando antes e passando depois, com o comando; `turnos` se souber. Mesmas regras de aprovação item a item.
- Sem nenhum sinal (e `bug_resolvido` false): diga "nada a aprender nesta tarefa" e vá para o passo 6.

## 2. Casos (rascunho)
Para cada sinal com causa conhecida **e** verificação objetiva (comando + resultado), escreva `<pasta da tarefa>/retro/caso-N.json` (pasta = `.nabuco/tarefas/<tarefa>/`, campo `tarefa` dos sinais). Escreva o arquivo com a ferramenta de arquivo — nunca JSON na linha de comando.
```json
{ "papel": "dev", "sintoma": "TypeError: x is undefined em auth.test.mjs",
  "contexto": "src/auth.mjs, tarefa 2026-10-17-login", "hipotese_errada": "mock do token",
  "causa_raiz": "await faltando em carregarUsuario", "correcao": "await em auth.mjs:42",
  "verificacao": "npm test -- auth → 12 passed", "sinal_precoce": "promise pendente no log",
  "tags": ["async", "auth"], "turnos": 6 }
```
Obrigatórios: `papel`, `sintoma`, `causa_raiz`, `correcao`, `verificacao`. `papel` é um dos 9 funcionários ou `gerente`. Se o erro voltou apesar de uma lição que o cobria, acrescente `"recorrencia_de": "<id da lição>"`.
Depois rode `C similares --de <pasta da tarefa>/retro/caso-N.json` → `{ similares, destilar }`.

## 3. Lições (rascunho)
Se `destilar` for `true` (≥ 1 caso similar já gravado ou custo alto), proponha lição em `<pasta da tarefa>/retro/licao-N.json`. No total, 0–3 lições por funcionário envolvido, **inclui o Gerente** (classificação, plano, critérios mal feitos).
```json
{ "papel": "dev", "titulo": "Confira await em funções de I/O antes de mexer em mocks",
  "gatilho": "TypeError: undefined vindo de função async", "expectativa": "se for await faltando, o valor é uma Promise; se não, a hipótese está errada",
  "faca": "logue o tipo do valor antes de alterar mocks", "porque": "promise não aguardada chega como undefined",
  "evidencia": ["casos/dev/2026-10-x.md"], "escopo": "global" }
```
Todos os campos de texto em uma linha só. `escopo`: `global` (vale para qualquer projeto) ou `projeto` (só este). `evidencia` recebe o caminho que `C caso-add` imprimir (passo 5) e, ao destilar de ≥ 2 casos, também os caminhos dos casos que `similares` devolveu. A evidência tem de apontar para casos que existem: se o usuário descartar o caso desta tarefa mas aprovar a lição, use só os casos similares já gravados — sem nenhum, descarte a lição.
- Antes de propor, confira `C licoes --papel <papel>`: se já existe lição com o mesmo sentido, proponha `licao-reforcar` em vez de lição nova.
- **Contradição** (lição nova diz o oposto de uma existente): mostre as duas lado a lado e deixe o usuário decidir (editar a antiga, aposentar a antiga ou descartar a nova).

## 4. Aprovação item a item
Mostre **item a item** — um caso ou uma lição por vez, com o conteúdo completo — e pergunte: **aprovar / editar / mudar escopo / descartar**. Nunca aprove em lote. Aplique só o aprovado; ajuste o JSON conforme a edição.

## 5. Aplicar
- Caso aprovado: `C caso-add --de <arquivo>` → imprime `casos/<papel>/<arquivo>.md`; use esse caminho na `evidencia` das lições.
- Lição aprovada: `C licao-add --de <arquivo>` → imprime o id novo.
  - **Duplicata:** exit 1 com o id da parecida no stdout. Mostre a lição parecida e proponha `C licao-reforcar --id <id> --caso <caminho do caso>` (também com aprovação). `--forcar` só se o usuário disser que são diferentes.
  - Outro exit 1 (sem id no stdout): leia o erro. Se for o limite (o CLI recusa já com 30 ativas), rode `C licoes --papel <papel>` e proponha, item a item, fundir ou aposentar ids específicos antes de tentar de novo.
- Reforço aprovado: `C licao-reforcar --id <id> --caso <caminho do caso>`.
O CLI grava como delta e faz o commit em `~/.nabuco/` sozinho.

## 6. Higiene
Rode `C higiene` (ou `C higiene --papel <papel>`). Cada item tem `motivo`:
- `excesso` (vem com `id: null`; aparece só acima de 30) → rode `C licoes --papel <papel>`, escolha ids específicos e proponha fusão (editar uma com `C licao-editar --id <id> --de <json>`, aposentar as outras com `C aposentar --id <id> --motivo="fundida em <id>"`);
- `sem_uso` ou `ruim` → propor revisão (`licao-editar`) ou aposentadoria (`C aposentar --id <id> --motivo="<por quê>"`);
- `promover` → propor promoção a regra (hook, lint ou teste) — só se for verificável mecanicamente.
Também item a item, com aprovação. Promoção aprovada vira **nova tarefa** do time (`/nabuco:tarefa` ou `$tarefa`: "criar a regra que garante <lição>"); só depois de ela concluir com evidência rode `C promover --id <id> --regra="<onde a regra ficou>"`.

## 7. Fechar
Resuma ao usuário: casos gravados, lições criadas/reforçadas e o que ficou para higiene.
