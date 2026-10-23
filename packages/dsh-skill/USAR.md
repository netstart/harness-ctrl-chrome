# Como usar a skill do DeepSeek Harness

## Passo a passo

1. **Prepare o ambiente** (raiz do monorepo):
   ```bash
   pnpm install
   pnpm run build
   ```

2. **Registre o host nativo** do Chrome (Windows, consulte `packages/native-host/REGISTRO.md`).

3. **Carregue a extensao** no Chrome:
   - `chrome://extensions` > Modo de desenvolvedor > Carregar sem compactacao > `packages/chrome-extension/dist`.

4. **Inicie os servidores** (dois terminais):
   ```bash
   # Terminal 1
   node packages/mcp-server-chrome/dist/index.js

   # Terminal 2
   node packages/native-host/dist/index.js
   ```

5. **Carregue a skill no DSH**: use o conteudo de `packages/dsh-skill/instructions.md` como instrucao do agente (ou atraves do ponto de extensao de skills do DSH, se disponível).

6. **Converse com o agente** pedindo acoes no Chrome:
   - "Abra uma aba no Chrome e acesse https://exemplo.com"
   - "Preencha o form de contato da pagina atual"
   - "Leia o texto da aba 2 e me resuma"
   - "Tire um print da pagina inteira"
   - "Faça login no Instagram com usuario X e senha Y"
   - "Navegue no feed do Instagram e curta os ultimos 5 posts"
   - "Responda 'Obrigado!' no chat do Instagram para o usuario @fulano"
   - "Clique no botao 'Seguir' no perfil do Instagram"
   - "Execute JavaScript na pagina para rolar o feed infinitamente"
   - "Tire um print da conversa no Direct do Instagram"

## O que é POSSÍVEL fazer (Capacidades Completas)

### Navegação e Abas
- **Abrir abas** (`chrome_open_tab`): nova aba em branco ou com URL específica
- **Navegar** (`chrome_navigate`): ir para qualquer URL em uma aba existente
- **Listar abas** (`chrome_list_tabs`): ver todas as abas abertas com URL, título, status
- **Fechar abas** (`chrome_close_tab`): fechar aba por ID
- **Focar aba** (`chrome_focus_tab`): trazer aba para frente
- **Info da página** (`chrome_get_page_info`): URL, título, favicon da aba ativa ou indicada

### Interação com Páginas (DOM Livre)
- **Preencher formulários** (`chrome_fill_form`): preenche campos por seletor CSS → valor; suporta `submitAfter: true` para clicar no botão de submit automaticamente
- **Clicar em elementos** (`chrome_click`): clica qualquer elemento via seletor CSS (botões, links, inputs, divs, etc.)
- **Ler conteúdo** (`chrome_read`): lê texto, HTML ou JSON da página inteira ou de um elemento específico
- **Executar JavaScript** (`chrome_evaluate`): executa JS arbitrário no contexto da página (acesso total a `window`, `document`, APIs do navegador, React/Vue devtools, etc.)
- **Screenshot** (`chrome_screenshot`): captura tela visível ou página inteira (fullPage), PNG ou JPEG

### O que isso permite na prática (exemplos reais)

| Cenário | Como fazer |
|---------|------------|
| **Login em qualquer site** (Instagram, Twitter, LinkedIn, etc.) | `chrome_navigate` → `chrome_fill_form` com `submitAfter: true` |
| **Navegar logado no Instagram** | Faça login uma vez; a sessão persiste nas abas; depois use `chrome_navigate`, `chrome_click`, `chrome_read` |
| **Responder no Direct/Chat do Instagram** | `chrome_fill_form` no campo de mensagem + `submitAfter: true` OU `chrome_click` no botão enviar + `chrome_evaluate` para digitar |
| **Curtir/Comentar/Seguir no Instagram** | `chrome_click` nos seletores dos botões (ex: `svg[aria-label="Curtir"]`, `button:contains("Seguir")`) |
| **Rolar feed infinito** | `chrome_evaluate` com `window.scrollTo(0, document.body.scrollHeight)` em loop |
| **Extrair dados de perfis/posts** | `chrome_read` com seletores específicos ou `chrome_evaluate` para scraping customizado |
| **Automatizar qualquer fluxo web** | Combine as ferramentas: navegar → preencher → clicar → ler → avaliar → screenshot |

> **Importante**: A extensão roda no **seu Chrome real**, com **seu perfil, cookies, sessões logadas**. Não há sandbox isolado — você controla o navegador que já está aberto. Isso significa que **login persiste**, **cookies funcionam**, **2FA já feito funciona**, etc.

## O que acontece por baixo

```
Agente (DSH)
  -> chama ferramenta MCP (ex: chrome_navigate)
  -> mcp-server-chrome (stdio, JSON-RPC 2.0)
  -> TCP localhost:8765
  -> native-host
  -> extensao Chrome -> chrome.tabs / content script (DOM)
  -> resultado volta ate o agente
```

## Princípios

- KISS: a skill so orienta; a execucao eh do servidor MCP + extensao.
- ACID: cada acao e atomica e isolada por aba.
- **Livre**: voce tem acesso total ao DOM e JS da pagina — sem restricoes alem do que o proprio Chrome permite.
