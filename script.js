// =====================================================================
const SUPABASE_URL = 'https://wxnqafncrhfjkbbcfwth.supabase.co';
const SUPABASE_KEY = 'sb_publishable_sXhmqia1QKL4nr5NaSLqEg_xhEIv9vH';

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
);
// =====================================================================
// Metas diárias por linha (peças/dia)
const lineTargets = {
  'Linha 1': 1700,
  'Linha 2': 900,
  'Linha 3': 700,
  'Linha 4': 270,
  'Linha 5': 900,
};

// Turnos por linha
const lineShifts = {
  'Linha 1': '1º Turno 05:30–15:45 · 2º Turno 15:45–22:30',
  'Linha 2': 'Turno único 07:00–17:00',
  'Linha 3': 'Turno único 07:00–17:00',
  'Linha 4': 'Turno único 07:00–17:00',
  'Linha 5': 'Turno único 07:00–17:00',
};

// opsHoje = quantas OPs rodaram nessa máquina hoje · metaHoje = soma da quantidade
// de TODAS essas OPs · pecasHoje = soma do que foi produzido no dia (todas as OPs).
// Eficiência do operador = pecasHoje ÷ metaHoje. Mock por enquanto, vem do EGA
// quando a leitura do banco estiver pronta.
let machines = [];
let selectedMachineId = null;

async function carregarMaquinas() {

    const { data, error } = await supabaseClient
        .from('machines')
        .select('*')
        .order('id');

    if (error) {
        console.error('Erro ao buscar máquinas do Supabase:', error);
        const pill = document.getElementById('status-pill');
        if(pill) pill.innerHTML = `<span class="dot-live"></span> ERRO AO CONECTAR NO SUPABASE — VEJA O CONSOLE`;
        return;
    }

    machines = data.map(m => {
        // "since" chega do Supabase como data/hora completa (ISO) — mostramos
        // só o horário, formatado, em vez do texto cru.
        let sinceFormatado = '';
        if(m.since){
            const d = new Date(m.since);
            sinceFormatado = !isNaN(d) ? d.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'}) : m.since;
        }

        return {
            id: m.id,
            line: m.line,
            status: m.status,
            op: m.op || null,
            target: Number(m.target) || 0,
            produced: Number(m.produced) || 0,
            operator: m.operator || 'Sem operador',
            reason: m.reason || null,
            since: sinceFormatado,

            // Temporariamente mantemos esses campos
            // até buscarmos os dados históricos reais.
            opsHoje: Number(m.opsHoje) || 0,
            metaHoje: Number(m.metaHoje) || 0,
            pecasHoje: Number(m.pecasHoje) || 0
        };
    });

    // Se a máquina selecionada não existir mais
    if (!machines.some(m => m.id === selectedMachineId)) {
        selectedMachineId = machines.length > 0
            ? machines[0].id
            : null;
    }

    const pill = document.getElementById('status-pill');
    if(pill){
        pill.innerHTML = machines.length > 0
            ? `<span class="dot-live"></span> ${machines.length} MÁQUINA(S) CONECTADA(S) AO EGA VIA SUPABASE`
            : `<span class="dot-live"></span> CONECTADO AO SUPABASE — NENHUMA MÁQUINA NA TABELA AINDA`;
    }

    renderAll();
    checkAlarmState();
}

const statusLabel = { run:'Rodando', stop:'Parada', setup:'Setup' };
const statusTagClass = { run:'tag-run', stop:'tag-stop', setup:'tag-setup' };
const statusBadgeClass = { run:'badge-run', stop:'badge-stop', setup:'badge-setup' };

// Motivos de parada padrão (a princípio genérico — trocar pela lista real do EGA quando integrar)
const commonReasons = [
  'Falta de matéria-prima',
  'Falha mecânica',
  'Troca de ferramenta / Setup',
  'Aguardando operador',
  'Manutenção preventiva',
  'Qualidade / Refugo',
  'Outro motivo',
];

function pct(m){ return Math.min(100, Math.round((m.produced / m.target) * 100)); }

// Máquina parada e sem motivo apontado ainda pelo operador
// Motivos que o EGA usa como "placeholder" quando ainda não sabe o motivo
// real da parada — só nesses casos o alarme sonoro + tela piscando dispara.
// Qualquer outro motivo já é uma parada classificada: mostra a tela vermelha
// (fixa, sem piscar) mas sem tocar som.
const ALARM_REASONS = ['PARADA A DEFINIR', 'MOT.INDETERMINADO'];
function needsAlarm(m){ return m.status === 'stop' && (!m.reason || ALARM_REASONS.includes(m.reason)); }
function isStopped(m){ return m.status === 'stop'; }

// ---------------- ALARME SONORO ----------------
// Toca um bipe curto via Web Audio API (não depende de nenhum arquivo de áudio).
// O AudioContext só pode ser criado/retomado após uma interação do usuário
// (clique na aba, por exemplo), respeitando a política de autoplay dos navegadores.
let audioCtx = null;
let alarmInterval = null;

function ensureAudioCtx(){
  if(!audioCtx){
    const AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return null;
    audioCtx = new AC();
  }
  if(audioCtx.state === 'suspended'){ audioCtx.resume(); }
  return audioCtx;
}

function beep(){
  const ctx = ensureAudioCtx();
  if(!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.4);
  // segundo bipe, mais curto, pra soar como alarme e não como notificação comum
  setTimeout(()=>{
    if(!audioCtx) return;
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'square';
    osc2.frequency.value = 660;
    gain2.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain2.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
    gain2.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    osc2.connect(gain2).connect(ctx.destination);
    osc2.start();
    osc2.stop(ctx.currentTime + 0.3);
  }, 220);
}

