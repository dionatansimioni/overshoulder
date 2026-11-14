#!/usr/bin/env python3
# Usado por test-image.sh: manda um STUN Binding Request por TLS para host:porta, pedindo o nome
# (SNI) informado, e confere a resposta. Prova que a divisão da 443 chega ao TURN do LiveKit.
import os, socket, ssl, struct, sys
host, port, sni = sys.argv[1], int(sys.argv[2]), sys.argv[3]
ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
with socket.create_connection((host, port), timeout=5) as raw, ctx.wrap_socket(raw, server_hostname=sni) as tls:
    cert = tls.getpeercert(binary_form=True)
    txid = os.urandom(12)
    tls.sendall(struct.pack('!HHI', 0x0001, 0, 0x2112A442) + txid)
    resp = tls.recv(512)
    kind, length, cookie = struct.unpack('!HHI', resp[:8])
    ok = kind == 0x0101 and cookie == 0x2112A442 and resp[8:20] == txid
    print(f"SNI={sni}: resposta STUN 0x{kind:04x} ({'Binding Success' if ok else 'inesperada'}), certificado com {len(cert)} bytes")
    sys.exit(0 if ok else 1)
