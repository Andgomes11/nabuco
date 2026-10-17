---
name: licoes
description: Consulta e cuida das lições do time nabuco - lista lições por funcionário, mostra métricas de senioridade, edita, muda escopo, aposenta, promove a regra e roda a higiene, sempre via CLI e com aprovação do usuário. Use com /nabuco:licoes ou $licoes.
---

# Lições — time nabuco

`NABUCO` = a pasta dois níveis acima do diretório desta skill (raiz do plugin).
`C` = `node "$NABUCO/scripts/cerebro.mjs"` — rode sempre a partir da raiz do projeto.

Lições globais ficam em `~/.nabuco/licoes/<papel>.md`; as do projeto, em `.nabuco/licoes/<papel>.md`; aposentadas, em `~/.nabuco/licoes/arquivo/`. **Nunca edite esses `.md` à mão** — toda mudança passa pelo CLI (grava como delta e faz o commit em `~/.nabuco/`). Papéis: os 9 funcionários e `gerente`.

## Consultar
- Listar: `C licoes` ou `C licoes --papel <papel>` (JSON; `--todas` inclui as promovidas a regra). Mostre em tabela curta: id, título, escopo, 👍/👎, última.
- Buscar o que o time receberia: `C buscar --papel <papel> --texto="<sintoma>"`.
- Métricas de senioridade: `C metricas` ou `C metricas --papel <papel>`; mostre a tabela sem resumir. Nível com amostra < 10 é provisório.
- Casos gravados: `C casos --papel <papel>`.

## Mudar (só sob pedido do usuário e com confirmação)
Antes de rodar, mostre o que vai mudar e peça "ok".
- Editar: escreva um JSON só com os campos a mudar (`titulo`, `gatilho`, `expectativa`, `faca`, `porque`, `evidencia`), em arquivo, e rode `C licao-editar --id <id> --de <arquivo>`.
- Mudar escopo: `C licao-editar --id <id> --escopo global|projeto` (o id pode mudar; o CLI imprime o novo).
- Aposentar: `C aposentar --id <id> --motivo="<por quê>"`.
- Promover a regra: a regra (hook, lint ou teste) é criada antes, como tarefa normal do time (`/nabuco:tarefa` ou `$tarefa`); concluída com evidência, rode `C promover --id <id> --regra="<onde a regra ficou>"`.

## Higiene
Rode `C higiene` (ou `--papel <papel>`) e proponha item a item: `excesso` → fundir; `sem_uso`/`ruim` → revisar ou aposentar; `promover` → promoção a regra (se verificável mecanicamente). Aplique só o aprovado.
