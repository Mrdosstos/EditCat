# EditCat

Editor de vídeo que roda no navegador, no celular ou no computador. Não precisa instalar nada e os arquivos não saem do seu aparelho.

## O que faz

- **Linha do tempo com três faixas**: vídeo/foto, texto e áudio. Arraste para reordenar, puxe as bordas para aparar, dê zoom com os botões ou com Ctrl + roda do mouse.
- **Cortes**: dividir no cursor, duplicar, excluir, desfazer e refazer (até 100 passos).
- **Clipes**: velocidade de 0,25× a 4×, volume até 200%, 8 filtros, brilho, contraste e saturação, enquadramento (preencher, encaixar, fundo desfocado), zoom lento em fotos e transições de entrada (dissolver, deslizar, zoom, cortina).
- **Texto**: 5 fontes, cor, estilos (sombra, faixa, contorno) e animações (surgir, saltar, subir, digitar). Arraste o texto direto na prévia.
- **Áudio**: música em faixa própria com volume, entrada e saída suaves, forma de onda na linha do tempo.
- **Formatos**: 9:16, 16:9, 1:1 e 4:5.
- **Exportação**: MP4 (ou WebM, conforme o navegador) em 720p ou 1080p, 30 ou 60 fps, com imagem e som.
- **Salvamento automático** no próprio navegador (IndexedDB), inclusive dos arquivos importados.

## Atalhos

| Tecla | Ação |
| --- | --- |
| Espaço | Reproduzir ou pausar |
| S | Dividir no cursor |
| D | Duplicar seleção |
| Delete | Excluir seleção |
| ← → | Andar um quadro (Shift: um segundo) |
| Ctrl Z / Ctrl Shift Z | Desfazer / refazer |

## Estrutura

```
src/core.js      lógica de edição pura (sem DOM), usada pelo app e pelos testes
src/app.html     interface, renderização no canvas, áudio e exportação
scripts/build.mjs junta os dois em dist/
dist/editcat.html    arquivo único pronto para abrir ou hospedar
dist/index.html  mesma página sem o esqueleto do documento (usada no claude.ai)
tests/unit/      testes da lógica (node:test)
tests/e2e/       testes no navegador (Playwright + Chromium)
```

## Rodar

```bash
npm run build
```

Abra `dist/editcat.html` no navegador. Para hospedar, basta publicar esse arquivo (GitHub Pages, por exemplo).

## Testes

```bash
npm test
```

Roda os testes unitários e depois os de navegador. Os de navegador precisam do Playwright com Chromium e do `ffmpeg` (usado para gerar um vídeo, uma foto e uma música de teste e para conferir que o arquivo exportado tem faixas de vídeo e áudio).

Casos cobertos:

- Unitários (21): código de tempo, duração com velocidade, encadeamento dos clipes, clipe sob o cursor, divisão de vídeo/texto/áudio, duplicar e excluir, reordenação estável, aparar com limites, ímã nas bordas, empilhamento de faixas, ganho com fades, filtros, tamanho do quadro por formato, animações de texto, transições, nome do arquivo exportado, tipo de mídia, limpeza de mídia ausente, histórico de desfazer.
- Navegador (10): abre o exemplo sem erros e desenha a prévia; reproduzir/pausar e Espaço; dividir, desfazer e refazer; filtro, transição, ajustes e Delete; adicionar, editar e arrastar texto; troca de formato; importação de vídeo, foto e música; projeto salvo após recarregar e "Novo projeto" com confirmação; exportação com imagem e som e download; layout de celular sem rolagem lateral.

## Limites conhecidos

- A exportação acontece em tempo real: um vídeo de 1 minuto leva cerca de 1 minuto. Deixe a aba aberta.
- Formatos que o navegador não decodifica (HEVC no Chrome, por exemplo) não podem ser importados.
- O projeto fica salvo só naquele navegador.
