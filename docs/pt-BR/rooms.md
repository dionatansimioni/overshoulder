# Salas

[← Documentação](README.md) · [English](../rooms.md) · Português

## Criar uma sala

Na página inicial, **Criar sala** e escolha o tipo. A sala é criada na hora e a tela de entrada já mostra o link de convite para copiar. Em "Mais opções" ficam as escolhas menos comuns.

| Tipo | Como funciona |
|---|---|
| **Jogando juntos** | Todos falam, como numa call. Por padrão, qualquer um mostra a tela (dá para desligar em "Mais opções", e aí a pessoa pede) |
| **Live** | Só quem apresenta fala. O público usa o chat e, se o anfitrião permitir, pode **pedir a palavra** ou **pedir para mostrar a tela** |

Com várias telas ao vivo, cada pessoa escolhe qual assistir e só recebe essa.

## A criptografia e o link

Os botões de convite ficam no alto da sala: **Copiar convite** (o link não aparece na tela; cole no Discord, no WhatsApp ou onde quiser), **Novo link** e, se configurado, **Discord**.

A chave da sala é gerada no seu navegador e vai só no `#` do link: o servidor nunca a vê e repassa um vídeo que não consegue abrir. Por isso:

- quem perde o link perde o acesso; não há como o servidor recuperar a chave;
- a barra lateral da página inicial mostra **as salas deste navegador**, cada uma com o ícone do tipo (controle para Jogando juntos, antena para Live); em outro aparelho a lista começa vazia. Dois cliques no nome dão um apelido à sala (Enter ou clicar fora salva, Esc desiste, nome vazio volta ao original); o apelido fica neste navegador;
- o chat passa pelo servidor com HTTPS, mas não tem criptografia de ponta a ponta.

## Sala privada

Em "Mais opções", **Sala privada**: a sala não fica guardada no navegador e acaba quando o anfitrião sai por mais de 30 segundos (tolerância para recarregar a página ou a rede cair). Em computador compartilhado, use também "Ao sair, esquecer as salas deste navegador" na página inicial.

## Convites e sala de espera

O link padrão não tem limite. Em **Pessoas › Convites e entrada**, o anfitrião cria convites com nome (ex.: "Discord do clã"), limite de pessoas, validade e senha opcional, e revoga um convite (o link morre e quem entrou por ele sai). Quem entra guarda um "ingresso" no navegador: recarregar a página não gasta o convite de novo.

A **sala de espera** faz cada pessoa aguardar o anfitrião deixar entrar.

## Anunciar no Discord

Se o admin configurou o webhook de um canal do Discord (em `/admin` › Geral), o anfitrião que tem conta ganha, ao lado do link de convite, o botão **Anunciar no Discord**. Ele posta no canal um cartão com a sala e o link de convite.

O anúncio sai direto do navegador do anfitrião para o Discord: o servidor não vê o link, que leva a chave da sala. Quem está no canal do Discord recebe o link, como se alguém o colasse lá. O webhook só chega a quem tem conta; quem assiste nunca o recebe.

## Salas fixas

O admin cria em `/admin` › Salas fixas salas que não somem, com o mesmo link e os mesmos convites para sempre (o canal da comunidade, a live semanal). A sala vai ao ar quando alguém entra. A chave é criada no navegador do admin; em outro navegador, ele precisa do link ou de uma chave nova (que invalida os links antigos).

## Moderação

Na aba **Pessoas**, o anfitrião:

- na Live, escolhe em **Pedidos do público** se quem assiste pode pedir a palavra e pedir para mostrar a tela (os dois começam desligados; desligar um descarta os pedidos daquele tipo que estavam na fila);
- aprova pedidos de palavra e de tela, e libera ou tira a fala e a tela de cada pessoa;
- remove alguém (a pessoa vê "A live foi encerrada" e o link usado por ela é trocado);
- desliga o chat de quem assiste e gera um link novo para a sala;
- em **Ajustes da sala**, muda o **limite de pessoas** com a sala no ar (vale para quem entra depois; "Usar o do servidor" volta ao de Administração › Geral) e, no Jogando juntos, se **qualquer um pode mostrar a tela**, sem recriar a sala.

