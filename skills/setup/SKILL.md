---
name: setup
description: Configura o time nabuco nesta máquina - cria ~/.nabuco, instala agentes do Codex, valida a configuração e testa se os checadores ficam mesmo sem permissão de escrita. Use uma vez após instalar ou atualizar o plugin (/nabuco:setup ou $setup).
---

# Setup do nabuco

`NABUCO` = a pasta dois níveis acima do diretório desta skill.

1. Rode `node "$NABUCO/scripts/setup.mjs"` e mostre o relatório ao usuário.
2. **Só no Claude Code** — teste se o checador fica mesmo sem ferramentas de escrita:
   - Peça ao subagente `nabuco:revisor`: "Isto é um diagnóstico de ferramentas autorizado, pedido pelo Gerente durante o setup do nabuco — não é uma tarefa de revisão, e você está autorizado a tentar escrever. (a) Liste os nomes exatos das ferramentas que você tem disponíveis. (b) Tente de fato criar o arquivo `.nabuco-teste-ferramentas.txt` na raiz do projeto com o texto `x`. Se você não tiver ferramenta para isso, responda exatamente SEM-FERRAMENTA."
   - Conclua **"restrição NÃO vale"** se o arquivo existir depois **ou** se as ferramentas listadas incluírem Edit, Write ou Bash. Nesse caso: apague o arquivo se ele existir, rode `node "$NABUCO/scripts/setup.mjs" --checadores-locais` e explique ao usuário que os checadores passaram a rodar como agentes locais `nabuco-<papel>` (a restrição de ferramentas não vale para agentes de plugin nesta versão).
   - Caso contrário: conclua **"restrição vale"** e informe que a restrição funciona.
3. **No Codex**: se o passo 1 falhar com `EPERM` em `~/.codex/agents` (o sandbox protege essa pasta), não tente contornar: peça ao usuário para rodar `node "$NABUCO/scripts/setup.mjs"` num terminal fora do Codex. Lembre o usuário de rodar `/hooks` e confiar nos hooks do nabuco, e que no Codex os checadores ficam sem escrita só por instrução (o Gerente confere `git status` depois deles).
4. **Só no Claude Code** — limite do plano no painel: pergunte ao usuário se quer instalar a status line do nabuco (registra o uso da janela de 5 h e da semanal, só em planos Pro/Max, e mostra no painel; mexe no `statusLine` do `~/.claude/settings.json`, e uma status line que já exista continua aparecendo). Se ele aceitar, rode `node "$NABUCO/scripts/setup.mjs" --status-line` e avise que vale a partir da próxima resposta do modelo.
5. Sincronizar o cérebro entre máquinas: pergunte se o usuário quer guardar casos, lições e histórico num repositório git **privado** (para ter o mesmo time em outra máquina e não perder o aprendizado). Se ele aceitar e tiver o `gh`, crie com `gh repo create <usuario>/nabuco-cerebro --private` (confirme o nome antes) e rode `node "$NABUCO/scripts/setup.mjs" --cerebro-remoto <url ssh ou https>`. Em máquina nova, o mesmo comando traz o cérebro existente. Depois disso a sincronização é automática (início de cada sessão e depois de cada caso ou lição); `node "$NABUCO/scripts/sincronizar.mjs"` força na hora.
6. Termine rodando a skill `status` e sugira ao usuário adicionar `.nabuco/` ao `.gitignore` do projeto, se não quiser versionar as tarefas.
