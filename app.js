// FirstBeat: decision-support prototype. Simulated data only, not for medical use.
// Thresholds are tuning knobs for the demo, NOT medical limits. Replace with sourced values.
const CFG = { baselineDays: 24, sustainDays: 3, watchSD: 2 };
const DELAY_MIN = 22, START_DAY = 83, SOLAR_IDX = 25;

// ---- Simulated 30-day data (deterministic so the demo is repeatable) ----
const series = (base, amp, tail) => Array.from({ length: 30 }, (_, i) =>
  i < 30 - tail.length
    ? +(base + Math.sin(i * 1.7) * amp + Math.cos(i * 0.9) * amp / 2).toFixed(1)
    : tail[i - (30 - tail.length)]);

const METRICS = [
  { id: "hr", label: "Resting HR", unit: "bpm", bad: "up", d: 0, values: series(65, 2, [69, 71, 73]) },
  { id: "bp", label: "Blood pressure", unit: "mmHg", bad: "up", d: 0, values: series(120, 2, [119, 118, 118]),
    fmt: v => Math.round(v) + "/76" }, // systolic tracked, diastolic fixed for the demo
  { id: "sleep", label: "Sleep", unit: "h", bad: "down", d: 1, values: series(7.2, 0.25, [6.4, 6.1, 5.9]) },
  { id: "ex", label: "Exercise", unit: "min", bad: "down", d: 0, values: series(35, 3, [38, 40, 42]) },
];

// ---- Baseline + drift: compare the recent average to your own baseline ----
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const sd = a => Math.sqrt(mean(a.map(x => (x - mean(a)) ** 2))) || 1;

function analyze(m) {
  const base = m.values.slice(0, CFG.baselineDays);
  const recent = m.values.slice(-CFG.sustainDays);
  const z = (mean(recent) - mean(base)) / sd(base);
  const badZ = m.bad === "up" ? z : -z;
  return {
    base, z, mean: mean(base), sd: sd(base),
    latest: m.values[m.values.length - 1],
    status: badZ >= CFG.watchSD ? "watch" : "normal",
  };
}
METRICS.forEach(m => (m.a = analyze(m)));
const [HR, , SLEEP] = METRICS;

// ---- App state ----
const state = { level: null, symptoms: [], advice: "", queued: false, emergencyActive: false, protocolStarted: false };
const overall = () => state.level || (METRICS.some(m => m.a.status === "watch") ? "watch" : "normal");
const $ = id => document.getElementById(id);

const ICON = {
  ok: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>',
  warn: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/></svg>',
};
const LABEL = { normal: "Normal", watch: "Watch", act: "Act now" };
const badge = s => `<span class="badge" data-status="${s}">${s === "normal" ? ICON.ok : ICON.warn}${LABEL[s]}</span>`;

// ---- Render: hero ----
function renderHero() {
  const s = overall(), hr = HR.a;
  const lift = (mean(HR.values.slice(-CFG.sustainDays)) - hr.mean).toFixed(0);
  const copy = {
    normal: ["All readings are within your baseline", "Keep your routine. Do a check-in if anything feels off."],
    watch: ["Resting heart rate trending up for 3 days",
      `+${lift} bpm vs your baseline.` + (SLEEP.a.status === "watch" ? " Sleep is also below baseline, a likely contributor." : "")],
    act: ["Stop and get help now", "Follow the onboard emergency protocol and alert the Crew Medical Officer. Don’t wait for Earth."],
  }[s];
  $("hero").dataset.status = s;
  $("badge").outerHTML = badge(s).replace("<span", '<span id="badge"');
  $("headline").textContent = copy[0];
  $("sub").textContent = copy[1];
  $("startCheckin").textContent = state.emergencyActive ? "Reopen emergency" : "Start check-in";
}

// ---- Render: metric cards ----
function renderMetrics() {
  $("metrics").innerHTML = METRICS.map(m => {
    const a = m.a, diff = a.latest - a.mean, f = (m.fmt || (v => v.toFixed(m.d)));
    const delta = Math.abs(diff) < 0.5 * Math.pow(10, -m.d) ? "On baseline"
      : `${diff > 0 ? "↑" : "↓"} ${Math.abs(diff).toFixed(m.d)} ${m.unit} vs baseline`;
    return `<article class="card metric" data-status="${a.status}">
      <div class="row"><h3>${m.label}</h3>${badge(a.status)}</div>
      <p class="val"><span class="mono">${f(a.latest)}</span> <span class="muted">${m.unit}</span></p>
      <p class="delta">${delta}</p></article>`;
  }).join("");
}

