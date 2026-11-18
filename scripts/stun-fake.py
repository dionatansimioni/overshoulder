"""Servidor STUN falso para o teste da imagem: responde a qualquer pedido de binding com o IP dado.
Uso: python3 -I scripts/stun-fake.py <porta> <ip>  (roda até ser encerrado)"""
import socket
import struct
import sys

MAGIC = 0x2112A442
port, ip = int(sys.argv[1]), sys.argv[2]
raw = struct.unpack('!I', socket.inet_aton(ip))[0]
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.bind(('0.0.0.0', port))
while True:
    msg, addr = sock.recvfrom(2048)
    if len(msg) < 20 or struct.unpack('!H', msg[:2])[0] != 0x0001:
        continue
    attr = struct.pack('!HHBBHI', 0x0020, 8, 0, 1, 1234 ^ (MAGIC >> 16), raw ^ MAGIC)
    sock.sendto(struct.pack('!HHI', 0x0101, len(attr), MAGIC) + msg[8:20] + attr, addr)
