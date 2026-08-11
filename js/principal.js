// Site estático de somente leitura — porta em JS puro dos gráficos de
// Histórico do painel React (mesmas cores, corte de 5% nos rótulos internos,
// altura de barra proporcional ao volume real, tooltip com valor + percentual).
// Sem dependências externas: só lê docs/data/historico.json via fetch.

const SVG_NS = 'http://www.w3.org/2000/svg';
const PERCENTUAL_MINIMO_ROTULO = 5;

const NOMES_MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

// Mesma lista de client/src/App.jsx (SERVICOS_HISTORICO) e server/src/config.js
// (regrasHistorico.servicosDisponiveis). O JSON estático tem cada um desses 12
// exportado individualmente — quando o usuário seleciona vários, o site soma
// no cliente (ver somarLinhas), sem precisar de combos pré-calculados.
const SERVICOS_HISTORICO = [
  'COMT', 'COBT', 'PSAA', 'PSER', 'PSAC', 'PSRP', 'PSAG', 'PSAI', 'PSAF', 'PSSG', 'PSIP', 'PSST',
];
const MERCADOS_HISTORICO = ['URBANO', 'RURAL'];

function formatarMesAno(mes) {
  const [ano, m] = mes.split('-');
  return `${NOMES_MES[Number(m) - 1]}/${ano.slice(2)}`;
}

function formatarNumero(v) {
  return Number(v).toLocaleString('pt-BR');
}

