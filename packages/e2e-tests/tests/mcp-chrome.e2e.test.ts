/**
 * Testes end-to-end do Harness Ctrl Chrome.
 *
 * Camada 1 (sempre): testa o servidor MCP stdio (ferramentas, erros, protocolo).
 * Camada 2 (condicional): testa o fluxo completo com Chrome real, apenas se um
 * Chrome já estiver rodando com depuração remota na porta 9222.
 *
 * Como rodar:
 *  npm test --workspace @harness-ctrl-chrome/e2e-tests -- --forceExit
 */

import { beforeAll, afterAll, test, expect, describe, pending } from '@jest/globals';
import { spawn, ChildProcess } from 'child_process';
import * as net from 'net';
import * as path from 'path';
import { WebSocket } from 'ws';
import * as readline from 'readline';

const ROOT = path.resolve(__dirname, '../../..');
const MCP_SERVER_DIR = path.join(ROOT, 'packages', 'mcp-server-chrome');
const MCP_SERVER = path.join(MCP_SERVER_DIR, 'dist', 'index.js');

const MCP_PORT = 8765;
const MCP_HOST = '127.0.0.1';
const DEBUG_PORT = 9222;

let mcpProc: ChildProcess | null = null;

/* ========================================================================
   Cliente MCP simples (stdio JSON-RPC 2.0)
   ======================================================================== */

class McpClient {
  private proc: ChildProcess | null = null;
  private pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private reqId = 0;

  start(cwd: string): void {
    this.proc = spawn('node', ['dist/index.js'], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc.stderr?.on('data', (d) => process.stderr.write(`[mcp-err] ${d}`));

    const rl = readline.createInterface({ input: this.proc.stdout!, terminal: false });
    rl.on('line', (line: string) => {
      const t = line.trim();
      if (!t) return;
      try {
        const msg = JSON.parse(t);
        if (msg && typeof msg.id === 'string') {
          const p = this.pending.get(msg.id);
          if (p) {
            this.pending.delete(msg.id);
            if (msg.error) p.reject(new Error(msg.error.message));
            else p.resolve(msg.result);
          }
        }
      } catch { /* ignore */ }
    });

    this.proc.on('close', () => {
      for (const [, p] of this.pending) p.reject(new Error('MCP encerrou'));
      this.pending.clear();
    });
  }

  async request<T = any>(method: string, params: any = {}, timeoutMs = 15000): Promise<T> {
    if (!this.proc) throw new Error('MCP client não iniciado');
    const id = (++this.reqId).toString();
    this.proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: (v: any) => { clearTimeout(timer); resolve(v); }, reject: (e: Error) => { clearTimeout(timer); reject(e); } });
    });
  }

  async initialize(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'e2e', version: '1.0.0' },
    });
    await this.request('notifications/initialized', {});
  }

  async listTools(): Promise<any[]> {
    const res: any = await this.request('tools/list', {});
    return res.tools ?? [];
  }

  async callTool(name: string, args: any = {}): Promise<any> {
    const res: any = await this.request('tools/call', { name, arguments: args });
    if (res.isError) throw new Error(res.error?.message ?? 'Erro na ferramenta');
    const text = res.content?.[0]?.text ?? '{}';
    try { return JSON.parse(text); } catch { return { raw: text }; }
  }

  stop(): void {
    if (this.proc && !this.proc.killed) this.proc.kill('SIGTERM');
    this.proc = null;
  }
}

let mcpClient: McpClient;

/* ========================================================================
   CDP (Chrome DevTools Protocol) via WebSocket — condicional
   ======================================================================== */

class CdpClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private id = 0;

  async connect(wsUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);
      this.ws!.once('open', () => resolve());
      this.ws!.once('error', (err) => reject(err));
      this.ws!.on('message', (raw: Buffer) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg && typeof msg.id === 'string') {
            const p = this.pending.get(msg.id);
            if (p) {
              this.pending.delete(msg.id);
              if (msg.error) p.reject(new Error(msg.error.message));
              else p.resolve(msg.result);
            }
          }
        } catch { /* ignore */ }
      });
    });
  }

  send(method: string, params: any = {}): Promise<any> {
    if (!this.ws) throw new Error('CDP não conectado');
    const mid = (++this.id).toString();
    this.ws.send(JSON.stringify({ id: mid, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(mid, { resolve, reject });
    });
  }

  close(): void {
    if (this.ws) { this.ws.close(); this.ws = null; }
  }
}

let cdp: CdpClient | null = null;

/* ========================================================================
   Helpers
   ======================================================================== */

function waitForTcp(port: number, host: string, timeoutMs = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    function tryConnect() {
      const socket = new net.Socket();
      socket.setTimeout(1000);
      socket.once('connect', () => { socket.destroy(); resolve(undefined); });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - start < timeoutMs) setTimeout(tryConnect, 500);
        else reject(new Error(`Timeout conectando ${host}:${port}`));
      });
      socket.connect(port, host);
    }
    tryConnect();
  });
}

