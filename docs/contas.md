# Contas e usuários

[← Documentação](README.md)

| Quem | Tem conta? | O que faz |
|---|---|---|
| Administrador | Sim (uma) | Configura o servidor em `/admin`, cria salas, gere as contas |
| Transmissor | Sim | Cria salas e transmite, mesmo sem o admin presente; não mexe nas configurações |
| Espectador | Não | Entra pelo link da sala, só com um nome |

## Senhas

No mínimo 12 caracteres, sem conter o usuário e fora das ~30 mil senhas vazadas mais comuns. Uma frase longa é mais fácil de lembrar e mais segura. As sessões duram até 12 horas, ou 2 horas sem uso.

## Transmissores

O modo de cadastro fica em `/admin` › Geral:

- **Só por convite:** o admin gera um convite em `/admin` › Convites e manda o link. A pessoa escolhe o próprio usuário e senha; o admin nunca vê a senha. O link vale uma vez, por 48 horas.
- **Com aprovação (padrão):** qualquer um pede uma conta em `/cadastro`; a conta fica pendente até o admin aprovar em `/admin` › Transmissores. Há limite de pedidos por IP e um teto de contas esperando.
- **Livre:** qualquer um cria conta em `/cadastro` e já transmite. Use só em servidores para um grupo que você confia.

Em `/admin` › Transmissores:

- **Revogar:** desativa a conta e encerra na hora as sessões e as salas ao vivo dela.
- **Reativar:** devolve o acesso a uma conta revogada.
- **Excluir:** apaga a conta.

## Verificação em duas etapas (2FA)

Cada pessoa ativa em `/conta`, com um app autenticador (Google Authenticator, Aegis, 1Password…). Ao ativar, recebe 10 códigos de recuperação, que valem uma vez cada. O admin pode **exigir 2FA** de todos em `/admin` › Geral.

## Recuperar o acesso

- **Admin perdeu a senha ou o 2FA:** no servidor, rode `docker exec overshoulder overshoulder reset-admin`. Ele mostra um link de uso único, válido por 15 minutos, que troca a senha e remove o 2FA do admin. Todas as sessões dele são encerradas.
- **Transmissor perdeu o celular do 2FA:** ele entra com um código de recuperação. Sem códigos, o admin, em `/admin` › Transmissores, remove o 2FA da conta ou gera códigos novos (e entrega por um canal seguro).
- **Transmissor esqueceu a senha:** hoje o admin não troca a senha de outra conta. O caminho é excluir a conta e mandar um convite novo (ou, no modo com aprovação, a pessoa pede de novo em `/cadastro`).
- **Trocar a própria senha:** em `/conta`.

## Login da empresa (SSO)

Opcional, por OpenID Connect (Google Workspace, Microsoft Entra ID, Keycloak, Authentik…), em `/admin` › Avançado:

1. No provedor, cadastre um aplicativo "web" com o endereço de retorno mostrado no painel.
2. Preencha o emissor (issuer), o Client ID, o Client secret e os domínios de e-mail permitidos.
3. Defina quem transmite: um grupo (se o provedor enviar a lista de grupos) ou uma lista de e-mails. Essas pessoas viram transmissor no primeiro login.

Cada sala pode exigir o login da empresa para assistir, e aí o nome no chat é o nome real. O admin torna isso padrão ou obrigatório. O administrador sempre entra com usuário e senha, para não ficar trancado fora se o provedor cair.

O SSO foi testado com um provedor simulado; teste com o seu provedor antes de depender dele.
