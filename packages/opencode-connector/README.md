# Conector OpenCode — Controle do Chrome via MCP

## O que este pacote faz

O **OpenCode** (opencode-ai) ja possui suporte nativo a servidores MCP: voce configura um ou mais servidores em `~/.opencode/mcp.json` e o modelo passa a enxergar suas ferramentas como "tools" disponiveis durante a conversa.

Neste repositorio, o servidor e o `mcp-server-chrome` (projeto `packages/mcp-server-chrome`), que expoe as seguintes ferramentas ao OpenCode:

- `chrome_list_tabs` — lista abas do Chrome
- `chrome_open_tab` — abre uma nova aba
- `chrome_navigate` — navega uma aba para uma URL
- `chrome_close_tab` — fecha uma aba
- `chrome_focus_tab` — foca uma aba
- `chrome_fill_form` — preenche campos de formulario (seletor CSS -> valor)
- `chrome_click` — clica em um elemento por seletor CSS
- `chrome_read` — le o texto/html de uma aba ou elemento
- `chrome_screenshot` — tira um print (screenshot) de uma aba
- `chrome_evaluate` — executa JavaScript no contexto da pagina
- `chrome_get_page_info` — informacoes da aba/ pagina

## Como instalar

1. **Compile o servidor MCP** (raiz do monorepo):
   ```bash
   pnpm install
   pnpm run build
   ```

2. **Registre o host de mensagens nativas do Chrome** (Windows):
   Consulte `packages/native-host/REGISTRO.md`. Resumo:
   - Ajuste o `path` em `packages/native-host/com.host.harnessctrl.chrome.windows.json` para `...\\packages\\native-host\\dist\\index.js`.
   - Substitua `__EXTENSION_ID__` pelo ID da extensao carregada (ou use `*` em desenvolvimento).
   - Registre em `HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.harnessctrl.chrome.host`.

3. **Carregue a extensao** no Chrome (`chrome://extensions` > Modo de desenvolvedor > Carregar sem compactacao > selecione `packages/chrome-extension/dist`).

4. **Inicie o servidor MCP** em um terminal:
   ```bash
   node packages/mcp-server-chrome/dist/index.js
   ```
   (Ele escuta o host nativo na porta TCP 8765 e aguarda comandos pelo stdio.)

5. **Inicie o host nativo** em outro terminal:
   ```bash
   node packages/native-host/dist/index.js
   ```

6. **Configure o OpenCode**: copie o conteudo de `opencode-mcp.json` para o seu `~/.opencode/mcp.json` (ou adicione a entrada `harness-ctrl-chrome` ao arquivo existente).

   No Linux/macOS, altere o `args` para o caminho absoluto correto do `dist/index.js`.

7. Reinicie o OpenCode. O modelo agora pode controlar o Chrome pela conversa.

## Exemplos de uso no chat do OpenCode

- "Abra uma aba nova no Chrome e navegue para https://exemplo.com"
- "Preencha o formulario de login: usuario em '#usuario' e senha em '#senha', depois envie"
- "Leia o conteudo da aba atual e me resuma"
- "Tire um print da pagina inteira da aba 5"
- "Clique no botao com seletor '.btn-enviar'"

## Arquitetura (resumo)

```
OpenCode (cliente MCP nativo)
   -> stdio (JSON-RPC 2.0)
   -> mcp-server-chrome (tools/call)
   -> TCP localhost:8765
   -> native-host (framing 4 bytes)
   -> extensao Chrome -> DOM / chrome.tabs
```

## Nao e necessario plugin separado

Como o OpenCode já fala MCP nativamente, nao e necessario criar um plugin especifico para ele. Este pacote apenas documenta a ligacao. Se no futuro o OpenCode mudar seu modelo de extensao, basta adaptar a configuracao de `opencode-mcp.json`.
