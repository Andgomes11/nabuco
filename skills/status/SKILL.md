---
name: status
description: Mostra o estado do time nabuco - modelo e effort de cada funcionário em Claude e Codex, problemas de configuração, instalação e a tarefa ativa do projeto. Use com /nabuco:status ou $status.
---

# Status do nabuco

`NABUCO` = a pasta dois níveis acima do diretório desta skill.

Rode, na raiz do projeto, `node "$NABUCO/scripts/status.mjs"` e mostre a saída ao usuário sem resumir a tabela.
Se houver linhas com ⚠️, explique em uma frase cada uma e o comando que resolve.
