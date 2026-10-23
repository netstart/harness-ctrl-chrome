# @harness-ctrl-chrome/e2e-tests

## Responsabilidade

**Testes end-to-end** que validam o fluxo completo do Harness Ctrl Chrome:

```
Cliente MCP (teste) → mcp-server-chrome (stdio) → native-host (TCP) → chrome-extension → Chrome real (Puppeteer/Playwright)
```

Diferente dos testes unitários de cada pacote (Jest + ts-jest, mocks), estes testes **exercutam a integração real** com:
- Servidor MCP rodando
- Host nativo rodando
- Chrome real (headless) via Puppeteer
- Extensão carregada no Chrome

---

## Instalação

```bash
# Na raiz do monorepo
pnpm install
pnpm run build   # compila todos os pacotes
```

### Dependências extras (Chrome headless)

Os testes usam **Puppeteer** que baixa seu próprio Chromium. Não precisa de Chrome instalado no sistema.

Se quiser usar Chrome do sistema:
```bash
export PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome  # Linux
# ou
set PUPPETEER_EXECUTABLE_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe  # Windows
```

---

## Estrutura

```
src/
├── mcp-client.ts          # Cliente MCP mínimo (stdio JSON-RPC 2.0) para testes
scripts/
├── orchestrator.ts        # Sobe/desce MCP server + native-host + Chrome + extensão
tests/
└── mcp-chrome.e2e.test.ts # Casos de teste (abrir aba, navegar, preencher, ler, click, screenshot)
jest.config.js             # Config Jest (timeout longo, setup/teardown global)
```

---

## Como rodar

### Pré-requisitos

1. **Build completo**: `pnpm run build` na raiz
2. **Host nativo registrado**: veja `packages/native-host/REGISTRO.md`
3. **Extensão carregada no Chrome de teste**: o orchestrator carrega a extensão automaticamente via Puppeteer

### Executar testes

```bash
# Na raiz do monorepo
pnpm test --workspace @harness-ctrl-chrome/e2e-tests

# Ou direto no pacote
cd packages/e2e-tests
pnpm test
```

> **Timeout**: testes e2e são lentos (sobem Chrome, extensão, servidores). Timeout padrão: **120s** por teste.

### Modo watch (desenvolvimento)

```bash
cd packages/e2e-tests
pnpm test:watch
```

---

## O que o orchestrator faz (`scripts/orchestrator.ts`)

1. **Inicia MCP server** (`node packages/mcp-server-chrome/dist/index.js`) — captura stdio
2. **Inicia native-host** (`node packages/native-host/dist/index.js`) — conecta ao MCP server via TCP
3. **Inicia Chrome headless** via Puppeteer com:
   - `--enable-automation`
   - `--load-extension=packages/chrome-extension/dist`
   - Porta de debugging aberta
4. **Aguarda extensão conectar** ao native-host (polling no native-host stderr)
5. **Expõe cliente MCP** para os testes chamarem `tools/call`
6. **Teardown**: mata processos, fecha Chrome

---

## Testes atuais (`tests/mcp-chrome.e2e.test.ts`)

| Teste | O que valida |
|-------|--------------|
| `list_tabs` | Lista abas iniciais (pelo menos a aba `about:blank`) |
| `open_tab + navigate` | Abre aba, navega para URL, valida título/URL |
| `fill_form + click` | Preenche formulário simples, submete, valida navegação |
| `read` | Lê conteúdo da página (text/html) |
| `evaluate` | Executa JS no contexto da página |
| `screenshot` | Captura tela (data URL base64 válida) |
| `close_tab` | Fecha aba e valida remoção da lista |
| `eventos` | Verifica se `tab_created`, `page_loaded` são emitidos |

---

## Escrevendo novos testes

Use o `mcpClient` exposto pelo setup global:

```typescript
import { mcpClient } from '../src/mcp-client';

test('meu teste customizado', async () => {
  // 1. Abre aba
  const open = await mcpClient.call('chrome_open_tab', { url: 'https://exemplo.com' });
  const tabId = open.tabId;

  // 2. Chama ferramenta
  const result = await mcpClient.call('chrome_read', { tabId, as: 'text' });
  expect(result.content.length).toBeGreaterThan(0);

  // 3. Fecha
  await mcpClient.call('chrome_close_tab', { tabId });
});
```

### Métodos do `mcpClient`

```typescript
mcpClient.call(toolName: string, args: Record<string, any>): Promise<any>
mcpClient.listTools(): Promise<string[]>
mcpClient.close(): Promise<void>
```

---

## CI/CD (GitHub Actions)

Exemplo de workflow (`.github/workflows/e2e.yml`):

```yaml
name: E2E Tests
on: [push, pull_request]
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run build
      - name: Register native host
        run: |
          mkdir -p ~/.config/google-chrome/NativeMessagingHosts
          cp packages/native-host/com.host.harnessctrl.chrome.linux.json \
            ~/.config/google-chrome/NativeMessagingHosts/com.host.harnessctrl.chrome.json
          # Ajustar allowed_origins após build da extensão (ID dinâmico)
      - run: npm test --workspace @harness-ctrl-chrome/e2e-tests
```

> **Nota**: Em CI headless, o ID da extensão muda a cada execução. O orchestrator lê o ID do Chrome e injeta no manifesto do host nativo dinamicamente.

---

## Debugging

### Ver logs do Chrome
```bash
# No teste, adicione:
const browser = await puppeteer.launch({
  headless: false,  // abre Chrome visível
  devtools: true,   // abre DevTools
  // ...
});
```

### Logs do MCP server / native-host
O orchestrator redireciona stdout/stderr. Para ver ao vivo:
```typescript
mcpServerProcess.stderr?.on('data', d => console.log('[MCP]', d.toString()));
nativeHostProcess.stderr?.on('data', d => console.log('[HOST]', d.toString()));
```

### Screenshot em falha
Jest pode capturar screenshot via Puppeteer no `afterEach` se teste falhar.

---

## Princípios

- **Teste real**: nada de mocks — Chrome real, extensão real, servidores reais
- **Isolamento**: cada teste abre/fecha suas abas; `beforeEach`/`afterEach` limpam estado
- **Determinístico**: URLs de teste controladas (`https://httpbin.org`, `data:` URLs, arquivos locais)
- **Lento mas confiável**: aceita timeout alto para pegar flakiness de integração real