let formDirty = false;
let suppressDirty = false;
let stream = null;
let lastCurrent = null;

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

function applyTemplate(template, target) {
  const data = target || {};
  return String(template || "{spectated_name}").replace(/\{(\w+)\}/g, (_, key) => {
    const value = data[key];
    return value == null ? "" : String(value);
  });
}

function renderState(state) {
  const s = state || {};
  const current = s.current || null;
  lastCurrent = current;

  document.getElementById("status-ably").textContent = s.connection_status || "idle";
  document.getElementById("status-count").textContent = String(s.received_count || 0);
  document.getElementById("status-last-message").textContent = s.last_message_at || "—";
  document.getElementById("status-vmix-text").textContent = s.last_vmix_text || "—";
  document.getElementById("status-vmix-error").textContent = s.last_vmix_error || "—";

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

  const list = document.getElementById("history");
  list.innerHTML = "";
  for (const item of s.history || []) {
    const li = document.createElement("li");
    li.textContent = `${item.observed_at} — ${item.spectated_name} (${item.team})`;
    list.appendChild(li);
  }

  updatePreview();
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
      input: document.getElementById("vmixInput").value,
      selectedName: document.getElementById("vmixSelectedName").value,
      textTemplate: document.getElementById("vmixTemplate").value,
    }
  };
}

function writeConfigForm(config) {
  suppressDirty = true;
  document.getElementById("ablyApiKey").value = config.ably?.apiKey || "";
  document.getElementById("ablyChannel").value = config.ably?.channel || "deadlock.spectated-target";
  document.getElementById("ablyClientId").value = config.ably?.clientId || "caster-vmix-bridge";
  document.getElementById("vmixBaseUrl").value = config.vmix?.baseUrl || "http://127.0.0.1:8088/API";
  document.getElementById("vmixInput").value = config.vmix?.input || "";
  document.getElementById("vmixSelectedName").value = config.vmix?.selectedName || "Headline.Text";
  document.getElementById("vmixTemplate").value = config.vmix?.textTemplate || "{spectated_name}";
  suppressDirty = false;
  formDirty = false;
  updatePreview();
}

function updatePreview() {
  const config = readConfigForm();
  document.getElementById("preview").textContent = applyTemplate(config.vmix.textTemplate, lastCurrent || {
    spectated_name: "SampleTarget",
    player_name: "SampleTarget",
    hero_name: "",
    team: "amber",
  });
}

async function refresh() {
  const [config, stateData] = await Promise.all([
    getJson("/config"),
    getJson("/state")
  ]);

  if (!formDirty) writeConfigForm(config);
  renderState(stateData.state);
}

function connectStream() {
  if (stream) stream.close();
  stream = new EventSource("/stream");
  stream.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "hello") {
      if (!formDirty && message.config) writeConfigForm(message.config);
      renderState(message.state);
      setStatus("Live stream connected.", false);
      return;
    }

    if (message.state) renderState(message.state);
    if (message.type === "config" && !formDirty && message.config) writeConfigForm(message.config);
  };
  stream.onerror = () => setStatus("Live stream disconnected. Retrying...", true);
}

for (const element of document.querySelectorAll("#config-form input")) {
  element.addEventListener("input", () => {
    if (suppressDirty) return;
    formDirty = true;
    updatePreview();
  });
  element.addEventListener("change", () => {
    if (suppressDirty) return;
    formDirty = true;
    updatePreview();
  });
}

document.getElementById("config-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const result = await getJson("/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(readConfigForm())
    });
    writeConfigForm(result.config);
    setStatus("Config saved and bridge reconnected.", false);
  } catch (error) {
    setStatus(error.message, true);
  }
});

document.getElementById("test-vmix").addEventListener("click", async () => {
  try {
    const result = await getJson("/test-vmix", { method: "POST" });
    setStatus(`vMix write ok: ${result.text}`, false);
  } catch (error) {
    setStatus(error.message, true);
  }
});

refresh().then(connectStream).catch((error) => setStatus(error.message, true));
setInterval(() => {
  refresh().catch((error) => setStatus(error.message, true));
}, 5000);