function formatarDataHora(iso) {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '—';
  const dataFmt = data.toLocaleDateString('pt-BR');
  const horaFmt = data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${dataFmt} ${horaFmt}`;
}

// Mesmas paletas/categorias de client/src/App.jsx.
const GRAFICOS = [
  {
    chave: 'aprovacao',
    campoCategoria: 'CATEGORIA',
    categorias: [
      { key: 'APROVADO', label: 'Aprovado', color: '#2f9e6e' },
      { key: 'REPROVADO', label: 'Reprovado', color: '#e0663f' },
      { key: 'CANCELADO', label: 'Cancelado', color: '#a02b2b' },
    ],
  },
  {
    chave: 'liberacao',
    campoCategoria: 'TIPO',
    categorias: [
      { key: 'COM_OBRAS', label: 'Com obras', color: '#2a78d6' },
      { key: 'SEM_OBRAS', label: 'Sem obras', color: '#3d9b3d' },
      { key: 'SERVICOS_REDE', label: 'Serviços na rede', color: '#8a5a0b' },
    ],
  },
  {
    chave: 'universalizacao',
    campoCategoria: 'CATEGORIA',
    
    categorias: [
      { key: 'UNIVERSALIZADA', label: 'Universalizada', color: '#2f9e6e' },{ key: 'NAO_UNIVERSALIZADA', label: 'Não universalizada', color: '#8a5a0b' },{ key: 'FORA_UNIVERSALIZACAO', label: 'Fora da universalização', color: '#2a78d6' },{ key: 'SEGURANCA', label: 'Obras de segurança', color: '#a02b2b' },{ key: 'OUTROS', label: 'Outros', color: '#898781' },
    ],
  },
];

function montarDados(linhas, categorias, campoCategoria) {
  const porMes = new Map();
  linhas.forEach((linha) => {
    const mes = linha.MES;
    if (!porMes.has(mes)) porMes.set(mes, {});
    porMes.get(mes)[linha[campoCategoria]] = linha.QTD;
  });
  return [...porMes.keys()].sort().map((mes) => {
    const bruto = porMes.get(mes);
    const total = categorias.reduce((soma, cat) => soma + (bruto[cat.key] || 0), 0);
    return { mes, bruto, total };
  });
}

// Soma QTD de várias listas de linhas {MES, [campoCategoria], QTD} agrupando
// por MES+categoria — usado pra somar os serviços selecionados (cada um
// exportado individualmente no JSON) antes de montar os dados do gráfico.
function somarLinhas(listasDeLinhas, campoCategoria) {
  const mapa = new Map();
  listasDeLinhas.forEach((linhas) => {
    linhas.forEach((linha) => {
      const chave = `${linha.MES}__${linha[campoCategoria]}`;
      const acumulada = mapa.get(chave);
      if (acumulada) {
        acumulada.QTD += linha.QTD;
      } else {
        mapa.set(chave, { MES: linha.MES, [campoCategoria]: linha[campoCategoria], QTD: linha.QTD });
      }
    });
  });
  return [...mapa.values()];
}

// Mesmo algoritmo de "nice numbers" usado por libs de gráfico para escolher um
// teto de eixo Y arredondado (evita eixo terminando em valores tipo 3.847).
function calcularEscalaY(maxValor, alvoTicks = 5) {
  if (maxValor <= 0) return { max: 10, passo: 2 };
  const passoBruto = maxValor / alvoTicks;
  const magnitude = 10 ** Math.floor(Math.log10(passoBruto));
  const residuo = passoBruto / magnitude;
  let passoNice;
  if (residuo >= 5) passoNice = 10 * magnitude;
  else if (residuo >= 2) passoNice = 5 * magnitude;
  else if (residuo >= 1) passoNice = 2 * magnitude;
  else passoNice = magnitude;
  const max = Math.ceil(maxValor / passoNice) * passoNice;
  return { max, passo: passoNice };
}

function svgEl(tag, atributos = {}, textoInterno) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(atributos).forEach(([chave, valor]) => el.setAttribute(chave, valor));
  if (textoInterno != null) el.textContent = textoInterno;
  return el;
}

const tooltipEl = document.getElementById('tooltip');

function mostrarTooltip(evento, mes, mesAtual, bruto, total, categorias) {
  const linhas = categorias
    .map((cat) => {
      const qtd = bruto[cat.key] || 0;
      const pct = total ? (qtd / total) * 100 : 0;
      return `<div class="tooltip-flutuante__row">
        <span class="tooltip-flutuante__swatch" style="background:${cat.color}"></span>
        ${cat.label}: ${qtd} (${pct.toFixed(1)}%)
      </div>`;
    })
    .join('');
  const aviso =
    mes === mesAtual
      ? '<div class="tooltip-flutuante__aviso">Mês em andamento — dados parciais</div>'
      : '';
  tooltipEl.innerHTML = `
    <strong>${formatarMesAno(mes)}</strong>
    ${aviso}
    ${linhas}
    <div class="tooltip-flutuante__total">Total: ${total}</div>
  `;
  tooltipEl.hidden = false;
  posicionarTooltip(evento);
}

function posicionarTooltip(evento) {
  const deslocamento = 14;
  let x = evento.clientX + deslocamento;
  let y = evento.clientY + deslocamento;
  const retTooltip = tooltipEl.getBoundingClientRect();
  if (x + retTooltip.width > window.innerWidth) x = evento.clientX - retTooltip.width - deslocamento;
  if (y + retTooltip.height > window.innerHeight) y = evento.clientY - retTooltip.height - deslocamento;
  tooltipEl.style.left = `${Math.max(4, x)}px`;
  tooltipEl.style.top = `${Math.max(4, y)}px`;
}

function esconderTooltip() {
  tooltipEl.hidden = true;
}

function desenharGrafico(container, rodapeEl, legendaMesEl, dados, categorias) {
  container.innerHTML = '';
  rodapeEl.innerHTML = '';
  legendaMesEl.textContent = '';

  if (!dados.length) {
    container.innerHTML = '<div class="grafico-vazio">Nenhum dado encontrado para o período.</div>';
    return;
  }

  const mesAtual = new Date().toISOString().slice(0, 7);
  const temMesAtual = dados.some((d) => d.mes === mesAtual);
  if (temMesAtual) {
    legendaMesEl.textContent = `* ${formatarMesAno(mesAtual)} ainda está em andamento — volume parcial, não indica queda real.`;
  }

  const LARGURA = 900;
  const ALTURA = 380;
  const MARGEM = { top: 36, right: 16, bottom: 52, left: 56 };
  const plotW = LARGURA - MARGEM.left - MARGEM.right;
  const plotH = ALTURA - MARGEM.top - MARGEM.bottom;
  const baseY = MARGEM.top + plotH;

  const maiorTotal = Math.max(...dados.map((d) => d.total), 0);
  const escala = calcularEscalaY(maiorTotal);

  const svg = svgEl('svg', { viewBox: `0 0 ${LARGURA} ${ALTURA}`, preserveAspectRatio: 'xMidYMid meet' });

  // Grade horizontal + eixo Y (quantidade)
  const numTicks = Math.round(escala.max / escala.passo);
  for (let i = 0; i <= numTicks; i += 1) {
    const valor = i * escala.passo;
    const y = baseY - (valor / escala.max) * plotH;
    svg.appendChild(
      svgEl('line', {
        x1: MARGEM.left,
        x2: LARGURA - MARGEM.right,
        y1: y,
        y2: y,
        stroke: 'var(--card-border)',
        'stroke-width': 1,
      }),
    );
    svg.appendChild(
      svgEl(
        'text',
        { x: MARGEM.left - 8, y: y + 4, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--text-muted)' },
        formatarNumero(valor),
      ),
    );
  }
  svg.appendChild(
    svgEl(
      'text',
      {
        x: 14,
        y: MARGEM.top + plotH / 2,
        'text-anchor': 'middle',
        'font-size': 12,
        fill: 'var(--text-muted)',
        transform: `rotate(-90 14 ${MARGEM.top + plotH / 2})`,
      },
      'Quantidade',
    ),
  );

  const barSlot = plotW / dados.length;
  const barWidth = Math.min(barSlot * 0.55, 42);

  dados.forEach((linha, indice) => {
    const xSlot = MARGEM.left + indice * barSlot;
    const xBarra = xSlot + (barSlot - barWidth) / 2;
    const atual = linha.mes === mesAtual;

    // Faixa de destaque no hover (mesmo cursor sutil do Recharts) + captura de mouse.
    const faixaHover = svgEl('rect', {
      x: xSlot,
      y: MARGEM.top,
      width: barSlot,
      height: plotH,
      fill: 'rgba(30, 90, 75, 0.06)',
      opacity: 0,
    });
    svg.appendChild(faixaHover);

    // Segmentos empilhados: categorias[0] na base, última categoria no topo.
    let yCursor = baseY;
    categorias.forEach((cat, catIndice) => {
      const valor = linha.bruto[cat.key] || 0;
      const alturaSeg = escala.max > 0 ? (valor / escala.max) * plotH : 0;
      const yTopo = yCursor - alturaSeg;
      const ultima = catIndice === categorias.length - 1;

      if (alturaSeg > 0) {
        const rect = svgEl('rect', {
          x: xBarra,
          y: yTopo,
          width: barWidth,
          height: alturaSeg,
          fill: cat.color,
          stroke: '#fff',
          'stroke-width': 2,
          'fill-opacity': atual ? 0.55 : 1,
          rx: ultima ? 4 : 0,
          ry: ultima ? 4 : 0,
          'pointer-events': 'none',
        });
        svg.appendChild(rect);

        const pct = linha.total > 0 ? (valor / linha.total) * 100 : 0;
        if (pct >= PERCENTUAL_MINIMO_ROTULO) {
          svg.appendChild(
            svgEl(
              'text',
              {
                x: xBarra + barWidth / 2,
                y: yTopo + alturaSeg / 2,
                'text-anchor': 'middle',
                'dominant-baseline': 'middle',
                'font-size': 10,
                'font-weight': 600,
                fill: '#fff',
                'pointer-events': 'none',
              },
              `${Math.round(pct)}%`,
            ),
          );
        }
      }
      yCursor = yTopo;
    });

    // Rótulo do total do mês, acima do topo da barra — cor neutra, fonte menor
    // que os rótulos internos de percentual.
    if (linha.total > 0) {
      svg.appendChild(
        svgEl(
          'text',
          {
            x: xBarra + barWidth / 2,
            y: yCursor - 8,
            'text-anchor': 'middle',
            'font-size': 9,
            'font-weight': 600,
            fill: 'var(--text-body)',
            'pointer-events': 'none',
          },
          formatarNumero(linha.total),
        ),
      );
    }

    // Rótulo do mês no eixo X (+ aviso "em andamento" no mês atual, igual ao HistoricoMesTick).
    const xCentro = xSlot + barSlot / 2;
    svg.appendChild(
      svgEl(
        'text',
        { x: xCentro, y: baseY + 16, 'text-anchor': 'middle', 'font-size': 12, fill: 'var(--text-muted)' },
        formatarMesAno(linha.mes),
      ),
    );
    if (atual) {
      svg.appendChild(
        svgEl(
          'text',
          {
            x: xCentro,
            y: baseY + 30,
            'text-anchor': 'middle',
            'font-size': 10,
            'font-style': 'italic',
            fill: 'var(--late-text)',
          },
          'em andamento',
        ),
      );
    }

    faixaHover.addEventListener('mouseenter', (evento) => {
      faixaHover.setAttribute('opacity', '1');
      mostrarTooltip(evento, linha.mes, mesAtual, linha.bruto, linha.total, categorias);
    });
    faixaHover.addEventListener('mousemove', posicionarTooltip);
    faixaHover.addEventListener('mouseleave', () => {
      faixaHover.setAttribute('opacity', '0');
      esconderTooltip();
    });
  });

  // Eixo X (linha de base)
  svg.appendChild(
    svgEl('line', {
      x1: MARGEM.left,
      x2: LARGURA - MARGEM.right,
      y1: baseY,
      y2: baseY,
      stroke: 'var(--card-border)',
      'stroke-width': 1,
    }),
  );

  container.appendChild(svg);

  categorias.forEach((cat) => {
    const item = document.createElement('div');
    item.className = 'grafico-rodape__item';
    item.innerHTML = `<span class="grafico-rodape__swatch" style="background:${cat.color}"></span>${cat.label}`;
    rodapeEl.appendChild(item);
  });
}

// servicosSelecionados: array de 1-12 códigos (cada um já vem individual no
// JSON). mercadosSelecionados: array de 1-2 valores ('URBANO'/'RURAL') — os
// dois juntos usam o bucket 'TODOS' já pré-calculado (mesma semântica de
// "sem filtro de mercado" do backend), em vez de somar Urbano+Rural no
// cliente, pra ficar idêntico ao que a API retornaria sem o filtro.
function aplicarFiltros(dadosCompletos, servicosSelecionados, mercadosSelecionados) {
  const bucketsMercado =
    mercadosSelecionados.length === MERCADOS_HISTORICO.length ? ['TODOS'] : mercadosSelecionados;

  GRAFICOS.forEach((grafico) => {
    const wrapper = document.querySelector(`.grafico-wrapper[data-grafico="${grafico.chave}"]`);
    const corpo = wrapper.querySelector('.grafico-corpo');
    const rodape = wrapper.querySelector('.grafico-rodape');
    const legendaMes = wrapper.querySelector('.grafico-legenda-mes');

    const listas = [];
    servicosSelecionados.forEach((servico) => {
      bucketsMercado.forEach((mercado) => {
        const combinacao = dadosCompletos.dados?.[servico]?.[mercado];
        if (combinacao) listas.push(combinacao[grafico.chave] || []);
      });
    });

    const linhas = somarLinhas(listas, grafico.campoCategoria);
    const dados = montarDados(linhas, grafico.categorias, grafico.campoCategoria);
    desenharGrafico(corpo, rodape, legendaMes, dados, grafico.categorias);
  });
}

// Mesmo padrão visual/comportamental do ChipMultiFilter do app React: clique
// isola a opção (só ela fica marcada), Ctrl/Cmd+clique combina (soma/remove
// do conjunto), clique em "Todos" marca todas.
function criarChipMultiFiltro(container, { opcoes, selecionadas, aoMudar }) {
  container.innerHTML = '';
  const lista = document.createElement('div');
  lista.className = 'chip-list';

  const todasSelecionadas = selecionadas.length === opcoes.length;
  const botaoTodos = document.createElement('button');
  botaoTodos.type = 'button';
  botaoTodos.className = `chip chip--todos ${todasSelecionadas ? 'chip--ativo' : ''}`;
  botaoTodos.textContent = 'Todos';
  botaoTodos.addEventListener('click', () => aoMudar([...opcoes]));
  lista.appendChild(botaoTodos);

  opcoes.forEach((valor) => {
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = `chip ${selecionadas.includes(valor) ? 'chip--ativo' : ''}`;
    botao.textContent = valor;
    botao.addEventListener('click', (evento) => {
      const combinar = evento.ctrlKey || evento.metaKey;
      if (combinar) {
        aoMudar(
          selecionadas.includes(valor) ? selecionadas.filter((v) => v !== valor) : [...selecionadas, valor],
        );
      } else {
        aoMudar([valor]);
      }
    });
    lista.appendChild(botao);
  });

  container.appendChild(lista);
}

async function iniciar() {
  const elAtualizado = document.getElementById('atualizado-em');
  const elErro = document.getElementById('erro-carga');
  const elChipsServico = document.getElementById('chips-servico');
  const elChipsMercado = document.getElementById('chips-mercado');

  try {
    const resp = await fetch('./data/historico.json', { cache: 'no-store' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const dadosCompletos = await resp.json();

    elAtualizado.textContent = `Dados atualizados em: ${formatarDataHora(dadosCompletos.geradoEm)}`;

    // Serviço começa só com COMT (mesmo default do app React); mercado começa
    // com os dois marcados (= "Todos").
    let servicosSelecionados = ['COMT'];
    let mercadosSelecionados = [...MERCADOS_HISTORICO];

    function renderizarFiltros() {
      criarChipMultiFiltro(elChipsServico, {
        opcoes: SERVICOS_HISTORICO,
        selecionadas: servicosSelecionados,
        aoMudar: (novaSelecao) => {
          servicosSelecionados = novaSelecao;
          renderizarFiltros();
          aplicarFiltros(dadosCompletos, servicosSelecionados, mercadosSelecionados);
        },
      });
      criarChipMultiFiltro(elChipsMercado, {
        opcoes: MERCADOS_HISTORICO,
        selecionadas: mercadosSelecionados,
        aoMudar: (novaSelecao) => {
          mercadosSelecionados = novaSelecao;
          renderizarFiltros();
          aplicarFiltros(dadosCompletos, servicosSelecionados, mercadosSelecionados);
        },
      });
    }

    renderizarFiltros();
    aplicarFiltros(dadosCompletos, servicosSelecionados, mercadosSelecionados);
  } catch (err) {
    elAtualizado.textContent = 'Falha ao carregar os dados.';
    elErro.hidden = false;
    elErro.textContent = `Não foi possível carregar docs/data/historico.json (${err.message}). Rode o script de exportação e publique o arquivo gerado.`;
  }
}

iniciar();