// ---- Render: chart (hand-drawn SVG, no libraries) ----
function renderChart() {
  const v = HR.values, a = HR.a, n = v.length;
  const W = 640, H = 260, L = 40, R = 12, T = 12, B = 30;
  const lo = Math.floor(Math.min(...v) - 3), hi = Math.ceil(Math.max(...v) + 3);
  const x = i => L + (i * (W - L - R)) / (n - 1);
  const y = val => T + ((hi - val) / (hi - lo)) * (H - T - B);
  const bLo = a.mean - 2 * a.sd, bHi = a.mean + 2 * a.sd;
  const pts = (from, to) => v.slice(from, to + 1).map((p, k) => `${x(from + k).toFixed(1)},${y(p).toFixed(1)}`).join(" ");
  const ticks = [0, 1, 2, 3, 4].map(k => Math.round(lo + ((hi - lo) * k) / 4));
  const xl = [0, 7, 14, 21, 29];
  const tailStart = n - CFG.sustainDays - 1;
  $("chart").innerHTML = `
    ${ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="#26324D"/><text x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${t}</text>`).join("")}
    <rect x="${L}" y="${y(bHi)}" width="${W - L - R}" height="${y(bLo) - y(bHi)}" fill="#3DD6C6" opacity=".16"/>
    <line x1="${L}" x2="${W - R}" y1="${y(a.mean)}" y2="${y(a.mean)}" stroke="#9AABC7" stroke-dasharray="4 4" opacity=".6"/>
    <line x1="${x(SOLAR_IDX)}" x2="${x(SOLAR_IDX)}" y1="${T}" y2="${H - B}" stroke="#9AABC7" stroke-dasharray="5 5"/>
    <text x="${x(SOLAR_IDX) - 6}" y="${T + 12}" text-anchor="end">Solar event</text>
    <polyline points="${pts(0, tailStart)}" fill="none" stroke="#3DD6C6" stroke-width="2.5" stroke-linejoin="round"/>
    <polyline points="${pts(tailStart, n - 1)}" fill="none" stroke="#F5A524" stroke-width="3" stroke-linejoin="round"/>
    ${v.slice(-CFG.sustainDays).map((p, k) => `<circle cx="${x(n - CFG.sustainDays + k)}" cy="${y(p)}" r="4" fill="#F5A524"/>`).join("")}
    ${xl.map(i => `<text x="${x(i)}" y="${H - 8}" text-anchor="${i === 0 ? "start" : i === n - 1 ? "end" : "middle"}">${i === n - 1 ? "Today" : "Day " + (START_DAY + i)}</text>`).join("")}`;
  $("today").textContent = `${a.latest} bpm today`;
  $("today").style.color = "var(--" + (a.status === "watch" ? "watch" : "normal") + ")";
  $("range").textContent = `Daily resting average, mission days ${START_DAY} to ${START_DAY + n - 1}`;
  $("bandLabel").textContent = `Your baseline: ${Math.round(bLo)} to ${Math.round(bHi)} bpm`;
}

// ---- Render: guidance + ground link ----
const STEPS = {
  normal: ["Keep your usual exercise and sleep routine.", "Log anything unusual you notice.", "Next routine check-in tomorrow."],
  watch: ["Rest for 15 minutes, then recheck.", "Log your sleep and fluids.", "Start the check-in and queue a summary for Earth."],
  act: ["Stop what you are doing and sit or lie down.", "Alert the Crew Medical Officer now.", "Queue the summary for Earth, but don’t wait for a reply."],
};
function renderSteps() { $("steps").innerHTML = STEPS[overall()].map(t => `<li>${t}</li>`).join(""); }

function renderGround() {
  const s = overall();
  $("groundBody").innerHTML = state.queued
    ? `<p><span class="big mono">${DELAY_MIN}</span> <span class="muted">min one-way</span></p>
       <p class="muted">Queued. Earliest reply in about ${DELAY_MIN * 2} min.</p>
       <ul>
         <li>Baseline resting HR ${Math.round(HR.a.mean)} bpm, now ${HR.a.latest} bpm (${HR.a.z.toFixed(1)} SD)</li>
         <li>Sleep ${SLEEP.a.latest} h vs ${SLEEP.a.mean.toFixed(1)} h baseline</li>
         <li>Symptoms: ${state.symptoms.length ? state.symptoms.join(", ") : "none reported"}</li>
         <li>Tool advice: ${state.advice || "Rest, recheck, log"}</li></ul>`
    : `<div class="row"><p><span class="big mono">${DELAY_MIN}</span> <span class="muted">min one-way</span></p>
       <button class="btn" id="queueBtn">Queue message</button></div>
       <p class="muted">Allow at least ${DELAY_MIN * 2} min for a round-trip reply.</p>`;
  $("groundBadge").dataset.status = state.queued ? "normal" : "watch";
  $("groundBadge").textContent = state.queued ? "Queued" : "Delayed";
  if (s === "act" && !state.queued) $("groundBadge").dataset.status = "act";
}

function render() { renderHero(); renderSteps(); renderGround(); renderEmergencyBanner(); }

// ---- Check-in flow ----
const QS = ["Are you having chest pain or pressure?", "Are you having palpitations or a racing heartbeat?", "Are you dizzy, faint, or very short of breath?"];
const SYM = ["chest pain or pressure", "palpitations", "dizziness or breathlessness"];
const dlg = $("checkin"), body = $("ciBody");
let step = 0, ans = [];
let previousState = null; // snapshot taken when a check-in starts, restored on "False alarm"

function renderEmergencyBanner() {
  $("emergencyBanner").hidden = !state.emergencyActive;
}
// Placeholder steps for the demo. A real product would use the mission's own
// emergency protocol, written and approved by flight surgeons.
const PROTOCOL = [
  "Stop what you are doing. Sit or lie down with your head and shoulders slightly raised.",
  "Call the Crew Medical Officer and the nearest crew member. Stay on the line.",
  "Do not stay alone. Keep checking your breathing and whether you can respond.",
  "Loosen tight clothing and breathe slowly while help arrives.",
];
function renderEmergencyModal() {
  body.innerHTML = `${badge("act")}
    <h2>${state.protocolStarted ? "Protocol started" : "Get help now"}</h2>
    <p>${state.protocolStarted
      ? "Protocol started. Stay with the crew member and keep following the steps below."
      : "Follow these steps now. Don’t wait for Earth’s reply."}</p>
    <ol class="protocol" aria-label="Onboard emergency protocol">${PROTOCOL.map(t => `<li>${t}</li>`).join("")}</ol>
    <p class="emergency-queue-note muted">Summary queued for Earth. Earliest reply in ${DELAY_MIN * 2} min.</p>
    <div class="actions">${state.protocolStarted ? "" : '<button class="btn primary" id="ciProtocolStarted">I\'ve alerted the Crew Medical Officer</button>'}
      <button class="btn" id="ciFalseAlarm">False alarm, I\'m okay</button></div>`;
}
function reopenEmergency() {
  renderEmergencyModal();
  dlg.showModal();
  renderEmergencyBanner();
}
function openCheckin() {
  if (state.emergencyActive) { reopenEmergency(); return; }
  previousState = { level: state.level, queued: state.queued, symptoms: state.symptoms, advice: state.advice };
  step = 0; ans = []; dlg.classList.remove("help-result"); renderStep(); dlg.showModal();
}
function renderStep() {
  if (step >= QS.length) return result();
  body.innerHTML = `<p class="muted">Question ${step + 1} of ${QS.length}</p><h2>${QS[step]}</h2>
    <p class="muted">Answer based on how you feel right now.</p>
    <div class="yn"><button class="btn" data-a="1">Yes</button><button class="btn" data-a="0">No</button></div>`;
}
function result() {
  const red = ans[0] || ans[2];
  state.symptoms = SYM.filter((_, i) => ans[i]);
  state.level = red ? "act" : "watch";
  state.advice = red ? "Stop activity, alert the Crew Medical Officer, follow emergency protocol"
    : ans[1] ? "Rest 15 minutes, recheck, escalate if it continues" : "Log it and recheck tomorrow";
  if (red) {
    state.emergencyActive = true;
    state.protocolStarted = false;
    state.queued = true;
    dlg.classList.add("help-result");
    renderEmergencyModal();
    render();
    return;
  }
  dlg.classList.remove("help-result");
  body.innerHTML = `${badge(state.level)}
    <h2>${ans[1] ? "Rest and recheck" : "Keep monitoring"}</h2>
    <p>${ans[1] ? "Rest for 15 minutes, then recheck. If it continues, or you feel chest pain, faintness or severe breathlessness, escalate."
      : "No warning symptoms reported. Your readings are still off your baseline, so log it and recheck tomorrow."}</p>
    <div class="actions"><button class="btn primary" id="ciQueue">Queue message to Earth</button><button class="btn" id="ciClose">Close</button></div>`;
  render();
}

