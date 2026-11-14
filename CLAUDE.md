# Overshoulder (antigo Owncord)

Compartilhamento de tela para jogar com os amigos: LiveKit + app Node (`app/`) + Caddy, via Docker Compose. O plano em andamento, as decisões e as perguntas em aberto estão em `docs/PLANO.md`. Leia esse arquivo antes de retomar o trabalho.

Converse com o usuário em português (pt-BR).

## Testes

`./scripts/test.sh` roda a suíte inteira em containers (LiveKit de teste nas portas 17880–17882 e Playwright): primeiro o gitleaks (histórico do git e arquivos; exceções em `.gitleaks.toml`), depois os testes do servidor em `app/test/server.test.js`, de segurança de todos os endpoints em `app/test/security.test.js` e do navegador em `app/test/browser.test.js`. Endpoint ou recurso novo ganha também os casos de segurança correspondentes (entrada malformada, permissões, vazamento). A suíte está verde só quando o script sai com código 0 e o resumo mostra `fail 0`: confira o código de saída, porque um filtro da saída (`grep`, `tail`) esconde falhas de rede do `npm ci`.

## Como trabalhar

- **Git:** todo trabalho é versionado com git local. Cada mudança coerente vira um commit com mensagem descritiva em português: a primeira linha diz o que mudou, e o corpo explica o porquê quando não for óbvio.
- **Testes verdes:** o projeto tem testes básicos que provam que o site e o servidor funcionam. Depois de qualquer modificação, rode a suíte inteira. Se algo ficar vermelho, analise a causa, corrija e rode de novo até tudo passar. Só faça commit com a suíte verde.
- **Teste novo por recurso:** todo recurso novo que tenha comportamento testável entra junto com o teste que o cobre, no mesmo commit.
