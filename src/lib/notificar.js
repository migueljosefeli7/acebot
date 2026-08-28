const cfg = require('../config');
const gc = require('./guildconfig');
const membros = require('./membros');
const ui = require('./ui');

/** Link direto para um canal/tópico do servidor. */
const linkPara = (guildId, channelId) => `https://discord.com/channels/${guildId}/${channelId}`;

/**
 * Chama no privado TODO MUNDO que tem o cargo configurado em `roleKey`.
 *
 * Precisa do intent SERVER MEMBERS ligado no portal do Discord — sem ele o bot
 * só enxerga os membros que já estão em cache e a notificação sai incompleta.
 *
 * Retorna { enviados, semDm, total }.
 */
async function chamarCargo(client, guildId, roleKey, {
  titulo, descricao, dados, canalId, rotuloBotao = 'ATENDER CHAMADO', cor = cfg.COR.aviso, limite = 40,
}) {
  const vazio = { enviados: 0, semDm: 0, total: 0 };

  const roleId = gc.get(guildId, roleKey);
  if (!roleId) {
    console.warn(`[notificar] ${roleKey} não configurado — ninguém foi chamado no privado.`);
    return vazio;
  }

  // Cache compartilhado: baixar a lista inteira de membros a cada chamado de
  // staff era uma das maiores fontes de rate limit em horario de pico.
  const guild = await membros.comMembros(client, guildId);
  if (!guild) return vazio;

  const role = await guild.roles.fetch(roleId).catch(() => null);
  if (!role) return vazio;

  const alvos = [...role.members.values()].filter((m) => !m.user.bot).slice(0, limite);

  const container = ui.bloco(cor,
    ui.titulo(titulo),
    ui.txt(descricao),
    dados?.length ? ui.divisor() : null,
    dados?.length ? ui.tabela(dados) : null,
    ui.divisor(),
    canalId
      ? ui.comBotao(
          '**Chamado aberto** — clique para atender.',
          ui.botaoLink(linkPara(guildId, canalId), rotuloBotao, '🔔'),
        )
      : null,
    ui.nota(`${guild.name} · você recebeu isso porque tem o cargo @${role.name}`),
  );

  let enviados = 0;
  let semDm = 0;
  for (const membro of alvos) {
    try {
      await membro.send(ui.msg(container));
      enviados++;
    } catch {
      semDm++; // DM fechada ou bloqueou o bot
    }
  }

  console.log(`[notificar] ${roleKey}: ${enviados}/${alvos.length} avisados no privado (${semDm} com DM fechada).`);
  return { enviados, semDm, total: alvos.length };
}

module.exports = { chamarCargo, linkPara };
