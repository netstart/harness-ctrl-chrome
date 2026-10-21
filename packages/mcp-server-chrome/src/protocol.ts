/**
 * Manipulador do protocolo MCP sobre JSON-RPC 2.0 (transporte baseado em linhas).
 *
 * É intencionalmente sem dependência do SDK oficial do MCP para manter o
 * servidor enxuto, offline-friendly e fácil de auditar. Implementa:
 *  - initialize / capabilities
 *  - notifications/initialized (ack)
 *  - tools/list
 *  - tools/call
 */

export type MCPTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

export interface MCPHandlerOptions {
  tools: MCPTool[];
  serverName?: string;
  serverVersion?: string;
}

type MCPResponse = {
  jsonrpc: '2.0';
  id?: unknown;
  result?: unknown;
  error?: unknown;
  content?: { type: string; text: string }[];
  isError?: boolean;
};

export class MCPHandler {
  private initialized = false;
  private readonly tools: Map<string, MCPTool> = new Map();

  constructor(private readonly options: MCPHandlerOptions) {
    for (const tool of options.tools) {
      this.tools.set(tool.name, tool);
    }
  }

  /** Processa uma linha JSON-RPC recebida pelo stdin. Retorna a resposta quando
   *  deve responder, `null` para notificacoes de entrada sem resposta. */
  async handleLine(line: string): Promise<MCPResponse | null> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return this.errorResponse(null, -32700, 'Parse error');
    }

    if (!this.isValidRequest(parsed)) {
      return this.errorResponse(this.getId(parsed), -32600, 'Invalid Request');
    }

    const req = parsed as { jsonrpc: string; id: unknown; method: string; params?: unknown };
    const { method } = req;

    // Notificacao do cliente: initialized (nao aguarda resposta)
    if (method === 'notifications/initialized') {
      this.initialized = true;
      return null;
    }

    // Requisicoes exigem servidor inicializado (exceto initialize)
    if (method !== 'initialize' && !this.initialized) {
      return this.errorResponse(req.id, -32002, 'Server not initialized. Call initialize first.');
    }

    switch (method) {
      case 'initialize':
        return this.handleInitialize(req.id);
      case 'tools/list':
        return this.handleToolsList(req.id);
      case 'tools/call':
        return this.handleToolsCall(req.id, req.params);
      default:
        return this.errorResponse(req.id, -32601, `Method not found: ${method}`);
    }
  }

  /** Produz uma notificacao do servidor para ser enviada ao cliente (ex: logs). */
  serverNotification(method: string, params: unknown): MCPResponse & { method: string } {
    return { jsonrpc: '2.0', method, params } as MCPResponse & { method: string };
  }

  /* -------------------------- internos -------------------------- */

  private isValidRequest(v: unknown): boolean {
    if (!v || typeof v !== 'object') return false;
    const o = v as Record<string, unknown>;
    return o.jsonrpc === '2.0' && typeof o.method === 'string';
  }

  private getId(v: unknown): unknown {
    if (!v || typeof v !== 'object') return null;
    return (v as Record<string, unknown>).id ?? null;
  }

  private errorResponse(id: unknown, code: number, message: string): MCPResponse {
    return { jsonrpc: '2.0', id, error: { code, message } };
  }

  private successResponse(id: unknown, result: unknown): MCPResponse {
    return { jsonrpc: '2.0', id, result };
  }

  private handleInitialize(id: unknown): MCPResponse {
    this.initialized = true;
    return this.successResponse(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: {
        name: this.options.serverName ?? 'mcp-server-chrome',
        version: this.options.serverVersion ?? '1.0.0',
      },
    });
  }

  private handleToolsList(id: unknown): MCPResponse {
    return this.successResponse(id, {
      tools: Array.from(this.tools.values()).map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
      })),
    });
  }

  private async handleToolsCall(id: unknown, params: unknown): Promise<MCPResponse> {
    const p = params as { name?: string; arguments?: unknown } | undefined;
    if (!p || typeof p.name !== 'string') {
      return this.errorResponse(id, -32602, 'Invalid params: "name" is required');
    }

    const tool = this.tools.get(p.name);
    if (!tool) {
      return this.errorResponse(id, -32602, `Tool not found: ${p.name}`);
    }

    const args = (p.arguments && typeof p.arguments === 'object') ? (p.arguments as Record<string, unknown>) : {};

    try {
      const result = await tool.handler(args);
      // Formato de resultado de ferramenta MCP: lista de conteudos.
      return this.successResponse(id, {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message },
        content: [{ type: 'text', text: message }],
        isError: true,
      } as MCPResponse;
    }
  }
}
