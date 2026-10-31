---
name: relatorio
description: Relatório do time nabuco - resume em Markdown o que o time fez num período (tarefas, checadores, escapes, cérebro, funcionários com tempo e tokens, qualidade dos dados) a partir do histórico de eventos. Só lê; grava o relatório só com o ok do usuário e nunca o envia a lugar nenhum. Use com /nabuco:relatorio ou $relatorio (opcional: período e projeto).
---

# Relatório do nabuco

`NABUCO` = a pasta dois níveis acima do diretório desta skill.

1. Na raiz do projeto, rode `node "$NABUCO/scripts/relatorio.mjs"` (padrão: últimos 7 dias, projeto atual), traduzindo o pedido do usuário em opções:
   - período (só um): `--dias N`, `--desde AAAA-MM-DD [--ate AAAA-MM-DD]` ou `--desde-release` (desde a última tag semver ou release liberada);
   - escopo: `--projeto todos` para todos os projetos (padrão `atual`);
   - `--json` só se o usuário pedir os dados crus.
   Saída 0 = ok, 2 = uso incorreto (mostre a mensagem `nabuco: ...` e pare).
2. Mostre o relatório como saiu, sem resumir as tabelas. Depois, destaque em até 3 frases o que chama atenção (achados alta, escapes, tarefas em andamento, critérios que falharam).
3. Leia a seção "Qualidade dos dados" junto: "Nenhum evento no período" quer dizer que **nada foi conferido**, nunca que deu tudo certo; diga isso ao usuário.
   Execuções sem papel são agentes fora do nabuco (ignoradas de propósito); tokens "não medido" são do Codex ou de eventos antigos.
4. Ofereça gravar: com o ok do usuário, rode de novo com as mesmas opções e `--gravar` e informe o caminho impresso
   (`.nabuco/relatorios/<desde>_<ate>.md` no projeto; `~/.nabuco/relatorios/` com `--projeto todos`).

Regras:
- Nunca envie, publique, cole ou compartilhe o relatório (e-mail, Slack, issue, PR, documento, artifact) sem o usuário pedir explicitamente; quem compartilha é o usuário.
- Não altere o histórico nem nenhum outro arquivo: o script só lê, e com `--gravar` grava apenas o relatório.
- O relatório não traz caminhos da máquina nem conteúdo de transcrições; não acrescente nada disso ao mostrar.
- Se o ambiente bloquear o comando (sandbox, permissão), relate a falha como está; não contorne.
