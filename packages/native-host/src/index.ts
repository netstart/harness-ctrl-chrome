/**
 * Host de mensagens nativas do Chrome (Native Messaging host).
 *
 * Pontos de integracao:
 *  - Extensao Chrome <-> host: stdin/stdout com framing de 4 bytes
 *    (little-endian uint32 do tamanho do corpo JSON), conforme exigido pelo
 *    protocolo de Native Messaging do Chrome.
 *  - Host <-> servidor MCP: TCP localhost na porta configurada
 *    (MCP_CHROME_PORT, default 8765), mensagens por linha (JSON + '\n').
 *
 * O host e um proxy simples, sem estado de aplicacao: encaminha comandos do
 * Chrome para o MCP server e eventos/resultados do MCP server para o Chrome.
 * Nenhuma logica de controle do Chrome vive aqui (KISS / seguranca).
 */

import * as net from 'net';

const HOST = process.env.MCP_CHROME_HOST ?? '127.0.0.1';
const PORT = Number(process.env.MCP_CHROME_PORT ?? 8765);
const RECONNECT_INTERVAL_MS = Number(process.env.MCP_RECONNECT_INTERVAL_MS ?? 2000);

let client: net.Socket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let connecting = false;

// Buffer de dados brutos vindos do stdin (framing de 4 bytes).
let sizeBuffer = Buffer.alloc(4);
let sizeOffset = 0;
let bodyLength = 0;
let bodyBuffer: Buffer | null = null;

/** Conecta ao servidor MCP (TCP). Reconexao exponencial simples. */
function connect(): void {
  if (connecting || (client && !client.destroyed)) return;
  connecting = true;

  const sock = net.createConnection({ host: HOST, port: PORT });
  client = sock;

  sock.on('connect', () => {
    console.error(`[native-host] conectado ao MCP server ${HOST}:${PORT}`);
    connecting = false;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  });

  sock.on('data', (chunk) => {
    // Mensagens do MCP server sao por linha (JSON + '\n'). Encaminha cada
    // linha para a extensao com framing de Native Messaging.
    const text = chunk.toString('utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      sendToExtension(trimmed);
    }
  });

  sock.on('error', (err) => {
    console.error('[native-host] erro TCP:', err.message);
    scheduleReconnect();
  });

  sock.on('close', () => {
    console.error('[native-host] conexao TCP fechada');
    client = null;
    scheduleReconnect();
  });
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  connecting = false;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, RECONNECT_INTERVAL_MS);
}

/** Envia uma mensagem JSON para a extensao Chrome via stdout (framing 4 bytes). */
function sendToExtension(json: string): void {
  const body = Buffer.from(json, 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(header);
  process.stdout.write(body);
}

/** Lê do stdin com framing de Native Messaging e encaminha para o MCP server. */
function setupStdin(): void {
  const stdin = process.stdin;
  stdin.resume();

  stdin.on('data', (chunk: Buffer) => {
    let offset = 0;
    while (offset < chunk.length) {
      if (bodyLength === 0) {
        // Ainda lendo o header de 4 bytes (tamanho).
        const needed = 4 - sizeOffset;
        const take = Math.min(needed, chunk.length - offset);
        chunk.copy(sizeBuffer, sizeOffset, offset, offset + take);
        sizeOffset += take;
        offset += take;

        if (sizeOffset === 4) {
          bodyLength = sizeBuffer.readUInt32LE(0);
          // Protege contra mensagens absurdamente grandes.
          if (bodyLength > 1024 * 1024) {
            console.error('[native-host] mensagem muito grande:', bodyLength);
            sizeOffset = 0;
            bodyLength = 0;
          }
          bodyBuffer = Buffer.alloc(bodyLength);
        }
      } else {
        // Lendo o corpo JSON.
        const needed = bodyLength - bodyBuffer!.length;
        const take = Math.min(needed, chunk.length - offset);
        chunk.copy(bodyBuffer!, bodyBuffer!.length - needed, offset, offset + take);
        offset += take;

        if (bodyBuffer!.length === bodyLength) {
          const line = bodyBuffer!.toString('utf8');
          bodyBuffer = null;
          bodyLength = 0;
          sizeOffset = 0;

          if (client && client.writable && !client.destroyed) {
            client.write(line + '\n');
          } else {
            console.error('[native-host] MCP server nao conectado; comando descartado:', line.slice(0, 200));
          }
        }
      }
    }
  });

  stdin.on('end', () => {
    console.error('[native-host] stdin encerrado (extensao desconectada)');
    process.exit(0);
  });

  stdin.on('error', (err) => {
    console.error('[native-host] erro no stdin:', err.message);
    process.exit(1);
  });
}

// ---- Inicializacao ----

function main(): void {
  connect();
  setupStdin();

  process.on('SIGTERM', () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (client) client.destroy();
    process.exit(0);
  });
  process.on('SIGINT', () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (client) client.destroy();
    process.exit(0);
  });
  process.on('uncaughtException', (err) => {
    console.error('[native-host] excecao nao tratada:', err.stack ?? err.message);
    process.exit(1);
  });
}

main();
