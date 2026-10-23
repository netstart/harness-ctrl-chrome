# @harness-ctrl-chrome/dsh-skill

## Responsabilidade

**Skill de instruções (bloco de orientação)** para o **DeepSeek Harness (DSH)** ensinar o agente a usar as ferramentas MCP do Harness Ctrl Chrome.

> **Importante**: Esta skill **não é um plugin de execução**. A execução real é feita pelo `mcp-server-chrome` + `native-host` + `chrome-extension`. Este pacote apenas documenta **quais ferramentas existem** e **como chamá-las** via protocolo MCP.

---

## O que contém

| Arquivo | Descrição |
|---------|-----------|
| `instructions.md` | Instruções completas para o agente DSH: lista de ferramentas, parâmetros, exemplos de chamada, requisitos de ambiente |
| `USAR.md` | Guia rápido passo a passo para o usuário final configurar e usar a skill no DSH |

---

## Ferramentas MCP expostas (disponíveis ao agente DSH)

| Ferramenta MCP | Descrição | Parâmetros |
|----------------|-----------|------------|
| `chrome_list_tabs` | Lista todas as abas | — |
| `chrome_open_tab` | Abre nova aba | `url?`, `active?`, `windowId?` |
| `chrome_navigate` | Navega aba existente | `tabId`, `url` |
| `chrome_close_tab` | Fecha aba | `tabId` |
| `chrome_focus_tab` | Foca/traz aba para frente | `tabId`, `windowId?` |
| `chrome_fill_form` | Preenche campos por seletor CSS | `tabId`, `fields: Record<selector, value>`, `submitAfter?` |
| `chrome_click` | Clica elemento por seletor CSS | `tabId`, `selector` |
| `chrome_read` | Lê texto/HTML/JSON da página ou elemento | `tabId`, `selector?`, `as?: 'text'\|'html'\|'json'` |
| `chrome_screenshot` | Captura tela da aba | `tabId`, `format?`, `quality?`, `fullPage?` |
| `chrome_evaluate` | Executa JavaScript na página | `tabId`, `script` |
| `chrome_get_page_info` | Informações da aba (URL, título, favicon) | `tabId?`, `windowId?` |

---

## Instalação

Este pacote **não precisa de build** — contém apenas arquivos Markdown.

```bash
# Na raiz do monorepo (para ter o contexto completo)
pnpm install
pnpm run build   # compila os pacotes de execução (mcp-server-chrome, etc.)
```

---

## Como usar no DeepSeek Harness

### 1. Preparar o ambiente (obrigatório)

```bash
# Raiz do monorepo
pnpm install
pnpm run build

# Registrar host nativo do Chrome (Windows/Linux/macOS)
# Veja: packages/native-host/REGISTRO.md

# Carregar extensão no Chrome
# chrome://extensions → Modo desenvolvedor → Carregar sem compactação
# Pasta: packages/chrome-extension/dist

# Iniciar servidores (2 terminais)
# Terminal 1
node packages/mcp-server-chrome/dist/index.js

# Terminal 2
node packages/native-host/dist/index.js
```

### 2. Carregar a skill no DSH

**Opção A — Contexto do agente (recomendado)**  
Cole o conteúdo de `packages/dsh-skill/instructions.md` nas instruções do agente (system prompt / agent instructions) no DeepSeek Harness.

**Opção B — Ponto de extensão de skills (se disponível)**  
Se o DSH tiver um mecanismo de skills/plugins MCP, aponte para o servidor `mcp-server-chrome` (stdio) e carregue `instructions.md` como skill.

### 3. Conversar com o agente

Exemplos de comandos naturais que o agente saberá transformar em `tools/call` MCP:

> "Abra uma aba no Chrome e acesse https://github.com"  
> "Preencha o formulário de login: usuário em `#email`, senha em `#senha`, depois clique em entrar"  
> "Leia o conteúdo da aba atual e me dê um resumo"  
> "Clique no botão com seletor `.btn-primary`"  
> "Tire um print da página inteira da aba 2"  
> "Liste todas as abas abertas"  
> "Execute `document.title = 'Novo título'` na aba 3"

