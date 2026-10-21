/**
 * Service worker da extensao Chrome.
 *
 * Papel:
 *  - Mantem a porta aberta com o host de mensagens nativas (chrome.runtime.connectNative).
 *  - Recebe comandos do host (via onNativeMessage) e os roteia:
 *    * Comandos de aba (list_tabs, open_tab, navigate, close_tab, focus_tab, get_page_info)
 *      sao executados diretamente pelas APIs chrome.tabs.
 *    * Comandos de DOM (fill_form, click, read, evaluate, screenshot) sao enviados ao
 *      script de conteudo da aba alvo via chrome.tabs.sendMessage.
 *  - Envia eventos do Chrome de volta ao host (tab_created, tab_removed, etc.).
 */

const NATIVE_APP_NAME = 'com.harnessctrl.chrome.host';

let nativePort: chrome.runtime.Port | null = null;

/* -------------------------- conexao com o host nativo -------------------------- */

function connectNative(): void {
  try {
    nativePort = chrome.runtime.connectNative(NATIVE_APP_NAME);
    nativePort.onMessage.addListener((message: any) => {
      void handleNativeMessage(message);
    });
    nativePort.onDisconnect.addListener(() => {
      console.error('[extensao] host nativo desconectado');
      nativePort = null;
      // Tenta reconectar apos um curto intervalo.
      setTimeout(connectNative, 2000);
    });
  } catch (err) {
    console.error('[extensao] falha ao conectar ao host nativo:', err);
    setTimeout(connectNative, 2000);
  }
}

/** Envia um resultado/evento de volta ao host nativo. */
function sendToHost(message: any): void {
  if (!nativePort) return;
  try {
    nativePort.postMessage(message);
  } catch (err) {
    console.error('[extensao] falha ao enviar ao host nativo:', err);
  }
}

chrome.runtime.onStartup.addListener(connectNative);
chrome.runtime.onInstalled.addListener(() => {
  connectNative();
  // Escuta mudancas de abas para repassar eventos ao host (e, portanto, ao MCP server).
  chrome.tabs.onCreated.addListener((tab) => broadcastEvent('tab_created', tabToInfo(tab)));
  chrome.tabs.onRemoved.addListener((tabId) => broadcastEvent('tab_removed', { tabId }));
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo.status || changeInfo.url || changeInfo.title) {
      broadcastEvent('tab_updated', tabToInfo(tab));
    }
    if (changeInfo.status === 'complete') {
      broadcastEvent('page_loaded', tabToInfo(tab));
    }
  });
  chrome.tabs.onActivated.addListener((activeInfo) => {
    chrome.tabs.get(activeInfo.tabId, (tab) => {
      if (tab) broadcastEvent('tab_activated', tabToInfo(tab));
    });
  });
});

function broadcastEvent(event: string, payload: any): void {
  sendToHost({ type: 'event', id: undefined, event, payload, timestamp: Date.now() });
}

/* -------------------------- roteamento de comandos -------------------------- */

async function handleNativeMessage(message: any): Promise<void> {
  if (!message || message.type !== 'command') return;
  const { id, command, payload } = message;

  try {
    const result = await dispatchCommand(command, payload ?? {});
    sendToHost({ type: 'result', id, ok: true, data: result, timestamp: Date.now() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendToHost({ type: 'result', id, ok: false, error: msg, timestamp: Date.now() });
  }
}

async function dispatchCommand(command: string, payload: any): Promise<any> {
  switch (command) {
    case 'list_tabs': return listTabs();
    case 'open_tab': return openTab(payload);
    case 'navigate': return navigate(payload);
    case 'close_tab': return closeTab(payload);
    case 'focus_tab': return focusTab(payload);
    case 'get_page_info': return getPageInfo(payload);
    case 'fill_form': return domCommand(payload, 'fill_form');
    case 'click': return domCommand(payload, 'click');
    case 'read': return domCommand(payload, 'read');
    case 'screenshot': return screenshotTab(payload);
    case 'evaluate': return domCommand(payload, 'evaluate');
    default:
      throw new Error(`Comando desconhecido: ${command}`);
  }
}

/* -------------------------- comandos de aba (APIs nativas do Chrome) -------------------------- */

function listTabs(): Promise<any> {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({}, (tabs) => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      resolve(tabs.map(tabToInfo));
    });
  });
}

