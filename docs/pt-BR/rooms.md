# Salas

[← Documentação](README.md) · [English](../rooms.md) · Português

## Criar uma sala

Na página inicial, **Criar sala** e escolha o tipo. A sala é criada na hora e a tela de entrada já mostra o link de convite para copiar. Em "Mais opções" ficam as escolhas menos comuns.

| Tipo | Como funciona |
|---|---|
| **Jogando juntos** | Todos falam, como numa call. Por padrão, qualquer um mostra a tela (dá para desligar em "Mais opções", e aí a pessoa pede) |
| **Live** | Só quem apresenta fala. O público usa o chat e pode **pedir a palavra** ou **pedir para mostrar a tela** |

Com várias telas ao vivo, cada pessoa escolhe qual assistir e só recebe essa.

## A criptografia e o link

A chave da sala é gerada no seu navegador e vai só no `#` do link: o servidor nunca a vê e repassa um vídeo que não consegue abrir. Por isso:

- quem perde o link perde o acesso; não há como o servidor recuperar a chave;
- a barra lateral da página inicial mostra **as salas deste navegador**; em outro aparelho a lista começa vazia;
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

- aprova pedidos de palavra e de tela, e libera ou tira a fala e a tela de cada pessoa;
- remove alguém (a pessoa vê "A live foi encerrada" e o link usado por ela é trocado);
- desliga o chat de quem assiste e gera um link novo para a sala.

## Encerrar a sala

**Encerrar** fecha a sala para todos. O anfitrião, e quem tem conta no servidor, volta para a página inicial (se havia gravação, ela é salva antes). Quem assiste vê a tela "A live acabou".

## Gravação

O anfitrião grava no próprio navegador o vídeo que está na tela e todo o áudio da sala; o servidor nunca vê o conteúdo. Todos na sala veem **● Gravando**.

- No Chrome e no Edge, o arquivo vai para uma pasta escolhida; nos outros navegadores, é baixado ao parar.
- Formato: MP4 com áudio AAC quando o navegador consegue (Chrome no Windows e no Mac); MP4 com áudio Opus no Chromium; WebM no Firefox.
- Tela (com o áudio) e câmera ficam em arquivos separados. Cada trecho de vídeo vira uma parte (por exemplo, parar e voltar a compartilhar).
- Editor que não abre Opus: `ffmpeg -i gravacao.mp4 -c:v copy -c:a aac gravacao-aac.mp4`.