async function tryConnectChrome(): Promise<boolean> {
  try {
    await waitForTcp(DEBUG_PORT, MCP_HOST, 3000);
    cdp = new CdpClient();
    const res = await fetch(`http://${MCP_HOST}:${DEBUG_PORT}/json/version`);
    const data: any = await res.json();
    await cdp.connect(data.webSocketDebuggerUrl);
    return true;
  } catch {
    return false;
  }
}

async function createTab(url: string = 'about:blank'): Promise<string> {
  const res: any = await cdp!.send('Target.createTarget', { url });
  return res.targetId;
}

async function getPageTargets(): Promise<any[]> {
  const res: any = await cdp!.send('Target.getTargets');
  return res.targetInfos.filter((t: any) => t.type === 'page');
}

async function attachAndEval(targetId: string, script: string): Promise<any> {
  const sessionRes: any = await cdp!.send('Target.attachToTarget', { targetId, flatten: true });
  const sessionId = sessionRes.sessionId;
  const res: any = await cdp!.send('Runtime.evaluate', { sessionId, expression: script, returnByValue: true });
  await cdp!.send('Target.detachFromTarget', { sessionId });
  return res.result?.value;
}

async function navigateTab(targetId: string, url: string): Promise<void> {
  const sessionRes: any = await cdp!.send('Target.attachToTarget', { targetId, flatten: true });
  const sessionId = sessionRes.sessionId;
  await cdp!.send('Page.navigate', { sessionId, url });
  await new Promise((r) => setTimeout(r, 2000));
  await cdp!.send('Target.detachFromTarget', { sessionId });
}

/* ========================================================================
   Setup / Teardown
   ======================================================================== */

let chromeAvailable = false;

beforeAll(async () => {
  mcpProc = spawn('node', [MCP_SERVER], {
    cwd: MCP_SERVER_DIR,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, MCP_CHROME_PORT: String(MCP_PORT) },
  });
  mcpProc.stdout?.on('data', (d) => process.stdout.write(`[mcp] ${d}`));
  mcpProc.stderr?.on('data', (d) => process.stderr.write(`[mcp-err] ${d}`));

  await waitForTcp(MCP_PORT, MCP_HOST, 20000);

  chromeAvailable = await tryConnectChrome();
  if (chromeAvailable) {
    console.error('[e2e] Chrome conectado via CDP na porta', DEBUG_PORT);
  } else {
    console.error('[e2e] Chrome não disponível na porta', DEBUG_PORT);
  }

  mcpClient = new McpClient();
  mcpClient.start(MCP_SERVER_DIR);
  await mcpClient.initialize();
  console.error('[e2e] Cliente MCP conectado');
}, 120000);

afterAll(async () => {
  try { mcpClient.stop(); } catch { /* ignore */ }
  try { cdp?.close(); } catch { /* ignore */ }
  if (mcpProc && !mcpProc.killed) { try { mcpProc.kill('SIGTERM'); } catch { try { mcpProc.kill('SIGKILL'); } catch { } } }
  console.error('[e2e] MCP server encerrado');
}, 30000);

/* ========================================================================
   Testes E2E - MCP server (sempre rodam)
   ======================================================================== */

describe('Harness Ctrl Chrome - MCP Server', () => {
  test('lista as 11 ferramentas MCP disponíveis', async () => {
    const tools = await mcpClient.listTools();
    const names = tools.map((t: any) => t.name);
    expect(names).toContain('chrome_list_tabs');
    expect(names).toContain('chrome_open_tab');
    expect(names).toContain('chrome_navigate');
    expect(names).toContain('chrome_fill_form');
    expect(names).toContain('chrome_click');
    expect(names).toContain('chrome_read');
    expect(names).toContain('chrome_screenshot');
    expect(names).toContain('chrome_evaluate');
    expect(names).toContain('chrome_get_page_info');
    expect(names).toContain('chrome_close_tab');
    expect(names).toContain('chrome_focus_tab');
    expect(names).toHaveLength(11);
  });

  test('retorna erro ao navegar em aba inexistente', async () => {
    const result: any = await mcpClient.callTool('chrome_navigate', { tabId: 99999, url: 'https://example.com' });
    const hasError = result.isError === true || result.ok === false || !!result.error;
    expect(hasError).toBe(true);
  });

  test('chamada chrome_evaluate é processada pelo servidor', async () => {
    const result: any = await mcpClient.callTool('chrome_evaluate', {
      tabId: 1,
      script: '(10 + 5) * 2',
    });
    expect(result).toBeDefined();
  });

  test('porta TCP do MCP está aceitando conexões', async () => {
    const socket = new net.Socket();
    const result = await new Promise<boolean>((resolve) => {
      socket.setTimeout(3000);
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => { socket.destroy(); resolve(false); });
      socket.connect(MCP_PORT, MCP_HOST);
    });
    expect(result).toBe(true);
  });
});

/* ========================================================================
   Testes E2E - Chrome real (apenas se Chrome estiver disponível)
   ======================================================================== */

