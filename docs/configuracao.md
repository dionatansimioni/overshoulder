# Configuração

[← Documentação](README.md)

## Variáveis do servidor

Passadas ao container com `-e NOME=valor` (ou no `.env` do Compose). Mudar uma variável exige recriar o container.

| Variável | Padrão | Uso |
|---|---|---|
| `DOMAIN` | (obrigatória) | Domínio ou IP do servidor |
| `TLS` | `acme` | `acme`: certificado do Let's Encrypt; `local`: certificado próprio (rede local); `proxy`: atrás de outro proxy, como o do Coolify, que cuida do HTTPS (veja [Atrás de outro proxy](proxy.md)) |
| `NODE_IP` | descoberto sozinho | IP que o vídeo anuncia aos navegadores (use na rede local) |
| `HTTP_PORT`, `HTTPS_PORT` | `80`, `443` | Portas do site; mapeie as mesmas no `-p`. Com `TLS=proxy`, só a `HTTP_PORT` é usada, e o endereço público fica sem porta |
| `TRUSTED_PROXIES` | `private_ranges` | Só com `TLS=proxy`: de onde o IP e o protocolo de quem acessa são aceitos (IPs e faixas separados por espaço) |
| `MAX_PARTICIPANTS` | `16` | Limite inicial de pessoas por sala, sugerido na configuração (2 a 5000) |
| `TURN_DOMAIN` | desligado | **Experimental.** Subdomínio só para o TURN (ex.: `turn.live.seudominio.com`), para redes que só liberam a porta 443. Exige `HTTPS_PORT=443` e o subdomínio apontando para o servidor; não funciona com `TLS=proxy` |

## Painel `/admin`

Só o administrador abre. O menu lateral tem cinco seções; cada uma tem endereço próprio (`/admin#salas`).

### Geral

- **Exigir 2FA de todas as contas:** quem ainda não tem verificação em duas etapas (inclusive você) precisa configurar antes de continuar.
- **Limite de pessoas por sala:** de 2 a 5000. O painel estima a banda com a sala cheia e destaca a estimativa a partir de 200 pessoas.
- **Qualidade padrão das transmissões:** começa em 720p · 30 fps.
- **Qualidade máxima permitida:** quem transmite só vê opções até ela. É um limite da página: um navegador modificado ainda poderia enviar mais, porque o servidor de vídeo não limita a taxa por acesso.
- **Cadastro de transmissores:** só por convite, com aprovação (padrão) ou livre. Veja [Contas](contas.md#transmissores).

### Salas fixas

Salas que não somem: o link e os convites continuam os mesmos, inclusive depois de reiniciar o servidor. Veja [Salas](salas.md#salas-fixas).

### Transmissores

Lista das contas, com os pedidos de cadastro esperando aprovação. Ações: aprovar, revogar, reativar, excluir, gerar códigos de recuperação e remover o 2FA. Veja [Contas](contas.md).

### Convites

Links de uso único, válidos por 48 horas, para criar contas de transmissor.

### Avançado

- **TURN na porta 443:** mostra se está ligado. Ele é configurado pela variável `TURN_DOMAIN`, não pelo painel.
- **Login da empresa (SSO):** OpenID Connect. Veja [Contas](contas.md#login-da-empresa-sso).

A maioria dos servidores não precisa mexer em "Avançado".
