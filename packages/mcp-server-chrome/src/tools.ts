/**
 * Registro e implementação das ferramentas MCP de controle do Chrome.
 *
 * Cada ferramenta traduz uma intenção de linguagem natural (ex: "preencha o
 * formulário de login") num comando enviado ao Chrome via host de mensagens
 * nativas -> extensão -> script de conteúdo (DOM) ou APIs do navegador
 * (tabs, scripting, captura de tela).
 *
 * Observacao: os handlers nao manipulam o Chrome diretamente. Eles apenas
 * enviam comandos pelo `sendCommand` e aguardam o resultado, o que mantem
 * o servidor desacoplado da extensão e facilita testes.
 */

import type { CommandMessage } from '@harness-ctrl-chrome/shared-protocol';
import type { MCPTool } from './protocol';

type SendCommand = (
  command: CommandMessage['command'],
  payload: Record<string, unknown>,
  tabId?: number
) => Promise<unknown>;

function asNumber(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function createTools(sendCommand: SendCommand): MCPTool[] {
  return [
    {
      name: 'chrome_list_tabs',
      description: 'Lista todas as abas do Chrome (id, url, titulo, ativa, etc.).',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: async () => sendCommand('list_tabs', {}, undefined),
    },
    {
      name: 'chrome_open_tab',
      description: 'Abre uma nova aba no Chrome. Aceita url opcional.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL a abrir. Se omitido, abre aba em branco.' },
          active: { type: 'boolean', description: 'Se a nova aba fica ativa (default true).' },
        },
        additionalProperties: false,
      },
      handler: async (args) =>
        sendCommand('open_tab', {
          url: args.url ?? undefined,
          active: args.active ?? true,
        }),
    },
    {
      name: 'chrome_navigate',
      description: 'Navega uma aba existente para uma URL.',
      inputSchema: {
        type: 'object',
        required: ['tabId', 'url'],
        properties: {
          tabId: { type: 'number', description: 'Id da aba.' },
          url: { type: 'string', description: 'URL para navegar.' },
        },
        additionalProperties: false,
      },
      handler: async (args) => {
        const tabId = asNumber(args.tabId, -1);
        if (!Number.isFinite(tabId) || tabId < 0) throw new Error('tabId invalido');
        return sendCommand('navigate', { tabId, url: String(args.url ?? '') }, tabId);
      },
    },
    {
      name: 'chrome_close_tab',
      description: 'Fecha uma aba do Chrome.',
      inputSchema: {
        type: 'object',
        required: ['tabId'],
        properties: { tabId: { type: 'number', description: 'Id da aba a fechar.' } },
        additionalProperties: false,
      },
      handler: async (args) => {
        const tabId = asNumber(args.tabId, -1);
        if (!Number.isFinite(tabId) || tabId < 0) throw new Error('tabId invalido');
        return sendCommand('close_tab', { tabId }, tabId);
      },
    },
    {
      name: 'chrome_focus_tab',
      description: 'Foca/traz uma aba para frente.',
      inputSchema: {
        type: 'object',
        required: ['tabId'],
        properties: { tabId: { type: 'number', description: 'Id da aba.' } },
        additionalProperties: false,
      },
      handler: async (args) => {
        const tabId = asNumber(args.tabId, -1);
        if (!Number.isFinite(tabId) || tabId < 0) throw new Error('tabId invalido');
        return sendCommand('focus_tab', { tabId }, tabId);
      },
    },
    {
      name: 'chrome_fill_form',
      description: 'Preenche campos de um formulario. `fields` mapeia seletor CSS -> valor.',
      inputSchema: {
        type: 'object',
        required: ['tabId', 'fields'],
        properties: {
          tabId: { type: 'number' },
          fields: {
            type: 'object',
            description: 'Mapeamento seletor CSS -> valor a preencher. Ex: {"#usuario": "fulano"}.',
            additionalProperties: { type: 'string' },
          },
          submitAfter: {
            type: 'boolean',
            description: 'Se verdadeiro, clica no primeiro botao submit apos preencher.',
          },
        },
        additionalProperties: false,
      },
      handler: async (args) => {
        const tabId = asNumber(args.tabId, -1);
        if (!Number.isFinite(tabId) || tabId < 0) throw new Error('tabId invalido');
        const fields = args.fields;
        if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
          throw new Error('fields deve ser um objeto { seletor: valor }');
        }
        const payload: Record<string, unknown> = { tabId, fields };
        if (args.submitAfter !== undefined) payload.submitAfter = Boolean(args.submitAfter);
        return sendCommand('fill_form', payload, tabId);
      },
    },
    {
      name: 'chrome_click',
      description: 'Clica em um elemento identificado por seletor CSS.',
      inputSchema: {
        type: 'object',
        required: ['tabId', 'selector'],
        properties: {
          tabId: { type: 'number' },
          selector: { type: 'string', description: 'Seletor CSS do elemento a clicar.' },
        },
        additionalProperties: false,
      },
      handler: async (args) => {
        const tabId = asNumber(args.tabId, -1);
        if (!Number.isFinite(tabId) || tabId < 0) throw new Error('tabId invalido');
        return sendCommand('click', { tabId, selector: String(args.selector ?? '') }, tabId);
      },
    },
    {
      name: 'chrome_read',
      description: 'Lê o conteúdo de uma aba ou de um elemento (seletor). Retorna texto/html/json.',
      inputSchema: {
        type: 'object',
        required: ['tabId'],
        properties: {
          tabId: { type: 'number' },
          selector: { type: 'string', description: 'Seletor CSS do elemento. Omitido = ler a pagina toda.' },
          as: { type: 'string', enum: ['text', 'html', 'json'], description: 'Formato de saida (default text).' },
        },
        additionalProperties: false,
      },
      handler: async (args) => {
        const tabId = asNumber(args.tabId, -1);
        if (!Number.isFinite(tabId) || tabId < 0) throw new Error('tabId invalido');
        return sendCommand('read', {
          tabId,
          selector: args.selector ?? undefined,
          as: args.as ?? 'text',
        }, tabId);
      },
    },
    {
      name: 'chrome_screenshot',
      description: 'Tira um print (screenshot) de uma aba ou da pagina inteira.',
      inputSchema: {
        type: 'object',
        required: ['tabId'],
        properties: {
          tabId: { type: 'number' },
          format: { type: 'string', enum: ['png', 'jpeg'], description: 'png ou jpeg (default png).' },
          quality: { type: 'number', description: 'Qualidade 0-100 (apenas jpeg).' },
          fullPage: { type: 'boolean', description: 'Captura a pagina toda (default false).' },
        },
        additionalProperties: false,
      },
      handler: async (args) => {
        const tabId = asNumber(args.tabId, -1);
        if (!Number.isFinite(tabId) || tabId < 0) throw new Error('tabId invalido');
        return sendCommand('screenshot', {
          tabId,
          format: args.format ?? 'png',
          quality: args.quality ?? undefined,
          fullPage: args.fullPage ?? false,
        }, tabId);
      },
    },
    {
      name: 'chrome_evaluate',
      description: 'Executa JavaScript arbitrario no contexto da pagina (conteúdo).',
      inputSchema: {
        type: 'object',
        required: ['tabId', 'script'],
        properties: {
          tabId: { type: 'number' },
          script: { type: 'string', description: 'Codigo JS a executar na pagina.' },
        },
        additionalProperties: false,
      },
      handler: async (args) => {
        const tabId = asNumber(args.tabId, -1);
        if (!Number.isFinite(tabId) || tabId < 0) throw new Error('tabId invalido');
        return sendCommand('evaluate', { tabId, script: String(args.script ?? '') }, tabId);
      },
    },
    {
      name: 'chrome_get_page_info',
      description: 'Retorna informacoes da aba/ pagina (url, titulo, icone).',
      inputSchema: {
        type: 'object',
        properties: {
          tabId: { type: 'number', description: 'Id da aba. Omitido = aba ativa.' },
        },
        additionalProperties: false,
      },
      handler: async (args) => {
        const tabId = args.tabId !== undefined ? asNumber(args.tabId, -1) : undefined;
        if (tabId !== undefined && (!Number.isFinite(tabId) || tabId < 0)) throw new Error('tabId invalido');
        return sendCommand('get_page_info', { tabId: tabId ?? undefined }, tabId);
      },
    },
  ];
}
