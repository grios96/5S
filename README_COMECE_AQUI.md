# 5S Speedrun — 6 rounds + QR code + ranking ao vivo

Versão baseada no exercício [The 5S Numbers Game (Wine Australia)](https://www.wineaustralia.com/getmedia/e2d39043-bde1-4ff3-86c6-06ac8b84a74c/2016_Lean-production-5s-numbers-game.pdf), com duas etapas adicionais de **Visual Management — Find the Missing Number**.

## Roteiro das seis etapas

| Etapa | Desafio | Tempo | Resultado |
|---|---|---:|---|
| 1 — Before 5S | Marcar 1–49 em sequência num ambiente com 90 números e fontes, cores, tamanhos e ângulos diferentes | 20s | Números corretos |
| 2 — Sort | Remover números 50–90, mantendo os números 1–49 nos mesmos lugares | 20s | Números corretos |
| 3 — Straighten + Sweep | Criar 9 áreas grandes (grade 3×3), com números espalhados dentro das áreas e cada número seguinte numa área vizinha | 20s | Números corretos |
| 4 — Standardize | Tabuleiro organizado em sequência | 20s | Números corretos |
| 5 — Missing Number · Before 5S | Um número de 1–49 foi removido do tabuleiro original, ainda misturado com 50–90. Identificar digitando qual falta | Até 120s | Tempo de identificação |
| 6 — Missing Number · After 5S | Outro número (diferente do anterior) foi removido de uma grade padronizada. Identificá-lo | Até 120s | Tempo de identificação |

**Regras das quatro primeiras etapas:** 1 ponto por número correto marcado em sequência. Não há penalidade por erro nem bônus por velocidade. O placar coletivo é a **menor pontuação individual da etapa**, como no exemplo de papel. O acumulado individual dos quatro turnos permanece no ranking.

**Regras das etapas 5 e 6:** cada participante digita seu palpite de 1 a 49. Os dois números faltantes são diferentes, evitando que a etapa final vire um exercício de memória. O relógio conta **para cima** e indica quantos turnos de 20 segundos se passaram. Quando todos acertam, a rodada encerra automaticamente; o apresentador também pode encerrar manualmente, e existe um limite de dois minutos. Tentativas incorretas têm um intervalo de aproximadamente 2,5 segundos, para evitar chutes repetidos. O tempo de acerto é registrado por participante; quem não acertar aparece como **Not found**. O ranking das etapas extras usa o menor tempo, e **não altera** a pontuação das quatro primeiras etapas. O telão apresenta a quantidade de pessoas que acertou e a mediana do tempo **somente entre os que acertaram**, para comparar antes/depois. Os números faltantes só são revelados no resultado final.

Os tabuleiros simulam um ambiente de trabalho; celulares têm telas e tamanhos diferentes, portanto a comparação é **didática, não uma medida científica** de produtividade.

## Instalar no Render (se o projeto já está publicado)

1. Descompacte este ZIP.
2. Substitua no repositório GitHub o arquivo `server.py` e **todos os arquivos da pasta `public/`**, preservando a estrutura de diretórios. É importante enviar `public/` inteira, não apenas `server.py`.
3. Faça o commit no GitHub.
4. No Render, abra o Web Service existente e selecione **Manual Deploy → Deploy latest commit**, caso o deploy não inicie automaticamente.
5. Abra o endereço `https://...onrender.com`, crie **uma nova sala** e teste com dois celulares. Salas anteriores não sobrevivem a um novo deploy, pois o estado fica na memória.
6. Se o navegador continuar mostrando uma tela antiga, atualize a página com recarregamento forçado (Ctrl+Shift+R) ou use uma aba anônima.

### Configuração do serviço (se precisar conferir)

- Service Type: `Web Service`, linguagem Python
- Root Directory: em branco se `server.py` está na raiz
- Build Command: `pip install -r requirements.txt`
- Start Command: `uvicorn server:app --host 0.0.0.0 --port $PORT`
- Python: 3.13.5 via `.python-version`, com `render.yaml` como configuração opcional

O jogo usa FastAPI e WebSockets, portanto não funciona como um *Static Site*.

## Como apresentar

1. No notebook ligado ao projetor, entre no site e selecione **Create live room**. O QR aparece automaticamente.
2. Cada funcionário escaneia o QR e digita um nome no celular. Não precisa instalar nada.
3. Clique em **Start round 1**; todas as pessoas começam simultaneamente após a contagem regressiva. Ao término, discuta o resultado coletivo e clique no botão para a próxima rodada.
4. Depois da quarta rodada, explique *Visual Management* e inicie **Missing Number — Before 5S**. Os jogadores deverão observar o tabuleiro e escrever qual número de 1–49 não está presente.
5. Faça o mesmo no **Missing Number — After 5S** com a grade organizada; depois compare os tempos no ranking e as medianas.
6. Use **Reset all scores** para outra turma; os mesmos jogadores podem permanecer conectados. Para uma nova sessão completamente isolada, crie outra sala pelo início.

**Atenção ao Render gratuito:** o serviço pode entrar em suspensão por inatividade; reiniciar ou fazer deploy também apaga as salas ativas. Abra o jogo pouco antes da palestra e teste o QR no Wi-Fi da fábrica.

## Execução local e testes

No Windows: execute `iniciar_no_windows.bat`. Em Mac/Linux, use `iniciar_no_mac_linux.sh`; ou execute manualmente:

```bash
python -m pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8000
```

Para usar pela rede Wi-Fi local, abra `http://<IP-do-notebook>:8000` (não `localhost`), com os celulares na mesma rede e sem isolamento de clientes. Pode ser necessário liberar a porta TCP 8000 no firewall.

Para executar os testes automatizados:

```bash
python -m unittest discover -s test -v
```

O servidor não requer contas dos participantes. Nomes e pontuações permanecem na memória durante a sessão, sem persistência externa.

## Ajuste Round 3 — áreas vizinhas (16/11/2026)

O round **3 — Straighten + Sweep** mostra nove **áreas grandes** em uma grade 3×3, separadas por linhas azuis. Os números 1–49 ficam espalhados dentro dessas áreas, com fontes, ângulos e tamanhos variados, como no jogo em papel. Cada número `N+1` fica sempre numa **área grande vizinha por um dos lados** da área onde está `N`, mas não necessariamente próximo dele dentro da área. O jogo gera uma nova distribuição por partida, idêntica para todos os participantes da sala.

Os rounds 5 e 6 continuam usando exatamente **o mesmo número faltante**.
