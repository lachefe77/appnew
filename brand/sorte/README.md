# Sorte — identidade visual

Marca para a plataforma de apostas: quatro naipes de baralho (espada, copas, paus e ouros)
montados em grade 2x2 como um trevo de quatro folhas, com o ouros em dourado e uma faísca
de sorte. A paleta segue a do app (roxo `#8b5cf6` + fundo `#03030e`), então o logo encaixa
direto no popup da extensão, no site e nas redes.

## Arquivos

Todos os SVGs são vetor puro — o wordmark já está convertido em curvas, então não depende
de fonte instalada e pode ser ampliado sem perder qualidade (banner, camiseta, outdoor).

| Arquivo | Uso |
| --- | --- |
| `sorte-logo-dark.svg` | Logo horizontal principal (fundo escuro) |
| `sorte-logo-light.svg` | Logo horizontal para fundo claro / impressão |
| `sorte-logo-dark-transparent.svg` | Horizontal sem fundo, para aplicar sobre qualquer cor escura |
| `sorte-logo-light-transparent.svg` | Horizontal sem fundo, para fundos claros |
| `sorte-logo-stacked-dark.svg` | Versão vertical (fundo escuro), boa para espaços quadrados |
| `sorte-logo-stacked-light.svg` | Versão vertical (fundo claro) |
| `sorte-symbol.svg` | Só o símbolo, com moldura arredondada |
| `sorte-symbol-plain.svg` | Só os naipes, sem moldura (favicon, marca d'água) |
| `sorte-symbol-compact.svg` | Naipes ampliados — versão que se mantém legível em 16–48 px |
| `sorte-avatar.svg` | Avatar 1:1 para Instagram, Telegram, WhatsApp, Discord |
| `png/` | Exportações PNG prontas (logos em 1600 px, ícones de 16 a 1024 px, avatar 1024 px) |
| `conceitos/` | Três estudos iniciais gerados para comparação de estilo |

Ícones da extensão: use `png/sorte-icon-16.png`, `-32`, `-48` e `-128` (é exatamente o que
o `manifest.json` do Chrome pede).

## Paleta

| Cor | Hex | Onde usar |
| --- | --- | --- |
| Roxo claro | `#a78bfa` | Início do gradiente dos naipes |
| Roxo | `#8b5cf6` | Cor de destaque da marca (igual ao `--accent` do app) |
| Roxo profundo | `#6d28d9` | Fim do gradiente, moldura |
| Dourado | `#f59e0b` | Naipe de ouros, faísca, detalhes premium |
| Dourado claro | `#fcd34d` | Brilho do gradiente dourado |
| Preto | `#03030e` | Fundo (igual ao `--bg` do app) |
| Branco gelo | `#f4f4f7` | Wordmark no escuro |
| Grafite | `#0b0b14` | Wordmark no claro |

Tipografia: **Montserrat ExtraBold** no wordmark (tracking levemente aberto) e
**Montserrat SemiBold** na assinatura `APOSTAS INTELIGENTES`, com tracking largo.

## Boas práticas

- Respiro mínimo em volta do logo: a altura do símbolo dividida por 2.
- Abaixo de 120 px de largura, troque o horizontal pelo símbolo (`sorte-symbol.svg`).
- Não recolorir os naipes fora da paleta, não aplicar sombra, não distorcer a proporção.
- Em fundo colorido, use as versões `-transparent`.

## Regerar os arquivos

```bash
pip install fonttools cairosvg
python3 brand/sorte/tools/build_logo.py
```

O script baixa a fonte Montserrat (OFL) para `tools/.cache/`, converte o texto em curvas e
reescreve todos os SVGs e PNGs. Para mudar a assinatura, o tamanho do símbolo ou as cores,
edite as constantes no topo de `tools/build_logo.py` e rode de novo.
