# Skill DeepSeek Harness — Controle do Chrome via MCP

## O que esta skill faz

Esta e uma **skill de instrucoes** (bloco de orientacao para o agente) que ensina o DeepSeek Harness a utilizar as ferramentas MCP do projeto **Harness Ctrl Chrome** para controlar o navegador Google Chrome durante uma conversa com o usuario.

Ela NAO e um plugin de execucao: a execucao real eh feita pelo `mcp-server-chrome` + `native-host` + extensao Chrome. A skill apenas diz ao agente **quais ferramentas estao disponiveis** e **como chamá-las** por meio do protocolo MCP.

## Ferramentas expostas pelo MCP (disponiveis ao agente)

| Ferramenta | O que faz |
|---|---|
| `chrome_list_tabs` | Lista todas as abas do Chrome |
| `chrome_open_tab` | Abre uma nova aba (url opcional) |
| `chrome_navigate` | Navega uma aba existente para uma URL |
| `chrome_close_tab` | Fecha uma aba |
| `chrome_focus_tab` | Foca/traz uma aba para frente |
| `chrome_fill_form` | Preenche campos: `{ tabId, fields: { seletor: valor }, submitAfter? }` |
| `chrome_click` | Clica em elemento por seletor CSS: `{ tabId, selector }` |
| `chrome_read` | Le texto/html/json de aba ou elemento: `{ tabId, selector?, as? }` |
| `chrome_screenshot` | Tira print da aba: `{ tabId, format?, quality?, fullPage? }` |
| `chrome_evaluate` | Executa JS na pagina: `{ tabId, script }` |
| `chrome_get_page_info` | Info da aba: `{ tabId? }` |

## Como o agente deve usar (padroes de chamada)

O agente chama as ferramentas via protocolo MCP (JSON-RPC 2.0) pelo servidor `mcp-server-chrome`, que roda em stdio e se conecta ao host nativo do Chrome (TCP 8765).

Exemplo de chamada para preencher um formulario:

```
tools/call
{
  "name": "chrome_fill_form",
  "arguments": {
    "tabId": 3,
    "fields": { "#usuario": "fulano", "#senha": "senha123" },
    "submitAfter": true
  }
}
```

Exemplo de leitura de pagina:

```
tools/call
{
  "name": "chrome_read",
  "arguments": { "tabId": 3, "as": "text" }
}
```

## Requisitos de ambiente (antes de usar a skill)

1. Compile o monorepo: `pnpm install` e `pnpm run build`.
2. Registre o host de mensagens nativas do Chrome (veja `packages/native-host/REGISTRO.md`).
3. Carregue a extensao em `chrome://extensions` (pasta `packages/chrome-extension/dist`).
4. Inicie o servidor MCP: `node packages/mcp-server-chrome/dist/index.js`.
5. Inicie o host nativo: `node packages/native-host/dist/index.js`.

## Integracao com o DeepSeek Harness

- Se o DSH expor um ponto de extensão MCP/skill, aponte-o para o servidor `mcp-server-chrome` e carregue este arquivo `instructions.md` como contexto do agente.
- Caso o DSH ainda nao suporte cliente MCP nativo, o agente pode ser orientado a chamar o servidor MCP por linha de comando (stdio) ate que a integracao nativa esteja disponivel.

## Princípios

- **KISS:** a skill so documenta o que existe; nao duplica logica.
- **ACID:** cada chamada `tools/call` e atomica e isolada por aba (via `TabMutex` no servidor).
- **Seguranca:** o agente so pode agir em abas que o usuario ja abriu / esta navegando; nao há acesso a senhas nem a dados sensiveis alem do que a pagina expõe no DOM.
