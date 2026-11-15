// Como a mídia está chegando ao servidor: UDP direto (o melhor), TCP (a rede bloqueia UDP) ou TURN
// pela 443 (a rede só libera a 443). Lê as estatísticas do WebRTC; os testes chamam direto.
export const connectionType = (stats) => {
  const all = [...stats];
  const byId = new Map(all.map((r) => [r.id, r]));
  const selectedId = all.find((r) => r.type === 'transport' && r.selectedCandidatePairId)?.selectedCandidatePairId;
  const pair =
    byId.get(selectedId) ?? all.find((r) => r.type === 'candidate-pair' && r.selected) ?? all.find((r) => r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded');
  const local = pair && byId.get(pair.localCandidateId);
  if (!local) return null;
  if (local.candidateType === 'relay') return 'turn';
  return local.protocol === 'tcp' ? 'tcp' : 'udp';
};

export const CONNECTION_LABELS = {
  udp: 'Conexão: UDP, direta (a melhor)',
  tcp: 'Conexão: TCP (a rede bloqueia UDP; o vídeo pode atrasar mais)',
  turn: 'Conexão: TURN pela porta 443 (a rede só libera a 443; o vídeo pode atrasar mais)',
};
