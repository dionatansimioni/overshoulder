# Instalação

[← Documentação](README.md) · [English](../install.md) · Português

## Requisitos

- Um servidor Linux com **Docker**.
- De preferência, um **domínio ou subdomínio** apontando para o IP do servidor (por exemplo, `live.seudominio.com`). Sem domínio também funciona: veja [Sem domínio](#sem-domínio). O HTTPS é obrigatório: os navegadores só compartilham tela e usam criptografia em sites HTTPS.
- **Banda de saída:** o servidor envia uma cópia do vídeo para cada pessoa. Em 720p são ~3 Mbps por espectador; em 1080p60, ~7 Mbps. Com 10 pessoas em 1080p60, ~70 Mbps e quase 30 GB por hora. Confira a franquia do seu plano.

## Instalador de um comando

Em Ubuntu ou Debian (amd64 ou arm64), com o domínio já apontando para o servidor:

```bash
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/dionatansimioni/overshoulder/main/install.sh)"
```

O instalador:

1. confere o sistema e instala o Docker, se faltar;
2. pergunta como as pessoas vão chegar ao servidor: com domínio, sem domínio (certificado no IP), só pela rede local, ou atrás de um proxy que já existe (se as portas 80 e 443 estiverem ocupadas, ele sugere essa opção; no Coolify, ele indica o [guia do Coolify](proxy.md#coolify));
3. libera as portas no ufw ou no firewalld;
4. sobe o container com Docker Compose em `/opt/overshoulder` (a configuração fica no `.env` dessa pasta);
5. mostra o endereço, o código da primeira configuração e as portas a liberar no painel do provedor.

Depois, o comando `overshoulder` cuida do dia a dia:

| Comando | O que faz |
|---|---|
| `sudo overshoulder update` | Baixa a versão nova e reinicia, mantendo os dados |
| `overshoulder status` | Mostra se está rodando, a saúde e a versão |
| `overshoulder logs` | Acompanha os logs |
| `overshoulder config-code` | Mostra o código da primeira configuração |
| `overshoulder reset-admin` | Gera um link para redefinir a senha do admin |
| `overshoulder backup` | Salva os dados num arquivo na pasta atual |
| `sudo overshoulder uninstall` | Remove o Overshoulder; com `--purge`, apaga também os dados |

Para instalar sem perguntas (automação), passe as respostas pelo ambiente: `MODE=domain DOMAIN=live.seudominio.com OVERSHOULDER_YES=1`. Os modos são `domain`, `ip`, `lan` e `proxy` (com `PROXY_PORT`, padrão 8080).

O instalador e o comando `overshoulder` falam português quando o idioma do sistema (`LANG`) é português, e inglês nos outros casos. Para escolher, use `OVERSHOULDER_LANG=pt` ou `OVERSHOULDER_LANG=en`.

Não use `curl … | sudo bash`: em alguns sistemas, como o Ubuntu 25.10, o instalador lido pelo cano não recebe o que você digita, nem o CTRL+C.

## Hostinger (um clique)

[![Deploy on Hostinger](https://assets.hostinger.com/vps/deploy.svg)](https://www.hostinger.com/docker-hosting?compose_url=https://raw.githubusercontent.com/dionatansimioni/overshoulder/main/deploy/hostinger/compose.yml)

O botão abre a compra da Hostinger com o Compose do Overshoulder ([deploy/hostinger/compose.yml](../../deploy/hostinger/compose.yml)). Depois da compra, o Docker Manager da VPS abre com ele, pronto para subir.

- **Não precisa de domínio para começar:** com `DOMAIN` vazio, o servidor descobre o próprio IP público e pede o certificado HTTPS para ele. Abra `https://<IP da VPS>/setup`.
- **Código de configuração:** nos logs do projeto no Docker Manager, na linha com `setupCode`.
- **Com domínio:** aponte-o para a VPS, preencha `DOMAIN` nas variáveis de ambiente do projeto e suba de novo.
- **Firewall:** o firewall do painel da Hostinger só vale se você aplicar um grupo de regras à VPS. Se aplicar, libere 80/TCP, 443/TCP, 7881/TCP e 7882/UDP.
- **Atualizar:** no Docker Manager, atualize (redeploy) o projeto; os dados ficam no volume.

## Subir com Docker

Sem o instalador: a imagem é única, com LiveKit (vídeo), o app e o Caddy (HTTPS automático) no mesmo container.

```bash
docker run -d --name overshoulder --restart unless-stopped \
  -p 80:80 -p 443:443 -p 7881:7881 -p 7882:7882/udp \
  -v overshoulder-data:/data \
  -e DOMAIN=live.seudominio.com \
  ghcr.io/dionatansimioni/overshoulder:latest
```

Para compilar a partir do código: `git clone https://github.com/dionatansimioni/overshoulder.git` e, na pasta, `docker build -t overshoulder .`. Com o Docker Compose: `./setup.sh` pergunta o domínio e gera o `.env`; depois, `docker compose up -d --build`.

As outras variáveis (certificado próprio, portas, TURN) estão em [Configuração](configuration.md#variáveis-do-servidor).

Se as portas 80 e 443 já têm dono (Coolify, Dokploy, EasyPanel, um Nginx ou Traefik), veja [Atrás de outro proxy](proxy.md).

## Primeiro acesso

1. Abra `https://live.seudominio.com/setup`.
2. Pegue o **código de configuração** (formato `XXXX-XXXX-XXXX`). Ele só existe enquanto o servidor não tem administrador, e prova que é você quem instalou. Não é uma senha: está nos logs, na linha que tem `setupCode`:
   - **instalador:** `overshoulder config-code`;
   - **`docker run` ou Docker Compose:** `docker logs overshoulder 2>&1 | grep setupCode`;
   - **Coolify, Dokploy, EasyPanel:** na aba *Logs* do serviço, procure `setupCode` (Ctrl+F); ou, no terminal do servidor, `docker logs $(docker ps -qf name=overshoulder) 2>&1 | grep setupCode`.

   O código muda a cada vez que o container reinicia: use o da última linha `setupCode`.
3. Siga os 3 passos: código, conta de administrador (usuário e senha de pelo menos 12 caracteres) e limite de pessoas por sala.

Pronto: você entra logado e já pode criar salas. O resto fica em `/admin` (veja [Configuração](configuration.md)).

## Firewall

| Porta | Protocolo | Uso |
|---|---|---|
| 80, 443 | TCP | Site e HTTPS (o Let's Encrypt usa a 80 para emitir o certificado) |
| 7881 | TCP | Vídeo por TCP, para redes que bloqueiam UDP |
| 7882 | UDP | Vídeo (o caminho normal, mais rápido) |

Se o provedor tem firewall no painel, libere as portas lá também, porque ele é separado do firewall do sistema. Ele vem ligado no Oracle Cloud (a lista de segurança padrão só deixa passar o SSH), na AWS e no Google Cloud. Na Hostinger, o firewall do painel só passa a valer quando você aplica um grupo de regras ao servidor; sem isso, não bloqueia nada.

## Atualizar

Antes, leia as notas da versão nova (na página de releases do projeto) e faça um backup. Os dados ficam no volume e sobrevivem à troca do container. O painel `/admin` avisa quando sai uma versão nova e mostra estes mesmos passos.

| Como foi instalado | Como atualizar |
|---|---|
| Instalador de um comando | `sudo overshoulder update` |
| Docker Compose com a imagem pronta | Na pasta do `compose.yml`: `docker compose pull` e depois `docker compose up -d` |
| Docker Compose compilando o código | Na pasta do projeto: `git pull` e depois `docker compose up -d --build` |
| `docker run` | `docker pull ghcr.io/dionatansimioni/overshoulder:latest`, `docker rm -f overshoulder` e o mesmo `docker run` da instalação |
| Hostinger (Docker Manager) | Atualize (redeploy) o projeto no Docker Manager |
| Coolify, Dokploy, EasyPanel | **Redeploy** do serviço. Com a tag `latest`, a imagem nova é baixada; com uma versão fixa (ex.: `:0.2.0`), troque a tag antes |

Para fixar uma versão em vez de seguir a `latest`: no instalador, troque `OVERSHOULDER_VERSION` no `/opt/overshoulder/.env` e rode `sudo overshoulder update`.

## Backup

Tudo o que importa fica no volume `/data`:

- `state.json`: contas, configurações, salas fixas e convites (senhas só em hash);
- `secrets.json`: chaves internas do servidor (gerado na primeira subida);
- `caddy/`: certificados HTTPS.

Para copiar:

```bash
docker run --rm -v overshoulder-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/overshoulder-backup.tgz -C /data .
```

Para restaurar num servidor novo, extraia o arquivo no volume antes de subir o container. Guarde o backup em lugar seguro: `secrets.json` permite emitir acessos às salas.

## Sem domínio

Use o IP público do servidor em `DOMAIN` (ex.: `DOMAIN=203.0.113.5`). O Caddy pede ao Let's Encrypt um certificado para o próprio IP. Esses certificados duram uns 6 dias, e o Caddy os renova sozinho. A porta 80 precisa estar aberta para a internet.

Se o certificado no IP falhar (veja os logs do container), use o nip.io, que transforma o IP num nome: `DOMAIN=203-0-113-5.nip.io`. O nip.io é um serviço de terceiros, e a cota de certificados do Let's Encrypt para ele é dividida entre todos os usuários. Um domínio próprio continua sendo o caminho mais estável.

## Rede local

Para usar só dentro de casa ou da empresa: `./setup.sh`, opção 2 (detecta o IP), e `docker compose up -d --build`. Com `TLS=local`, o Caddy usa um certificado próprio e cada navegador mostra um aviso na primeira vez ("Avançado" > "Continuar"). Para tirar o aviso de vez num aparelho, instale nele a CA do Caddy:

```bash
docker compose cp overshoulder:/data/caddy/pki/authorities/local/root.crt overshoulder-ca.crt
```

### Certificado da empresa

Se a empresa já tem um certificado que os aparelhos confiam (de uma CA interna ou comprado), use `TLS=custom`. Monte a pasta com o certificado (`cert.pem`, com a cadeia) e a chave sem senha (`key.pem`) em `/data/certs`:

```bash
docker run -d --name overshoulder --restart unless-stopped \
  -p 443:443 -p 7881:7881 -p 7882:7882/udp \
  -v overshoulder-data:/data -v /etc/overshoulder/certs:/data/certs:ro \
  -e DOMAIN=live.empresa.local -e TLS=custom -e NODE_IP=192.168.0.10 \
  ghcr.io/dionatansimioni/overshoulder:latest
```

- Outros caminhos: `TLS_CERT` e `TLS_KEY`.
- O container roda com o usuário de uid 1000: ele precisa conseguir ler os dois arquivos.
- Ao subir, o servidor confere se o certificado vale para `DOMAIN` (e para `TURN_DOMAIN`, se houver), se a chave é dele e se não venceu. Se algo estiver errado, ele não sobe e explica o motivo nos logs.
- Para renovar, troque os arquivos: em até um minuto o certificado novo passa a valer, sem reiniciar. Se o novo tiver problema, o anterior continua e o motivo aparece nos logs.

### Sem internet

O servidor funciona numa rede sem acesso à internet. Numa máquina com internet, baixe a imagem e salve num arquivo:

```bash
docker pull ghcr.io/dionatansimioni/overshoulder:latest
docker save -o overshoulder.tar ghcr.io/dionatansimioni/overshoulder:latest
```

Leve o arquivo ao servidor e carregue: `docker load -i overshoulder.tar`. Depois, suba com `TLS=local` ou `TLS=custom` e **sempre com `NODE_IP`** (o IP do servidor na rede): sem internet, o servidor não consegue descobrir o próprio IP sozinho. O aviso de nova versão fica sem resposta e não atrapalha nada.

### Em casa (homelab)

Funciona, com três cuidados:

- **Upload:** o limite é o upload da sua internet. Com 100 Mbps de upload, cabem umas 26 pessoas em 720p.
- **CGNAT:** se a operadora não dá um IP público só seu, quem está fora da sua casa não consegue chegar ao servidor. Confira se o IP que aparece no roteador é o mesmo de sites como `ifconfig.me`.
- **IP exposto:** quem assiste se conecta direto ao servidor e fica sabendo o IP da sua casa, que revela a cidade e a operadora e pode virar alvo de ataques. Para lives abertas ao público, prefira uma VPS.

## Saúde e logs

- `GET /healthz` responde `{"status":"ok"}` e alimenta o healthcheck do Docker.
- `docker logs overshoulder` mostra os logs em JSON, um por linha, sem senhas nem IDs de sala.
