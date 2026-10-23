# @harness-ctrl-chrome/shared-protocol

## Responsabilidade

Define os **tipos TypeScript** e **funções de validação em tempo de execução** do protocolo de fio (wire protocol) compartilhado entre todos os componentes do Harness Ctrl Chrome:

- `mcp-server-chrome` — servidor MCP (stdio + TCP)
- `native-host` — host de mensagens nativas do Chrome
- `chrome-extension` — extensão Manifest V3 (background + content script)

Garante que comandos, resultados e eventos tenham estrutura consistente e possam ser validados antes de serem processados.

---

## O que este pacote exporta

### Tipos principais

| Tipo | Descrição |
|------|-----------|
| `WireEnvelope` | Envelope base com `type: 'command' \| 'result' \| 'event'`, `id` (correlação), `timestamp` |
| `CommandMessage` | Comando enviado do MCP server para o Chrome (`list_tabs`, `open_tab`, `navigate`, `close_tab`, `focus_tab`, `fill_form`, `click`, `read`, `screenshot`, `evaluate`, `get_page_info`) |
| `ResultMessage` | Resultado de um comando (`ok: boolean`, `data?`, `error?`) |
| `EventMessage` | Evento assíncrono do Chrome (`tab_created`, `tab_removed`, `tab_updated`, `tab_activated`, `navigated`, `page_loaded`, `console_message`, `error`) |
| `TabInfo`, `PageInfo`, `ReadResult`, `ScreenshotResult` | Estruturas de dados de retorno |

### Constantes de validação

- `CHROME_COMMANDS: Set<string>` — conjunto dos 11 nomes de comando válidos
- `CHROME_EVENTS: Set<string>` — conjunto dos 8 nomes de evento válidos

### Funções de guarda (type guards)

```typescript
isWireEnvelope(v: unknown): v is WireEnvelope
isCommandMessage(v: unknown): v is CommandMessage
isResultMessage(v: unknown): v is ResultMessage
isEventMessage(v: unknown): v is EventMessage
isKnownWireMessage(v: unknown): v is CommandMessage | ResultMessage | EventMessage
```

---

## Instalação

Este pacote é uma dependência interna do monorepo. Não é publicado no npm.

```bash
# Na raiz do monorepo
pnpm install
pnpm run build   # compila todos os pacotes, inclusive shared-protocol
```

O build gera em `packages/shared-protocol/dist/`:
- `index.js` / `index.d.ts` — CommonJS + declarações TypeScript
- Source maps (`.map`)

---

## Uso

### Como dependência (interno ao monorepo)

No `package.json` dos consumidores (`mcp-server-chrome`, `native-host`, `chrome-extension`):

```json
{
  "dependencies": {
    "@harness-ctrl-chrome/shared-protocol": "file:../shared-protocol"
  }
}
```

Importação em TypeScript:

```typescript
import {
  CommandMessage,
  ResultMessage,
  EventMessage,
  isCommandMessage,
  CHROME_COMMANDS,
  type FillFormPayload,
  type TabInfo
} from '@harness-ctrl-chrome/shared-protocol';
```

### Validação de mensagens recebidas (exemplo)

```typescript
function handleWireLine(line: string): void {
  let parsed: unknown;
  try { parsed = JSON.parse(line); } catch { return; }

  if (!isKnownWireMessage(parsed)) {
    console.error('Mensagem de fio inválida');
    return;
  }

  if (parsed.type === 'command') {
    // parsed é CommandMessage — seguro acessar parsed.command, parsed.payload
    dispatchCommand(parsed.command, parsed.payload);
  }
  // ...
}
```

---

## Comandos disponíveis (resumo)

| Comando | Payload principal | Retorno típico |
|---------|-------------------|----------------|
| `list_tabs` | `{}` | `TabInfo[]` |
| `open_tab` | `{ url?, active?, windowId? }` | `TabInfo` |
| `navigate` | `{ tabId, url }` | `TabInfo` |
| `close_tab` | `{ tabId }` | `{ tabId }` |
| `focus_tab` | `{ tabId, windowId? }` | `{ tabId, focused: true }` |
| `fill_form` | `{ tabId, fields: Record<string,string>, submitAfter? }` | `{ filled: string[] }` |
| `click` | `{ tabId, selector }` | `{ clicked: boolean }` |
| `read` | `{ tabId, selector?, as?: 'text'\|'html'\|'json' }` | `ReadResult` |
| `screenshot` | `{ tabId, format?: 'png'\|'jpeg', quality?, fullPage? }` | `ScreenshotResult` |
| `evaluate` | `{ tabId, script }` | `any` (resultado do script) |
| `get_page_info` | `{ tabId?, windowId? }` | `PageInfo` |

---

## Eventos disponíveis (Chrome → MCP server)

| Evento | Payload |
|--------|---------|
| `tab_created` | `TabInfo` |
| `tab_removed` | `{ tabId }` |
| `tab_updated` | `TabInfo` |
| `tab_activated` | `TabInfo` |
| `navigated` | `TabInfo` |
| `page_loaded` | `TabInfo` |
| `console_message` | `{ tabId, level, text }` |
| `error` | `{ message, context? }` |

---

## Testes

```bash
# Na raiz do monorepo
pnpm test --workspace @harness-ctrl-chrome/shared-protocol
```

> Atualmente o pacote não possui testes próprios (apenas tipos e validação). Testes de integração ficam em `packages/e2e-tests`.

---

## Princípios de design

- **Single source of truth**: todos os componentes importam tipos daqui; não há duplicação.
- **Validação em runtime**: type guards permitem validar JSON vindo da rede/stdin antes de usar.
- **Sem dependências de runtime**: apenas TypeScript puro; zero dependências em `dependencies`.
- **Versionamento em lockstep**: versão do pacote sobe junto com o monorepo.