describe('Harness Ctrl Chrome - E2E com Chrome (condicional)', () => {
  const chromeTests: Array<[name: string, fn: () => Promise<void>]> = [
    [
      'abre uma nova aba via chrome_open_tab',
      async () => {
        const targetId: string = (globalThis as any).__E2E_TARGET__;
        await mcpClient.callTool('chrome_open_tab', { url: 'https://example.com', active: true });
        await new Promise((r) => setTimeout(r, 2000));
        const targets = await getPageTargets();
        expect(targets.length).toBeGreaterThanOrEqual(1);
      },
    ],
    [
      'navega para uma URL via chrome_navigate',
      async () => {
        const targetId: string = (globalThis as any).__E2E_TARGET__;
        await mcpClient.callTool('chrome_navigate', { tabId: 1, url: 'https://example.com' });
        await new Promise((r) => setTimeout(r, 2500));
        const title: any = await attachAndEval(targetId, 'document.title');
        expect(typeof title).toBe('string');
        expect(title.length).toBeGreaterThan(0);
      },
    ],
    [
      'preenche um formulário via chrome_fill_form',
      async () => {
        const targetId: string = (globalThis as any).__E2E_TARGET__;
        await attachAndEval(targetId, `
          document.body.innerHTML = \`
            <form><input id="user" type="text"><input id="pass" type="password"><button id="btn" type="submit">Enviar</button></form>
          \`;
        `);
        await mcpClient.callTool('chrome_fill_form', {
          tabId: 1,
          fields: { '#user': 'fulano', '#pass': 'senha123' },
          submitAfter: false,
        });
        const userVal: any = await attachAndEval(targetId, "document.getElementById('user').value");
        const passVal: any = await attachAndEval(targetId, "document.getElementById('pass').value");
        expect(userVal).toBe('fulano');
        expect(passVal).toBe('senha123');
      },
    ],
    [
      'clica em um elemento via chrome_click',
      async () => {
        const targetId: string = (globalThis as any).__E2E_TARGET__;
        await attachAndEval(targetId, `
          document.body.innerHTML = \`<button id="btn">Clique</button><div id="out"></div>\`;
          document.getElementById('btn').onclick = () => { document.getElementById('out').textContent = 'clicado'; };
        `);
        await mcpClient.callTool('chrome_click', { tabId: 1, selector: '#btn' });
        await new Promise((r) => setTimeout(r, 500));
        const out: any = await attachAndEval(targetId, "document.getElementById('out').textContent");
        expect(out).toBe('clicado');
      },
    ],
    [
      'lê o conteúdo de uma página via chrome_read',
      async () => {
        const targetId: string = (globalThis as any).__E2E_TARGET__;
        await attachAndEval(targetId, "document.body.innerText = 'Texto de leitura E2E';");
        const result: any = await mcpClient.callTool('chrome_read', { tabId: 1, as: 'text' });
        expect(result.content).toContain('Texto de leitura E2E');
      },
    ],
    [
      'obtém informações da página via chrome_get_page_info',
      async () => {
        const targetId: string = (globalThis as any).__E2E_TARGET__;
        await navigateTab(targetId, 'https://example.com');
        await new Promise((r) => setTimeout(r, 2000));
        const info: any = await mcpClient.callTool('chrome_get_page_info', { tabId: 1 });
        expect(info.url).toContain('example.com');
        expect(info.title).toBeDefined();
      },
    ],
    [
      'tira um screenshot via chrome_screenshot',
      async () => {
        const targetId: string = (globalThis as any).__E2E_TARGET__;
        await attachAndEval(targetId, "document.body.innerHTML = '<h1>Screenshot E2E</h1>';");
        const result: any = await mcpClient.callTool('chrome_screenshot', { tabId: 1, format: 'png' });
        expect(result.dataUrl).toBeDefined();
        expect(result.format).toBe('png');
        expect(result.bytes).toBeGreaterThan(0);
        expect(result.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
      },
    ],
    [
      'executa JavaScript arbitrário via chrome_evaluate',
      async () => {
        const targetId: string = (globalThis as any).__E2E_TARGET__;
        const result: any = await mcpClient.callTool('chrome_evaluate', {
          tabId: 1,
          script: '42',
        });
        expect(result).toBe(42);
      },
    ],
    [
      'lista abas do Chrome via chrome_list_tabs',
      async () => {
        const result: any = await mcpClient.callTool('chrome_list_tabs', {});
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeGreaterThan(0);
      },
    ],
    [
      'processa comandos concorrentes em abas diferentes',
      async () => {
        await createTab('about:blank');
        await createTab('about:blank');
        await new Promise((r) => setTimeout(r, 1000));
        const tabs: any = await mcpClient.callTool('chrome_list_tabs', {});
        const ids = tabs.map((t: any) => t.tabId).slice(0, 2);
        const results = await Promise.all(
          ids.map((id: number) => mcpClient.callTool('chrome_read', { tabId: id, as: 'text' }))
        );
        expect(results.length).toBe(2);
      },
    ],
  ];

  test.each(chromeTests)('%s', async (_name, fn) => {
    if (!chromeAvailable) {
      pending();
      return;
    }
    await fn();
  });
});