function startAlarm(){
  if(alarmInterval) return;
  beep();
  alarmInterval = setInterval(beep, 4000);
}

function stopAlarm(){
  if(alarmInterval){ clearInterval(alarmInterval); alarmInterval = null; }
}

// Só toca o alarme enquanto a tela "Máquinas" está aberta e a máquina
// selecionada está parada sem motivo registrado.
function checkAlarmState(){
  const activeScreen = document.querySelector('.screen.active');
  const m = machines.find(x=>x.id===selectedMachineId);
  if(activeScreen && activeScreen.id === 'maquinas' && m && needsAlarm(m)){
    startAlarm();
  } else {
    stopAlarm();
  }
}

// ---------------- DASHBOARD ----------------
function renderDashboardGrid(){
  const grid = document.getElementById('dash-machine-grid');
  grid.innerHTML = machines.map(m => `
    <div class="m-card ${needsAlarm(m) ? 'unreported' : isStopped(m) ? 'stopped-plain-card' : ''}" onclick="openMachine('${m.id}')">
      <div class="m-top">
        <div>
          <div class="m-name">${m.id}</div>
          <div class="m-line">${m.line}</div>
        </div>
        <div class="led ${m.status}"></div>
      </div>
      <span class="m-status-tag ${statusTagClass[m.status]}">${statusLabel[m.status]}</span>
      <div class="m-op">${m.op || '—'}</div>
      ${m.status !== 'setup' ? `
        <div class="progress-bar"><div class="progress-fill" style="width:${pct(m)}%; background:${m.status==='stop' ? 'var(--stop)' : 'var(--info)'}"></div></div>
        <div class="m-qty">${m.produced.toLocaleString('pt-BR')} / ${m.target.toLocaleString('pt-BR')} pçs</div>
      ` : `<div class="m-qty">Troca de ferramenta</div>`}
      ${needsAlarm(m) ? `<div class="m-reason">🚨 ${m.reason || 'Motivo indefinido'}</div>` : m.status === 'stop' ? `<div class="m-reason">⛔ ${m.reason}</div>` : ''}
    </div>
  `).join('');
}

function updateDashboardKPIs(){
  const rodando = machines.filter(m=>m.status==='run').length;
  const paradas = machines.filter(m=>m.status==='stop').length;
  const setup = machines.filter(m=>m.status==='setup').length;
  document.getElementById('kpi-rodando').innerHTML = `${rodando} <span class="kpi-unit">/ ${machines.length}</span>`;
  document.getElementById('kpi-paradas').innerHTML = `${paradas} <span class="kpi-unit">/ ${machines.length}</span>`;
  const lines = lineProduction();
  const totalProd = Object.values(lines).reduce((a,v)=>a+v,0);
  document.getElementById('kpi-prod').textContent = totalProd.toLocaleString('pt-BR');
  document.getElementById('kpi-oee').textContent = Math.min(100, Math.round(totalProd/totalDailyTarget()*100));
  document.getElementById('dash-time').textContent = new Date().toLocaleTimeString('pt-BR');
}

// Meta do dia da fábrica = soma das metas de cada linha (uma vez por linha, não por máquina)
function totalDailyTarget(){
  return Object.values(lineTargets).reduce((a,v)=>a+v,0);
}

// ---------------- MAQUINAS (OPERADOR) ----------------
let machineViewMode = 'list'; // 'list' = mostra só a lista pra selecionar | 'detail' = mostra só a máquina escolhida

function renderMachinePicker(){
  const el = document.getElementById('machine-picker');
  el.innerHTML = machines.map(m => `
    <div class="m-card ${needsAlarm(m) ? 'unreported' : isStopped(m) ? 'stopped-plain-card' : ''}" onclick="selectMachineOperator('${m.id}')">
      <div class="m-top">
        <div>
          <div class="m-name">${m.id}</div>
          <div class="m-line">${m.line}</div>
        </div>
        <div class="led ${m.status}"></div>
      </div>
      <span class="m-status-tag ${statusTagClass[m.status]}">${needsAlarm(m) ? '🚨 ' + (m.reason || 'Motivo indefinido') : statusLabel[m.status]}</span>
    </div>
  `).join('');
}

function selectMachineOperator(id){
  selectedMachineId = id;
  machineViewMode = 'detail';
  document.getElementById('operator-layout').className = 'operator-layout mode-detail';
  renderOpDetail();
}

function backToMachineList(){
  machineViewMode = 'list';
  document.getElementById('operator-layout').className = 'operator-layout mode-list';
  renderMachinePicker();
}