Com a sala cheia, quem tenta entrar vê "A sala está cheia". O anfitrião entra sempre. A sala de um transmissor não passa do limite do servidor; a do admin vai até 5000. Mudar o limite do servidor vale na hora para as salas no ar.

Na gaveta lateral da sala, **Administração** e **Minha conta** abrem em outra aba: a live continua, e o **Voltar** dessas páginas fecha a aba.

## Chat, Pessoas e Registro

O painel lateral tem o **Chat** (para o anfitrião, só as conversas), **Pessoas** e, para o anfitrião, o **Registro**: quem entrou, quem saiu, pedidos de palavra, a sala de espera e os outros eventos da sala. Quem assiste não tem o Registro e continua vendo esses avisos no chat. O olho no alto mostra quantas pessoas estão na sala.

No celular em pé, o vídeo fica no topo, os controles logo abaixo e o chat ocupa o resto da tela. Deitado, o chat fica ao lado do vídeo e pode ser escondido pelo botão do painel; os Ajustes abrem numa folha que sobe de baixo. No computador, a barra de volume abre ao passar o mouse no alto-falante e mostra o nível (0 a 100%) enquanto você arrasta. O ícone do alto-falante silencia a sala: a barra vai a zero e fica vermelha, e clicar de novo devolve o volume que estava.

## Destacar uma pergunta (Live)

Na Live, o anfitrião passa o mouse numa mensagem do chat e clica na **estrela** para pôr a mensagem sobre o vídeo, para todos, com o nome de quem perguntou. Quem entra depois também vê. Clicar de novo na estrela, ou no **×** do cartão, tira o destaque. Só o anfitrião destaca; o cartão vai de navegador a navegador, como o chat.

## Link velho

O link de uma sala que acabou, ou cujo link o anfitrião trocou, não abre mais a tela de entrada: avisa que a sala não existe mais, com o botão para a página inicial e a dica de falar com o anfitrião para pedir um link novo. Para o anfitrião sem sessão aberta, há também o atalho para entrar na conta e abrir outra sala.

## Encerrar a sala

**Encerrar** fecha a sala para todos. O anfitrião, e quem tem conta no servidor, volta para a página inicial (se havia gravação, ela é salva antes). Quem assiste vê a tela "A live acabou".

## Gravação (experimental)

A gravação é **experimental e vem desligada**. Ela acontece no computador do anfitrião, ao mesmo tempo que a transmissão e o jogo, então usa processador e pode deixar os dois mais lentos. Dá para ligar em dois lugares; os dois mostram antes um aviso de desempenho:

- **Ajustes da sala** (a engrenagem): *Gravação › Mostrar o botão de gravar*. Vale só naquele navegador e tem prioridade sobre o padrão do servidor.
- **Administração › Geral › Gravação da transmissão (experimental)**: mostra o botão para todos os anfitriões por padrão.

O anfitrião grava no próprio navegador o vídeo que está na tela e todo o áudio da sala; o servidor nunca vê o conteúdo. Todos na sala veem **● Gravando**.

- No Chrome e no Edge, o arquivo vai para uma pasta escolhida; nos outros navegadores, é baixado ao parar.
- Formato: MP4 com áudio AAC quando o navegador consegue (Chrome no Windows e no Mac); MP4 com áudio Opus no Chromium; WebM no Firefox.
- Tela (com o áudio) e câmera ficam em arquivos separados. Cada trecho de vídeo vira uma parte (por exemplo, parar e voltar a compartilhar).
- Ao parar, o arquivo é reescrito como um MP4 comum (com índice e duração), então players comuns, como o Filmes e TV do Windows, conseguem pular na timeline. Vídeo e áudio não são recodificados. Se a reescrita falhar, o original é mantido; ele toca no Chrome e no VLC, mas pode não pular em todos os players.
- **Jogos em tela cheia exclusiva:** o navegador só recebe quadros novos de uma janela quando o conteúdo muda, e um jogo em tela cheia exclusiva não passa pelo compositor do Windows. Gravar uma *janela* nesse caso trava num quadro só. Coloque o jogo em modo janela ou sem bordas, ou compartilhe a tela inteira. O mesmo limite pode afetar a transmissão ao vivo.
- Editor que não abre Opus: `ffmpeg -i gravacao.mp4 -c:v copy -c:a aac gravacao-aac.mp4`.
