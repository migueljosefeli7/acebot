# ACE BOT — apostas de Free Fire no Discord

Bot completo com **carteira PIX (Mercado Pago)**, **filas por modalidade** e **tickets de partida** com combinação de regras, resultado confirmado pelos dois jogadores, SOS de suporte e VAR interno da staff.

---

## 1. Instalar o Node.js

O bot roda em Node.js 20 ou superior. Na máquina atual **ele ainda não está instalado**.

```bash
winget install OpenJS.NodeJS.LTS
```

Depois **feche e abra o terminal** e confira:

```bash
node -v
```

(Alternativa: baixar o instalador em https://nodejs.org — versão LTS.)

## 2. Instalar as dependências

```bash
cd "C:\Users\FlexAim\Desktop\ACEBOT" && npm install
```

## 3. Criar o bot no Discord

1. https://discord.com/developers/applications → **New Application**
2. Aba **Bot** → **Reset Token** → copie o token → vai no `.env` em `DISCORD_TOKEN`
3. Ainda em **Bot**, ligue **MESSAGE CONTENT INTENT**
4. Aba **General Information** → copie o **Application ID** → `CLIENT_ID`
5. Aba **OAuth2 → URL Generator** → marque `bot` + `applications.commands` e as permissões:
   `Manage Threads`, `Create Private Threads`, `Send Messages`, `Send Messages in Threads`,
   `Embed Links`, `Attach Files`, `Read Message History`, `Manage Messages`
6. Abra a URL gerada e adicione o bot no servidor
7. Ative o **Modo de desenvolvedor** no Discord (Configurações → Avançado) para copiar IDs.
   Clique com o botão direito no servidor → **Copiar ID do servidor** → `GUILD_ID`

## 4. Configurar o `.env`

Copie `.env.example` para `.env` e preencha:

```bash
copy .env.example .env
```

| Variável | O que é |
|---|---|
| `DISCORD_TOKEN` | token do bot |
| `CLIENT_ID` | ID da aplicação |
| `GUILD_ID` | ID do seu servidor (registra os comandos na hora) |
| `MP_ACCESS_TOKEN` | credencial de **produção** do Mercado Pago |
| `PUBLIC_URL` | URL pública que recebe o webhook do PIX |
| `TAXA_PARTIDA_CENTAVOS` | `50` = R$ 0,50 por partida (R$ 0,25 de cada lado) |
| `DEPOSITO_MINIMO_CENTAVOS` | `100` = R$ 1,00 |
| `SAQUE_MINIMO_CENTAVOS` | `500` = R$ 5,00 |
| `FAKE_PAYMENTS` | `true` para testar sem gateway nenhum |

### Mercado Pago

1. https://www.mercadopago.com.br/developers/panel/app → crie uma aplicação
2. **Credenciais de produção** → copie o `Access Token` (`APP_USR-...`) → `MP_ACCESS_TOKEN`
3. Em **Webhooks**, cadastre a URL `SEU_PUBLIC_URL/webhook/mercadopago` e marque o evento **Pagamentos**

## 5. Rodar

```bash
npm start
```

---

## Testar tudo no PC, sem gateway

No `.env` coloque `FAKE_PAYMENTS=true`. O botão **Depositar** gera um PIX falso e o botão
**Já paguei** credita o saldo na hora. Todo o resto (filas, tickets, regras, resultado, SS,
saque) funciona igual à produção. É assim que se testa o fluxo inteiro sem mexer em dinheiro.

Para testar o PIX **real** ainda no PC, o Mercado Pago precisa alcançar sua máquina:

```bash
npx ngrok http 3000
```

Copie a URL `https://....ngrok-free.app` para `PUBLIC_URL` e cadastre-a no webhook do MP.

---

## Configuração dentro do Discord

Rode uma vez, como administrador:

```
/config canal canal_tickets          #tickets-partidas
/config canal canal_log_deposito     #logs-entrada
/config canal canal_log_saque        #logs-saida
/config canal canal_log_partidas     #logs-partidas
/config canal canal_saques_staff     #saques-staff
/config canal canal_ss               #chamados-suporte-staff
/config canal canal_analises         #var-analises
/config cargo cargo_staff            @Staff
/config cargo cargo_analista         @AnalistasVAR
/config ver
```

Painel de saldo:

```
/painel-saldo canal:#saldo
```

Filas — uma por modalidade **e por valor** (dá para ter várias no mesmo canal, igual nos prints):

```
/fila criar modalidade:1x1 Mobile   valor:100  canal:#1x1-mob
/fila criar modalidade:1x1 Mobile   valor:50   canal:#1x1-mob
/fila criar modalidade:2x2 Mobile   valor:100  canal:#2x2-mob
...
```

O painel fixo tem 4 botoes: **MEU PERFIL**, **DEPOSITAR**, **SACAR** e **VOUCHER**.

Outros comandos: `/fila listar`, `/fila remover`, `/fila republicar`,
`/saldo adicionar|remover|ver|extrato|bloquear`,
`/voucher criar|listar|ver|desativar`,
`/partida vencedor|anular|painel|abertas`.

## Sugestões e votação

Configure uma vez:

```
/sugestao configurar canal:#sugestoes
```

Depois disso, toda mensagem comum enviada no canal vira um painel com votação
**SIM / NÃO**. Cada pessoa tem um voto, pode trocar de opção ou remover clicando
na mesma opção. O bot também abre um tópico público ligado à sugestão para discussão.

Para consultar ou desligar:

```
/sugestao ver
/sugestao desativar
```

## IA Chat

O canal de atendimento usa a OpenAI Responses API para responder dúvidas sobre
filas, saldo, partidas, regras, quebra de regra, tela, elo e loja. Cada jogador
tem um contexto separado, que expira após algumas horas.

1. Crie uma chave de projeto em https://platform.openai.com/api-keys.
2. Coloque `OPENAI_API_KEY` no `.env` e reinicie o bot.
3. Configure o canal:

```
/ia configurar canal:#ia-chat
```

O modelo padrão é `gpt-5.6-luna`, mas pode ser trocado em `OPENAI_MODEL`. Para
adicionar regras próprias do servidor sem editar o código:

```
/ia regras texto:SEU TEXTO DE REGRAS
```

Outros comandos:

```
/ia ver
/ia limpar-contexto
/ia limpar-contexto jogador:@Fulano
/ia desativar
```

A IA fala em português informal, mas não pode prometer estorno, decidir disputa,
inventar saldo ou se passar pela staff. Casos concretos de dinheiro e punição são
encaminhados à equipe.

---

## Vouchers

Codigo de bonus que a staff cria e o jogador resgata no botao **VOUCHER** do painel.
O saldo cai na conta dele na hora e o resgate aparece no log de entrada.

```
/voucher criar valor:10 usos:50 descricao:Promo de lancamento
/voucher criar valor:25 exclusivo:@Fulano validade_horas:48
/voucher criar valor:5 usos:100 codigo:GUETOFEST
```

| Opcao | Para que serve |
|---|---|
| `valor` | quanto cada resgate credita (obrigatorio) |
| `usos` | quantas pessoas podem resgatar (padrao 1) |
| `exclusivo` | trava o codigo num jogador so |
| `validade_horas` | expira sozinho depois desse tempo |
| `descricao` | texto que o jogador ve ao resgatar |
| `codigo` | codigo personalizado; sem isso ele gera tipo `GUETO-A7K2-9XPM` |

Regras que o bot garante sozinho: **um resgate por jogador por codigo**, nunca passa do
limite de usos (nem em cliques simultaneos), respeita validade e exclusividade.
`/voucher listar` mostra a **exposicao em aberto** — quanto ainda pode ser resgatado.
`/voucher ver CODIGO` mostra quem ja resgatou. `/voucher desativar CODIGO` corta o codigo
sem tirar o saldo de quem ja pegou.

---

## Como o dinheiro anda

Tudo em **centavos inteiros** — nunca float.

| Momento | O que acontece |
|---|---|
| Entrou na fila **com** saldo | valor sai do saldo livre e vai para **reservado** |
| Entrou na fila **sem** saldo | entra assim mesmo; paga aquela partida no ticket |
| Saiu da fila | volta na hora para o saldo livre |
| Partida cancelada / anulada | volta para os dois |
| Partida finalizada | reservado dos dois é consumido, vencedor recebe `valor × 2 − taxa` |
| Pediu saque | valor vai para **reservado** até a staff aprovar |
| Saque recusado | volta para o saldo livre |

Exemplo com partida de R$ 100: pote de R$ 200, org fica com R$ 0,50, vencedor recebe **R$ 199,50**.

O bot **nunca faz pagamento automático para o jogador** — ele só credita saldo.
Quem quiser dinheiro na conta pede saque no painel de saldo, e a staff aprova.

## Quem entra sem saldo

Nao trava mais a entrada na fila. Quando a partida fecha, o ticket abre em
**AGUARDANDO PAGAMENTO** e quem esta devendo clica em `PAGAR MINHA PARTIDA`:
gera um PIX do valor exato daquela partida.

Esse dinheiro **nunca vira saldo na conta** — entra direto reservado naquela
partida. Se o jogador tiver depositado nesse meio tempo, o bot usa o saldo dele
e nem gera PIX.

Sem os dois pagamentos a partida nao comeca. Passou de `PAGAMENTO_PARTIDA_MINUTOS`
(padrao 15), a partida e cancelada sozinha e quem pagou recebe de volta.

## Pontos, elo e ranking

Cada partida finalizada move pontos: **+25** para quem venceu, **-12** para quem perdeu
(`PONTOS_VITORIA` / `PONTOS_DERROTA`). Ninguem fica com pontos negativos.

A escada tem **25 degraus** no estilo Valorant — Ferro, Bronze, Prata, Ouro, Platina,
Diamante, Ascendente e Imortal com 3 divisoes cada, mais Radiante no topo. Sao
100 pontos por divisao, entao Radiante fica em 2400.

```
/elo criar-cargos     cria os 25 cargos e vincula automaticamente
/elo escada           mostra a escada inteira
/elo ver              seu elo, barra de progresso e posicao
/elo dar @jogador 50  ajuste manual (admin)
/elo sincronizar      reaplica os cargos em todo mundo
```

> Depois de `/elo criar-cargos`, **arraste o cargo do bot para cima dos cargos de elo**.
> Sem isso o Discord recusa a aplicacao e o bot avisa no console.

Ranking publico com o **top 10**, atualizado a cada partida:

```
/ranking painel canal:#ranking
/config cargo cargo_top1 @Top1
/config cargo cargo_top2 @Top2
/config cargo cargo_top3 @Top3
```

Os cargos de podio sao exclusivos de quem esta na posicao: caiu, perde na hora.

## Loja de pontos

```
/loja painel canal:#loja
/loja add nome:Skin AK preco:500 estoque:3 descricao:Skin exclusiva
/loja itens
/loja pedidos
```

O jogador escolhe pelo menu do painel, os pontos saem na hora e abre um **ticket
privado** no canal de pedidos com a staff. Botoes `MARCAR COMO ENTREGUE` e
`CANCELAR E DEVOLVER` (esse devolve os pontos e repoe o estoque).

Cada jogador pode ter no maximo **3 pedidos pendentes** ao mesmo tempo.

## SOS de suporte e VAR

O botão **CHAMAR SUPORTE** fica disponível em qualquer fase ativa da partida. Ele
funciona como SOS: pausa a partida, avisa a staff no canal interno `canal_ss` e
mantém os valores reservados enquanto o problema é atendido.

Jogadores não possuem botão de **PEDIR TELA** e não podem chamar o VAR. No painel
interno do chamado, somente a staff vê **CHAMAR VAR**. Esse botão cria a análise e
encaminha o caso para `canal_analises`, onde os analistas usam `/bo fila` e
`/bo assumir` para controlar o atendimento.

## Interface

Todas as telas usam **Components V2** do Discord: container com barra colorida,
titulos, divisores, tabelas alinhadas e botoes agrupados. O kit fica em
`src/lib/ui.js` — mexa la para mudar o visual do sistema inteiro de uma vez.

## Fluxo do ticket

```
fila (2 jogadores, mesmo modo de gelo)
  → ticket privado criado no canal de tickets
  → DM para os dois com botao IR PARA O TICKET
  → quem entrou sem saldo: PAGAR MINHA PARTIDA (PIX so daquela partida)
  → COMBINAR REGRAS → CONFIRMAR ......... AGUARDANDO CRIAÇÃO DA SALA
                                          (aqui o CANCELAR some: so a staff anula)
                    → MUDAR REGRA → ACEITAR / RECUSAR (recusou = ticket fecha e estorna)
  → SALA CRIADA · INICIAR ............... PARTIDA EM ANDAMENTO
  → um jogador escolhe QUEM VENCEU ....... o adversário confirma = pago na hora
                         discordou = CHAMAR SUPORTE (staff decide)
  → resultado pago → PEDIR REVANCHE ...... novo valor, aceite e saldo reservado
                         sem saldo = canal privado de depósito automático
  → CHAMAR SUPORTE ....................... SOS disponível em qualquer fase ativa
                                           pausa o caso e notifica a staff
  → CHAMAR VAR ........................... somente no canal interno da staff
                                           envia o caso para o canal de análises
```

---

## Subir na VPS (Ubuntu)

```bash
sudo apt update && sudo apt install -y nodejs npm git build-essential
sudo npm install -g pm2
```

Mande a pasta para o servidor (sem `node_modules` e sem `.env`), então:

```bash
cd ~/ZE-BOT && npm install --omit=dev
```

Crie o `.env` no servidor com `PUBLIC_URL=https://seudominio.com`, e suba:

```bash
pm2 start src/index.js --name ze-bot && pm2 save && pm2 startup
```

Nginx na frente, para o webhook do PIX chegar com HTTPS:

```nginx
location /webhook/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
}
```

Certificado: `sudo certbot --nginx -d seudominio.com`.

**Backup do banco** (é onde está o saldo de todo mundo):

```bash
cp ~/ZE-BOT/data/ze.db ~/backup/ze-$(date +%F).db
```

Logs: `pm2 logs ze-bot` · Reiniciar: `pm2 restart ze-bot`
