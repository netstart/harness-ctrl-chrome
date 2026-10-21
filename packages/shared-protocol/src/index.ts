/**
 * Protocolo de fio compartilhado entre:
 *  - mcp-server-chrome (servidor MCP, stdio para clientes + WebSocket para o host nativo)
 *  - native-host (ponte Chrome Native Messaging <-> WebSocket do MCP server)
 *  - chrome-extension (extensão Manifest V3)
 *
 * Mensagens trocam-se como JSON. Cada comando tem um `id` de correlação e cada
 * resultado/evento referencia esse `id` quando aplicável.
 */

export type MessageType = 'command' | 'result' | 'event';

export interface WireEnvelope {
  type: MessageType;
  id?: string;           // presente em commands e results (correlação)
  timestamp?: number;    // epoch ms
}

/* -------------------------- Commands (MCP server -> Chrome) -------------------------- */

export type ChromeCommand =
  | { command: 'list_tabs'; payload: ListTabsPayload }
  | { command: 'open_tab'; payload: OpenTabPayload }
  | { command: 'navigate'; payload: NavigatePayload }
  | { command: 'close_tab'; payload: CloseTabPayload }
  | { command: 'focus_tab'; payload: FocusTabPayload }
  | { command: 'fill_form'; payload: FillFormPayload }
  | { command: 'click'; payload: ClickPayload }
  | { command: 'read'; payload: ReadPayload }
  | { command: 'screenshot'; payload: ScreenshotPayload }
  | { command: 'evaluate'; payload: EvaluatePayload }
  | { command: 'get_page_info'; payload: GetPageInfoPayload };

export interface CommandMessage extends WireEnvelope {
  type: 'command';
  id: string;
  command: ChromeCommand['command'];
  payload: Record<string, unknown>;
}

/* -------------------------- Payloads -------------------------- */

export interface ListTabsPayload {}
export interface GetPageInfoPayload { tabId?: number; }

export interface OpenTabPayload {
  url?: string;          // ausente = aba nova em branco
  active?: boolean;      // default true
  windowId?: number;
}

export interface NavigatePayload {
  tabId: number;
  url: string;
}

export interface CloseTabPayload { tabId: number; }

export interface FocusTabPayload { tabId: number; }

export interface FillFormPayload {
  tabId: number;
  // mapeamento seletor CSS -> valor. Ex: { '#usuario': 'fulano', '#senha': 'x' }
  fields: Record<string, string>;
  submitAfter?: boolean; // clicar no primeiro botão submit após preencher
}

export interface ClickPayload {
  tabId: number;
  selector: string;      // seletor CSS do elemento a clicar
}

export interface ReadPayload {
  tabId: number;
  selector?: string;     // ausente = ler texto visível da página inteira
  as?: 'text' | 'html' | 'json'; // default 'text'
}

export interface ScreenshotPayload {
  tabId: number;
  format?: 'png' | 'jpeg';
  quality?: number;      // 0-100, apenas jpeg
  fullPage?: boolean;
}

export interface EvaluatePayload {
  tabId: number;
  script: string;        // JS executado no contexto da página (conteúdo)
}

/* -------------------------- Results -------------------------- */

export interface ResultMessage extends WireEnvelope {
  type: 'result';
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface TabInfo {
  tabId: number;
  windowId: number;
  url: string;
  title: string;
  active: boolean;
  incognito: boolean;
  pinned: boolean;
}

export interface PageInfo {
  tabId: number;
  url: string;
  title: string;
  favIconUrl?: string;
}

export interface ReadResult {
  selector?: string;
  as: string;
  content: string;
  length: number;
}

export interface ScreenshotResult {
  tabId: number;
  format: string;
  dataUrl: string;      // data URL (base64)
  bytes: number;
}

/* -------------------------- Events (Chrome -> MCP server) -------------------------- */

export interface EventMessage extends WireEnvelope {
  type: 'event';
  id?: string;
  event: ChromeEvent;
  payload: unknown;
}

export type ChromeEvent =
  | 'tab_created'
  | 'tab_removed'
  | 'tab_updated'
  | 'tab_activated'
  | 'navigated'
  | 'page_loaded'
  | 'console_message'
  | 'error';

/* -------------------------- Validação em tempo de execução -------------------------- */

export const CHROME_COMMANDS = new Set([
  'list_tabs', 'open_tab', 'navigate', 'close_tab', 'focus_tab',
  'fill_form', 'click', 'read', 'screenshot', 'evaluate', 'get_page_info',
] as const);

export const CHROME_EVENTS = new Set([
  'tab_created', 'tab_removed', 'tab_updated', 'tab_activated', 'navigated',
  'page_loaded', 'console_message', 'error',
] as const);

export function isWireEnvelope(v: unknown): v is WireEnvelope {
  return (
    typeof v === 'object' && v !== null &&
    'type' in v &&
    (v as { type?: unknown }).type !== undefined &&
    ['command', 'result', 'event'].includes(v.type as string)
  );
}

export function isCommandMessage(v: unknown): v is CommandMessage {
  if (!isWireEnvelope(v) || v.type !== 'command') return false;
  const m = v as CommandMessage;
  return typeof m.id === 'string' && CHROME_COMMANDS.has(m.command as ChromeCommand['command']);
}

export function isResultMessage(v: unknown): v is ResultMessage {
  if (!isWireEnvelope(v) || v.type !== 'result') return false;
  const m = v as ResultMessage;
  return typeof m.id === 'string' && typeof m.ok === 'boolean';
}

export function isEventMessage(v: unknown): v is EventMessage {
  if (!isWireEnvelope(v) || v.type !== 'event') return false;
  const m = v as EventMessage;
  return typeof m.event === 'string' && CHROME_EVENTS.has(m.event as ChromeEvent);
}

export function isKnownWireMessage(v: unknown): v is CommandMessage | ResultMessage | EventMessage {
  return isCommandMessage(v) || isResultMessage(v) || isEventMessage(v);
}
