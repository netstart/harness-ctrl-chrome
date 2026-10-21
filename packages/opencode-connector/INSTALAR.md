# Instalacao rapida — OpenCOde + Harness Ctrl Chrome

Passos minimos para colocar o OpenCode controlando o Chrome:

```bash
# 1. Na raiz do monorepo
pnpm install
pnpm run build

# 2. Registre o host nativo (Windows, PowerShell)
#    Veja detalhes em packages/native-host/REGISTRO.md

# 3. Carregue a extensao em chrome://extensions (modo desenvolvedor)
#    Pasta: packages/chrome-extension/dist

# 4. Inicie o servidor MCP
node packages/mcp-server-chrome/dist/index.js

# 5. Inicie o host nativo
node packages/native-host/dist/index.js

# 6. Copie a configuracao MCP para o OpenCode
#    (Linux/macOS ajuste o caminho em opencode-mcp.json)
copy packages\\opencode-connector\\opencode-mcp.json %USERPROFILE%\\.opencode\\mcp.json

# 7. Reinicie o OpenCode e comece a conversar com o Chrome.
```

Depois de configurado, basta pedir ao modelo no OpenCode: "abre o Chrome e navega para ...", "preenche o form ...", etc.