function renderOpDetail(){
  const m = machines.find(x=>x.id===selectedMachineId);
  const el = document.getElementById('op-detail');
  if(!m){ el.innerHTML=''; return; }

  el.classList.toggle('unreported-alert', needsAlarm(m));
  el.classList.toggle('stopped-plain', isStopped(m) && !needsAlarm(m));

  el.innerHTML = `
    <button class="back-to-list-btn" onclick="backToMachineList()">← Voltar para lista de máquinas</button>
    ${needsAlarm(m) ? `
      <div class="unreported-banner">
        <div class="ico">🚨</div>
        <div class="txt">
          <b>MOTIVO DA PARADA AINDA NÃO DEFINIDO NO EGA</b>
          <span>${m.reason ? `Status atual: "${m.reason}"` : 'Nenhum motivo registrado ainda'} — verifique a máquina</span>
        </div>
      </div>
    ` : ''}

    <div class="op-header">
      <div>
        <h3>${m.id}</h3>
        <div class="m-line">${m.line} · Operador: ${m.operator}</div>
      </div>
      <div class="op-status-badge ${statusBadgeClass[m.status]}">${statusLabel[m.status]}</div>
    </div>

    <div class="op-info-grid">
      <div class="info-box">
        <div class="lbl">Ordem de Produção</div>
        <div class="val">${m.op || '—'}</div>
      </div>
      <div class="info-box">
        <div class="lbl">Quantidade da OP</div>
        <div class="val">${m.target.toLocaleString('pt-BR')} <small>pçs</small></div>
      </div>
      <div class="info-box">
        <div class="lbl">Produzido até agora</div>
        <div class="val">${m.produced.toLocaleString('pt-BR')} <small>pçs</small></div>
      </div>
      <div class="info-box">
        <div class="lbl">Turno</div>
        <div class="val" style="font-size:15px; line-height:1.3;">${lineShifts[m.line]}</div>
      </div>
    </div>

    <div class="prod-progress-wrap">
      <div class="prod-progress-head"><span>Progresso da OP</span><span>${pct(m)}%</span></div>
      <div class="prod-progress-track">
        <div class="prod-progress-fill" style="width:${pct(m)}%">${pct(m)}%</div>
      </div>
    </div>

    ${needsAlarm(m) ? `
      <div class="stop-reason-box">
        <div class="ico">⛔</div>
        <div style="flex:1;">
          <div class="lbl">Qual o motivo da parada?</div>
          <div class="reason-picker">
            ${commonReasons.map(r => `<button class="reason-chip" onclick="setReason('${m.id}', '${r}')">${r}</button>`).join('')}
          </div>
        </div>
      </div>
    ` : m.status === 'stop' ? `
      <div class="stop-reason-box">
        <div class="ico">⛔</div>
        <div>
          <div class="lbl">Máquina parada</div>
          <div class="reason">${m.reason}</div>
          <div class="since">Parada desde ${m.since}</div>
        </div>
      </div>
    ` : m.status === 'setup' ? `
      <div class="stop-reason-box" style="background: var(--setup-dim); border-color: rgba(245,185,61,0.4);">
        <div class="ico">🔧</div>
        <div>
          <div class="lbl" style="color:#FFE1A8;">Em preparação</div>
          <div class="reason">Troca de ferramenta / setup de OP</div>
        </div>
      </div>
    ` : `
      <div class="stop-reason-box" style="background: var(--run-dim); border-color: rgba(53,208,127,0.4);">
        <div class="ico">✅</div>
        <div>
          <div class="lbl" style="color:#A9F0C6;">Máquina em produção normal</div>
          <div class="reason">Sem apontamento de parada</div>
        </div>
      </div>
    `}
  `;

  checkAlarmState();
}

function setReason(machineId, reason){
  const m = machines.find(x=>x.id===machineId);
  if(!m) return;
  m.reason = reason;
  m.since = new Date().toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
  renderAll();
}

function openMachine(id){
  selectedMachineId = id;
  machineViewMode = 'detail';
  document.getElementById('operator-layout').className = 'operator-layout mode-detail';
  renderOpDetail();
  document.querySelector('.tab-btn[data-screen="maquinas"]').click();
}

// ---------------- SUPERVISOR ----------------
function lineProduction(){
  // Plissadeira e Dosadora são etapas sequenciais da MESMA linha.
  // O processo começa na Plissadeira e termina na Dosadora — a peça só é
  // considerada pronta na etapa final (Dosadora), que também é a única
  // etapa na Linha 5.
  const lines = {};
  machines.forEach(m=>{
    if(!(m.line in lines) || m.id.startsWith('Dosadora')){
      lines[m.line] = m.produced;
    }
  });
  return lines;
}

function renderLineBars(){
  const lines = lineProduction();
  const el = document.getElementById('linha-bars');
  el.innerHTML = Object.keys(lineTargets).map(name=>{
    const val = lines[name] || 0;
    const meta = lineTargets[name];
    const perc = Math.min(100, Math.round((val/meta)*100));
    return `
    <div class="bar-row">
      <div class="bar-label">${name}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${perc}%"></div></div>
      <div class="bar-value">${val.toLocaleString('pt-BR')} / ${meta.toLocaleString('pt-BR')}</div>
    </div>
  `;}).join('');
}