body.addEventListener("click", e => {
  const t = e.target.closest("button"); if (!t) return;
  if (t.dataset.a) {
    ans.push(+t.dataset.a);
    step++;
    // Chest pain is a red flag: skip the remaining questions and go straight to the emergency screen.
    if (ans[0]) result(); else renderStep();
  }
  if (t.id === "ciProtocolStarted") { state.protocolStarted = true; renderEmergencyModal(); }
  if (t.id === "ciFalseAlarm") {
    // Restore everything the emergency changed (level, queued message, symptoms, advice).
    Object.assign(state, previousState, { emergencyActive: false, protocolStarted: false });
    dlg.close();
    render();
  }
  if (t.id === "ciQueue") { state.queued = true; renderGround(); dlg.close(); }
  if (t.id === "ciClose") dlg.close();
});
dlg.addEventListener("click", e => {
  // Clicks on the dialog's own padding also have target === dlg, so check the pointer is outside its box.
  const r = dlg.getBoundingClientRect();
  const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  if (e.target === dlg && !inside) dlg.close();
});
dlg.addEventListener("cancel", e => { e.preventDefault(); dlg.close(); });
dlg.addEventListener("close", renderEmergencyBanner);
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && dlg.open) { e.preventDefault(); dlg.close(); }
});
$("startCheckin").addEventListener("click", openCheckin);
$("reopenEmergency").addEventListener("click", reopenEmergency);
$("groundBody").addEventListener("click", e => { if (e.target.id === "queueBtn") { state.queued = true; renderGround(); } });

// ---- Init ----
$("missionDay").textContent = "Mission day " + (START_DAY + 29);
$("delay").textContent = DELAY_MIN;
renderMetrics(); renderChart(); render();