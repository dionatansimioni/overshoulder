# Atrás de outro proxy (Coolify e similares)

[← Documentação](README.md)

Por padrão, o Overshoulder usa as portas 80 e 443 e cuida sozinho do HTTPS. Se o servidor já tem um proxy nessas portas, use `TLS=proxy`. Isso vale para o Coolify, o Dokploy, o EasyPanel, um Traefik, um Nginx ou um Caddy que você já usa. Nesse modo:

- o seu proxy cuida do domínio e do certificado e repassa o site em HTTP para a porta `HTTP_PORT` do container (padrão `80`);
- o vídeo não passa pelo proxy: as portas **7881/TCP** e **7882/UDP** continuam abertas direto no servidor;
- os links que o Overshoulder gera usam `https://<DOMAIN>`, sem porta;
- o TURN na 443 (`TURN_DOMAIN`) não funciona, porque a 443 é do outro proxy.

## Coolify

1. Crie um recurso **Docker Compose** (por exemplo, "Docker Compose Empty") e cole:

   ```yaml
   services:
     overshoulder:
       image: ghcr.io/dionatansimioni/overshoulder:latest
       restart: unless-stopped
       ports:
         - "7881:7881"
         - "7882:7882/udp"
       environment:
         DOMAIN: live.seudominio.com
         TLS: proxy
         # Faz o aviso de nova versão mostrar como atualizar no Coolify
         INSTALL_METHOD: coolify
       volumes:
         - data:/data
   volumes:
     data:
   ```

2. No serviço `overshoulder`, preencha o domínio com a porta interna: `https://live.seudominio.com:80`. O `:80` indica ao Coolify a porta do container. O endereço público continua sem porta.
3. Use o mesmo domínio em `DOMAIN`, sem `https://`.
4. Faça o deploy e siga o [primeiro acesso](instalacao.md#primeiro-acesso): o código de configuração aparece nos logs do serviço, no próprio Coolify.
5. Libere 7881/TCP e 7882/UDP no firewall do servidor e no painel do provedor.

Não publique a porta 80 do container no servidor (`ports: "80:80"`): o acesso ao site deve passar sempre pelo proxy do Coolify.

Se alguém abrir o site por `http://`, o Overshoulder redireciona para `https://<DOMAIN>`. Para isso, o proxy precisa enviar o cabeçalho `X-Forwarded-Proto`, como fazem o Traefik do Coolify, o Caddy e as configurações de Nginx deste guia.

O Dokploy e o EasyPanel funcionam da mesma forma: domínio apontando para a porta 80 do container, `TLS=proxy` e as portas de vídeo publicadas.

## Nginx, Caddy ou Traefik no mesmo servidor

Suba o container publicando o site só para o próprio servidor:

```bash
docker run -d --name overshoulder --restart unless-stopped \
  -p 127.0.0.1:8080:80 -p 7881:7881 -p 7882:7882/udp \
  -v overshoulder-data:/data \
  -e DOMAIN=live.seudominio.com -e TLS=proxy \
  ghcr.io/dionatansimioni/overshoulder:latest
```

O proxy precisa repassar o WebSocket (a rota `/rtc`), o cabeçalho `Host` original e os cabeçalhos `X-Forwarded-For` e `X-Forwarded-Proto`.

**Caddy** (já faz tudo isso sozinho):

```
live.seudominio.com {
	reverse_proxy 127.0.0.1:8080
}
```

**Nginx:**

```nginx
server {
    server_name live.seudominio.com;
    listen 443 ssl;
    # ssl_certificate e ssl_certificate_key do seu certificado

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 1h;
    }
}
```

**Traefik** (rótulos no container, com o Traefik na mesma rede do Docker; sem publicar a 8080):

```yaml
labels:
  - traefik.enable=true
  - traefik.http.routers.overshoulder.rule=Host(`live.seudominio.com`)
  - traefik.http.routers.overshoulder.entrypoints=websecure
  - traefik.http.routers.overshoulder.tls.certresolver=letsencrypt
  - traefik.http.services.overshoulder.loadbalancer.server.port=80
```

## IP de quem acessa

Os limites de tentativas (login, cadastro, senhas de convite) contam por IP. O Overshoulder só aceita o IP e o protocolo informados pelo proxy quando o pedido chega de um endereço em `TRUSTED_PROXIES`. O padrão, `private_ranges`, aceita as redes privadas (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` e equivalentes), que é de onde o proxy chega em quase todas as instalações com Docker. Se o seu proxy estiver em outro endereço, informe-o: `TRUSTED_PROXIES="203.0.113.10"` (IPs e faixas separados por espaço).

O IP de quem acessa é lido da direita para a esquerda no `X-Forwarded-For`: o que um visitante escrever antes do último proxy confiável é ignorado.
