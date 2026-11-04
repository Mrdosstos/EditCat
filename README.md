# EditCat

Editor de vídeo que roda no navegador, no celular ou no computador. Não precisa instalar nada e os arquivos não saem do seu aparelho.

## O que faz

**Edição**
- Linha do tempo com cinco faixas: legenda, texto, camada, vídeo e áudio. Arraste para mover, puxe as bordas para aparar, ímã nas bordas, no cursor e nas batidas.
- Dividir, duplicar, excluir, desfazer e refazer (até 100 passos).
- Velocidade de 0,25× a 4×, 8 filtros, brilho, contraste e saturação, enquadramento (preencher, encaixar, fundo desfocado), zoom lento em fotos, transições de entrada.
- **Camadas** (vídeo dentro do vídeo) com 7 modos de mistura, **chroma key** (tela verde), **máscaras** (círculo, retângulo, linear, com suavidade e inversão).
- **Quadros-chave** para posição, escala, rotação e opacidade, em clipes e camadas.
- **Congelar quadro**, **inverter clipe**, espelhar, girar.
- **Desfoque e mosaico** para esconder rostos, placas ou telas (animáveis com quadros-chave).

**Cortes inteligentes**
- **Remover silêncios**: corta as pausas dos clipes de vídeo pela análise do som.
- **Cortar no ritmo**: marca as batidas da música e faz cada clipe terminar numa batida.

**Legendas**
- **Legendas automáticas** com o tempo de cada palavra, usando um modelo de reconhecimento de fala (Whisper) que roda no próprio navegador.
- **Roteiro para legendas**: cola o texto e o EditCat encaixa as frases nos trechos com fala.
- Estilo único para todas (fonte, tamanho, cor, contorno/sombra/caixa, posição, maiúsculas) e destaque da palavra falada (karaokê).

**Áudio**
- Faixa de áudio com volume, entrada e saída suaves e forma de onda; cada áudio é marcado como música, voz ou efeito.
- **Separar áudio** de um vídeo, **gravar narração** pelo microfone.
- **Equalizar volume** e **abaixar a música quando alguém fala**.
- **Efeitos de voz**: eco, caverna, rádio, telefone, robô, mais grave, mais agudo, e **limpar voz** (filtros e compressor).

**Projeto**
- Formatos 9:16, 16:9, 1:1 e 4:5.
- Exportação MP4 (ou WebM, conforme o navegador) em 720p ou 1080p, 30 ou 60 fps, com imagem e som.
- Salvamento automático no próprio navegador (IndexedDB), inclusive dos arquivos importados.

## Atalhos

| Tecla | Ação |
| --- | --- |
| Espaço | Reproduzir ou pausar |
| S | Dividir no cursor |
| D | Duplicar seleção |
| K | Adicionar ou remover quadro-chave no cursor |
| Delete | Excluir seleção |
| ← → | Andar um quadro (Shift: um segundo) |
| Ctrl Z / Ctrl Shift Z | Desfazer / refazer |

## Estrutura

```
src/core.js      lógica de edição pura (sem DOM), usada pelo app e pelos testes
src/app.html     marcação e estilos
src/app.js       interface, renderização no canvas, áudio, ferramentas e exportação
scripts/build.mjs junta tudo em dist/
dist/editcat.html    arquivo único pronto para abrir ou hospedar
dist/index.html  mesma página sem o esqueleto do documento (usada no claude.ai)
tests/unit/      testes da lógica (node:test)
tests/e2e/       testes no navegador (Playwright + Chromium)
```

## Rodar

```bash
npm run build
```

Abra `dist/editcat.html` no navegador.

## Hospedar no GitHub Pages

O workflow `.github/workflows/pages.yml` roda todos os testes a cada push na `main` e, se passarem, publica o app no GitHub Pages. Para ligar:

1. No GitHub, abra **Settings → Pages** do repositório.
2. Em **Build and deployment → Source**, escolha **GitHub Actions**.
3. Em **Actions**, rode de novo o workflow **Testar e publicar** (ou faça um push).

O endereço fica `https://brancoviana.github.io/EditCat/`. Repositório privado só pode usar Pages em planos pagos; no plano gratuito o repositório precisa ser público. Hospedado, o app consegue baixar o modelo das legendas automáticas e usar o microfone para a narração.

## Testes

```bash
npm test
```

Roda os testes unitários e depois os de navegador. Os de navegador precisam do Playwright com Chromium e do `ffmpeg` (usado para gerar um vídeo, uma foto e uma música de teste e para conferir que o arquivo exportado tem faixas de vídeo e áudio).

Casos cobertos:

- Unitários (43): tempo e quadros, encadeamento dos clipes, divisão de vídeo, texto, áudio, camadas e legendas, reordenação estável, aparar, ímã, empilhamento, fades, filtros, formatos, animações, histórico, quadros-chave (interpolação, chave automática, deslocamento ao dividir), envelope de áudio, detecção de fala, remoção de silêncios, batidas e ajuste ao ritmo, equalização de volume, roteiro para legendas, agrupamento de palavras, palavra falada, chroma key, separar áudio, inserir quadro congelado, migração de projetos antigos.
- Navegador (22): abrir o exemplo; reproduzir/pausar; dividir/desfazer; ajustes por aba; texto; formato; importação; salvamento; exportação; celular; camada com chroma key, máscara e mistura (conferindo pixels); quadros-chave movendo a camada; separar áudio, remover silêncios e equalizar; roteiro para legendas nos trechos com fala; legendas automáticas (com um reconhecedor de teste); batidas e ajuste ao ritmo; efeitos de voz e música abaixando na fala; congelar quadro; inverter; desfoque e mosaico; narração com microfone simulado; exportação com camada, legenda e mosaico conferida com `ffprobe`.

## Limites conhecidos

- A exportação acontece em tempo real: um vídeo de 1 minuto leva cerca de 1 minuto. Deixe a aba aberta.
- Formatos que o navegador não decodifica (HEVC no Chrome, por exemplo) não podem ser importados.
- O projeto fica salvo só naquele navegador.
- Legendas automáticas baixam um modelo de cerca de 80 MB na primeira vez. Na página publicada no claude.ai esse download e o microfone são bloqueados; use o `editcat.html` hospedado (GitHub Pages, por exemplo). Os testes automáticos usam um reconhecedor simulado; o modelo real não foi testado aqui.
- Inverter gera um clipe sem som e aceita trechos de até 20 s.
- Ainda não tem: remover fundo sem tela verde, rastrear objetos, retoque de rosto, texto para fala, tradução, achar destaques em vídeos longos (estes precisam de modelos maiores ou de um servidor).