// OEE simplificado por linha = produção realizada / meta diária (proxy até termos disponibilidade,
// desempenho e qualidade reais vindos do EGA)
// Pareto de OEE por Linha: ordenado da PIOR pra melhor, pra destacar onde
// focar primeiro — mesmo estilo visual usado nas paradas.
function renderOeeByLine(){
  const lines = lineProduction();
  const el = document.getElementById('oee-bars');

  const dados = Object.keys(lineTargets).map(name=>{
    const val = lines[name] || 0;
    const meta = lineTargets[name];
    const perc = Math.min(100, Math.round((val/meta)*100));
    return { name, perc };
  }).sort((a,b)=>b.perc-a.perc); // melhor primeiro (padrão de gráfico de Pareto)

  const W = 640, H = 260, padL = 44, padR = 44, padT = 26, padB = 40;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const n = dados.length;
  const slot = chartW / n;
  const barW = slot * 0.5;

  const bars = dados.map((d,i)=>{
    const x = padL + i*slot + (slot-barW)/2;
    const barH = (d.perc/100)*chartH;
    const y = padT + chartH - barH;
    const color = d.perc>=80 ? '#35D07F' : d.perc>=60 ? '#F5B93D' : '#FF5A5F';
    return `
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" rx="4" fill="${color}"/>
      <text x="${(x+barW/2).toFixed(1)}" y="${(y-8).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="700" fill="#E7ECF3" font-family="'JetBrains Mono',monospace">${d.perc}%</text>
      <text x="${(x+barW/2).toFixed(1)}" y="${(padT+chartH+20).toFixed(1)}" text-anchor="middle" font-size="11" fill="#8D99AC">${d.name.replace('Linha ','L')}</text>
    `;
  }).join('');

  // linha guia de referência nos 80% (meta de OEE saudável)
  const y80 = padT + chartH - 0.8*chartH;

  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; display:block;">
      <line x1="${padL}" y1="${y80.toFixed(1)}" x2="${W-padR}" y2="${y80.toFixed(1)}" stroke="#2A3342" stroke-width="1" stroke-dasharray="4 4"/>
      <text x="${W-padR+4}" y="${(y80+3).toFixed(1)}" font-size="9.5" fill="#5C6779">80%</text>
      ${bars}
    </svg>
  `;
}

// Log de paradas do dia — cada entrada é uma parada já registrada (linha, máquina, motivo, duração).
// Hoje é mock; quando a leitura do banco do EGA estiver pronta, isso vem de lá.
const stopLog = [
  { machine:'Plissadeira 1', line:'Linha 1', reason:'Falta de matéria-prima', minutes:22 },
  { machine:'Dosadora 1',    line:'Linha 1', reason:'Troca de ferramenta / Setup', minutes:9 },
  { machine:'Dosadora 2',    line:'Linha 2', reason:'Falha mecânica', minutes:51 },
  { machine:'Plissadeira 2', line:'Linha 2', reason:'Aguardando operador', minutes:9 },
  { machine:'Plissadeira 3', line:'Linha 3', reason:'Falha mecânica', minutes:15 },
  { machine:'Dosadora 3',    line:'Linha 3', reason:'Qualidade / Refugo', minutes:12 },
  { machine:'Dosadora 4',    line:'Linha 4', reason:'Manutenção preventiva', minutes:25 },
  { machine:'Plissadeira 4', line:'Linha 4', reason:'Troca de ferramenta / Setup', minutes:18 },
  { machine:'Dosadora 5',    line:'Linha 5', reason:'Aguardando operador', minutes:60 },
];

// ---------------- RELATÓRIOS (histórico + período) ----------------
// Histórico diário mock — quando a leitura do EGA estiver pronta, isso vem
// de uma consulta ao banco por data, no lugar dessa geração fictícia.
const dailyHistory = (() => {
  const dias = 30;
  const metaDia = totalDailyTarget();
  const arr = [];
  for(let i = dias - 1; i >= 0; i--){
    const d = new Date();
    d.setDate(d.getDate() - i);
    const fator = 0.72 + Math.random() * 0.26; // 72%–98% da meta, mock
    arr.push({
      date: d,
      prod: Math.round(metaDia * fator),
      target: metaDia,
      oee: Math.min(100, Math.round(fator * 100)),
      paradas: Math.floor(Math.random() * 7) + 2,
      tempoParadoMin: Math.floor(Math.random() * 160) + 40,
    });
  }
  return arr;
})();

function fmtMin(min){
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2,'0')}min` : `${m}min`;
}

let periodDays = 7;
let periodCustomStart = null;
let periodCustomEnd = null;

function selectPeriodPreset(days){
  periodDays = days;
  periodCustomStart = null;
  periodCustomEnd = null;
  document.querySelectorAll('.period-btn').forEach(b=>b.classList.remove('active'));
  document.querySelector(`.period-btn[data-period="${days}"]`).classList.add('active');
  document.getElementById('period-custom-inputs').style.display = 'none';
  renderRelatorios();
}

function showCustomPeriod(){
  document.querySelectorAll('.period-btn').forEach(b=>b.classList.remove('active'));
  document.querySelector('.period-btn[data-period="custom"]').classList.add('active');
  document.getElementById('period-custom-inputs').style.display = 'flex';
}

function applyCustomPeriod(){
  const start = document.getElementById('period-start').value;
  const end = document.getElementById('period-end').value;
  if(!start || !end) return;
  periodCustomStart = new Date(start + 'T00:00:00');
  periodCustomEnd = new Date(end + 'T23:59:59');
  renderRelatorios();
}

function getPeriodData(){
  if(periodCustomStart && periodCustomEnd){
    return dailyHistory.filter(d => d.date >= periodCustomStart && d.date <= periodCustomEnd);
  }
  return dailyHistory.slice(-periodDays);
}

