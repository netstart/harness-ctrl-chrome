/**
 * Testes do servidor MCP de controle do Chrome.
 * Cobrem: isolamento por aba (TabMutex), manipulador de protocolo MCP
 * (initialize / tools/list / tools/call) e registro de ferramentas.
 */

import { TabMutex } from '../src/lock';
import { MCPHandler } from '../src/protocol';
import { createTools } from '../src/tools';

function buildHandler(sendCommand: any) {
  return new MCPHandler({
    tools: createTools(sendCommand),
    serverName: 'test-server',
    serverVersion: '0.0.1',
  });
}

function mcpRequest(method: string, params: any, id = 1) {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params });
}

async function callLine(h: MCPHandler, line: string) {
  return h.handleLine(line);
}

describe('TabMutex (isolamento por aba)', () => {
  it('permite concorrencia entre abas diferentes', async () => {
    const m = new TabMutex();
    const order: string[] = [];
    await Promise.all([
      m.run(1, async () => { order.push('a1-start'); await delay(20); order.push('a1-end'); }),
      m.run(2, async () => { order.push('a2-start'); await delay(20); order.push('a2-end'); }),
    ]);
    expect(order[0]).toMatch(/(a1|a2)-start/);
    expect(order).toHaveLength(4);
  });

  it('serializa acessos a mesma aba', async () => {
    const m = new TabMutex();
    const order: string[] = [];
    await Promise.all([
      m.run(7, async () => { order.push('t7-a-start'); await delay(30); order.push('t7-a-end'); }),
      m.run(7, async () => { order.push('t7-b-start'); await delay(30); order.push('t7-b-end'); }),
    ]);
    expect(order).toEqual(['t7-a-start', 't7-a-end', 't7-b-start', 't7-b-end']);
  });
});

describe('MCPHandler', () => {
  it('initialize retorna capacidades e servidor', async () => {
    const h = buildHandler(async () => ({}));
    const res = (await callLine(h, mcpRequest('initialize', {}, 1))) as any;
    expect(res.jsonrpc).toBe('2.0');
    expect(res.id).toBe(1);
    expect(res.result.capabilities.tools).toBeDefined();
    expect(res.result.serverInfo.name).toBe('test-server');
  });

  it('recusa chamadas antes de initialize', async () => {
    const h = buildHandler(async () => ({}));
    const res = (await callLine(h, mcpRequest('tools/list', {}, 2))) as any;
    expect(res.error).toBeDefined();
    expect(res.error.code).toBe(-32002);
  });

  it('notifications/initialized nao retorna resposta', async () => {
    const h = buildHandler(async () => ({}));
    await callLine(h, mcpRequest('initialize', {}, 1));
    const res = await callLine(h, JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
    expect(res).toBeNull();
  });

  it('tools/list lista as ferramentas do Chrome', async () => {
    const h = buildHandler(async () => ({}));
    await callLine(h, mcpRequest('initialize', {}, 1));
    const res = (await callLine(h, mcpRequest('tools/list', {}, 3))) as any;
    const names = (res.result.tools as any[]).map((t: any) => t.name);
    expect(names).toContain('chrome_list_tabs');
    expect(names).toContain('chrome_navigate');
    expect(names).toContain('chrome_fill_form');
    expect(names).toContain('chrome_screenshot');
    expect(names).toHaveLength(11);
  });

  it('tools/call executa uma ferramenta e retorna conteudo', async () => {
    const captured: any[] = [];
    const h = buildHandler(async (cmd: string, payload: any, tabId?: number) => {
      captured.push({ cmd, payload, tabId });
      return { ok: true, tabId };
    });
    await callLine(h, mcpRequest('initialize', {}, 1));

    const res = (await callLine(
      h,
      mcpRequest('tools/call', { name: 'chrome_navigate', arguments: { tabId: 5, url: 'https://example.com' } }, 4)
    )) as any;

    expect(res.jsonrpc).toBe('2.0');
    expect(res.id).toBe(4);
    expect(res.error).toBeUndefined();
    const content = JSON.parse(res.result.content[0].text);
    expect(content.ok).toBe(true);
    expect(content.tabId).toBe(5);
    expect(captured).toHaveLength(1);
    expect(captured[0].cmd).toBe('navigate');
    expect(captured[0].payload.url).toBe('https://example.com');
    expect(captured[0].tabId).toBe(5);
  });

  it('tools/call retorna isError quando o handler lança', async () => {
    const h = buildHandler(async () => {
      throw new Error('boom no Chrome');
    });
    await callLine(h, mcpRequest('initialize', {}, 1));
    const res = (await callLine(
      h,
      mcpRequest('tools/call', { name: 'chrome_read', arguments: { tabId: 1 } }, 5)
    )) as any;
    expect(res.error).toBeDefined();
    expect(res.error.message).toContain('boom no Chrome');
    expect(res.content).toBeDefined();
    expect(res.isError).toBe(true);
  });

  it('ferramenta desconhecida retorna erro', async () => {
    const h = buildHandler(async () => ({}));
    await callLine(h, mcpRequest('initialize', {}, 1));
    const res = (await callLine(
      h,
      mcpRequest('tools/call', { name: 'chrome_nao_existe', arguments: {} }, 6)
    )) as any;
    expect(res.error).toBeDefined();
    expect(res.error.code).toBe(-32602);
  });
});

describe('linha invalida', () => {
  it('retorna erro de parse', async () => {
    const h = buildHandler(async () => ({}));
    const res = (await callLine(h, 'não é json')) as any;
    expect(res.error.code).toBe(-32700);
  });
});

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
