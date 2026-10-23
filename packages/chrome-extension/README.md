# @harness-ctrl-chrome/chrome-extension

## Responsabilidade

**Extensão Chrome Manifest V3** que executa comandos de controle do navegador recebidos do host de mensagens nativas. Componentes:

| Componente | Arquivo | Papel |
|------------|---------|-------|
| **Service Worker (background)** | `background.ts` | Mantém porta com native-host, roteia comandos, gerencia abas, injeta content script |
| **Content Script** | `content.ts` | Executado no contexto da página: `fill_form`, `click`, `read`, `evaluate`, `screenshot` (full-page) |
| **Popup** | `popup.ts` + `popup.html` | UI mínima: status da conexão, botão reconectar |

---

## Arquitetura

```
native-host (stdin/stdout, 4-byte framing)
    ↓ chrome.runtime.connectNative()
background.ts (service worker)
    ├── chrome.tabs.* APIs  → comandos de aba (list, open, navigate, close, focus, get_page_info)
    └── chrome.tabs.sendMessage() → content.ts (DOM: fill_form, click, read, evaluate, screenshot)
content.ts (injetado em <all_urls>, document_idle, all_frames)
    └── DOM API / window / document
popup.html/ts → chrome.runtime.connect() → background (status)
```

---

## Permissões (manifest.json)

```json
{
  "permissions": ["tabs", "tabGroups", "scripting", "nativeMessaging"],
  "host_permissions": ["<all_urls>"],
  "background": { "service_worker": "background.js" },
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content.js"],
    "run_at": "document_idle",
    "all_frames": true
  }],
  "action": { "default_popup": "popup.html" },
  "web_accessible_resources": [{ "resources": ["content.js"], "matches": ["<all_urls>"] }]
}
```

---

## Instalação

```bash
# Na raiz do monorepo
pnpm install
pnpm run build   # compila TS → dist/ + copia manifest.json
```

### Carregar no Chrome (modo desenvolvedor)

1. Abra `chrome://extensions`
2. Ative **Modo de desenvolvedor** (canto superior direito)
3. Clique **Carregar sem compactação**
4. Selecione a pasta: `packages/chrome-extension/dist`
5. Anote o **ID da extensão** gerado (ex: `abcdefghijklmnopqrstuvwxyz123456`)

### Registrar o host nativo

**Obrigatório** antes da extensão conectar. Veja `packages/native-host/REGISTRO.md`.

No arquivo de manifesto do host (`com.host.harnessctrl.chrome.*.json`), defina `allowed_origins` com o ID da extensão:

```json
"allowed_origins": ["chrome-extension://abcdefghijklmnopqrstuvwxyz123456/"]
```

---

## Uso

### Iniciar a stack completa

```bash
# Terminal 1: MCP server
node packages/mcp-server-chrome/dist/index.js

# Terminal 2: native-host
node packages/native-host/dist/index.js
```

A extensão conecta-se automaticamente ao native-host ao carregar (ou ao iniciar o Chrome). O popup mostra status:

- 🟢 **Conectado** — pronto para receber comandos MCP
- 🔴 **Desconectado** — inicie o native-host e clique "Reconectar" (recarrega a extensão)

---

## Comandos suportados (recebidos do native-host)

### Comandos de aba (executados no background via `chrome.tabs.*`)

| Comando | Parâmetros | Retorno |
|---------|------------|---------|
| `list_tabs` | — | `TabInfo[]` |
| `open_tab` | `url?`, `active?`, `windowId?` | `TabInfo` |
| `navigate` | `tabId`, `url` | `TabInfo` |
| `close_tab` | `tabId` | `{ tabId }` |
| `focus_tab` | `tabId`, `windowId?` | `{ tabId, focused: true }` |
| `get_page_info` | `tabId?`, `windowId?` | `PageInfo` |

### Comandos de DOM (encaminhados ao content script via `chrome.tabs.sendMessage`)