function renderRelatorios(){
  const data = getPeriodData();
  if(data.length === 0){
    document.getElementById('rel-chart').innerHTML = `<div class="pareto-empty">Nenhum dado no período selecionado.</div>`;
    return;
  }

  const totalProd = data.reduce((a,d)=>a+d.prod, 0);
  const totalTarget = data.reduce((a,d)=>a+d.target, 0);
  const oeeMedio = Math.round(data.reduce((a,d)=>a+d.oee, 0) / data.length);
  const tempoParadoTotal = data.reduce((a,d)=>a+d.tempoParadoMin, 0);
  const paradasTotal = data.reduce((a,d)=>a+d.paradas, 0);

  document.getElementById('rel-producao').textContent = totalProd.toLocaleString('pt-BR');
  document.getElementById('rel-producao-foot').textContent = `${Math.round(totalProd/totalTarget*100)}% da meta do período`;

  document.getElementById('rel-oee').textContent = oeeMedio;
  const oeeWrap = document.getElementById('rel-oee-wrap');
  oeeWrap.classList.remove('warn','bad');
  if(oeeMedio < 60) oeeWrap.classList.add('bad');
  else if(oeeMedio < 80) oeeWrap.classList.add('warn');

  const tempoParadoMedioDia = tempoParadoTotal / data.length;
  const tempoEl = document.getElementById('rel-tempo-parado');
  tempoEl.textContent = fmtMin(tempoParadoTotal);
  tempoEl.classList.remove('warn','bad');
  if(tempoParadoMedioDia > 120) tempoEl.classList.add('bad');
  else if(tempoParadoMedioDia > 60) tempoEl.classList.add('warn');

  document.getElementById('rel-paradas-count').textContent = `${paradasTotal} paradas registradas`;
  document.getElementById('rel-dias').textContent = data.length;
  document.getElementById('rel-periodo-label').textContent = `${data[0].date.toLocaleDateString('pt-BR')} – ${data[data.length-1].date.toLocaleDateString('pt-BR')}`;
  renderRelTotalProducao();

  renderRelatoriosChart(computeLinhaPeriodo(totalProd, data.length));
  renderRelatoriosLinhaTable(totalProd, data.length);
  renderRelParetoList();
  renderRelOperatorPerf(data.length);
}

let selectedOeeLinhas = Object.keys(lineTargets); // todas marcadas por padrão

function renderOeeLinhaToggles(){
  const el = document.getElementById('rel-oee-linha-toggles');
  if(!el || el.dataset.built) { return; } // monta só uma vez, não a cada tick
  el.dataset.built = '1';
  el.innerHTML = Object.keys(lineTargets).map(name => `
    <label class="rel-oee-linha-toggle">
      <input type="checkbox" checked onchange="toggleOeeLinha('${name}')">
      <span>${name}</span>
    </label>
  `).join('');
}

function toggleOeeLinha(name){
  if(selectedOeeLinhas.includes(name)){
    selectedOeeLinhas = selectedOeeLinhas.filter(n => n !== name);
  } else {
    selectedOeeLinhas = [...selectedOeeLinhas, name];
  }
  renderRelatorios();
}