function openTab(payload: any): Promise<any> {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({
      url: payload.url ?? undefined,
      active: payload.active !== false,
      windowId: payload.windowId ?? undefined,
    }, (tab) => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      resolve(tabToInfo(tab));
    });
  });
}

function navigate(payload: any): Promise<any> {
  const { tabId, url } = payload;
  if (!tabId || !url) throw new Error('tabId e url sao obrigatorios');
  return new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, { url }, (tab) => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      resolve(tabToInfo(tab!));
    });
  });
}

function closeTab(payload: any): Promise<any> {
  const { tabId } = payload;
  if (!tabId) throw new Error('tabId e obrigatorio');
  return new Promise((resolve, reject) => {
    chrome.tabs.remove(tabId, () => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      resolve({ tabId });
    });
  });
}

function focusTab(payload: any): Promise<any> {
  const { tabId } = payload;
  if (!tabId) throw new Error('tabId e obrigatorio');
  return new Promise((resolve, reject) => {
    chrome.tabs.highlight({ tabs: tabId, windowId: payload.windowId }, () => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      resolve({ tabId, focused: true });
    });
  });
}

function getPageInfo(payload: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const query = payload.tabId !== undefined ? { active: true, windowId: payload.windowId } : { active: true, lastFocusedWindow: true };
    chrome.tabs.query(query, (tabs) => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      const tab = tabs?.[0];
      if (!tab) return reject(new Error('Nenhuma aba encontrada'));
      resolve(tabToInfo(tab));
    });
  });
}

/* -------------------------- comandos de DOM (script de conteudo) -------------------------- */

async function domCommand(payload: any, action: string): Promise<any> {
  const { tabId } = payload;
  if (!tabId) throw new Error('tabId e obrigatorio');

  // Garante que o script de conteudo esteja injetado na aba alvo.
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
  } catch {
    // Ja injetado ou nao e possivel injetar (ex: paginas internas do Chrome);
    // ignoramos e tentamos enviar a mensagem mesmo assim.
  }

  return new Promise((resolve, reject) => {
    const listener = (msg: any, _sender: any, _sendResponse: any) => {
      if (msg && msg.__ext === 'harness-ctrl-chrome' && msg.tabId === tabId) {
        chrome.runtime.onMessage.removeListener(listener);
        if (msg.ok) resolve(msg.data);
        else reject(new Error(msg.error ?? 'Comando DOM falhou'));
        return true;
      }
    };
    chrome.runtime.onMessage.addListener(listener);

    chrome.tabs.sendMessage(tabId, { __ext: 'harness-ctrl-chrome', tabId, action, payload }, (_resp) => {
      if (chrome.runtime.lastError) {
        chrome.runtime.onMessage.removeListener(listener);
        reject(new Error(chrome.runtime.lastError.message));
      }
    });

    // Timeout de seguranca.
    setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      reject(new Error(`Tempo esgotado aguardando resposta do script de conteudo para '${action}'`));
    }, 30000);
  });
}

async function screenshotTab(payload: any): Promise<any> {
  const { tabId, format = 'png', quality, fullPage = false } = payload;
  if (!tabId) throw new Error('tabId e obrigatorio');

  return new Promise((resolve, reject) => {
    const options: any = {};
    if (format === 'jpeg') options.quality = quality ?? 90;

    chrome.tabs.captureVisibleTab(options, (dataUrl) => {
      if (chrome.runtime.lastError) {
        // Fallback: tentar capturar via script de conteudo (full page).
        if (fullPage) {
          return domCommand({ ...payload, tabId }, 'screenshot')
            .then(resolve).catch(reject);
        }
        return reject(new Error(chrome.runtime.lastError.message));
      }
      const bytes = dataUrl ? Math.ceil((dataUrl.length - 'data:image/png;base64,'.length) * 3 / 4) : 0;
      resolve({ tabId, format, dataUrl, bytes });
    });
  });
}

function tabToInfo(tab: chrome.tabs.Tab): any {
  return {
    tabId: tab.id,
    windowId: tab.windowId,
    url: tab.url ?? '',
    title: tab.title ?? '',
    active: tab.active ?? false,
    incognito: tab.incognito ?? false,
    pinned: tab.pinned ?? false,
  };
}
