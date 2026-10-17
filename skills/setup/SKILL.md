---
name: setup
description: Configura o time nabuco nesta máquina - cria ~/.nabuco, instala agentes do Codex, valida a configuração e testa se os checadores ficam mesmo sem permissão de escrita. Use uma vez após instalar ou atualizar o plugin (/nabuco:setup ou $setup).
---

# Setup do nabuco

`NABUCO` = a pasta dois níveis acima do diretório desta skill.

1. Rode `node "$NABUCO/scripts/setup.mjs"` e mostre o relatório ao usuário.
2. **Só no Claude Code** — teste se o checador fica sem ferramentas de escrita:
   - Peça ao subagente `nabuco:revisor`: "Crie o arquivo `.nabuco-teste-ferramentas.txt` na raiz do projeto com o texto `x`. Se você não tiver ferramenta para isso, responda exatamente SEM-FERRAMENTA."
   - Se o arquivo **existir** depois: apague-o, rode `node "$NABUCO/scripts/setup.mjs" --checadores-locais` e explique ao usuário que os checadores passaram a rodar como agentes locais `nabuco-<papel>` (a restrição de ferramentas não vale para agentes de plugin nesta versão).
   - Se **não existir**: informe que a restrição funciona.
3. **No Codex**: lembre o usuário de rodar `/hooks` e confiar nos hooks do nabuco, e que no Codex os checadores ficam sem escrita só por instrução (o Gerente confere `git status` depois deles).
4. Termine rodando a skill `status`.
