---
name: release
description: Auditor de release do time nabuco - antes de uma versão, confere desde a release anterior as tarefas, as versões dos manifestos, os comandos de verificação e o CHANGELOG.md, e só libera com evidência de cada item. Nunca cria tag, commit, push nem publica. Use com /nabuco:release ou $release.
---

# Release do nabuco

`NABUCO` = a pasta dois níveis acima do diretório desta skill.

1. Rode, na raiz do projeto, `node "$NABUCO/scripts/release.mjs"` (acrescente `--versao X.Y.Z` se o usuário disse a versão).
   Saída 0 = liberada, 1 = reprovada, 2 = uso incorreto (mostre a mensagem `nabuco: ...` e pare).
   Se a mensagem disser que a versão já foi liberada, nenhum relatório novo foi gravado: explique que é preciso subir a versão.
2. Mostre o resumo da saída e o relatório gravado em `.nabuco/releases/<versao>.md` sem resumir a tabela.
3. Se reprovada, explique cada item ❌ em uma frase: o que falhou, a prova (comando ou arquivo) e o que resolveria.
   Itens ⚠️ (tarefa abandonada, nenhum comando configurado) são avisos: cite, mas não bloqueiam.
   Ofereça abrir uma tarefa para corrigir (`/nabuco:tarefa <descrição>` no Claude Code, `$tarefa <descrição>` no Codex).
4. Se liberada, diga que a release pode seguir e que tag, commit, push e publicação ficam com o usuário.

Regras:
- Não altere nada sozinho: nem manifestos, nem CHANGELOG.md, nem tarefas. O script só grava o relatório.
- Nunca crie tag, commit, push nem publique pacote, mesmo com a release liberada.
- Se o ambiente bloquear um comando (sandbox, permissão), relate a falha como está; não contorne.
- Comandos a rodar ficam em `.nabuco/release.json` (`{"comandos": ["npm test", "npm run lint"]}`); sem ele, `npm test` se o `package.json` tiver script `test`.
