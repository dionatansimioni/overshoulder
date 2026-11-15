# Transmitir

[← Documentação](README.md)

## Antes de entrar

A tela de entrada da sala tem uma prévia: ligue a câmera e o microfone para testar (a barra verde mostra o volume). O que estiver ligado ali entra ligado na sala, se você puder falar ou aparecer.

## A barra de controles

- **À esquerda, suas entradas:** microfone, câmera e tela (ou janela). O microfone ligado mostra um anel que cresce com a sua voz.
- **À direita:** volume, tela cheia, ocultar a própria tela, gravar, ajustes e encerrar a sala.

## Compartilhar a tela

Clique no botão de tela e escolha a tela inteira, uma janela ou uma aba. O selo no canto da prévia mostra o que está saindo de fato: resolução, quadros por segundo e Mbps.

**Ocultar sua tela** (ícone de olho): a prévia fica desfocada e nada é reproduzido para você. Quem assiste continua vendo normalmente. A prévia própria não usa banda do servidor, mas mostrá-la gasta processamento do seu computador, o que pesa enquanto você joga.

## Qualidade

Em **Ajustes**: qualidade (até a máxima que o admin permite) e codec.

- Trocar vale na hora, sem parar o compartilhamento; quem assiste vê uma piscada de ~1 s.
- **H.264** costuma usar o encoder da placa de vídeo e é o mais leve enquanto você joga. **AV1** e **VP9** dão imagem melhor na mesma taxa, mas pesam mais sem encoder na placa.
- Acima de 720p, os ajustes mostram quanto cada pessoa recebe e quanto o servidor envia.

**Avisos de rede:** se a sua internet não sustentar a qualidade escolhida por alguns segundos, aparece um aviso com um botão para a qualidade de baixo. Também há aviso quando a conexão perde muitos pacotes (quem assiste vê travamentos).

## Áudio do jogo

- **Windows (Chrome/Edge):** ao escolher "Tela inteira", marque "Compartilhar áudio do sistema".
- **Linux:** o navegador não envia o som do computador junto com a tela. Em **Ajustes › Áudio do jogo**, clique em "Listar" e escolha o **"Monitor of …"** da sua saída de som (PipeWire/PulseAudio). Vale na hora, mesmo com a tela já compartilhada, e os ajustes mostram de onde o áudio está saindo.
  Para não transmitir o som do Discord ou de outros apps, crie uma saída só para o jogo:
  `pactl load-module module-null-sink sink_name=jogo`, mande o jogo para ela e escolha "Monitor of jogo".

## Câmera sobre a tela

Ligue a câmera junto com a tela: ela aparece no canto, por cima (picture-in-picture). Em Ajustes, escolha o canto, o tamanho e o formato (retângulo ou círculo). Quem assiste pode esconder a câmera ou trocar com a tela. Sem tela, a câmera vira o vídeo principal.

## No celular

Os navegadores de celular não compartilham a tela, mas dá para fazer uma live só com a câmera. Para transmitir um jogo de celular, espelhe a tela no computador (scrcpy no Android, AirPlay no iPhone) e compartilhe essa janela. O guia completo fica em `/celular`, no próprio servidor.
