/**
 * Cliente MCP simples para testes E2E.
 *
 * Conecta ao servidor MCP via stdio (spawn de processo) e envia
 * mensagens JSON-RPC 2.0, aguardando respostas por linha.
 */

import { spawn, ChildProcess } from 'child_process';
import * as readline from 'readline';

export interface McpClientOptions {
  cwd: string;
  env?: Record<string, string>;
}

export class McpTestClient {
  private proc: ChildProcess | null = null;
  private rl: readline.ReadLine | null = null;
  private pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private requestId = 0;

  constructor(private readonly options: McpClientOptions) {}

  /** Inicia o servidor MCP como processo filho e conecta via stdio. */
  start(): void {
    this.proc = spawn('node', ['dist/index.js'], {
      cwd: this.options.cwd,
      env: { ...process.env, ...this.options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.proc.stderr?.on('data', (d) => {
      process.stderr.write(`[mcp-client-err] ${d}`);
    });

    this.rl = readline.createInterface({ input: this.proc.stdout!, terminal: false });
    this.rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const msg = JSON.parse(trimmed);
        // Notificações (sem id) são ignoradas aqui; respostas têm id.
        if (msg && typeof msg.id === 'string') {
          const pend = this.pending.get(msg.id);
          if (pend) {
            this.pending.delete(msg.id);
            if (msg.error) pend.reject(new Error(msg.error.message));
            else pend.resolve(msg.result);
          }
        }
      } catch {
        // Ignora linhas que não são JSON válido.
      }
    });

    this.proc.on('close', () => {
      // Rejeita todas as pendências.
      for (const [, pend] of this.pending) {
        pend.reject(new Error('MCP server encerrou'));
      }
      this.pending.clear();
    });
  }

  /** Envia uma requisição JSON-RPC e aguarda a resposta. */
  async request<T = any>(method: string, params: any = {}, timeoutMs = 10000): Promise<T> {
    if (!this.proc || !this.rl) throw new Error('MCP client não iniciado');

    const id = (++this.requestId).toString();
    const message = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    this.proc.stdin!.write(message);

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout aguardando resposta para '${method}'`));
      }, timeoutMs);
      this.pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v as T); }, reject: (e) => { clearTimeout(timer); reject(e); } });
    });
  }

  /** Inicializa o servidor MCP (chamada obrigatória antes de usar ferramentas). */
  async initialize(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'e2e-test-client', version: '1.0.0' },
    });
    await this.request('notifications/initialized', {});
  }

  /** Lista as ferramentas disponíveis. */
  async listTools(): Promise<any[]> {
    const res: any = await this.request('tools/list', {});
    return res.tools ?? [];
  }

  /** Chama uma ferramenta MCP. */
  async callTool(name: string, args: any = {}): Promise<any> {
    const res: any = await this.request('tools/call', { name, arguments: args });
    // O servidor retorna content[0].text com o resultado serializado em JSON.
    if (res.isError) throw new Error(res.error?.message ?? 'Erro na chamada de ferramenta');
    const text = res.content?.[0]?.text ?? '{}';
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }

  /** Encerra o cliente e o servidor MCP. */
  stop(): void {
    if (this.proc && !this.proc.killed) {
      this.proc.kill('SIGTERM');
    }
    this.proc = null;
    this.rl = null;
    this.pending.clear();
  }
}
