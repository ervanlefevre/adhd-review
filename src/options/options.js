import { loadSettings, saveSettings, loadToken, saveToken, DEFAULT_KEYS } from "../settings.js";
import { parseRulesText } from "../rules.js";

const KEY_LABELS = {
  next: "Next file",
  previous: "Previous file",
  viewed: "Mark viewed",
  unview: "Unmark viewed",
  later: "Flag for later",
  nextPending: "Next pending file",
  markGroup: "Mark whole group viewed",
  panel: "Open side panel",
  refresh: "Refresh from GitHub",
  help: "Show keys",
};

const form = document.getElementById("form");
const tokenInput = document.getElementById("token");
const rulesInput = document.getElementById("rules");
const lineCapInput = document.getElementById("lineCap");
const scrollOffsetInput = document.getElementById("scrollOffset");
const progressColorInput = document.getElementById("progressColor");
const keysContainer = document.getElementById("keys");
const connectionStatus = document.getElementById("connection");
const rulesStatus = document.getElementById("rulesStatus");
const saveStatus = document.getElementById("saveStatus");

function setStatus(element, text, kind) {
  element.textContent = text;
  element.className = `status ${kind || ""}`;
}

async function fill() {
  const settings = await loadSettings();
  tokenInput.value = await loadToken();
  rulesInput.value = settings.rulesText;
  lineCapInput.value = settings.lineCap;
  scrollOffsetInput.value = settings.scrollOffset;
  progressColorInput.value = settings.progressColor;
  keysContainer.replaceChildren(
    ...Object.keys(DEFAULT_KEYS).map((action) => {
      const label = document.createElement("label");
      label.textContent = KEY_LABELS[action] || action;
      const input = document.createElement("input");
      input.type = "text";
      input.maxLength = 1;
      input.dataset.action = action;
      input.value = settings.keys[action];
      label.append(input);
      return label;
    })
  );
}

function validateRules() {
  const { rules, errors } = parseRulesText(rulesInput.value);
  if (errors.length) setStatus(rulesStatus, errors.join(" · "), "error");
  else setStatus(rulesStatus, `${rules.length} rules`, "ok");
  return errors.length === 0;
}

rulesInput.addEventListener("input", validateRules);

document.getElementById("test").addEventListener("click", async () => {
  setStatus(connectionStatus, "Checking…");
  const response = await chrome.runtime.sendMessage({ type: "checkConnection", token: tokenInput.value.trim() });
  if (response.ok) setStatus(connectionStatus, `Connected as ${response.result}`, "ok");
  else setStatus(connectionStatus, response.error, "error");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!validateRules()) return;
  const keys = {};
  for (const input of keysContainer.querySelectorAll("input")) keys[input.dataset.action] = input.value || DEFAULT_KEYS[input.dataset.action];
  await saveToken(tokenInput.value);
  await saveSettings({
    rulesText: rulesInput.value,
    lineCap: Math.max(1, Number(lineCapInput.value) || 150),
    scrollOffset: Number(scrollOffsetInput.value) || 0,
    progressColor: progressColorInput.value || "#3fb950",
    keys,
  });
  setStatus(saveStatus, "Saved", "ok");
  setTimeout(() => setStatus(saveStatus, ""), 2000);
});

fill().then(validateRules);
