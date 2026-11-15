# Instalação

[← Documentação](README.md)

## Requisitos

- Um servidor Linux com **Docker**.
- Um **domínio ou subdomínio** apontando para o IP do servidor (por exemplo, `live.seudominio.com`). O HTTPS é obrigatório: os navegadores só compartilham tela e usam criptografia em sites HTTPS.
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

## Rede local (sem domínio)

Para usar só dentro de casa ou da empresa: `./setup.sh`, opção 2 (detecta o IP), e `docker compose up -d --build`. Com `TLS=local`, o Caddy usa um certificado próprio e cada navegador mostra um aviso na primeira vez ("Avançado" > "Continuar"). Para tirar o aviso de vez num aparelho, instale nele a CA do Caddy:

```bash
docker compose cp overshoulder:/data/caddy/pki/authorities/local/root.crt overshoulder-ca.crt
```

Em casa, o limite é o upload da sua internet, e quem assiste de fora vê o IP da sua casa. Para lives abertas ao público, prefira uma VPS.

## Saúde e logs

- `GET /healthz` responde `{"status":"ok"}` e alimenta o healthcheck do Docker.
- `docker logs overshoulder` mostra os logs em JSON, um por linha, sem senhas nem IDs de sala.
