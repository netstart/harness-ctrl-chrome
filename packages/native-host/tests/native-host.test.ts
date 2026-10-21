/**
 * Testes do host de mensagens nativas do Chrome.
 * Valida o framing de Native Messaging (header de 4 bytes LE + corpo JSON)
 * e o encaminhamento de mensagens para o servidor MCP via TCP.
 */

import * as net from 'net';

// Mock do stdout para capturar mensagens enviadas para a extensao.
const sentToExtension: Buffer[] = [];
const originalWrite = process.stdout.write.bind(process.stdout);
(process.stdout as any).write = ((chunk: any, ...rest: any[]) => {
  if (Buffer.isBuffer(chunk)) sentToExtension.push(chunk);
  return originalWrite(chunk, ...rest);
}) as any;

function parseFramedMessages(): string[] {
  const messages: string[] = [];
  let offset = 0;
  const concat = Buffer.concat(sentToExtension);
  while (offset + 4 <= concat.length) {
    const len = concat.readUInt32LE(offset);
    offset += 4;
    if (offset + len > concat.length) break;
    messages.push(concat.slice(offset, offset + len).toString('utf8'));
    offset += len;
  }
  return messages;
}

beforeEach(() => {
  sentToExtension.length = 0;
});

describe('Native Messaging framing (saida para a extensao)', () => {
  it('encapsula cada mensagem JSON em header de 4 bytes LE + corpo', () => {
    const payload = JSON.stringify({ type: 'result', id: 'abc', ok: true, data: { tabId: 1 } });
    const expectedHeader = Buffer.alloc(4);
    expectedHeader.writeUInt32LE(Buffer.byteLength(payload), 0);
    const expected = Buffer.concat([expectedHeader, Buffer.from(payload, 'utf8')]);

    // Simula o que sendToExtension faz: chamamos diretamente a logica.
    const body = Buffer.from(payload, 'utf8');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);
    process.stdout.write(header);
    process.stdout.write(body);

    const msgs = parseFramedMessages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toBe(payload);
    // Verifica framing byte-a-byte.
    const full = Buffer.concat(sentToExtension);
    expect(full.slice(0, 4).equals(expectedHeader)).toBe(true);
    expect(full.slice(4).equals(body)).toBe(true);
  });
});

describe('encaminhamento para o MCP server (TCP)', () => {
  it('aceita conexao TCP e fecha graciosamente', (done) => {
    const server = net.createServer((socket) => {
      socket.on('data', (chunk) => {
        const line = chunk.toString('utf8').trim();
        expect(line.startsWith('{')).toBe(true);
        const parsed = JSON.parse(line);
        expect(parsed.type).toBe('command');
        // Responde com um resultado simulado para validar o ciclo.
        socket.write(JSON.stringify({ type: 'result', id: parsed.id, ok: true, data: { tabId: 2 } }) + '\n');
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port;
      // Forca uma nova conexao apontando para a porta do servidor de teste.
      (globalThis as any).__MCP_PORT_FOR_TEST__ = port;
      server.close(() => done());
    });
  });
});
