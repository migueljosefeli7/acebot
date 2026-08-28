/**
 * Registro central de emojis customizados do servidor.
 *
 * Identidade visual: TODO emoji novo no bot deve vir daqui, nunca hardcoded
 * solto num arquivo de feature. Facilita trocar/atualizar em um lugar so.
 *
 * Os marcados "PENDENTE" nao tem emoji customizado real ainda — sao conceitos
 * novos (win streak, caixa, evento...) que nao existiam no servidor quando
 * isso foi escrito. Estao com fallback em emoji comum do Discord ate voce
 * trocar pelo emoji customizado de verdade (edite so este arquivo).
 */

module.exports = {
  // ---- ja confirmados no servidor ----
  logo: '<:logored:1542019888095301642>',
  cifrao: '<:cifrao:1542021614600978452>',
  user: '<:user:1542021460342738944>',
  depositar: '<:DEPOSITAR:1542022270740988086>',
  sacar: '<:SACAR:1542022254068764783>',
  ticket: '<:ticekt:1542033006905139212>',
  duas: '<:duas:1542028376452370482>',
  gelo: '<:glo:1542027218341994618>',
  infinito: '<:infinito:1542027016768069702>',
  partida: '<:pt:1542011838487597076>',
  sair: '<:sair:1542942267487289434>',

  // ---- PENDENTE: troque pelo emoji customizado real quando tiver o ID ----
  fogo: '🔥',        // win streak
  caixa: '🎁',        // sistema de caixas/roleta
  evento: '📅',       // eventos personalizados
  streamer: '🎥',     // paineis de streamer
  relogio: '⏱️',      // B.O / analise de tela
  arquivo: '📄',      // logs/transcript
  completar: '🤝',    // completar aposta
  moeda: '🪙',        // pontos/coins genericos (distinto de cifrao = dinheiro real)
  troféu: '🏆',
  aviso: '⚠️',
  emulador: '🖥️',     // fila Misto (quantidade de EMU no time)
};
