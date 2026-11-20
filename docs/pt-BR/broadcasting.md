# Transmitir

[← Documentação](README.md) · [English](../broadcasting.md) · Português

## Antes de entrar

A tela de entrada da sala tem uma prévia: ligue a câmera e o microfone para testar (a barra verde mostra o volume). O que estiver ligado ali entra ligado na sala, se você puder falar ou aparecer.

## A barra de controles

- **À esquerda, suas entradas:** microfone, câmera e tela (ou janela). O microfone ligado mostra um anel que cresce com a sua voz.
- **À direita, abaixo do vídeo:** volume, tela cheia, ocultar a própria tela, gravar, ajustes e encerrar a sala. Quem assiste tem o mesmo grupo, também à direita.
- **Volume:** clique no alto-falante para abrir o painel (ele flutua sobre a página, então nada na barra se mexe). Nele estão o botão de silenciar e a barra (0 a 100%).
- **O botão do chat** fica numa coluna estreita ao lado do chat. Com o chat escondido a coluna continua, para trazê-lo de volta; um ponto avisa que chegou mensagem.
- Os botões dão retorno: afundam ao serem apertados e um anel sai deles ao ligar ou desligar.

## Atalhos de teclado

Tudo abaixo funciona quando o foco não está num campo de texto. Em **Ajustes › Atalhos de teclado**, clique num atalho e aperte a combinação que quiser (por exemplo `Ctrl+K`). **Esc** cancela, **Backspace** remove o atalho e **Restaurar atalhos padrão** devolve os originais. Se a combinação já era de outra ação, a outra a perde.

| Ação | Padrão |
|---|---|
| Ligar ou desligar o microfone | `M` |
| Ligar ou desligar a câmera | `V` |
| Compartilhar ou parar a tela | `S` |
| Silenciar ou voltar o som | `D` |
| Tela cheia | `F` |
| Esconder ou mostrar o chat | `C` |
| Pedir a palavra, gravar, só voz | sem atalho (você pode definir) |

Seus atalhos ficam guardados **só no seu navegador** (`localStorage`) e nunca vão para o servidor. Um atalho só funciona quando o botão dele está disponível para você (por exemplo, o do microfone não faz nada se você não pode falar).

## Chamada de voz (Jogando juntos)

- **Quem está falando:** anel verde e ondas de som saem do círculo de quem fala, na tela de voz, na lista de Pessoas e numa tira sobre o vídeo quando alguém transmite. Um microfone cortado marca quem está mudo.
- **Volume por pessoa:** em **Pessoas**, cada um tem um botão de silenciar e uma barra de volume, **só para você**: ninguém mais é afetado e some ao recarregar. O volume geral multiplica o dela.
- **Só voz:** o botão de fones permite ouvir e falar com os amigos sem receber a tela (e sem gastar a sua banda com ela). Clique de novo para voltar a assistir. A escolha fica no navegador.
- **Eco:** a captura de tela pede ao navegador que deixe de fora o som que esta página toca (as vozes da chamada), para ele não voltar à sala dentro da transmissão. Funciona no Chrome e no Edge do Windows e do macOS; outros navegadores podem ignorar.

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
- **Linux:** o navegador não envia o som do computador junto com a tela. Em **Ajustes › Áudio do jogo**, clique em "Listar" e escolha a fonte do som do computador. Vale na hora, mesmo com a tela já compartilhada, e os ajustes mostram de onde o áudio está saindo.
  - **Firefox:** escolha o **"Monitor of …"** da sua saída de som (PipeWire/PulseAudio).
  - **Chrome, Chromium, Edge e Brave:** eles escondem de propósito os "Monitor of …". Rode no terminal o comando abaixo, clique em "Listar" de novo e escolha **"Overshoulder-jogo"**. O chat da sala mostra o mesmo comando, com botão de copiar. A fonte vale até reiniciar o computador.
    ```bash
    pactl load-module module-remap-source master="$(pactl get-default-sink).monitor" source_name=overshoulder_jogo source_properties=device.description=Overshoulder-jogo
    ```
  - **Só o som do jogo**, sem o do Discord ou de outros apps: crie uma saída só para o jogo, mande o jogo para ela (no pavucontrol ou nas configurações de som) e transmita o monitor dela:
    ```bash
    pactl load-module module-null-sink sink_name=jogo
    pactl load-module module-loopback source=jogo.monitor
    pactl load-module module-remap-source master=jogo.monitor source_name=overshoulder_jogo source_properties=device.description=Overshoulder-jogo
    ```
    O `module-loopback` faz você continuar ouvindo o jogo. No Firefox, a última linha é opcional: dá para escolher "Monitor of jogo".

## Câmera sobre a tela

Ligue a câmera junto com a tela: ela aparece no canto, por cima (picture-in-picture). Em Ajustes, escolha o canto, o tamanho e o formato (retângulo ou círculo). Quem assiste pode esconder a câmera ou trocar com a tela. Sem tela, a câmera vira o vídeo principal.

## No celular

Os navegadores de celular não compartilham a tela, mas dá para fazer uma live só com a câmera. Para transmitir um jogo de celular, espelhe a tela no computador (scrcpy no Android, AirPlay no iPhone) e compartilhe essa janela. O guia completo fica em `/mobile`, no próprio servidor.
