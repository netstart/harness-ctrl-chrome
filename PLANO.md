# Plano de Implementação — Harness Ctrl Chrome

## Objetivo
Controlar o Google Chrome (abrir navegar, preencher formulários, ler páginas, tirar prints, clicar, executar JS) a partir de conversas com LLM no **OpenCode** e no **DeepSeek Harness**, passando por um **servidor MCP** e uma **extensão Chrome (Manifest V3)**.

Tudo em um **monorepo** (vários projetos integrados em um único repositório), com código de alta qualidade, testes automatizados, princípios de engenharia (KISS, ACID) e documentação completa.

---

## Decisões tomadas (avaliação do que é melhor para o usuário)

### 1. NÃO criar plugin para o OpenCode — usar suporte nativo a MCP
O OpenCode (opencode-ai) já possui cliente MCP integrado (configura servidores MCP em `~/.opencode/mcp.json` e expõe as ferramentas como "tools" ao modelo). Criar um plugin específico seria duplicar funcionalidade, adicionar atrito de instalação e violar KISS.

**Decisão:** Criar apenas um **conector OpenCode** = um arquivo de configuração de exemplo (`opencode-mcp.json`) + documentação de como apontar para o servidor MCP. Sem código extra de plugin.

### 2. NÃO criar "skill" como separação de projeto — criar uma Skill do DeepSeek Harness opcional
O catálogo de skills disponível no DSH inclui `ai-memory-*` (memória duradoura), não habilidades de controle de navegador. Uma "skill" no sentido do DSH é um bloco de instruções para um agente, não um mecanismo de execução de ações no Chrome.

**Decisão:** Não há projeto "skill" obrigatório. Oferecemos:
- Um arquivo de instruções/skill opcional para o DeepSeek Harness (`packages/dsh-skill/instructions.md`) que ensina o agente a usar as ferramentas MCP do Chrome.
- Um conector DSH (se o DSH expor ponto de extensão MCP) documentado.

Se no futuro o DSH adicionar cliente MCP nativo, basta apontar para o mesmo `mcp-server-chrome` (mesmo que o OpenCode).

### 3. Arquitetura escolhida (monorepo, 4 projetos + 1 compartilhado)

| Projeto | Responsabilidade | Tecnologia |
|---|---|---|
| `shared-protocol` | Tipos e validação do protocolo de fio (comandos/resultados/eventos) | TypeScript (zero dep. runtime) |
| `mcp-server-chrome` | Servidor MCP (stdio JSON-RPC 2.0) + TCP para o host nativo | Node.js, zero dep. runtime |
| `native-host` | Host de mensagens nativas do Chrome (stdio framing 4 bytes ↔ TCP localhost) | Node.js |
| `chrome-extension` | Extensão Manifest V3: background (service worker) + content script + popup | Chrome APIs (tabs, scripting, nativeMessaging) |
| `dsh-skill` | Instruções/skill opcional para o DeepSeek Harness usar as ferramentas MCP | Markdown |

**Fluxo de uma ação:**
```
cliente MCP (OpenCode / DSH)
  -> stdio (JSON-RPC)
  -> mcp-server-chrome (tools/call)
  -> TCP localhost:8765
  -> native-host (framing 4 bytes)
  -> extensão Chrome (background)
  -> chrome.tabs / chrome.scripting / content script (DOM)
  -> resultado retorna pelo mesmo caminho até o cliente
```

### 4. Garantias no estilo ACID
- **Atomicidade:** cada `tools/call` é uma unidade que completa com sucesso ou retorna erro sem efeito parcial visível ao cliente.
- **Consistência:** o resultado devolvido reflete o estado observado no Chrome (pelo content script / APIs nativas).
- **Isolamento:** `TabMutex` serializa comandos concorrentes na mesma aba; abas diferentes seguem concorrentes.
- **Durabilidade:** não grava estado persistente por design (estado vive no Chrome); logs de erro no stderr.

### 5. Testes
- Jest + ts-jest em cada pacote.
- Cobertura: `TabMutex` (isolamento/concorrência), `MCPHandler` (initialize/tools/list/tools/call, erros), content script (fillForm/click/read com DOM simulado), framing do native-host.

---

## Tarefas (ordem de execução)

1. [x] Estrutura raiz do monorepo (`package.json` com workspaces, `.gitignore`, `tsconfig.base.json`)
2. [x] `shared-protocol` (tipos + validação)
3. [x] `mcp-server-chrome` (protocolo MCP, ferramentas, TabMutex, índice)
4. [x] `mcp-server-chrome` (testes unitários + jest config)
5. [x] `native-host` (ponte stdio ↔ TCP) + manífestos de registro + REGISTRO.md
6. [x] `native-host` (testes de framing)
7. [x] `chrome-extension` (manifest V3, background, content, popup, manífesto)
8. [x] `chrome-extension` (testes de content script)
9. [ ] `dsh-skill` (instruções para o DeepSeek Harness)
10. [x] `opencode-connector` (configuração de exemplo + docs — adaptado ao OpenCode v2)
11. [ ] Build de todos os pacotes + execução dos testes
12. [ ] Documentação de cada projeto + README consolidado
13. [ ] Commit e push no repositório

---

## Como usar (resumo)

1. `pnpm install` na raiz.
2. `pnpm run build` para compilar todos os pacotes.
3. Registrar o host de mensagens nativas (ver `packages/native-host/REGISTRO.md`).
4. Carregar a extensão em `chrome://extensions` (modo desenvolvedor, pasta `packages/chrome-extension/dist`).
5. Iniciar o servidor MCP: `node packages/mcp-server-chrome/dist/index.js`.
6. Iniciar o host nativo: `node packages/native-host/dist/index.js` (ou deixar a extensão conectar automaticamente).
7. Configurar o OpenCode para usar o servidor MCP (`opencode-mcp.json`).
8. No DeepSeek Harness, usar as instruções de `packages/dsh-skill/instructions.md` para acionar as ferramentas MCP do Chrome via chat.
