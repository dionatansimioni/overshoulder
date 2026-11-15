# Configuração

[← Documentação](README.md)

## Variáveis do servidor

Passadas ao container com `-e NOME=valor` (ou no `.env` do Compose). Mudar uma variável exige recriar o container.

| Variável | Padrão | Uso |
|---|---|---|
| `DOMAIN` | (obrigatória) | Domínio ou IP do servidor. Com um IP público e `TLS=acme`, o certificado é emitido para o IP (veja [Sem domínio](instalacao.md#sem-domínio)) |
| `TLS` | `acme` | `acme`: certificado do Let's Encrypt; `local`: certificado próprio (rede local); `custom`: certificado seu, como o da empresa (veja [Certificado da empresa](instalacao.md#certificado-da-empresa)); `proxy`: atrás de outro proxy, como o do Coolify, que cuida do HTTPS (veja [Atrás de outro proxy](proxy.md)) |
| `TLS_CERT`, `TLS_KEY` | `/data/certs/cert.pem`, `/data/certs/key.pem` | Só com `TLS=custom`: certificado (com a cadeia) e chave sem senha |
| `NODE_IP` | descoberto sozinho | IP que o vídeo anuncia aos navegadores (use na rede local) |
| `HTTP_PORT`, `HTTPS_PORT` | `80`, `443` | Portas do site; mapeie as mesmas no `-p`. Com `TLS=proxy`, só a `HTTP_PORT` é usada, e o endereço público fica sem porta |
| `TRUSTED_PROXIES` | `private_ranges` | Só com `TLS=proxy`: de onde o IP e o protocolo de quem acessa são aceitos (IPs e faixas separados por espaço) |
| `UPDATE_CHECK` | ligada | `off` desliga de vez a consulta de nova versão (ex.: servidor sem internet) |
| `INSTALL_METHOD` | (vazia) | Como o servidor foi instalado (`installer`, `compose`, `compose-build`, `docker`, `coolify`): o aviso de nova versão mostra primeiro os passos dessa forma. O instalador e os exemplos já preenchem |
| `MAX_PARTICIPANTS` | `16` | Limite inicial de pessoas por sala, sugerido na configuração (2 a 5000) |
| `TURN_DOMAIN` | desligado | **Experimental.** Subdomínio só para o TURN (ex.: `turn.live.seudominio.com`), para redes que só liberam a porta 443. Exige `HTTPS_PORT=443` e o subdomínio apontando para o servidor; não funciona com `TLS=proxy` |

## Painel `/admin`

Só o administrador abre. O menu lateral tem seis seções; cada uma tem endereço próprio (`/admin#salas`).

### Geral

- **Versão:** mostra a versão do servidor e avisa quando sai uma nova, com o link para o que mudou e os passos para atualizar do jeito que o servidor foi instalado (veja [Atualizar](instalacao.md#atualizar)). O aviso também aparece na página inicial do admin.
  - A consulta é feita uma vez por dia na API de releases do GitHub. Nenhum dado do servidor é enviado; o GitHub vê só o IP do servidor. Desligue em **Verificar novas versões uma vez por dia** ou, de vez, com `UPDATE_CHECK=off`.
  - Compilações locais (versão `dev`) não consultam.
- **Exigir 2FA de todas as contas:** quem ainda não tem verificação em duas etapas (inclusive você) precisa configurar antes de continuar.
- **Limite de pessoas por sala:** de 2 a 5000. O painel estima a banda com a sala cheia e destaca a estimativa a partir de 200 pessoas.
- **Qualidade padrão das transmissões:** começa em 720p · 30 fps.
- **Qualidade máxima permitida:** quem transmite só vê opções até ela. É um limite da página: um navegador modificado ainda poderia enviar mais, porque o servidor de vídeo não limita a taxa por acesso.
- **Cadastro de transmissores:** só por convite, com aprovação (padrão) ou livre. Veja [Contas](contas.md#transmissores).

### Uso

Quanto de vídeo e áudio o servidor enviou no mês (calendário UTC), as salas no ar e as pessoas conectadas. É o que pesa na franquia de banda do plano de hospedagem.

- **Franquia mensal do plano (GB):** com ela, o painel mostra a porcentagem usada e, a partir de 80%, a página inicial do admin avisa. Os logs registram uma vez ao passar de 80% e de 100%.
- Os meses anteriores (até 12) ficam guardados no `state.json`.
- Os números vêm das métricas do servidor de vídeo, que só respondem dentro do container. Contam a mídia enviada, não o tráfego do site, que é pequeno.

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
