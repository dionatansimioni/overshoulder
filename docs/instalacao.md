# Instalação

[← Documentação](README.md)

## Requisitos

- Um servidor Linux com **Docker**.
- De preferência, um **domínio ou subdomínio** apontando para o IP do servidor (por exemplo, `live.seudominio.com`). Sem domínio também funciona: veja [Sem domínio](#sem-domínio). O HTTPS é obrigatório: os navegadores só compartilham tela e usam criptografia em sites HTTPS.
- **Banda de saída:** o servidor envia uma cópia do vídeo para cada pessoa. Em 720p são ~3 Mbps por espectador; em 1080p60, ~7 Mbps. Com 10 pessoas em 1080p60, ~70 Mbps e quase 30 GB por hora. Confira a franquia do seu plano.

## Subir com Docker

A imagem é única: LiveKit (vídeo), o app e o Caddy (HTTPS automático) no mesmo container.

```bash
git clone https://github.com/dionatansimioni/overshoulder.git
cd overshoulder
docker build -t overshoulder .
docker run -d --name overshoulder --restart unless-stopped \
  -p 80:80 -p 443:443 -p 7881:7881 -p 7882:7882/udp \
  -v overshoulder-data:/data \
  -e DOMAIN=live.seudominio.com \
  overshoulder
```

Com o Docker Compose: `./setup.sh` pergunta o domínio e gera o `.env`; depois, `docker compose up -d --build`.

As outras variáveis (certificado próprio, portas, TURN) estão em [Configuração](configuracao.md#variáveis-do-servidor).

Se as portas 80 e 443 já têm dono (Coolify, Dokploy, EasyPanel, um Nginx ou Traefik), veja [Atrás de outro proxy](proxy.md).

## Primeiro acesso

1. Abra `https://live.seudominio.com/configurar`.
2. Pegue o **código de configuração** nos logs: `docker logs overshoulder | grep setupCode`. Ele só existe enquanto o servidor não tem administrador, e prova que é você quem instalou.
3. Siga os 3 passos: código, conta de administrador (usuário e senha de pelo menos 12 caracteres) e limite de pessoas por sala.

Pronto: você entra logado e já pode criar salas. O resto fica em `/admin` (veja [Configuração](configuracao.md)).

## Firewall

| Porta | Protocolo | Uso |
|---|---|---|
| 80, 443 | TCP | Site e HTTPS (o Let's Encrypt usa a 80 para emitir o certificado) |
| 7881 | TCP | Vídeo por TCP, para redes que bloqueiam UDP |
| 7882 | UDP | Vídeo (o caminho normal, mais rápido) |

Libere também no painel do provedor (Hostinger, Oracle etc.): o firewall de lá é separado do sistema.

## Atualizar

```bash
cd overshoulder
git pull
docker build -t overshoulder .
docker rm -f overshoulder
docker run -d --name overshoulder ... # o mesmo comando da instalação
```

Os dados ficam no volume `overshoulder-data` e sobrevivem à troca do container. Com o Compose: `git pull` e `docker compose up -d --build`.

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
  overshoulder
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
