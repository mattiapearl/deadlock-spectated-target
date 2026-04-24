const DEFAULT_MAPPING_SLOTS = 12;
const LOCAL_STORAGE_CONFIG_KEY = "deadlock-vmix-bridge-config-v1";

let formDirty = false;
let suppressDirty = false;
let restoredBrowserBackup = false;
let stream = null;
let lastCurrent = null;
let mappingSlots = DEFAULT_MAPPING_SLOTS;
let backupTimer = null;
let availableUsernames = [];
let activeMappingRowIndex = null;

async function getJson(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

function setStatus(text, isError) {
  const el = document.getElementById("status-message");
  el.textContent = text;
  el.className = `status ${isError ? "error" : "ok"}`;
}

function normalizeName(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

function hasUserConfig(config) {
  const ably = config?.ably || {};
  const vmix = config?.vmix || {};
  const mappings = Array.isArray(vmix.mappings) ? vmix.mappings : [];
  const channel = String(ably.channel || "").trim();
  const baseUrl = String(vmix.baseUrl || "").trim();
  const functionName = String(vmix.functionName || "").trim();

  return Boolean(
    String(ably.apiKey || "").trim() ||
    (channel && channel !== "deadlock.spectated-target") ||
    (baseUrl && baseUrl !== "http://127.0.0.1:8088/API") ||
    (functionName && functionName !== "SetLayer") ||
    String(vmix.input || "").trim() ||
    String(vmix.unmappedValue || "").trim() ||
    Boolean(vmix.nickname?.enabled) ||
    String(vmix.nickname?.baseUrl || "").trim() ||
    String(vmix.nickname?.input || "").trim() ||
    (String(vmix.nickname?.selectedName || "").trim() && String(vmix.nickname?.selectedName || "").trim() !== "Nickname.Text") ||
    mappings.some((row) => String(row?.username || "").trim() || String(row?.value || "").trim())
  );
}

function loadBrowserBackup() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_CONFIG_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveBrowserBackup(config) {
  try {
    if (!hasUserConfig(config)) {
      localStorage.removeItem(LOCAL_STORAGE_CONFIG_KEY);
      return;
    }

    localStorage.setItem(LOCAL_STORAGE_CONFIG_KEY, JSON.stringify({
      savedAt: new Date().toISOString(),
      config,
    }));
  } catch {
    // Browser storage is best-effort only. Server-side config.json remains primary.
  }
}

function scheduleBrowserBackup() {
  clearTimeout(backupTimer);
  backupTimer = setTimeout(() => saveBrowserBackup(readConfigForm()), 200);
}

function markConfigDirty() {
  if (suppressDirty) return;
  formDirty = true;
  updatePreview();
  scheduleBrowserBackup();
}

function applyServerConfig(config) {
  if (hasUserConfig(config)) {
    restoredBrowserBackup = false;
    writeConfigForm(config);
    saveBrowserBackup(config);
    return;
  }

  const backup = loadBrowserBackup();
  if (backup?.config && hasUserConfig(backup.config)) {
    writeConfigForm(backup.config);
    formDirty = true;
    restoredBrowserBackup = true;
    setStatus(`Restored browser backup from ${backup.savedAt || "localStorage"}. Click Save and reconnect to write it back to config.json.`, false);
    return;
  }

  restoredBrowserBackup = false;
  writeConfigForm(config);
}

function ensureMappingRows(count = DEFAULT_MAPPING_SLOTS) {
  mappingSlots = count;
  const body = document.getElementById("mapping-body");
  if (body.children.length === count) return;

  body.innerHTML = "";
  for (let i = 0; i < count; i++) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${i + 1}</td>
      <td>
        <div class="username-picker">
          <input id="mapping-username-${i}" class="mapping-username" list="available-username-options" placeholder="Search or type username" autocomplete="off">
          <select id="mapping-username-choice-${i}" class="mapping-username-choice" aria-label="Choose username for row ${i + 1}"></select>
        </div>
      </td>
      <td><input id="mapping-value-${i}" placeholder="100"></td>
    `;
    body.appendChild(row);
  }

  for (let i = 0; i < count; i++) {
    const usernameInput = document.getElementById(`mapping-username-${i}`);
    const usernameChoice = document.getElementById(`mapping-username-choice-${i}`);
    const valueInput = document.getElementById(`mapping-value-${i}`);

    usernameInput.addEventListener("focus", () => {
      activeMappingRowIndex = i;
      renderUsernameChoiceControls();
    });
    usernameInput.addEventListener("input", markConfigDirty);
    usernameInput.addEventListener("change", () => {
      syncUsernameChoice(i);
      markConfigDirty();
    });

    usernameChoice.addEventListener("focus", renderUsernameChoiceControls);
    usernameChoice.addEventListener("pointerdown", renderUsernameChoiceControls);
    usernameChoice.addEventListener("change", () => {
      if (!usernameChoice.value) return;
      activeMappingRowIndex = i;
      setMappingUsername(i, usernameChoice.value);
    });

    valueInput.addEventListener("focus", () => activeMappingRowIndex = i);
    valueInput.addEventListener("input", markConfigDirty);
    valueInput.addEventListener("change", markConfigDirty);
  }

  renderUsernameChoiceControls();
}

function readMappingsFromForm() {
  const mappings = [];
  for (let i = 0; i < mappingSlots; i++) {
    mappings.push({
      username: document.getElementById(`mapping-username-${i}`).value,
      value: document.getElementById(`mapping-value-${i}`).value,
    });
  }
  return mappings;
}

function readConfigForm() {
  return {
    ably: {
      apiKey: document.getElementById("ablyApiKey").value,
      channel: document.getElementById("ablyChannel").value,
      clientId: document.getElementById("ablyClientId").value,
    },
    vmix: {
      baseUrl: document.getElementById("vmixBaseUrl").value,
      functionName: document.getElementById("vmixFunctionName").value,
      input: document.getElementById("vmixInput").value,
      unmappedValue: document.getElementById("vmixUnmappedValue").value,
      nickname: {
        enabled: document.getElementById("nicknameEnabled").checked,
        baseUrl: document.getElementById("nicknameBaseUrl").value,
        input: document.getElementById("nicknameInput").value,
        selectedName: document.getElementById("nicknameSelectedName").value,
      },
      mappings: readMappingsFromForm(),
    }
  };
}

function writeConfigForm(config) {
  suppressDirty = true;
  ensureMappingRows(Math.max(DEFAULT_MAPPING_SLOTS, (config.vmix?.mappings || []).length));
  document.getElementById("ablyApiKey").value = config.ably?.apiKey || "";
  document.getElementById("ablyChannel").value = config.ably?.channel || "deadlock.spectated-target";
  document.getElementById("ablyClientId").value = config.ably?.clientId || "caster-vmix-bridge";
  document.getElementById("vmixBaseUrl").value = config.vmix?.baseUrl || "http://127.0.0.1:8088/API";
  document.getElementById("vmixFunctionName").value = config.vmix?.functionName || "SetLayer";
  document.getElementById("vmixInput").value = config.vmix?.input || "";
  document.getElementById("vmixUnmappedValue").value = config.vmix?.unmappedValue || "";
  document.getElementById("nicknameEnabled").checked = !!config.vmix?.nickname?.enabled;
  document.getElementById("nicknameBaseUrl").value = config.vmix?.nickname?.baseUrl || "";
  document.getElementById("nicknameInput").value = config.vmix?.nickname?.input || "";
  document.getElementById("nicknameSelectedName").value = config.vmix?.nickname?.selectedName || "Nickname.Text";

  const mappings = config.vmix?.mappings || [];
  for (let i = 0; i < mappingSlots; i++) {
    document.getElementById(`mapping-username-${i}`).value = mappings[i]?.username || "";
    document.getElementById(`mapping-value-${i}`).value = mappings[i]?.value || "";
  }

  renderUsernameChoiceControls();
  suppressDirty = false;
  formDirty = false;
  updatePreview();
}

function findMappingForCurrent() {
  const current = lastCurrent;
  if (!current) return null;

  const name = normalizeName(current.spectated_name);
  if (!name) return null;

  const mappings = readMappingsFromForm();
  for (let i = 0; i < mappings.length; i++) {
    if (normalizeName(mappings[i].username) === name) {
      return { ...mappings[i], rowIndex: i };
    }
  }

  return null;
}

function syncUsernameChoice(rowIndex) {
  const input = document.getElementById(`mapping-username-${rowIndex}`);
  const choice = document.getElementById(`mapping-username-choice-${rowIndex}`);
  if (!input || !choice) return;

  const inputValue = input.value;
  const exact = availableUsernames.find((name) => name === inputValue);
  choice.value = exact || "";
}

function renderUsernameChoiceControls() {
  for (let i = 0; i < mappingSlots; i++) {
    const input = document.getElementById(`mapping-username-${i}`);
    const choice = document.getElementById(`mapping-username-choice-${i}`);
    if (!input || !choice) continue;

    const currentValue = input.value;
    choice.innerHTML = "";

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = availableUsernames.length ? `Choose username (${availableUsernames.length})...` : "No usernames seen yet";
    choice.appendChild(placeholder);

    for (const name of availableUsernames) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      choice.appendChild(option);
    }

    choice.value = availableUsernames.includes(currentValue) ? currentValue : "";
  }
}

function setMappingUsername(rowIndex, username) {
  const input = document.getElementById(`mapping-username-${rowIndex}`);
  if (!input) return;

  input.value = username;
  syncUsernameChoice(rowIndex);
  markConfigDirty();
  input.focus();
}

function findFirstEmptyMappingRow() {
  for (let i = 0; i < mappingSlots; i++) {
    const input = document.getElementById(`mapping-username-${i}`);
    if (input && !input.value.trim()) return i;
  }
  return 0;
}

function fillActiveOrFirstEmptyMapping(username) {
  const activeInput = activeMappingRowIndex === null
    ? null
    : document.getElementById(`mapping-username-${activeMappingRowIndex}`);
  const rowIndex = activeInput ? activeMappingRowIndex : findFirstEmptyMappingRow();
  setMappingUsername(rowIndex, username);
}

function collectUsernamesFromState(state) {
  const names = [];

  for (const name of state?.available_usernames || []) names.push(name);

  if (state?.current) {
    names.push(state.current.spectated_name);
    names.push(state.current.player_name);
  }

  for (const item of state?.history || []) {
    names.push(item.spectated_name);
    names.push(item.player_name);
  }

  return Array.from(new Set(names
    .map((name) => String(name || "").trim())
    .filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));
}

function renderAvailableUsernames(usernames) {
  availableUsernames = Array.from(new Set((usernames || [])
    .map((name) => String(name || "").trim())
    .filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));

  const list = document.getElementById("available-usernames");
  const datalist = document.getElementById("available-username-options");
  list.innerHTML = "";
  datalist.innerHTML = "";

  if (!availableUsernames.length) {
    const li = document.createElement("li");
    li.className = "muted small";
    li.textContent = "No usernames seen yet.";
    list.appendChild(li);
  }

  for (const name of availableUsernames) {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip";
    button.textContent = name;
    button.title = "Click to fill the focused mapping row, or the first empty row";
    button.addEventListener("click", () => fillActiveOrFirstEmptyMapping(name));
    li.appendChild(button);
    list.appendChild(li);

    const option = document.createElement("option");
    option.value = name;
    datalist.appendChild(option);
  }

  renderUsernameChoiceControls();
}

function renderState(state) {
  const s = state || {};
  const current = s.current || null;
  lastCurrent = current;

  document.getElementById("status-ably").textContent = s.connection_status || "idle";
  const observedUsernames = collectUsernamesFromState(s);

  document.getElementById("status-count").textContent = String(s.received_count || 0);
  document.getElementById("status-usernames").textContent = String(observedUsernames.length);
  document.getElementById("status-last-message").textContent = s.last_message_at || "—";

  if (s.last_matched_mapping) {
    document.getElementById("status-last-match").textContent = `#${s.last_matched_mapping.rowIndex + 1} ${s.last_matched_mapping.username} → ${s.last_matched_mapping.value || "(blank)"}`;
  } else {
    document.getElementById("status-last-match").textContent = "—";
  }

  document.getElementById("status-last-unmapped").textContent = s.last_unmapped_name || "—";
  document.getElementById("status-vmix-call").textContent = s.last_vmix_script_call || "—";
  document.getElementById("status-vmix-error").textContent = s.last_vmix_error || "—";
  document.getElementById("status-nickname-call").textContent = s.last_nickname_script_call || "—";
  document.getElementById("status-nickname-error").textContent = s.last_nickname_error || "—";

  const empty = document.getElementById("current-empty");
  const panel = document.getElementById("current");
  if (!current) {
    empty.classList.remove("hidden");
    panel.classList.add("hidden");
  } else {
    empty.classList.add("hidden");
    panel.classList.remove("hidden");
    document.getElementById("current-spectated").textContent = current.spectated_name || "";
    document.getElementById("current-player").textContent = current.player_name || "";
    document.getElementById("current-hero").textContent = current.hero_name || "";
    document.getElementById("current-team").textContent = current.team || "";
    document.getElementById("current-time").textContent = current.timestamp || "";
  }

  renderAvailableUsernames(observedUsernames);

  const list = document.getElementById("history");
  list.innerHTML = "";
  for (const item of s.history || []) {
    const li = document.createElement("li");
    const mappingText = item.mapped_value ? ` → ${item.mapped_value}` : " → unmapped";
    li.textContent = `${item.observed_at} — ${item.spectated_name} (${item.team})${mappingText}`;
    list.appendChild(li);
  }

  updatePreview();
}

function updatePreview() {
  const config = readConfigForm();
  const functionName = config.vmix.functionName || "SetLayer";
  const input = config.vmix.input || "67";
  const mapping = findMappingForCurrent();
  const lines = [];

  if (!lastCurrent) {
    lines.push(`Layer: API.Function("${functionName}", Input:="${input}", Value:="100")`);
  } else if (!mapping || !String(mapping.value || "").trim()) {
    const fallbackValue = config.vmix.unmappedValue || "";
    lines.push(fallbackValue
      ? `Layer fallback for ${lastCurrent.spectated_name || "current target"}: API.Function("${functionName}", Input:="${input}", Value:="${fallbackValue}")`
      : `Layer: no mapped value for ${lastCurrent.spectated_name || "current target"}; no layer command will be sent.`);
  } else {
    lines.push(`Layer: API.Function("${functionName}", Input:="${input}", Value:="${mapping.value}")`);
  }

  if (config.vmix.nickname?.enabled) {
    const nicknameInput = config.vmix.nickname.input || "86";
    const selectedName = config.vmix.nickname.selectedName || "Nickname.Text";
    const nickname = lastCurrent?.spectated_name || "EXAMPLE";
    lines.push(`Nickname: API.Function("SetText", Input:="${nicknameInput}", SelectedName:="${selectedName}", Value:="${nickname}")`);
  }

  document.getElementById("preview").textContent = lines.join("\n");
}

async function refresh() {
  const [config, stateData] = await Promise.all([
    getJson("/config"),
    getJson("/state")
  ]);

  if (!formDirty) applyServerConfig(config);
  renderState(stateData.state);
}

function connectStream() {
  if (stream) stream.close();
  stream = new EventSource("/stream");
  stream.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "hello") {
      ensureMappingRows(message.mappingSlots || DEFAULT_MAPPING_SLOTS);
      if (!formDirty && message.config) applyServerConfig(message.config);
      renderState(message.state);
      if (!restoredBrowserBackup) setStatus("Live stream connected.", false);
      return;
    }

    if (message.state) renderState(message.state);
    if (message.type === "config" && !formDirty && message.config) applyServerConfig(message.config);
  };
  stream.onerror = () => setStatus("Live stream disconnected. Retrying...", true);
}

