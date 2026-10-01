const API_BASE = "http://localhost:8000";

const el = (id) => document.getElementById(id);
const kiosk = el("kiosk");
const loadingState = el("loading-state");
const errorState = el("error-state");
const results = el("results");
const form = el("trip-form");

// --- clock, purely decorative, matches the departure-board vibe ---
function tickClock() {
  const now = new Date();
  el("clock").textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
tickClock();
setInterval(tickClock, 30000);

// --- pace toggle ---
document.querySelectorAll(".pace-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".pace-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    el("pace").value = btn.dataset.value;
  });
});

const LOADING_MESSAGES = [
  "Routing your itinerary…",
  "Checking opening hours…",
  "Scouting nearby stays…",
  "Balancing the budget…",
];
let loadingInterval;

function showLoading() {
  kiosk.hidden = true;
  errorState.hidden = true;
  results.hidden = true;
  loadingState.hidden = false;
  let i = 0;
  el("loading-text").textContent = LOADING_MESSAGES[0];
  loadingInterval = setInterval(() => {
    i = (i + 1) % LOADING_MESSAGES.length;
    el("loading-text").textContent = LOADING_MESSAGES[i];
  }, 1800);
}

function showError(message) {
  clearInterval(loadingInterval);
  loadingState.hidden = true;
  results.hidden = true;
  errorState.hidden = false;
  el("error-text").textContent = message;
}

function showKiosk() {
  clearInterval(loadingInterval);
  loadingState.hidden = true;
  errorState.hidden = true;
  results.hidden = true;
  kiosk.hidden = false;
}

const money = (amount, currency) => {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString()}`;
  }
};

function renderBudgetStrip(itinerary) {
  const b = itinerary.budget_breakdown;
  const cur = itinerary.currency;
  const cells = [
    ["Stays", b.accommodation],
    ["Food", b.food],
    ["Transport", b.transport],
    ["Activities", b.activities],
    ["Misc", b.miscellaneous],
    ["Total", itinerary.total_budget],
  ];
  el("budget-strip").innerHTML = cells
    .map(
      ([label, val], i) => `
      <div class="budget-cell ${i === cells.length - 1 ? "total" : ""}">
        <span class="k">${label}</span>
        <span class="v">${money(val, cur)}</span>
      </div>`
    )
    .join("");
}

function renderPlaces(title, items) {
  if (!items || !items.length) return "";
  return `
    <div>
      <h4>${title}</h4>
      ${items
        .map(
          (p) => `
        <div class="place-item">
          <div class="name"><span>${p.name}</span><span class="price">${p.price_range || ""}</span></div>
          <div class="area">${p.area || ""}</div>
          <div class="why">${p.why || ""}</div>
        </div>`
        )
        .join("")}
    </div>`;
}

function renderDays(itinerary) {
  const tabsEl = el("day-tabs");
  const wrapEl = el("ticket-wrap");
  tabsEl.innerHTML = "";
  wrapEl.innerHTML = "";

  itinerary.days.forEach((day, idx) => {
    const tab = document.createElement("button");
    tab.className = "day-tab" + (idx === 0 ? " active" : "");
    tab.textContent = `Day ${day.day_number}`;
    tab.addEventListener("click", () => {
      document.querySelectorAll(".day-tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".ticket").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(`ticket-${idx}`).classList.add("active");
    });
    tabsEl.appendChild(tab);

    const ticket = document.createElement("article");
    ticket.className = "ticket" + (idx === 0 ? " active" : "");
    ticket.id = `ticket-${idx}`;
    ticket.innerHTML = `
      <div class="ticket-head">
        <div>
          <span class="day-label">${itinerary.destination} · Day ${day.day_number}</span>
          <h3>${day.theme}</h3>
        </div>
        <span class="stub-num">${String(day.day_number).padStart(2, "0")}</span>
      </div>
      <div class="perforation"></div>
      <div class="blocks">
        ${day.blocks
          .map(
            (b) => `
          <div class="block">
            <div class="time">${b.time_start}–${b.time_end}<span class="dur">${b.duration_minutes} min</span></div>
            <div>
              <p class="activity-name">${b.location_name}</p>
              <p class="activity-desc">${b.activity}${b.notes ? ` — ${b.notes}` : ""}</p>
              <span class="cost">${money(b.estimated_cost, itinerary.currency)}</span>
            </div>
          </div>`
          )
          .join("")}
      </div>
      <div class="perforation"></div>
      <div class="places">
        ${renderPlaces("Nearby hotels", day.nearby_hotels)}
        ${renderPlaces("Nearby restaurants", day.nearby_restaurants)}
      </div>
    `;
    wrapEl.appendChild(ticket);
  });
}

function renderTips(itinerary) {
  const tipsEl = el("tips");
  if (!itinerary.tips || !itinerary.tips.length) {
    tipsEl.innerHTML = "";
    return;
  }
  tipsEl.innerHTML = `
    <h4>Before you go</h4>
    <ul>${itinerary.tips.map((t) => `<li>${t}</li>`).join("")}</ul>
  `;
}

function renderResults(itinerary) {
  clearInterval(loadingInterval);
  loadingState.hidden = true;
  errorState.hidden = true;
  kiosk.hidden = true;
  results.hidden = false;

  el("results-title").textContent = `${itinerary.duration_days} days in ${itinerary.destination}`;
  renderBudgetStrip(itinerary);
  renderDays(itinerary);
  renderTips(itinerary);
}

async function planTrip(payload) {
  const res = await fetch(`${API_BASE}/api/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {}
    throw new Error(detail);
  }
  return res.json();
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {
    destination: el("destination").value.trim(),
    duration_days: Number(el("duration").value),
    budget_amount: Number(el("budget").value),
    budget_currency: el("currency").value,
    travelers: Number(el("travelers").value),
    interests: el("interests").value.trim() || null,
    pace: el("pace").value,
  };

  showLoading();
  try {
    const itinerary = await planTrip(payload);
    renderResults(itinerary);
  } catch (err) {
    showError(
      err.message.includes("Failed to fetch")
        ? "Can't reach the backend. Is it running at " + API_BASE + "?"
        : err.message
    );
  }
});

el("retry-btn").addEventListener("click", showKiosk);
el("new-trip-btn").addEventListener("click", showKiosk);
