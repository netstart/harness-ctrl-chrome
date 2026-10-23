# @harness-ctrl-chrome/mcp-server-chrome

## Responsabilidade

**Servidor MCP (Model Context Protocol)** que roda em **stdio** (JSON-RPC 2.0) e expõe ferramentas para controlar o Google Chrome. É a ponte entre clientes MCP (OpenCode, DeepSeek Harness) e o ecossistema Chrome (native-host + extensão).

### O que este servidor faz

1. **Aceita conexões MCP via stdio** — clientes (OpenCode v2, DSH) conectam-se aqui e chamam `tools/call`
2. **Mantém servidor TCP (porta 8765)** — o `native-host` conecta-se aqui para fazer a ponte Chrome ↔ MCP
3. **Serializa comandos por aba (TabMutex)** — garante isolamento (ACID I): comandos na mesma aba executam em sequência; abas diferentes rodam em paralelo
4. **Expõe 11 ferramentas MCP** — `chrome_list_tabs`, `chrome_open_tab`, `chrome_navigate`, `chrome_close_tab`, `chrome_focus_tab`, `chrome_fill_form`, `chrome_click`, `chrome_read`, `chrome_screenshot`, `chrome_evaluate`, `chrome_get_page_info`
5. **Repassa eventos do Chrome** — `tab_created`, `tab_removed`, `tab_updated`, `tab_activated`, `navigated`, `page_loaded`, `console_message`, `error` como notificações MCP

---

## Arquitetura

```
Cliente MCP (OpenCode/DSH)
    ↓ stdio (JSON-RPC 2.0)
mcp-server-chrome (ESTE PACOTE)
    ↓ TCP localhost:8765
native-host (ponte Native Messaging)
    ↓ stdin/stdout (framing 4 bytes)
chrome-extension (background + content script)
    ↓ Chrome APIs / DOM
Google Chrome
```

---

## Ferramentas MCP expostas

| Ferramenta | Descrição | Parâmetros principais |
|------------|-----------|----------------------|
| `chrome_list_tabs` | Lista todas as abas | — |
| `chrome_open_tab` | Abre nova aba | `url?`, `active?`, `windowId?` |
| `chrome_navigate` | Navega aba existente | `tabId`, `url` |
| `chrome_close_tab` | Fecha aba | `tabId` |
| `chrome_focus_tab` | Foca aba | `tabId`, `windowId?` |
| `chrome_fill_form` | Preenche formulário | `tabId`, `fields: Record<selector, value>`, `submitAfter?` |
| `chrome_click` | Clica elemento | `tabId`, `selector` |
| `chrome_read` | Lê conteúdo | `tabId`, `selector?`, `as?: 'text'\|'html'\|'json'` |
| `chrome_screenshot` | Captura tela | `tabId`, `format?`, `quality?`, `fullPage?` |
| `chrome_evaluate` | Executa JS na página | `tabId`, `script` |
| `chrome_get_page_info` | Info da aba ativa/indicada | `tabId?`, `windowId?` |

---

## Instalação

```bash
# Na raiz do monorepo
pnpm install
pnpm run build   # compila para dist/index.js
```

---

## Configuração (variáveis de ambiente)

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `MCP_CHROME_PORT` | `8765` | Porta TCP para o native-host conectar |
| `MCP_COMMAND_TIMEOUT_MS` | `30000` | Timeout de comandos enviados ao Chrome |

---

## Uso

### Iniciar o servidor

```bash
node packages/mcp-server-chrome/dist/index.js
```

Saída esperada:
```
[mcp-server-chrome] escutando host nativo na porta 8765
```

O servidor fica aguardando:
- Mensagens JSON-RPC 2.0 no **stdin** (clientes MCP)
- Conexão TCP do **native-host** na porta configurada

### Conectar no OpenCode v2

Copie `packages/opencode-connector/opencode.json` para seu config global do OpenCode:

- Linux/macOS: `~/.config/opencode/opencode.json`
- Windows: `%APPDATA%\opencode\opencode.json`

Ajuste o `cwd` para o caminho absoluto de `packages/mcp-server-chrome` no seu sistema.

Reinicie o OpenCode.

### Conectar no DeepSeek Harness

Carregue `packages/dsh-skill/instructions.md` como instrução do agente. O DSH chamará as ferramentas MCP via stdio neste servidor.

---

## Exemplo de chamada MCP (tools/call)

```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "method": "tools/call",
  "params": {
    "name": "chrome_fill_form",
    "arguments": {
      "tabId": 3,
      "fields": { "#usuario": "fulano", "#senha": "minhasenha" },
      "submitAfter": true
    }
  }
}
```

Resposta de sucesso:
```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "result": { "filled": ["#usuario", "#senha"] }
}
```

Resposta de erro:
```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "error": { "code": -32603, "message": "Elemento não encontrado: #usuario" }
}
```

---

## Testes

```bash
# Todos os testes do monorepo
pnpm test

# Apenas este pacote
pnpm test --workspace @harness-ctrl-chrome/mcp-server-chrome
```

Cobertura atual:
- `TabMutex` — isolamento/concorrência por aba
- `MCPHandler` — initialize, tools/list, tools/call, erros, parse inválido

---

## Estrutura do código

```
src/
├── index.ts          # Entry point: stdio + TCP server + TabMutex
├── protocol.ts       # MCPHandler: JSON-RPC 2.0, tools, notificações
├── tools.ts          # Criação das 11 ferramentas MCP (wrappers de sendCommand)
└── lock.ts           # TabMutex: serialização por tabId
```

---

## Princípios de design

- **KISS**: implementa JSON-RPC 2.0 manualmente, sem SDK oficial do MCP
- **ACID**: atomicidade por `tools/call`, isolamento por `TabMutex`, consistência via resultado real do Chrome
- **Resiliente**: try/catch no loop de leitura do stdio; erros viram respostas JSON-RPC (-32603) em vez de derrubar o processo
- **Sem estado persistente**: o estado vive no Chrome; o servidor é stateless