function registerTopLevelInputs() {
  for (const element of document.querySelectorAll("#config-form > input, #config-form .row input, #config-form label > input")) {
    element.addEventListener("input", markConfigDirty);
    element.addEventListener("change", markConfigDirty);
  }
}

ensureMappingRows(DEFAULT_MAPPING_SLOTS);
registerTopLevelInputs();

document.getElementById("config-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const result = await getJson("/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(readConfigForm())
    });
    writeConfigForm(result.config);
    saveBrowserBackup(result.config);
    restoredBrowserBackup = false;
    setStatus("Config saved to config.json and browser backup updated.", false);
  } catch (error) {
    setStatus(error.message, true);
  }
});

document.getElementById("test-vmix").addEventListener("click", async () => {
  try {
    const result = await getJson("/test-vmix", { method: "POST" });
    setStatus(`vMix layer call ok: ${result.built.scriptCall}`, false);
  } catch (error) {
    setStatus(error.message, true);
  }
});

document.getElementById("test-nickname").addEventListener("click", async () => {
  try {
    const result = await getJson("/test-nickname", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: lastCurrent?.spectated_name || "НУЖНЫЙ_ТЕКСТ" })
    });
    setStatus(`vMix nickname call ok: ${result.built.scriptCall} URL: ${result.built.url}`, false);
  } catch (error) {
    setStatus(error.message, true);
  }
});

document.getElementById("clear-usernames").addEventListener("click", async () => {
  try {
    let result;
    try {
      result = await getJson("/clear-available-usernames", { method: "POST" });
    } catch (error) {
      if (!String(error.message || "").includes("Not found")) throw error;
      result = await getJson("/clear-usernames", { method: "POST" });
    }

    const clearedState = result.state || {
      connection_status: "connected",
      current: null,
      currentKey: "",
      history: [],
      available_usernames: [],
      received_count: 0,
      last_message_at: null,
      last_event_name: "",
      last_matched_mapping: null,
      last_unmapped_name: "",
      last_vmix_script_call: "",
      last_vmix_error: null,
      last_nickname_script_call: "",
      last_nickname_error: null,
    };

    renderState(clearedState);
    setStatus("Current game UI cleared. Ready for next game usernames.", false);
  } catch (error) {
    setStatus(`${error.message} — restart the updated bridge if this still says Not found.`, true);
  }
});

refresh().then(connectStream).catch((error) => setStatus(error.message, true));
setInterval(() => {
  refresh().catch((error) => setStatus(error.message, true));
}, 5000);
