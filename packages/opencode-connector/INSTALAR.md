# Instalacao rapida — OpenCode + Harness Ctrl Chrome (OpenCode v2)

Passos minimos para colocar o OpenCode (versao 2) controlando o Chrome via MCP.

```bash
# 1. Na raiz do monorepo
pnpm install
pnpm run build

# 2. Registre o host de mensagens nativas (Windows, PowerShell)
#    Veja detalhes em packages/native-host/REGISTRO.md

# 3. Carregue a extensao em chrome://extensions (modo desenvolvedor)
#    Pasta: packages/chrome-extension/dist

# 4. Inicie o servidor MCP (um terminal)
node packages/mcp-server-chrome/dist/index.js

# 5. Inicie o host nativo (outro terminal)
node packages/native-host/dist/index.js

# 6. Configure o OpenCode v2
#    Copie o conteudo de packages/opencode-connector/opencode.json para o seu
#    arquivo de configuracao global do OpenCode v2:
#      Linux/macOS: ~/.config/opencode/opencode.json  (ou opencode.jsonc)
#      Windows:     %APPDATA%\\opencode\\opencode.json
#
#    Ajuste o campo "cwd" para o caminho absoluto do pacote mcp-server-chrome
#    no seu sistema (no Windows use barras duplas \\ ou barras simples /).
#
#    No Windows (PowerShell), exemplo:
#      Get-Content packages\\opencode-connector\\opencode.json | Out-File -Encoding utf8 $env:APPDATA\\opencode\\opencode.json

# 7. Reinicie o OpenCode e comece a conversar com o Chrome.
```

Depois de configurado, basta pedir ao modelo no OpenCode: "abre o Chrome e navega para ...", "preenche o form ...", etc.

## Porque opencode.json e nao ~/.opencode/mcp.json

O OpenCode v2 tem cliente MCP nativo e le sua configuracao em `opencode.json` / `opencode.jsonc` (dentro do diretorio global de config), **nao** em `~/.opencode/mcp.json`. Cada servidor MCP no formato v2 exige:

- `type: "local"` para servidores stdio
- `command: string[]` (ex. `["node", "dist/index.js"]`)
- `cwd` (opcional, recomendado) para o diretorio de trabalho do servidor
- `environment` para variaveis de ambiente

Veja o exemplo em `packages/opencode-connector/opencode.json`.

## Arquitetura (resumo)

```
OpenCode (cliente MCP nativo, v2)
   -> stdio (JSON-RPC 2.0)
   -> mcp-server-chrome (tools/call)
   -> TCP localhost:8765
   -> native-host (framing 4 bytes)
   -> extensao Chrome -> DOM / chrome.tabs
```

Nao e necessario plugin separado: o OpenCode v2 ja fala MCP nativamente.
