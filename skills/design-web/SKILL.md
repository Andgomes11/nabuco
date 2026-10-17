---
name: design-web
description: Direção de design para interfaces web com qualidade de produto - tokens antes do código, estados completos, acessibilidade e autocrítica com screenshot, evitando a aparência genérica de interface gerada por IA. Use ao criar ou alterar telas, componentes ou estilos web.
---

# design-web

## 1. Contexto primeiro
- Quem usa, para quê, em que dispositivo? Qual o tom (sóbrio, lúdico, técnico, editorial)?
- **Se o projeto já tem design system/tema/tokens, eles mandam.** Reuse componentes existentes; não crie variações paralelas.

## 2. Direção estética explícita
Escreva em 2–3 linhas a direção escolhida (referências, tipografia, paleta, densidade) antes de codar. Uma direção clara e coerente vale mais que efeitos.

## 3. Tokens antes do código
Defina como variáveis (CSS custom properties ou tema do framework): cores (com pares texto/fundo), escala tipográfica, espaçamento (escala fixa, ex. 4/8), raios, sombras, durações de animação. Nada de valores soltos espalhados.

## 4. Implementação
- Estados: padrão, hover, foco visível, ativo, desabilitado, carregando, vazio, erro.
- Responsivo do menor ao maior breakpoint; sem rolagem horizontal; alvos de toque ≥ 44px em telas de toque.
- HTML semântico (botão é `button`, link é `a`), labels em formulários, `alt` útil.
- Contraste mínimo 4.5:1 para texto normal (3:1 para texto grande e componentes de UI).
- Respeite `prefers-reduced-motion` e `prefers-color-scheme` quando houver tema escuro.

## 5. Evite a "cara de IA"
Gradiente roxo-azul genérico, emojis no lugar de ícones, todos os cards iguais e centralizados, sombras pesadas em tudo, texto de marketing vazio, ícones de bibliotecas misturadas, bordas arredondadas exageradas sem critério.

## 6. Ferramentas opcionais (use se estiverem disponíveis na sessão)
- Plugin Figma (design → código, código → design).
- `ui-ux-pro-max` (base de estilos, paletas e regras por setor).
- `chrome-devtools-mcp:a11y-debugging` e screenshots do Chrome DevTools.

## Autocrítica
Antes de entregar, gere screenshot (desktop e mobile) e confira:
1. A hierarquia visual leva o olho ao que importa primeiro?
2. Espaçamentos e alinhamentos seguem a escala de tokens?
3. Todos os estados existem e foram vistos?
4. Contraste e foco visível passam?
5. Parece com o resto do produto (ou com a direção escolhida)?
Corrija o que falhar e só então entregue, anexando os screenshots como evidência.
