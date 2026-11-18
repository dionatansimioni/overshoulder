// Descobre o IPv4 público do servidor com um pedido STUN (RFC 5389), o mesmo mecanismo que o LiveKit usa
// para anunciar o próprio IP. Serve para subir sem DOMAIN (instalação de um clique, como na Hostinger):
// o certificado é emitido para o IP.
import crypto from 'node:crypto';
import dgram from 'node:dgram';

const MAGIC = 0x2112a442;
export const DEFAULT_STUN = 'stun.l.google.com:19302';

// Lê o endereço da resposta: XOR-MAPPED-ADDRESS (0x0020) ou, em servidores antigos, MAPPED-ADDRESS (0x0001)
export const parseBindingResponse = (msg, transactionId) => {
  if (msg.length < 20 || msg.readUInt16BE(0) !== 0x0101 || msg.readUInt32BE(4) !== MAGIC) return null;
  if (!msg.subarray(8, 20).equals(transactionId)) return null;
  const end = Math.min(msg.length, 20 + msg.readUInt16BE(2));
  for (let i = 20; i + 4 <= end; ) {
    const type = msg.readUInt16BE(i);
    const len = msg.readUInt16BE(i + 2);
    const value = msg.subarray(i + 4, i + 4 + len);
    if ((type === 0x0020 || type === 0x0001) && value.length >= 8 && value[1] === 0x01) {
      const raw = value.readUInt32BE(4) ^ (type === 0x0020 ? MAGIC : 0);
      return [raw >>> 24, (raw >>> 16) & 255, (raw >>> 8) & 255, raw & 255].join('.');
    }
    i += 4 + len + ((4 - (len % 4)) % 4);
  }
  return null;
};

export const discoverPublicIp = ({ server = DEFAULT_STUN, timeoutMs = 4000 } = {}) =>
  new Promise((resolve, reject) => {
    const [host, portText] = server.split(':');
    const port = Number(portText ?? 3478);
    const id = crypto.randomBytes(12);
    const request = Buffer.alloc(20);
    request.writeUInt16BE(0x0001, 0);
    request.writeUInt32BE(MAGIC, 4);
    id.copy(request, 8);
    const socket = dgram.createSocket('udp4');
    const done = (err, ip) => {
      clearTimeout(timer);
      socket.close();
      err ? reject(err) : resolve(ip);
    };
    const timer = setTimeout(() => done(new Error(`sem resposta do STUN em ${server}`)), timeoutMs);
    socket.on('message', (msg) => {
      const ip = parseBindingResponse(msg, id);
      if (ip) done(null, ip);
    });
    socket.on('error', (err) => done(err));
    // Repete o pedido algumas vezes: é UDP, um pacote pode se perder
    let tries = 0;
    const send = () => {
      if (tries++ < 3) socket.send(request, port, host, (err) => err && done(err));
    };
    send();
    const again = setInterval(send, timeoutMs / 3);
    socket.on('close', () => clearInterval(again));
  });