function renderRelatoriosChart(linhaData){
  renderOeeLinhaToggles();

  const el = document.getElementById('rel-chart');
  const dados = linhaData.filter(d => selectedOeeLinhas.includes(d.name)).sort((a,b)=>b.perc-a.perc);

  if(dados.length === 0){
    el.innerHTML = `<div class="pareto-empty">Selecione ao menos uma linha para exibir.</div>`;
    return;
  }

  const W = 900, H = 250, padL = 44, padR = 20, padT = 26, padB = 40;
  const chartW = W - padL - padR, chartH = H - padT - padB;
  const n = dados.length;
  const slot = chartW / n;
  const barW = Math.min(slot * 0.45, 80);

  const gridLines = [0, 25, 50, 75, 100].map(v=>{
    const y = padT + chartH - (v/100)*chartH;
    return `
      <line x1="${padL}" y1="${y.toFixed(1)}" x2="${W-padR}" y2="${y.toFixed(1)}" stroke="#1E2632" stroke-width="1"/>
      <text x="${(padL-8).toFixed(1)}" y="${(y+3).toFixed(1)}" text-anchor="end" font-size="9.5" fill="#5C6779" font-family="'JetBrains Mono',monospace">${v}%</text>
    `;
  }).join('');

  const bars = dados.map((d,i)=>{
    const x = padL + i*slot + (slot-barW)/2;
    const barH = (d.perc/100) * chartH;
    const y = padT + chartH - barH;
    const color = d.perc>=80 ? '#35D07F' : d.perc>=60 ? '#F5B93D' : '#FF5A5F';
    return `
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" rx="4" fill="${color}"/>
      <text x="${(x+barW/2).toFixed(1)}" y="${(y-9).toFixed(1)}" text-anchor="middle" font-size="13" font-weight="700" fill="#E7ECF3" font-family="'JetBrains Mono',monospace">${d.perc}%</text>
      <text x="${(x+barW/2).toFixed(1)}" y="${(padT+chartH+20).toFixed(1)}" text-anchor="middle" font-size="11.5" fill="#8D99AC">${d.name}</text>
    `;
  }).join('');

  const y80 = padT + chartH - 0.8*chartH;

  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; display:block;">
      ${gridLines}
      <line x1="${padL}" y1="${y80.toFixed(1)}" x2="${W-padR}" y2="${y80.toFixed(1)}" stroke="#4FA3F7" stroke-width="1.5" stroke-dasharray="5 4"/>
      <text x="${W-padR}" y="${(y80-6).toFixed(1)}" text-anchor="end" font-size="10" fill="#4FA3F7">80%</text>
      ${bars}
    </svg>
  `;
}

// ---------------- PRODUÇÃO TOTAL DO PERÍODO — filtro por linha/máquina ----------------
// Mesmo padrão de filtro em cascata usado nas Paradas por Linha. Quando
// filtrado, soma pecasHoje das máquinas que batem com a seleção × dias do
// período (mesma aproximação mock das outras seções desta tela).
function initRelTotalFilters(){
  const linhaSel = document.getElementById('rel-total-linha-filter');
  linhaSel.innerHTML = `<option value="todas">Todas as Linhas</option>` +
    Object.keys(lineTargets).map(l => `<option value="${l}">${l}</option>`).join('');
  onRelTotalLinhaChange();
}

function onRelTotalLinhaChange(){
  const linha = document.getElementById('rel-total-linha-filter').value;
  const maquinaSel = document.getElementById('rel-total-maquina-filter');
  const escopo = linha === 'todas' ? machines : machines.filter(m => m.line === linha);
  const temDosadora = escopo.some(m => m.id.startsWith('Dosadora'));
  const temPlissadeira = escopo.some(m => m.id.startsWith('Plissadeira'));

  const opcoes = [];
  if(temDosadora && temPlissadeira) opcoes.push({ value:'todas', label:'Dosadora + Plissadeira' });
  if(temDosadora) opcoes.push({ value:'Dosadora', label:'Dosadora' });
  if(temPlissadeira) opcoes.push({ value:'Plissadeira', label:'Plissadeira' });

  maquinaSel.innerHTML = opcoes.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
  renderRelTotalProducao();
}

function renderRelTotalProducao(){
  const linhaSel = document.getElementById('rel-total-linha-filter');
  const maquinaSel = document.getElementById('rel-total-maquina-filter');
  if(!linhaSel || !linhaSel.value || !maquinaSel.value) return; // filtros ainda não inicializados

  const dias = getPeriodData().length;
  const linha = linhaSel.value;
  const maquinaFiltro = maquinaSel.value;

  let filtradas = linha === 'todas' ? machines : machines.filter(m => m.line === linha);
  if(maquinaFiltro !== 'todas'){
    filtradas = filtradas.filter(m => m.id.startsWith(maquinaFiltro));
  }

  const total = Math.round(filtradas.reduce((a,m)=>a+m.pecasHoje, 0) * dias);
  document.getElementById('rel-producao-total').textContent = total.toLocaleString('pt-BR');
}

// Distribui a produção do período entre as linhas proporcionalmente à meta de
// cada uma (aproximação, já que o histórico mock é só do total da fábrica).
// Quando vier do EGA, cada linha terá seu próprio histórico real.
// Calcula produção/meta/OEE de cada linha no período (compartilhado entre a
// tabela "Produção por Linha" e o gráfico "OEE por Linha no Período").
function computeLinhaPeriodo(totalProd, dias){
  const metaTotalDia = totalDailyTarget();
  return Object.keys(lineTargets).map(name=>{
    const metaPeriodo = lineTargets[name] * dias;
    const share = lineTargets[name] / metaTotalDia;
    const producaoPeriodo = Math.round(totalProd * share);
    const perc = Math.min(100, Math.round((producaoPeriodo/metaPeriodo)*100));
    return { name, metaPeriodo, producaoPeriodo, perc };
  });
}

function renderRelatoriosLinhaTable(totalProd, dias){
  const el = document.getElementById('rel-linha-body');
  const dados = computeLinhaPeriodo(totalProd, dias).sort((a,b)=>b.perc-a.perc);

  el.innerHTML = dados.map((d,i)=>{
    const color = d.perc>=80 ? '#35D07F' : d.perc>=60 ? '#F5B93D' : '#FF5A5F';
    return `
      <tr>
        <td>
          <div class="rel-linha-name">
            <div class="rel-linha-rank">${i+1}</div>
            <b>${d.name}</b>
          </div>
        </td>
        <td class="rel-linha-nums">
          <div class="rel-linha-prod">${d.producaoPeriodo.toLocaleString('pt-BR')} pçs</div>
          <div class="rel-linha-meta">meta: ${d.metaPeriodo.toLocaleString('pt-BR')} pçs</div>
        </td>
        <td>
          <div class="rel-progress-row">
            <div class="rel-progress-track"><div class="rel-progress-fill" style="width:${d.perc}%; background:${color}"></div></div>
            <span class="rel-progress-label" style="color:${color}">${d.perc}%</span>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// ---------------- PARADAS POR LINHA — versão "no período" ----------------
// Mesma lógica do painel do Supervisor, só que os minutos de cada parada são
// escalados pelos dias do período selecionado (aproximação mock — o dia de
// hoje representado em stopLog é tratado como "um dia típico"; quando vier
// do EGA, cada dia do período terá seu próprio registro real de paradas).
function initRelParetoFilters(){
  const linhaSel = document.getElementById('rel-pareto-linha-filter');
  linhaSel.innerHTML = Object.keys(lineTargets).map(l => `<option value="${l}">${l}</option>`).join('');
  onRelParetoLinhaChange();
}

function onRelParetoLinhaChange(){
  const linha = document.getElementById('rel-pareto-linha-filter').value;
  const maquinaSel = document.getElementById('rel-pareto-maquina-filter');
  const temDosadora = machines.some(m => m.line === linha && m.id.startsWith('Dosadora'));
  const temPlissadeira = machines.some(m => m.line === linha && m.id.startsWith('Plissadeira'));

  const opcoes = [];
  if(temDosadora && temPlissadeira) opcoes.push({ value:'todas', label:'Dosadora + Plissadeira' });
  if(temDosadora) opcoes.push({ value:'Dosadora', label:'Dosadora' });
  if(temPlissadeira) opcoes.push({ value:'Plissadeira', label:'Plissadeira' });

  maquinaSel.innerHTML = opcoes.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
  renderRelParetoList();
}

function renderRelParetoList(){
  const linhaSel = document.getElementById('rel-pareto-linha-filter');
  const maquinaSel = document.getElementById('rel-pareto-maquina-filter');
  if(!linhaSel || !linhaSel.value || !maquinaSel.value) return; // filtros ainda não inicializados

  const dias = getPeriodData().length;
  const linha = linhaSel.value;
  const maquinaFiltro = maquinaSel.value;
  const el = document.getElementById('rel-pareto-list');

  let stops = stopLog.filter(s => s.line === linha);
  if(maquinaFiltro !== 'todas'){
    stops = stops.filter(s => s.machine.startsWith(maquinaFiltro));
  }
  stops = stops.map(s => ({ ...s, minutes: s.minutes * dias })).sort((a,b)=>b.minutes-a.minutes);

  if(stops.length === 0){
    el.innerHTML = `<div class="pareto-empty">Nenhuma parada registrada no período para essa seleção.</div>`;
    return;
  }

  const max = Math.max(...stops.map(s=>s.minutes));
  const total = stops.reduce((a,s)=>a+s.minutes,0);

  el.innerHTML = `
    <div class="pareto-line-group">
      <div class="pareto-line-head"><span>${linha}${maquinaFiltro!=='todas' ? ' · '+maquinaFiltro : ''}</span><span>${fmtMin(total)} parada</span></div>
      ${stops.map(s => `
        <div class="pareto-item">
          <div class="pareto-fill-wrap">
            <div class="pareto-name"><span>${s.reason} <small>(${s.machine})</small></span><span>${fmtMin(s.minutes)}</span></div>
            <div class="pareto-track"><div class="pareto-fill" style="width:${(s.minutes/max*100).toFixed(0)}%"></div></div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// ---------------- DESEMPENHO DOS OPERADORES — versão "no período" ----------------
// Mesma fórmula da tela Supervisor (produzido ÷ meta das OPs), só que os
// valores diários (opsHoje/metaHoje/pecasHoje) são escalados pelos dias do
// período — mesma aproximação mock explicada acima.
function renderRelOperatorPerf(dias){
  const withOperator = machines.filter(m=>m.operator!=='Sem operador');
  const el = document.getElementById('rel-op-perf-body');
  if(!el) return;
  el.innerHTML = withOperator.map(m=>{
    const metaPeriodo = m.metaHoje * dias;
    const producaoPeriodo = Math.round(m.pecasHoje * dias);
    const eff = metaPeriodo > 0 ? Math.min(100, Math.round((producaoPeriodo / metaPeriodo) * 100)) : 0;
    return `
      <tr>
        <td class="op-name">${m.operator}</td>
        <td>${m.id}</td>
        <td>${m.op || '—'}</td>
        <td>${producaoPeriodo.toLocaleString('pt-BR')} pçs</td>
        <td><span class="perf-bar"><span class="perf-fill" style="width:${eff}%"></span></span>${eff}%</td>
      </tr>
    `;
  }).join('');
}

document.querySelectorAll('.period-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const p = btn.dataset.period;
    if(p === 'custom'){ showCustomPeriod(); }
    else { selectPeriodPreset(parseInt(p)); }
  });
});


