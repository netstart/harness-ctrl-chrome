# Harness Ctrl Chrome

Controle o **Google Chrome** (abrir abas, navegar, preencher formulários, ler páginas, tirar prints, clicar, executar JavaScript) a partir de conversas com LLM no **OpenCode** e no **DeepSeek Harness**, passando por um **servidor MCP** e uma **extensão Chrome (Manifest V3)**.

Este é um **monorepo**: vários projetos integrados em um único repositório, cada um com sua própria responsabilidade, testes automatizados e documentação.

---

## O que este repositorio oferece

| Projeto | Pasta | O que faz |
|---|---|---|
| **shared-protocol** | `packages/shared-protocol` | Tipos e validação do protocolo de fio (comandos/resultados/eventos) entre todos os componentes |
| **mcp-server-chrome** | `packages/mcp-server-chrome` | Servidor MCP (stdio, JSON-RPC 2.0) que expõe ferramentas de controle do Chrome |
| **native-host** | `packages/native-host` | Host de mensagens nativas do Chrome: ponte stdio (4 bytes) ↔ TCP localhost |
| **chrome-extension** | `packages/chrome-extension` | Extensão Chrome Manifest V3: service worker + content script + popup |
| **opencode-connector** | `packages/opencode-connector` | Configuração de exemplo para ligar o OpenCode ao servidor MCP (sem plugin separado) |
| **dsh-skill** | `packages/dsh-skill` | Instruções (skill opcional) para o DeepSeek Harness usar as ferramentas MCP do Chrome |

---

## Arquitetura (visão didática)

```
+-------------------+      stdio (JSON-RPC 2.0)      +-----------------------+
|  OpenCode / DSH   | <=============================> |  mcp-server-chrome    |
|  (cliente MCP)    |                                 |  (servidor MCP stdio) |
+-------------------+                                 +-----------------------+
                                                                  |
                                                                  | TCP localhost:8765
                                                                  v
+-------------------+      framing 4 bytes      +-----------------------+
|   native-host     | <=======================> |  extensao Chrome      |
|  (ponte nativa)   |      stdio (Native        |  (Manifest V3)        |
+-------------------+      Messaging host)      |  background + content |
                                                 |  script (DOM/tabs)    |
                                                 +-----------------------+
                                                                  |
                                                                  v
                                                        +-------------------+
                                                        |   Google Chrome   |
                                                        |  (abas, DOM, etc) |
                                                        +-------------------+
```

### Fluxo de uma acao (ex: "preencha o form de login")

1. **Usuario** fala com a LLM no OpenCode ou DeepSeek Harness: "preencha o usuario e senha e envie".
2. **LLM** chama a ferramenta MCP `chrome_fill_form` com `{ tabId, fields: { '#usuario': 'fulano', '#senha': 'x' }, submitAfter: true }`.
3. **mcp-server-chrome** recebe a chamada pelo stdio, serializa por aba (isolamento via `TabMutex`) e envia o comando pelo TCP para o **native-host**.
4. **native-host** faz framing (4 bytes + JSON) e envia para a **extensão Chrome** via Native Messaging.
5. **Extensão Chrome** (service worker) roteia o comando:
   - Comandos de aba (`open_tab`, `navigate`, etc.) → APIs `chrome.tabs`.
   - Comandos de DOM (`fill_form`, `click`, `read`, `evaluate`) → **content script** injetado na página.
6. O resultado retorna pelo mesmo caminho até a LLM, que apresenta ao usuário.

---

## Decisoes de projeto (por que fizemos assim)

### Nao criamos plugin para o OpenCode
O OpenCode já possui **cliente MCP nativo**: basta adicionar o servidor em `~/.opencode/mcp.json`. Criar um plugin separado duplicaria funcionalidade, adicionaria atrito de instalação e violaria o princípio **KISS**. O pacote `packages/opencode-connector` contém apenas o arquivo de configuração de exemplo (`opencode-mcp.json`) e instruções.

### Nao criamos uma "skill" obrigatoria para o DSH
No DeepSeek Harness, "skill" é um bloco de instruções para o agente, não um mecanismo de execução. A execução real fica a cargo do `mcp-server-chrome` + extensão. O pacote `packages/dsh-skill` oferece um arquivo de instruções opcional (`instructions.md`) que ensina o agente do DSH a chamar as ferramentas MCP do Chrome.

### Protocolo proprio (sem SDK oficial do MCP)
O `mcp-server-chrome` implementa o JSON-RPC 2.0 sobre stdio por conta própria, sem dependência do SDK oficial do MCP. Isso torna o servidor:
- **Enxuto**: poucas dependências de runtime.
- **Offline-friendly**: funciona sem precisar baixar pacotes do SDK.
- **Facil de auditar**: poucos arquivos, lógica clara.