---

## Exemplo de chamada MCP (o que o agente envia)

```json
{
  "jsonrpc": "2.0",
  "id": "call-1",
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

Resposta:
```json
{
  "jsonrpc": "2.0",
  "id": "call-1",
  "result": { "filled": ["#usuario", "#senha"] }
}
```

---

## Requisitos de ambiente (checklist)

- [ ] Node.js ≥ 20
- [ ] `pnpm install && pnpm run build` executado na raiz
- [ ] Host nativo registrado no Chrome (`packages/native-host/REGISTRO.md`)
- [ ] Extensão carregada em `chrome://extensions` (pasta `dist`)
- [ ] `mcp-server-chrome` rodando (stdio)
- [ ] `native-host` rodando (conecta ao MCP server TCP:8765)
- [ ] Skill carregada no DSH (`instructions.md` como instrução do agente)

---

## Arquitetura (para o agente entender)

```
Agente DSH (você)
    ↓ tools/call (MCP/JSON-RPC 2.0 via stdio)
mcp-server-chrome (servidor MCP)
    ↓ TCP localhost:8765
native-host (ponte Native Messaging)
    ↓ stdin/stdout (4-byte framing)
chrome-extension (background + content script)
    ↓ chrome.tabs.* / DOM APIs
Google Chrome (abas, páginas, formulários)
```

---

## Princípios

- **KISS**: a skill só orienta; não duplica lógica de execução
- **ACID**: cada `tools/call` é atômico e isolado por aba (via `TabMutex` no servidor)
- **Segurança**: o agente só age em abas que o usuário já abriu/navega; sem acesso a senhas, cookies, ou dados sensíveis além do exposto no DOM
- **Declarativo**: o agente descreve *o que* fazer (seletores, valores); o servidor executa *como* (eventos input/change, injeção de script, etc.)

---

## Troubleshooting

| Sintoma | Causa provável | Solução |
|---------|----------------|---------|
| "Ferramenta não encontrada" | MCP server não iniciado ou DSH não conectou | Verifique se `mcp-server-chrome` roda e DSH está configurado para stdio |
| "Host nativo não conectado" | Native-host não rodando ou manifesto inválido | Inicie `node packages/native-host/dist/index.js`; veja `REGISTRO.md` |
| "TabId inválido" | Aba fechou ou ID mudou | Use `chrome_list_tabs` para obter IDs atuais |
| "Elemento não encontrado" | Seletor errado ou página não carregou | Use `chrome_read` para inspecionar DOM; aguarde `page_loaded` |
| Timeout | Comando demorou > 30s | Aumente `MCP_COMMAND_TIMEOUT_MS` no servidor; verifique se Chrome responde |

---

## Referência rápida (para colar no system prompt do agente)

```markdown
## Ferramentas Chrome MCP (Harness Ctrl Chrome)

chrome_list_tabs() → TabInfo[]
chrome_open_tab({url?, active?, windowId?}) → TabInfo
chrome_navigate({tabId, url}) → TabInfo
chrome_close_tab({tabId}) → {tabId}
chrome_focus_tab({tabId, windowId?}) → {tabId, focused: true}
chrome_fill_form({tabId, fields: {selector: value}, submitAfter?}) → {filled: string[]}
chrome_click({tabId, selector}) → {clicked: boolean}
chrome_read({tabId, selector?, as?: 'text'|'html'|'json'}) → {selector?, as, content, length}
chrome_screenshot({tabId, format?: 'png'|'jpeg', quality?, fullPage?}) → {tabId, format, dataUrl, bytes}
chrome_evaluate({tabId, script}) → any
chrome_get_page_info({tabId?, windowId?}) → {tabId, url, title, favIconUrl?}
```