function initParetoFilters(){
  const linhaSel = document.getElementById('pareto-linha-filter');
  linhaSel.innerHTML = Object.keys(lineTargets).map(l => `<option value="${l}">${l}</option>`).join('');
  onParetoLinhaChange();
}

function onParetoLinhaChange(){
  const linha = document.getElementById('pareto-linha-filter').value;
  const maquinaSel = document.getElementById('pareto-maquina-filter');
  const temDosadora = machines.some(m => m.line === linha && m.id.startsWith('Dosadora'));
  const temPlissadeira = machines.some(m => m.line === linha && m.id.startsWith('Plissadeira'));

  const opcoes = [];
  if(temDosadora && temPlissadeira) opcoes.push({ value:'todas', label:'Dosadora + Plissadeira' });
  if(temDosadora) opcoes.push({ value:'Dosadora', label:'Dosadora' });
  if(temPlissadeira) opcoes.push({ value:'Plissadeira', label:'Plissadeira' });

  maquinaSel.innerHTML = opcoes.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
  renderParetoList();
}

function renderParetoList(){
  const linhaSel = document.getElementById('pareto-linha-filter');
  const maquinaSel = document.getElementById('pareto-maquina-filter');
  if(!linhaSel.value || !maquinaSel.value) return; // filtros ainda não inicializados

  const linha = linhaSel.value;
  const maquinaFiltro = maquinaSel.value;
  const el = document.getElementById('pareto-list');

  let stops = stopLog.filter(s => s.line === linha);
  if(maquinaFiltro !== 'todas'){
    stops = stops.filter(s => s.machine.startsWith(maquinaFiltro));
  }
  stops = stops.slice().sort((a,b)=>b.minutes-a.minutes);

  if(stops.length === 0){
    el.innerHTML = `<div class="pareto-empty">Nenhuma parada registrada hoje para essa seleção.</div>`;
    return;
  }

  const max = Math.max(...stops.map(s=>s.minutes));
  const total = stops.reduce((a,s)=>a+s.minutes,0);

  el.innerHTML = `
    <div class="pareto-line-group">
      <div class="pareto-line-head"><span>${linha}${maquinaFiltro!=='todas' ? ' · '+maquinaFiltro : ''}</span><span>${total} min parada</span></div>
      ${stops.map(s => `
        <div class="pareto-item">
          <div class="pareto-fill-wrap">
            <div class="pareto-name"><span>${s.reason} <small>(${s.machine})</small></span><span>${s.minutes} min</span></div>
            <div class="pareto-track"><div class="pareto-fill" style="width:${(s.minutes/max*100).toFixed(0)}%"></div></div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderOperatorPerf(){
  const withOperator = machines.filter(m=>m.operator!=='Sem operador');
  const el = document.getElementById('op-perf-body');
  el.innerHTML = withOperator.map(m=>{
    const eff = m.metaHoje > 0 ? Math.min(100, Math.round((m.pecasHoje / m.metaHoje) * 100)) : 0;
    return `
      <tr>
        <td class="op-name">${m.operator}</td>
        <td>${m.id}</td>
        <td>${m.op || '—'}</td>
        <td>${m.pecasHoje.toLocaleString('pt-BR')} pçs</td>
        <td><span class="perf-bar"><span class="perf-fill" style="width:${eff}%"></span></span>${eff}%</td>
      </tr>
    `;
  }).join('');
}

// ---------------- TABS ----------------
document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.screen).classList.add('active');
    if(btn.dataset.screen === 'maquinas'){ backToMachineList(); }
    checkAlarmState();
  });
});

