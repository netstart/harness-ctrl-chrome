#!/usr/bin/env node
/**
 * Servidor MCP (stdio) para controle do Chrome.
 *
 * Pontos de integracao:
 *  - Clientes (OpenCode, DeepSeek Harness) falam MCP pelo stdio (JSON-RPC 2.0).
 *  - O host de mensagens nativas do Chrome se conecta por TCP a este servidor
 *    e faz a ponte para a extensao Chrome (Manifest V3).
 *
 * Fluxo de uma acao:
 *  cliente MCP -> stdio -> tools/call -> sendCommand -> TCP -> native-host ->
 *   extensao Chrome -> script de conteudo/DOM -> resultado volta pelo mesmo
 *   caminho ate o cliente.
 *
 * Garantias no estilo ACID:
 *  - Atomicidade: cada tools/call e uma unidade que ou completa com sucesso ou
 *    retorna erro sem efeito parcial visivel ao cliente.
 *  - Isolamento: comandos da mesma aba sao serializados por TabMutex.
 *  - Consistencia: o resultado devolvido reflete o estado observado no Chrome.
 */

import { createServer as createNetServer, Socket } from 'net';
import { createInterface } from 'readline';
import { MCPHandler } from './protocol';
import { createTools } from './tools';
import { TabMutex } from './lock';
import type { CommandMessage } from '@harness-ctrl-chrome/shared-protocol';
import { isKnownWireMessage } from '@harness-ctrl-chrome/shared-protocol';

const PORT = Number(process.env.MCP_CHROME_PORT ?? 8765);
const COMMAND_TIMEOUT_MS = Number(process.env.MCP_COMMAND_TIMEOUT_MS ?? 30000);

const mutex = new TabMutex();
let activeSocket: Socket | null = null;
const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();

// ---- Envio de comandos ao Chrome via TCP (host nativo) ----

function sendCommand(
  command: CommandMessage['command'],
  payload: Record<string, unknown>,
  tabId?: number
): Promise<unknown> {
  const run = () => {
    return new Promise<unknown>((resolve, reject) => {
      if (!activeSocket || activeSocket.destroyed || activeSocket.readyState !== 'open') {
        reject(new Error('Host nativo do Chrome nao esta conectado. Inicie o native-host e conecte a extensao.'));
        return;
      }

      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Tempo esgotado aguardando resultado do comando '${command}' (${COMMAND_TIMEOUT_MS}ms)`));
      }, COMMAND_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });

      const envelope: CommandMessage = { type: 'command', id, command, payload, timestamp: Date.now() };
      activeSocket.write(JSON.stringify(envelope) + '\n');
    });
  };

  // Isolamento por aba (ACID I): serializa acessos concorrentes a mesma aba.
  if (tabId !== undefined) return mutex.run(tabId, run);
  return run();
}

// ---- Servidor MCP e manipulador de protocolo ----

const handler = new MCPHandler({
  tools: createTools(sendCommand),
  serverName: 'mcp-server-chrome',
  serverVersion: '1.0.0',
});

// ---- Servidor TCP para o host nativo do Chrome ----

const netServer = createNetServer((socket) => {
  console.error('[mcp-server-chrome] host nativo conectado:', socket.remoteAddress, socket.remotePort);
  activeSocket = socket;

  let buffer = '';
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      handleWireLine(line);
    }
  });

  socket.on('end', () => {
    console.error('[mcp-server-chrome] host nativo desconectado');
    if (activeSocket === socket) activeSocket = null;
  });
  socket.on('error', (err) => {
    console.error('[mcp-server-chrome] erro no socket do host nativo:', err.message);
    if (activeSocket === socket) activeSocket = null;
  });
});

function handleWireLine(line: string): void {
  let parsed: unknown;
  try { parsed = JSON.parse(line); } catch {
    console.error('[mcp-server-chrome] linha invalida do host nativo:', line.slice(0, 200));
    return;
  }

  if (!isKnownWireMessage(parsed)) {
    console.error('[mcp-server-chrome] mensagem desconhecida do host nativo');
    return;
  }

  if (parsed.type === 'result') {
    const m = parsed as { id: string; ok: boolean; data?: unknown; error?: string };
    const pend = pending.get(m.id);
    if (!pend) return; // resultado de comando ja descartado / desconhecido
    clearTimeout(pend.timer);
    pending.delete(m.id);
    if (m.ok) pend.resolve(m.data ?? null);
    else pend.reject(new Error(m.error ?? `Comando falhou (sem detalhe)`));
    return;
  }

  if (parsed.type === 'event') {
    // Eventos do Chrome sao repassados como notificacoes de log do MCP ao cliente.
    const ev = parsed as { event: string; payload: unknown; timestamp?: number };
    const notif = handler.serverNotification('notifications/message', {
      kind: 'chrome_event',
      event: ev.event,
      payload: ev.payload,
      timestamp: ev.timestamp,
    });
    process.stdout.write(JSON.stringify(notif) + '\n');
    return;
  }
}

netServer.listen(PORT, () => {
  console.error(`[mcp-server-chrome] escutando host nativo na porta ${PORT}`);
});

// ---- Transporte stdio (clientes MCP) ----

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });

function sendMcpMessage(message: unknown): void {
  process.stdout.write(JSON.stringify(message) + '\n');
}

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  const response = await handler.handleLine(trimmed);
  if (response) sendMcpMessage(response);
});

rl.on('close', () => {
  process.exit(0);
});

// ---- Encerramento graceful ----

function shutdown(signal: string): void {
  console.error(`[mcp-server-chrome] encerrando por ${signal}`);
  for (const [, pend] of pending) {
    clearTimeout(pend.timer);
    pend.reject(new Error(`Servidor encerrado (${signal})`));
  }
  pending.clear();
  netServer.close(() => process.exit(0));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Tratamento de erros nao tratados para nao deixar o stdio travado.
process.on('uncaughtException', (err) => {
  console.error('[mcp-server-chrome] excecao nao tratada:', err.stack ?? err.message);
  process.exit(1);
});
