/**
 * Popup da extensao: exibe status da conexao com o host nativo e permite
 * reconectar manualmente. Útil para validacao durante o desenvolvimento.
 */

const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const log = document.getElementById('log');
const btnReconectar = document.getElementById('btnReconectar');
const btnAbrirOpcoes = document.getElementById('btnAbrirOpcoes');

function setStatus(on: boolean, text: string) {
  if (statusDot) statusDot.className = 'dot ' + (on ? 'on' : 'off');
  if (statusText) statusText.textContent = text;
  if (log) {
    const line = document.createElement('div');
    line.textContent = new Date().toLocaleTimeString() + ' - ' + text;
    log.prepend(line);
  }
}

// O popup nao tem acesso direto ao service worker; usa runtime.connect para sondar.
const port = chrome.runtime.connect({ name: 'popup' });
port.onMessage.addListener((msg) => {
  if (msg && msg.connected) setStatus(true, 'Host nativo conectado - pronto para comandos MCP.');
});
port.onDisconnect.addListener(() => {
  setStatus(false, 'Host nativo desconectado. Inicie o native-host e clique em Reconectar.');
});

function ping() {
  try {
    port.postMessage({ ping: true });
  } catch {
    setStatus(false, 'Host nativo desconectado.');
  }
}

setInterval(ping, 2000);
ping();

if (btnReconectar) btnReconectar.addEventListener('click', () => {
  setStatus(false, 'Reconectando...');
  chrome.runtime.reload();
});

if (btnAbrirOpcoes) btnAbrirOpcoes.addEventListener('click', () => {
  chrome.runtime.openOptionsPage?.();
});