function updateSupervisorKPIs(){
  const lines = lineProduction();
  const totalProd = Object.values(lines).reduce((a,v)=>a+v,0);
  const meta = totalDailyTarget();
  document.getElementById('sup-prod-geral').textContent = totalProd.toLocaleString('pt-BR');
  document.getElementById('sup-prod-geral-foot').textContent = `${Math.round(totalProd/meta*100)}% da meta diária (${meta.toLocaleString('pt-BR')} pçs)`;
  document.getElementById('sup-oee-geral').textContent = Math.min(100, Math.round(totalProd/meta*100));

  let bestLine = null, bestVal = -1;
  Object.entries(lines).forEach(([name,val])=>{ if(val>bestVal){ bestVal=val; bestLine=name; } });
  document.getElementById('sup-linha-destaque').textContent = bestLine;
  document.getElementById('sup-linha-destaque-foot').textContent = `${bestVal.toLocaleString('pt-BR')} pçs produzidas`;

  const paradas = machines.filter(m=>m.status==='stop').length;
  document.getElementById('sup-operadores').textContent = machines.filter(m=>m.operator!=='Sem operador').length + ' / ' + machines.length;
}

function renderAll(){
  renderDashboardGrid();
  updateDashboardKPIs();
  renderMachinePicker();
  renderOpDetail();
  renderLineBars();
  renderOeeByLine();
  renderParetoList();
  renderOperatorPerf();
  updateSupervisorKPIs();
}

// ---------------- LOGIN / PERFIL ----------------
// Aviso importante: essa senha fica visível pra quem abrir o código-fonte da
// página (F12 no navegador) — é só uma trava simples, não uma segurança de
// verdade. Enquanto não tivermos um backend/login real, é o que dá pra fazer
// numa página HTML sozinha. Trocar aqui quando quiserem outra senha.
const GESTOR_PASSWORD = 'nvs2026';

let currentRole = null; // 'operador' | 'gestor'

function selectRole(role){
  currentRole = role;
  sessionStorage.setItem('nvs-role', role);
  applyRole();
}

function showGestorPassword(){
  document.getElementById('role-grid').style.display = 'none';
  document.getElementById('gestor-password-form').classList.add('active');
  document.getElementById('gestor-password-input').focus();
}

function backToRoleSelect(){
  document.getElementById('role-grid').style.display = 'grid';
  document.getElementById('gestor-password-form').classList.remove('active');
  document.getElementById('login-error').style.display = 'none';
  document.getElementById('gestor-password-input').value = '';
}

function trySubmitGestorPassword(){
  const input = document.getElementById('gestor-password-input');
  if(input.value === GESTOR_PASSWORD){
    selectRole('gestor');
  } else {
    document.getElementById('login-error').style.display = 'block';
    input.value = '';
    input.focus();
  }
}

function applyRole(){
  document.getElementById('login-screen').classList.add('hidden');
  const tabsNav = document.getElementById('tabs-nav');
  const userBadge = document.getElementById('user-badge');

  if(currentRole === 'operador'){
    // Operador só vê a tela de máquinas, sem outras opções de navegação,
    // começando pela lista (nenhuma máquina selecionada ainda)
    tabsNav.style.display = 'none';
    userBadge.textContent = '👷 Operador · trocar';
    document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
    document.getElementById('maquinas').classList.add('active');
    backToMachineList();
  } else {
    tabsNav.style.display = 'flex';
    userBadge.textContent = '👔 Gestor · trocar';
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
    document.querySelector('.tab-btn[data-screen="dashboard"]').classList.add('active');
    document.getElementById('dashboard').classList.add('active');
  }
}

function logout(){
  sessionStorage.removeItem('nvs-role');
  currentRole = null;
  document.getElementById('login-screen').classList.remove('hidden');
  backToRoleSelect();
}

// Mantém o perfil escolhido se a página for recarregada na mesma aba/sessão
const savedRole = sessionStorage.getItem('nvs-role');
if(savedRole){ currentRole = savedRole; applyRole(); }

initParetoFilters();
initRelParetoFilters();
initRelTotalFilters();
renderRelatorios();
renderAll();

carregarMaquinas();

setInterval(carregarMaquinas, 5000);
