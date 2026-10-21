# Como usar a skill do DeepSeek Harness

## Passo a passo

1. **Prepare o ambiente** (raiz do monorepo):
   ```bash
   pnpm install
   pnpm run build
   ```

2. **Registre o host nativo** do Chrome (Windows, consulte `packages/native-host/REGISTRO.md`).

3. **Carregue a extensao** no Chrome:
   - `chrome://extensions` > Modo de desenvolvedor > Carregar sem compactacao > `packages/chrome-extension/dist`.

4. **Inicie os servidores** (dois terminais):
   ```bash
   # Terminal 1
   node packages/mcp-server-chrome/dist/index.js

   # Terminal 2
   node packages/native-host/dist/index.js
   ```

5. **Carregue a skill no DSH**: use o conteudo de `packages/dsh-skill/instructions.md` como instrucao do agente (ou atraves do ponto de extensao de skills do DSH, se disponível).

6. **Converse com o agente** pedindo acoes no Chrome:
   - "Abra uma aba no Chrome e acesse https://exemplo.com"
   - "Preencha o form de contato da pagina atual"
   - "Leia o texto da aba 2 e me resuma"
   - "Tire um print da pagina inteira"

## O que acontece por baixo

```
Agente (DSH)
  -> chama ferramenta MCP (ex: chrome_navigate)
  -> mcp-server-chrome (stdio, JSON-RPC 2.0)
  -> TCP localhost:8765
  -> native-host
  -> extensao Chrome -> chrome.tabs / content script (DOM)
  -> resultado volta ate o agente
```

## Princípios

- KISS: a skill so orienta; a execucao eh do servidor MCP + extensao.
- ACID: cada acao e atomica e isolada por aba.
