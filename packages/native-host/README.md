# @harness-ctrl-chrome/native-host

## Responsabilidade

**Host de mensagens nativas do Chrome (Native Messaging Host)**. Faz a ponte bidirecional entre:

1. **Extensão Chrome** — comunica-se via `chrome.runtime.connectNative()` usando **stdin/stdout com framing de 4 bytes** (little-endian uint32 = tamanho do JSON)
2. **Servidor MCP (`mcp-server-chrome`)** — comunica-se via **TCP localhost** (porta 8765, JSON por linha `\n`)

O host é um **proxy simples sem estado de aplicação** (KISS). Não contém lógica de controle do Chrome; apenas encaminha mensagens.

---

## Fluxo de dados

```
Extensão Chrome (Manifest V3)
    ↓ chrome.runtime.connectNative('com.harnessctrl.chrome.host')
    ↓ stdin/stdout (4-byte framing + JSON)
native-host (ESTE PACOTE)
    ↓ TCP localhost:8765 (JSON + '\n')
mcp-server-chrome
```

### Extensão → MCP Server (comandos)
1. Extensão envia: `[4 bytes length][JSON]`
2. Host lê framing, decodifica JSON, envia `JSON\n` para TCP
3. MCP server processa, responde via TCP

### MCP Server → Extensão (resultados/eventos)
1. MCP server envia `JSON\n` via TCP
2. Host lê linha, codifica com framing 4 bytes, escreve no stdout
3. Extensão recebe via `port.onMessage`

---

## Instalação

```bash
# Na raiz do monorepo
pnpm install
pnpm run build   # gera dist/index.js
```

### Registro no Chrome (obrigatório)

O Chrome exige que o host nativo seja **registrado no sistema** antes da extensão poder conectar-se.

Consulte: **`REGISTRO.md`** nesta pasta para passos detalhados (Windows, Linux, macOS).

Resumo rápido (Windows PowerShell como Admin):
```powershell
# 1. Ajuste o caminho em com.host.harnessctrl.chrome.windows.json para o dist/index.js real
# 2. Copie para o registro do Chrome:
Copy-Item com.host.harnessctrl.chrome.windows.json `
  "$env:LOCALAPPDATA\Google\Chrome\User Data\NativeMessagingHosts\com.host.harnessctrl.chrome.json"

# 3. Edite o JSON e coloque o ID da extensão em "allowed_origins"
#    (obtido em chrome://extensions após carregar a extensão)
```

---

## Configuração (variáveis de ambiente)

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `MCP_CHROME_HOST` | `127.0.0.1` | Host do servidor MCP |
| `MCP_CHROME_PORT` | `8765` | Porta TCP do servidor MCP |
| `MCP_RECONNECT_INTERVAL_MS` | `2000` | Intervalo de reconexão ao MCP server |

---

## Uso

### Iniciar manualmente (desenvolvimento)

```bash
# Terminal 1: inicie o MCP server primeiro
node packages/mcp-server-chrome/dist/index.js

# Terminal 2: inicie o native-host
node packages/native-host/dist/index.js
```

### Em produção (via extensão)

O Chrome inicia o host automaticamente quando a extensão chama `chrome.runtime.connectNative()`. Não precisa iniciar manualmente.

Logs vão para **stderr** (console do terminal onde o Chrome foi iniciado, ou journalctl/syslog no Linux).

---

## Formato de mensagem (Native Messaging)

### Entrada (stdin → host)
```
[uint32 LE length][UTF-8 JSON]
```
Exemplo (comando `navigate`):
```
0x4a 0x00 0x00 0x00  {"type":"command","id":"abc","command":"navigate","payload":{"tabId":3,"url":"https://exemplo.com"},"timestamp":1234567890}
```

### Saída (host → stdout)
Mesmo formato: 4 bytes length + JSON UTF-8.

---

## Testes

```bash
pnpm test --workspace @harness-ctrl-chrome/native-host
```

Cobertura:
- Framing de 4 bytes (leitura/escrita)
- Encaminhamento TCP ↔ stdin/stdout
- Reconexão automática

---

## Estrutura do código

```
src/
└── index.ts    # Entry point: connect TCP, setup stdin framing, proxy bidirecional
```

---

## Arquivos de manifesto (registro)

| Arquivo | SO | Descrição |
|---------|-----|-----------|
| `com.host.harnessctrl.chrome.windows.json` | Windows | Caminho para `dist/index.js`, `allowed_origins` = ID da extensão |
| `com.host.harnessctrl.chrome.linux.json` | Linux | Mesmo, caminho ajustado para Linux |
| *(macOS usa o mesmo do Linux, caminho `~/Library/...`)* | | |

> **Importante**: Edite `allowed_origins` com o **ID real da extensão** (obtido em `chrome://extensions` no modo desenvolvedor).

---

## Princípios de design

- **Proxy burro**: sem lógica de negócio; apenas encaminha bytes
- **Reconexão automática**: exponencial simples (fixo 2s) se o MCP server cair
- **Proteção contra mensagens grandes**: rejeita > 1 MB
- **Graceful shutdown**: SIGTERM/SIGINT fecham sockets e saem limpo
- **Logging em stderr**: não polui stdout (que é o canal de dados)