| Comando | Parâmetros | Retorno |
|---------|------------|---------|
| `fill_form` | `tabId`, `fields: Record<selector, value>`, `submitAfter?` | `{ filled: string[] }` |
| `click` | `tabId`, `selector` | `{ clicked: boolean }` |
| `read` | `tabId`, `selector?`, `as?: 'text'\|'html'\|'json'` | `ReadResult` |
| `evaluate` | `tabId`, `script` | `any` (resultado do script) |
| `screenshot` | `tabId`, `format?`, `quality?`, `fullPage?` | `ScreenshotResult` |

> **Nota**: `screenshot` com `fullPage: true` tenta `chrome.tabs.captureVisibleTab`; se falhar, delega ao content script (limitado).

---

## Content Script — detalhes

Injetado em **todas as páginas** (`<all_urls>`, `all_frames: true`, `document_idle`).

### Ações implementadas

```typescript
// fill_form: preenche inputs/selects/textareas + dispara input/change events
fillForm(fields: Record<string, string>, submitAfter: boolean): { filled: string[] }

// click: clica elemento via HTMLElement.click()
click(selector: string): { clicked: boolean }

// read: lê textContent / innerHTML / JSON de elemento ou página inteira
read(selector?: string, as: 'text' | 'html' | 'json' = 'text'): ReadResult

// evaluate: executa script no contexto da página (acesso a window, document)
evaluate(script: string): any

// screenshot: full-page via canvas (não usado por padrão; background usa captureVisibleTab)
```

### Comunicação

Todas as mensagens usam marcador `__ext: 'harness-ctrl-chrome'` para evitar colisões.

**Background → Content:**
```typescript
chrome.tabs.sendMessage(tabId, {
  __ext: 'harness-ctrl-chrome',
  tabId,
  action: 'fill_form',
  payload: { fields: { '#user': 'x' }, submitAfter: true }
});
```

**Content → Background (resposta):**
```typescript
chrome.runtime.sendMessage({
  __ext: 'harness-ctrl-chrome',
  tabId,
  ok: true,
  data: { filled: ['#user'] }
});
```

---

## Popup (UI de diagnóstico)

Arquivos: `popup.html`, `popup.ts`.

Mostra:
- Status da conexão com native-host (verde/vermelho)
- Log de eventos de conexão
- Botão **Reconectar** (faz `chrome.runtime.reload()`)
- Botão **Abrir opções** (placeholder para futura página de opções)

Útil durante desenvolvimento para validar se a ponte native-host ↔ extensão está funcionando.

---

## Testes

```bash
pnpm test --workspace @harness-ctrl-chrome/chrome-extension
```

Cobertura atual:
- Content script: `fillForm`, `click`, `read` (DOM simulado via JSDOM)

---

## Estrutura do código

```
src/
├── background.ts    # Service worker: native-port, roteamento, tab APIs, content script injection
├── content.ts       # Content script: DOM actions (fill, click, read, evaluate)
├── popup.ts         # Popup UI logic
└── popup.html       # Popup markup
dist/                # Build output (manifest.json copiado aqui)
manifest.json        # Manifest V3 source
```

---

## Desenvolvimento

### Recarregar extensão durante desenvolvimento

1. `pnpm run build` (no pacote ou raiz)
2. Em `chrome://extensions`, clique no ícone de **recarregar** (🔄) na extensão
3. Ou use o botão "Reconectar" no popup (faz `chrome.runtime.reload()`)

### Logs

- **Background**: DevTools da extensão (em `chrome://extensions` → "Service worker" → "Inspecionar")
- **Content Script**: DevTools da página (F12 → Console)
- **Native-host**: stderr do terminal onde o Chrome rodou (ou journalctl)

---

## Princípios de design

- **Manifest V3**: service worker (não persistent background), `scripting.executeScript` para injeção garantida
- **Isolamento por aba**: content script roda no contexto de cada frame; background roteia por `tabId`
- **Injeção preguiçosa**: `executeScript({ files: ['content.js'] })` antes de cada comando DOM — garante que o script está lá mesmo após navegação
- **Sem segredos**: a extensão só acessa DOM do que o usuário já abriu; sem acesso a credenciais, cookies, storage sensível
- **KISS**: background só roteia; lógica de DOM fica no content script