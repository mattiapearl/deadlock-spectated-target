let formDirty = false;
let suppressDirty = false;
let stream = null;

async function getJson(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

function setStatus(text, isError) {
  const el = document.getElementById("status");
  el.textContent = text;
  el.className = `status ${isError ? "error" : "ok"}`;
}

function renderCurrent(current) {
  const empty = document.getElementById("current-empty");
  const panel = document.getElementById("current");

  if (!current) {
    empty.classList.remove("hidden");
    panel.classList.add("hidden");
    return;
  }

  empty.classList.add("hidden");
  panel.classList.remove("hidden");
  document.getElementById("current-spectated").textContent = current.spectated_name || "";
  document.getElementById("current-player").textContent = current.player_name || "";
  document.getElementById("current-hero").textContent = current.hero_name || "";
  document.getElementById("current-team").textContent = current.team || "";

  document.getElementById("payload-preview").textContent = JSON.stringify({
    source: "deadlock-spectated-target",
    spectated_name: current.spectated_name || "",
    player_name: current.player_name || "",
    hero_name: current.hero_name || "",
    team: current.team || "",
    timestamp: new Date().toISOString()
  }, null, 2);
}

function renderHistory(history) {
  const list = document.getElementById("history");
  list.innerHTML = "";

  for (const item of history || []) {
    const li = document.createElement("li");
    li.textContent = `${item.observed_at} — ${item.spectated_name} (${item.team})`;
    list.appendChild(li);
  }
}

function updateDestinationVisibility() {
  const type = document.getElementById("type").value;
  const ablyFields = document.getElementById("ably-fields");
  const urlField = document.getElementById("url").closest("label");
  const headersField = document.getElementById("headers").closest("label");

  const isAbly = type === "ably_pubsub";
  ablyFields.classList.toggle("hidden", !isAbly);
  urlField.classList.toggle("hidden", isAbly);
  headersField.classList.toggle("hidden", isAbly);
}

function readConfigForm() {
  let headers;
  try {
    headers = JSON.parse(document.getElementById("headers").value || "{}");
  } catch {
    throw new Error("Headers must be valid JSON");
  }

  return {
    logPath: document.getElementById("logPath").value,
    destination: {
      enabled: document.getElementById("enabled").value === "true",
      type: document.getElementById("type").value,
      url: document.getElementById("url").value,
      headers,
      ably: {
        apiKey: document.getElementById("ablyApiKey").value,
        channel: document.getElementById("ablyChannel").value,
        clientId: document.getElementById("ablyClientId").value,
      }
    }
  };
}

function writeConfigForm(config) {
  suppressDirty = true;
  document.getElementById("logPath").value = config.logPath || "";
  document.getElementById("enabled").value = String(!!config.destination?.enabled);
  document.getElementById("type").value = config.destination?.type || "disabled";
  document.getElementById("url").value = config.destination?.url || "";
  document.getElementById("headers").value = JSON.stringify(config.destination?.headers || {}, null, 2);
  document.getElementById("ablyApiKey").value = config.destination?.ably?.apiKey || "";
  document.getElementById("ablyChannel").value = config.destination?.ably?.channel || "deadlock.spectated-target";
  document.getElementById("ablyClientId").value = config.destination?.ably?.clientId || "observer-relay";
  updateDestinationVisibility();
  suppressDirty = false;
  formDirty = false;
}

async function refreshCurrent() {
  const currentData = await getJson("/current");
  renderCurrent(currentData.current);
  renderHistory(currentData.history);
}

async function refreshConfig() {
  const config = await getJson("/config");
  if (!formDirty) writeConfigForm(config);
}

function connectStream() {
  if (stream) stream.close();

  stream = new EventSource("/stream");
  stream.onmessage = (event) => {
    const message = JSON.parse(event.data);

    if (message.type === "hello") {
      renderCurrent(message.current);
      renderHistory(message.history);
      if (!formDirty && message.config) writeConfigForm(message.config);
      setStatus("Live stream connected.", false);
      return;
    }

    if (message.type === "target") {
      renderCurrent(message.current);
      renderHistory(message.history);
      return;
    }

    if (message.type === "config") {
      if (!formDirty && message.config) writeConfigForm(message.config);
    }
  };

  stream.onerror = () => {
    setStatus("Live stream disconnected. Retrying...", true);
  };
}

for (const element of document.querySelectorAll("#config-form input, #config-form select, #config-form textarea")) {
  element.addEventListener("input", () => {
    if (suppressDirty) return;
    formDirty = true;
  });
  element.addEventListener("change", () => {
    if (suppressDirty) return;
    formDirty = true;
    if (element.id === "type") updateDestinationVisibility();
  });
}

document.getElementById("config-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const body = readConfigForm();
    const result = await getJson("/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    writeConfigForm(result.config);
    setStatus("Config saved.", false);
  } catch (error) {
    setStatus(error.message, true);
  }
});

document.getElementById("test-send").addEventListener("click", async () => {
  try {
    const result = await getJson("/test-send", { method: "POST" });
    if (result.status === "error") {
      setStatus(result.last_forward_error || "Test send failed.", true);
      return;
    }
    setStatus("Test send completed.", false);
  } catch (error) {
    setStatus(error.message, true);
  }
});

Promise.all([refreshCurrent(), refreshConfig()])
  .then(() => {
    connectStream();
  })
  .catch((error) => setStatus(error.message, true));

setInterval(() => {
  refreshCurrent().catch((error) => setStatus(error.message, true));
}, 5000);
