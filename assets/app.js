const MONTH_NAMES = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
const TYPE_LABELS = { manual: "人工配置大促", dynamic: "动态配置大促" };
const selectedMonths = new Set();

const monthList = document.querySelector("#month-list");
const resultsBody = document.querySelector("#results-body");
const emptyState = document.querySelector("#empty-state");
const elements = {
  regionCount: document.querySelector("#region-count"),
  dayCount: document.querySelector("#day-count"),
  recordCount: document.querySelector("#record-count"),
  monthCount: document.querySelector("#month-count"),
  selectionLabel: document.querySelector("#selection-label"),
};

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character]));

function typeFor(types) {
  if (types.has("manual") && types.has("dynamic")) return "mixed";
  return types.has("dynamic") ? "dynamic" : "manual";
}

function dateChip(day, types, detail = false) {
  const kind = typeFor(types);
  const title = [...types].map((type) => TYPE_LABELS[type]).join("、");
  return `<span class="date-chip${detail ? " month-detail" : ""} ${kind}" title="${escapeHtml(title)}">${day}</span>`;
}

function monthButton(month, data) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "month-button";
  button.textContent = MONTH_NAMES[month - 1];
  button.dataset.month = String(month);
  button.setAttribute("aria-pressed", String(selectedMonths.has(month)));
  button.addEventListener("click", () => {
    if (selectedMonths.has(month)) selectedMonths.delete(month);
    else selectedMonths.add(month);
    render(data);
  });
  return button;
}

function renderMonths(months, data) {
  monthList.replaceChildren(...months.map((month) => monthButton(month, data)));
}

function collectRecords(data) {
  const byRegion = new Map(data.regions.map((region) => [region, new Map()]));
  for (const campaign of data.campaigns) {
    const [year, month, day] = campaign.date.split("-").map(Number);
    if (year !== data.year || !selectedMonths.has(month)) continue;
    for (const region of campaign.regions) {
      if (!byRegion.has(region)) continue;
      const regionDates = byRegion.get(region);
      const key = `${month}-${day}`;
      if (!regionDates.has(key)) regionDates.set(key, { month, day, types: new Set() });
      regionDates.get(key).types.add(campaign.type);
    }
  }
  return byRegion;
}

function renderRows(data) {
  const byRegion = collectRecords(data);
  const activeRegions = [...byRegion.entries()].filter(([, dates]) => dates.size > 0);
  const totalRecordCount = activeRegions.reduce((sum, [, dates]) => sum + dates.size, 0);
  const uniqueDays = new Map();
  for (const [, dates] of activeRegions) {
    for (const record of dates.values()) {
      if (!uniqueDays.has(record.day)) uniqueDays.set(record.day, new Set());
      for (const type of record.types) uniqueDays.get(record.day).add(type);
    }
  }

  elements.regionCount.textContent = String(activeRegions.length);
  elements.dayCount.textContent = String(uniqueDays.size);
  elements.recordCount.textContent = String(totalRecordCount);
  elements.monthCount.textContent = String(selectedMonths.size);

  const orderedMonths = [...selectedMonths].sort((a, b) => a - b);
  elements.selectionLabel.textContent = orderedMonths.length
    ? `${data.year} · ${orderedMonths.map((month) => MONTH_NAMES[month - 1]).join(" + ")}`
    : `${data.year} · 未选择月份`;

  resultsBody.replaceChildren();
  for (const [region, dates] of activeRegions) {
    const union = new Map();
    for (const record of dates.values()) {
      if (!union.has(record.day)) union.set(record.day, new Set());
      for (const type of record.types) union.get(record.day).add(type);
    }
    const unionHtml = [...union.entries()].sort(([a], [b]) => a - b)
      .map(([day, types]) => dateChip(day, types)).join("");

    const details = orderedMonths.map((month) => {
      const items = [...dates.values()].filter((record) => record.month === month).sort((a, b) => a.day - b.day);
      if (!items.length) return "";
      const chips = items.map((record) => dateChip(record.day, record.types, true)).join("");
      return `<div class="month-group"><span class="month-group-label">${MONTH_NAMES[month - 1]}</span><div class="month-group-dates">${chips}</div></div>`;
    }).join("");

    const row = document.createElement("tr");
    row.innerHTML = `
      <td><span class="region-pill">${escapeHtml(region)}</span></td>
      <td><div class="date-list">${unionHtml}</div></td>
      <td class="count-cell"><strong>${union.size}</strong>个日号</td>
      <td><div class="month-details">${details}</div></td>
    `;
    resultsBody.append(row);
  }

  emptyState.hidden = activeRegions.length > 0;
}

function render(data) {
  for (const button of monthList.querySelectorAll(".month-button")) {
    button.setAttribute("aria-pressed", String(selectedMonths.has(Number(button.dataset.month))));
  }
  renderRows(data);
}

async function start() {
  const response = await fetch(new URL("../data/campaign-dates.json", import.meta.url));
  if (!response.ok) throw new Error("本地数据文件无法读取");
  const data = await response.json();
  if (data.availableMonths.length) {
    selectedMonths.add(data.availableMonths[data.availableMonths.length - 1]);
  }
  document.querySelector("#year-select").replaceChildren(
    new Option(String(data.year), String(data.year), true, true),
  );
  document.querySelector("#snapshot-date").textContent = data.asOf;
  renderMonths(data.availableMonths, data);
  render(data);

  document.querySelector("#select-all").addEventListener("click", () => {
    data.availableMonths.forEach((month) => selectedMonths.add(month));
    render(data);
  });
  document.querySelector("#clear-all").addEventListener("click", () => {
    selectedMonths.clear();
    render(data);
  });
}

start().catch((error) => {
  console.error(error);
  document.querySelector("#empty-state").hidden = false;
  document.querySelector("#empty-state strong").textContent = "数据暂时无法读取";
  document.querySelector("#empty-state span:last-child").textContent = "请检查 data/campaign-dates.json 是否随页面一起部署。";
});
