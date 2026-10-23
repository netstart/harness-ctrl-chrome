#!/usr/bin/env node
/**
 * Orquestrador de testes E2E.
 *
 * Gerencia os processos necessários para um teste end-to-end completo:
 *  1. mcp-server-chrome (servidor MCP stdio + TCP para o native host)
 *  2. native-host (ponte stdio <-> TCP localhost:8765)
 *  3. Chrome com a extensão carregada (via Playwright)
 *
 * Este módulo é usado pelos testes E2E para iniciar/parar a infraestrutura
 * antes e depois dos testes.
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as net from 'net';

const ROOT = path.resolve(__dirname, '../../..');
const MCP_SERVER = path.join(ROOT, 'packages', 'mcp-server-chrome', 'dist', 'index.js');
const NATIVE_HOST = path.join(ROOT, 'packages', 'native-host', 'dist', 'index.js');
const CHROME_EXTENSION_DIST = path.join(ROOT, 'packages', 'chrome-extension', 'dist');

const MCP_PORT = 8765;
const MCP_HOST = '127.0.0.1';

let mcpProcess: ChildProcess | null = null;
let nativeHostProcess: ChildProcess | null = null;
let chromeProcess: ChildProcess | null = null;

/** Aguarda uma porta TCP aceitar conexões (com timeout). */
async function waitForPort(port: number, host: string = MCP_HOST, timeoutMs: number = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const socket = new net.Socket();
        socket.setTimeout(1000);
        socket.once('connect', () => {
          socket.destroy();
          resolve(undefined);
        });
        socket.once('error', () => {
          socket.destroy();
          reject(new Error('conexão recusada'));
        });
        socket.once('timeout', () => {
          socket.destroy();
          reject(new Error('timeout'));
        });
        socket.connect(port, host);
      });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`Porta ${host}:${port} não aceitou conexões após ${timeoutMs}ms`);
}

/** Inicia o servidor MCP como processo filho. */
export function startMcpServer(env: Record<string, string> = {}): ChildProcess {
  const stdio: ('pipe' | 'ignore' | 'inherit')[] = ['pipe', 'pipe', 'pipe'];
  mcpProcess = spawn('node', [MCP_SERVER], {
    stdio,
    env: { ...process.env, MCP_CHROME_PORT: String(MCP_PORT), ...env },
  });

  mcpProcess.stdout?.on('data', (d) => {
    process.stdout.write(`[mcp-server] ${d}`);
  });
  mcpProcess.stderr?.on('data', (d) => {
    process.stderr.write(`[mcp-server-err] ${d}`);
  });

  return mcpProcess;
}

/** Inicia o host de mensagens nativas como processo filho. */
export function startNativeHost(env: Record<string, string> = {}): ChildProcess {
  const stdio: ('pipe' | 'ignore' | 'inherit')[] = ['pipe', 'pipe', 'pipe'];
  nativeHostProcess = spawn('node', [NATIVE_HOST], {
    stdio,
    env: { ...process.env, MCP_CHROME_HOST: MCP_HOST, MCP_CHROME_PORT: String(MCP_PORT), ...env },
  });

  nativeHostProcess.stdout?.on('data', (d) => {
    process.stdout.write(`[native-host] ${d}`);
  });
  nativeHostProcess.stderr?.on('data', (d) => {
    process.stderr.write(`[native-host-err] ${d}`);
  });

  return nativeHostProcess;
}

/** Inicia o Chrome com a extensão carregada (modo headless, porta de depuração remota). */
export async function startChromeWithExtension(debugPort: number = 9222): Promise<ChildProcess> {
  const chromePath =
    process.env.CHROME_PATH ??
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

  const args = [
    `--headless=new`,
    `--remote-debugging-port=${debugPort}`,
    `--disable-extensions-except=${CHROME_EXTENSION_DIST}`,
    `--load-extension=${CHROME_EXTENSION_DIST}`,
    `--no-first-run`,
    `--no-default-browser-check`,
    `--disable-background-networking`,
    `--disable-sync`,
    `--metrics-recording-only`,
    '--disable-default-apps',
    '--mute-audio',
    'about:blank',
  ];

  chromeProcess = spawn(chromePath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  chromeProcess.stdout?.on('data', (d) => {
    process.stdout.write(`[chrome] ${d}`);
  });
  chromeProcess.stderr?.on('data', (d) => {
    process.stderr.write(`[chrome-err] ${d}`);
  });

  // Aguarda a porta de depuração remota do Chrome aceitar conexões.
  await waitForPort(debugPort, MCP_HOST, 30000);
  return chromeProcess;
}

/** Encerra todos os processos iniciados. */
export async function stopAll(): Promise<void> {
  const kill = (proc: ChildProcess | null, name: string) => {
    if (!proc) return;
    try {
      if (!proc.killed) proc.kill('SIGTERM');
    } catch {
      try { proc.kill('SIGKILL'); } catch { /* ignore */ }
    }
    console.error(`[orchestrator] ${name} encerrado`);
  };

  kill(chromeProcess, 'Chrome');
  kill(nativeHostProcess, 'native-host');
  kill(mcpProcess, 'mcp-server-chrome');

  chromeProcess = null;
  nativeHostProcess = null;
  mcpProcess = null;

  // Aguarda um pouco para os processos encerrarem.
  await new Promise((r) => setTimeout(r, 1000));
}

/** Verifica se o servidor MCP está respondendo (porta TCP aberta). */
export async function isMcpServerReady(): Promise<boolean> {
  try {
    await waitForPort(MCP_PORT, MCP_HOST, 2000);
    return true;
  } catch {
    return false;
  }
}

export { MCP_PORT, MCP_HOST };
