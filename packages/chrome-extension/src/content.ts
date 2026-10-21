/**
 * Script de conteudo da extensao Chrome.
 *
 * Injetado nas paginas visitadas pelo usuario. Recebe mensagens do service
 * worker (background) e executa acoes no DOM da pagina:
 *  - fill_form: preenche campos por seletor CSS
 *  - click: clica em um elemento
 *  - read: le texto/html/json da pagina ou de um elemento
 *  - evaluate: executa JavaScript arbitrario no contexto da pagina
 *  - screenshot: captura a pagina inteira (full page) via canvas
 *
 * Toda resposta e enviada de volta ao background pelo canal
 * chrome.runtime.sendMessage com a marca __ext === 'harness-ctrl-chrome'.
 */

const EXT_MARK = 'harness-ctrl-chrome';

function respond(tabId: number, ok: boolean, data?: any, error?: string): void {
  chrome.runtime.sendMessage({
    __ext: EXT_MARK,
    tabId,
    ok,
    data,
    error,
  });
}

/* -------------------------- acoes de DOM -------------------------- */

function fillForm(fields: Record<string, string>, submitAfter: boolean): { filled: string[] } {
  const filled: string[] = [];
  for (const [selector, value] of Object.entries(fields)) {
    const el = document.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(selector);
    if (!el) continue;
    // Dispara eventos de entrada para nao burlar validadores de frameworks (React, etc).
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    filled.push(selector);
  }

  if (submitAfter) {
    const submit = document.querySelector<HTMLButtonElement | HTMLInputElement>(
      'button[type="submit"], input[type="submit"]'
    );
    if (submit) submit.click();
  }

  return { filled };
}

function click(selector: string): { clicked: boolean } {
  const el = document.querySelector<Element>(selector);
  if (!el) return { clicked: false };
  (el as HTMLElement).click();
  return { clicked: true };
}

function read(selector?: string, as: 'text' | 'html' | 'json' = 'text'): { selector?: string; as: string; content: string; length: number } {
  let content = '';
  if (selector) {
    const el = document.querySelector<Element>(selector);
    if (!el) throw new Error(`Elemento nao encontrado: ${selector}`);
    content = as === 'html' ? el.innerHTML : as === 'json' ? JSON.stringify(el.textContent ?? '') : (el.textContent ?? '');
  } else {
    content = as === 'html' ? document.documentElement.outerHTML : document.body ? document.body.innerText : '';
  }
  return { selector, as, content, length: content.length };
}

function evaluate(script: string): any {
  // Executa no contexto da pagina (conteudo). Usando Funcao para ter acesso ao window da pagina.
  const fn = new Function('window', 'document', script);
  return fn(window, document);
}

/* -------------------------- dispatcher de mensagens -------------------------- */

chrome.runtime.onMessage.addListener((msg: any, _sender, _sendResponse) => {
  if (!msg || msg.__ext !== EXT_MARK) return false;
  const { tabId, action, payload } = msg;

  (async () => {
    try {
      let result: any;
      switch (action) {
        case 'fill_form':
          result = fillForm(payload.fields ?? {}, payload.submitAfter === true);
          break;
        case 'click':
          result = click(payload.selector);
          break;
        case 'read':
          result = read(payload.selector, payload.as);
          break;
        case 'evaluate':
          result = evaluate(payload.script);
          break;
        case 'screenshot':
          // Full-page via content script nao e confiavel sem lib; delega ao background.
          throw new Error('Use chrome.tabs.captureVisibleTab via background para screenshot.');
        default:
          throw new Error(`Acao de DOM desconhecida: ${action}`);
      }
      respond(tabId, true, result);
    } catch (err) {
      respond(tabId, false, undefined, err instanceof Error ? err.message : String(err));
    }
  })();

  return true; // mantem o canal aberto para resposta assincrona
});

// Sinaliza que o script de conteudo esta ativo e pronto.
chrome.runtime.sendMessage({ __ext: EXT_MARK, tabId: -1, ready: true });
