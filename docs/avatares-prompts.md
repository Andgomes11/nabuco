# Prompts dos avatares — time Matrix

Salve como `assets/avatares/<papel>-<nivel>.jpg`, 512×512 JPEG (ex: `debugger-1.jpg`). Níveis: 1 Júnior · 2 Pleno · 3 Sênior · 4 Especialista.

## Como converter

Qualquer editor de imagens serve (exportar 512×512, JPEG, ≤ 200 KB). No Windows, no PowerShell, dá para redimensionar com `System.Drawing` (`Bitmap` → `Graphics.DrawImage` em 512×512 → `Save` com `ImageFormat.Jpeg`).

## Estilo base (cole SEMPRE no início)

```
Stylized digital portrait, head and shoulders, centered, facing slightly left,
cinematic Matrix (1999) aesthetic, dark background with subtle falling green
code glyphs, strong green rim light, deep shadows, high contrast, semi-realistic
illustration, clean edges, square 1:1, no text, no logo
```

Dicas: gere os 4 níveis do mesmo funcionário na mesma conversa ("same character, same style, next level").
No Midjourney use `--sref` (estilo) e `--cref` (personagem) a partir da 1ª imagem aprovada.

## Evolução comum a todos (acrescente ao final, por nível)

| Nível | Acréscimo |
|---|---|
| 1 Júnior | `simple clothes, neural cable plugged into back of the head, dim green light` |
| 2 Pleno | `jacket, more confident posture, medium green glow` |
| 3 Sênior | `long black coat with high collar, narrow black sunglasses, bright green rim light` |
| 4 Especialista | `sunglasses reflecting green code, faint aura of glowing code around silhouette, white-green highlights` |

## Identidade de cada funcionário (entre o estilo base e o nível)

| Papel | Arquivo | Identidade |
|---|---|---|
| Gerente | `gerente-N.jpg` | `calm captain of a hovercraft crew, Morpheus-like authority, small round pince-nez glasses, holding a glowing holographic task board` |
| Dev | `dev-N.jpg` | `focused coder, hands near a floating green keyboard of light, short hair, determined look` |
| Debugger | `debugger-N.jpg` | `sharp investigator, glowing magnifying-glass reflection in eyes, one eyebrow raised, examining a floating red error glyph` |
| Designer | `designer-N.jpg` | `serene Oracle-like creative, warm kitchen-light accent mixed with green, holding a floating color palette made of light` |
| DevOps | `devops-N.jpg` | `engineer of the ship, mechanic gloves, cables and server lights behind, operator headset` |
| Docs | `docs-N.jpg` | `archivist / keymaker, small round glasses, ring of glowing keys and floating pages of code` |
| Arquiteto | `arquiteto-N.jpg` | `elderly distinguished Architect, white beard, light grey suit, wall of monitors behind, analytical gaze` |
| Revisor | `revisor-N.jpg` | `meticulous inspector, scanning beam over floating lines of code, stern but fair expression` |
| Segurança | `seguranca-N.jpg` | `Agent-like security sentinel, dark suit, earpiece with coiled wire, firewall grid shimmering behind` |
| Tester | `tester-N.jpg` | `martial-arts sparring trainer in a dojo construct, testing stance, green checkmarks floating like sparks` |

Observação: o Arquiteto é "idoso" por identidade; nos níveis, mude só roupa/luz/aura, não a idade.
