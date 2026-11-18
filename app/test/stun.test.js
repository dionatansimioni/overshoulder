import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { after, before, test } from 'node:test';
import { discoverPublicIp, parseBindingResponse } from '../stun.js';

const MAGIC = 0x2112a442;
// Resposta STUN com XOR-MAPPED-ADDRESS para o IP dado, como um servidor de verdade monta
const bindingResponse = (transactionId, ip) => {
  const raw = ip.split('.').reduce((n, part) => n * 256 + Number(part), 0);
  const attr = Buffer.alloc(12);
  attr.writeUInt16BE(0x0020, 0);
  attr.writeUInt16BE(8, 2);
  attr[5] = 0x01;
  attr.writeUInt16BE(1234 ^ (MAGIC >>> 16), 6);
  attr.writeUInt32BE((raw ^ MAGIC) >>> 0, 8);
  const head = Buffer.alloc(20);
  head.writeUInt16BE(0x0101, 0);
  head.writeUInt16BE(attr.length, 2);
  head.writeUInt32BE(MAGIC, 4);
  transactionId.copy(head, 8);
  return Buffer.concat([head, attr]);
};

let server;
let port;
const seen = [];
before(async () => {
  server = dgram.createSocket('udp4');
  server.on('message', (msg, from) => {
    seen.push(msg);
    const id = msg.subarray(8, 20);
    // Primeiro uma resposta de outra transação (deve ser ignorada), depois a certa
    server.send(bindingResponse(Buffer.alloc(12, 7), '198.51.100.1'), from.port, from.address);
    server.send(bindingResponse(id, '203.0.113.7'), from.port, from.address);
  });
  await new Promise((r) => server.bind(0, '127.0.0.1', r));
  port = server.address().port;
});
after(() => server.close());

test('descobre o IP público pela resposta STUN e ignora respostas de outra transação', async () => {
  assert.equal(await discoverPublicIp({ server: `127.0.0.1:${port}` }), '203.0.113.7');
  const req = seen[0];
  assert.equal(req.readUInt16BE(0), 0x0001, 'pedido de binding');
  assert.equal(req.readUInt32BE(4), MAGIC);
});

test('sem resposta, desiste com erro claro', async () => {
  const quiet = dgram.createSocket('udp4');
  await new Promise((r) => quiet.bind(0, '127.0.0.1', r));
  await assert.rejects(discoverPublicIp({ server: `127.0.0.1:${quiet.address().port}`, timeoutMs: 300 }), /sem resposta do STUN/);
  quiet.close();
});

test('respostas malformadas não viram IP', () => {
  const id = Buffer.alloc(12, 1);
  assert.equal(parseBindingResponse(Buffer.alloc(10), id), null);
  assert.equal(parseBindingResponse(Buffer.alloc(40), id), null);
  const truncated = bindingResponse(id, '203.0.113.7');
  truncated.writeUInt16BE(400, 2); // tamanho declarado maior que a mensagem
  assert.equal(parseBindingResponse(truncated.subarray(0, 24), id), null);
});