### Garantias no estilo ACID
- **Atomicidade**: cada `tools/call` completa com sucesso ou retorna erro, sem efeito parcial visível ao cliente.
- **Consistencia**: o resultado reflete o estado observado no Chrome (via APIs nativas ou content script).
- **Isolamento**: `TabMutex` serializa comandos concorrentes na mesma aba; abas diferentes seguem concorrentes.
- **Durabilidade**: o estado vive no Chrome (não gravamos persistência local por design).

---

## Guia rapido de uso

### 1. Instalar dependências
```bash
npm install
```

### 2. Compilar todos os pacotes
```bash
npm run build
```

### 3. Registrar o host de mensagens nativas do Chrome
O Chrome exige que o host nativo seja registrado antes da extensão se conectar. Consulte:
- `packages/native-host/REGISTRO.md` (passos detalhados para Windows/Linux/macOS).

### 4. Carregar a extensão no Chrome
1. Abra `chrome://extensions`.
2. Ative o **Modo de desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** e selecione a pasta `packages/chrome-extension/dist`.
4. Anote o **ID da extensão** gerado e preencha no campo `allowed_origins` do manifesto do host (`packages/native-host/com.host.harnessctrl.chrome.*.json`).

### 5. Iniciar os servidores (dois terminais)
```bash
# Terminal 1 - servidor MCP
node packages/mcp-server-chrome/dist/index.js

# Terminal 2 - host nativo
node packages/native-host/dist/index.js
```

### 6. Configurar o OpenCode
Copie o conteúdo de `packages/opencode-connector/opencode-mcp.json` para o seu `~/.opencode/mcp.json` (ou adicione a entrada `harness-ctrl-chrome` ao arquivo existente). No Linux/macOS, ajuste o caminho em `args` para o `dist/index.js` absoluto. Reinicie o OpenCode.

### 7. Usar o DeepSeek Harness
Carregue o conteúdo de `packages/dsh-skill/instructions.md` como instrução do agente (ou através do ponto de extensão de skills do DSH, se disponível).

### 8. Conversar com o Chrome
Exemplos do que pedir ao modelo:
- "Abra uma aba nova no Chrome e acesse https://exemplo.com"
- "Preencha o formulário de login: usuário em '#usuario' e senha em '#senha', depois envie"
- "Leia o conteúdo da aba atual e me resuma"
- "Clique no botão com seletor '.btn-enviar'"
- "Tire um print da página inteira da aba 3"
- "Liste todas as abas abertas"

---

## Testes automatizados

Cada pacote com lógica própria possui testes via Jest + ts-jest:

```bash
npm test                    # todos os pacotes
npm test --workspace @harness-ctrl-chrome/mcp-server-chrome
npm test --workspace @harness-ctrl-chrome/native-host
npm test --workspace @harness-ctrl-chrome/chrome-extension
```

Cobertura atual:
- `TabMutex`: isolamento/concorrência por aba (ACID I).
- `MCPHandler`: initialize, tools/list, tools/call, erros, parse inválido.
- Content script: fillForm, click, read (DOM simulado).
- Native-host: framing de 4 bytes (Native Messaging), encaminhamento TCP.

---

## Documentacao por projeto

- [`packages/shared-protocol/`](packages/shared-protocol/) — tipos e validação do protocolo de fio
- [`packages/mcp-server-chrome/`](packages/mcp-server-chrome/) — servidor MCP stdio + TCP
- [`packages/native-host/`](packages/native-host/) — host nativo + REGISTRO.md
- [`packages/chrome-extension/`](packages/chrome-extension/) — extensão Manifest V3
- [`packages/opencode-connector/`](packages/opencode-connector/) — configuração OpenCode + INSTALAR.md
- [`packages/dsh-skill/`](packages/dsh-skill/) — instruções para DeepSeek Harness + USAR.md

---

## Princípios de engenharia respeitados

- **KISS**: cada projeto faz uma coisa só; sem SDKs desnecessários; sem plugins onde o cliente nativo já basta.
- **ACID**: atomicidade, consistência, isolamento (por aba) e durabilidade (estado no Chrome).
- **Qualidade de código**: TypeScript strict, testes automatizados em cada pacote, tipos exportados, validação de entrada.
- **Segurança**: a extensão só age em abas que o usuário está navegando; não há acesso a senhas nem a dados sensíveis além do exposto no DOM.

---

## Proximo passos sugeridos

- Adicionar testes de integração end-to-end (Chrome real + Puppeteer/Playwright).
- Adicionar suporte a múltiplos perfis de usuário do Chrome.
- Adicionar gravação de sessão (historico de ações no Chrome).
- Adicionar autenticação/autorização entre cliente MCP e servidor.
