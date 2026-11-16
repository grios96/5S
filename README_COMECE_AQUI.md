# 5S SPEEDRUN — jogo multiplayer com ranking ao vivo

**Pronto para publicar, mas ainda não publicado.** O código já contém servidor, interface do apresentador, interface dos participantes, QR code automático, três rodadas sincronizadas e ranking. O endereço público só passa a existir quando você publicar o projeto ou executar o servidor na rede local.

## Como funciona na fábrica

1. O apresentador abre o site e clica **Create live room**.
2. Aparece um painel de controle com um **QR code novo para aquela sala**, a quantidade de participantes e um ranking no telão.
3. Os funcionários escaneiam o QR com a câmera, digitam seu nome e entram sem criar conta.
4. Quando todos estiverem prontos, clique **Start round 1**. Todos verão uma contagem regressiva de 4 segundos e terão 30 segundos para tocar nos números de **1 a 30, em ordem**.
5. Terminados os 30 segundos, o telão apresenta os resultados automaticamente. Clique **Start round 2** e depois **Start round 3**. O painel mostra os três primeiros, pontuação acumulada e mudanças de posição.
6. Clique **Reset all scores** somente para iniciar outra turma. Os participantes continuam conectados, mas os pontos são zerados.

### As 3 rodadas

| Rodada | Condição | Tabuleiro |
|---|---|---|
| 1: BEFORE 5S | Bagunça + objetos desnecessários | Números 1–49 misturados; tarefa = clicar 1–30 |
| 2: SORT | Remover o desnecessário | Apenas números 1–30, ainda misturados |
| 3: SET IN ORDER | Lugar definido para cada item | Apenas 1–30, ordenados visualmente |

Pontuação: **+10 XP por número correto**, **−2 XP por clique errado**, e bônus de **3 XP por segundo inteiro restante** se completar os 30 antes do tempo. O placar é calculado pelo servidor, não pelo celular.

**Nota didática:** as rodadas ilustram Sort e Set in Order. Reserve os slides finais para Shine, Standardize e Sustain; o jogo não é uma medição científica de produtividade.

## Opção A — publicar no Render (recomendada se os funcionários usam redes diferentes)

**Requer conta GitHub e conta Render (gratuitas para testes).** O servidor usa WebSockets, não basta uma hospedagem de páginas estáticas.

1. Descompacte o ZIP deste projeto.
2. Crie um **repositório GitHub** e envie os **arquivos da pasta**, mantendo `server.py`, `requirements.txt`, `render.yaml` e a pasta `public/` na raiz. Você pode usar o botão **Add file > Upload files** do GitHub ou Git.
3. Acesse **https://dashboard.render.com/** → **New** → **Web Service**, conecte o repositório, selecione Python e plano **Free**, se disponível.
4. Defina **Build Command** = `pip install -r requirements.txt` e **Start Command** = `uvicorn server:app --host 0.0.0.0 --port $PORT`.
5. Publique. Quando aparecer um endereço `https://...onrender.com`, abra esse endereço no computador da apresentação e clique **Create live room**.
6. O QR code do painel já conterá a URL correta; qualquer celular com Internet poderá participar. Faça uma rodada de teste com dois celulares.

> Alternativa: em Render, **New → Blueprint** pode reconhecer o arquivo `render.yaml` e preencher os comandos automaticamente.

**Cuidados com o plano gratuito:** uma instância inativa pode hibernar após 15 minutos e levar algum tempo para voltar. Não crie a sala horas antes: abra o jogo perto da apresentação e mantenha a tela de host conectada. O estado da sala e os pontos ficam **na memória do servidor**; reinicialização, novo deploy ou suspensão podem apagar a partida. Acesse o site e faça testes **antes** de o pessoal chegar. Considere um plano pago ou outra infraestrutura caso precisão e disponibilidade sejam críticas. 

## Opção B — rodar em uma rede Wi-Fi local (sem publicar no Render)

Necessário: computador com **Python 3.10+**, e acesso ao mesmo Wi-Fi, sem isolamento entre dispositivos. Não depende da Internet **depois** que as bibliotecas Python estiverem instaladas; funciona via rede local.

**Windows:** dê dois cliques em `iniciar_no_windows.bat` ou abra o terminal na pasta:

```powershell
py -m pip install -r requirements.txt
py -m uvicorn server:app --host 0.0.0.0 --port 8000
```

**macOS/Linux:** execute `./iniciar_no_mac_linux.sh` (ou use `python3` com os comandos correspondentes).

Depois, obtenha o IP local do computador (`ipconfig` no Windows; procure IPv4, por exemplo `192.168.1.50`). **Abra no computador a URL `http://192.168.1.50:8000`, e NÃO `http://localhost:8000`**. O QR que aparece será acessível aos telefones da mesma rede. Se já abriu com `localhost`, no painel existe **Joining from a different Wi-Fi / LAN?** para trocar o endereço-base do QR.

Se os telefones não conseguirem abrir: teste com o navegador de um celular, confira se todos estão na mesma rede, se o Wi-Fi permite acesso entre aparelhos e se o firewall do computador permite a porta TCP 8000. Um Wi-Fi corporativo com isolamento de convidados pode bloquear acesso LAN. Nesse caso, use a opção Render.

## Checklist para amanhã

- [ ] Publicar ou iniciar o servidor **antes da palestra**.
- [ ] Abrir a página no notebook, clicar **Create live room** e projetar o painel.
- [ ] Escanear QR com **dois celulares reais** e confirmar que os nomes aparecem no painel.
- [ ] Clicar **Start round 1** e verificar que ambos começam sincronizados.
- [ ] Conferir se os pontos sobem e se o ranking aparece ao final dos 30 segundos.
- [ ] Testar a apresentação PowerPoint atualizada. **O slide 8 NÃO contém um QR fixo**; o QR é exibido pelo painel do jogo.
- [ ] Se fizer um teste completo antes, clicar **Reset all scores** e confirmar que os participantes ficam zerados.
- [ ] Deixar os PDFs de backup impressos se a internet ou o Wi-Fi não for confiável.

## Arquivos e manutenção

- `server.py` — backend em FastAPI e WebSockets (pontuação validada no servidor).
- `public/index.html` — criar sala.
- `public/host.html` + `host.js` — painel do projetor com ranking e QR.
- `public/play.html` + `play.js` — jogo no celular.
- `public/styles.css` — visual original com ranking, pódio e progresso.
- `render.yaml` — configuração opcional de deploy.
- `test/test_game.py` — testes automatizados; rode `python -m unittest discover -s test -v`.

**Não são coletados e-mails, senhas, localização nem dados pessoais além do nome digitado para o placar.** Os nomes e os resultados ficam somente na memória do servidor durante a sessão.
