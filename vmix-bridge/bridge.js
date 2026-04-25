#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const Ably = require("ably");
const {
    MAPPING_SLOTS,
    loadJson,
    buildDefaultMappings,
    buildTargetKey,
    normalizeTarget,
    normalizeMappings,
    findMappingForTarget,
    addAvailableUsername,
    buildVmixCall,
    buildVmixTextCall,
    buildVmixNicknameCall,
    buildVmixRosterCalls,
} = require("./helpers.js");

const DEFAULT_PORT = 5015;
const CONFIG_PATH = path.join(__dirname, "config.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_HISTORY = 40;
const MAX_SSE_CLIENTS = 20;

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = { port: DEFAULT_PORT };

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--port" && args[i + 1]) opts.port = parseInt(args[++i], 10);
    }

    return opts;
}

function defaultConfig() {
    return {
        ably: {
            apiKey: "",
            channel: "deadlock.spectated-target",
            clientId: "caster-vmix-bridge",
        },
        vmix: {
            baseUrl: "http://127.0.0.1:8088/API",
            functionName: "SetLayer",
            input: "",
            unmappedValue: "",
            nickname: {
                enabled: false,
                baseUrl: "",
                input: "",
                selectedName: "Nickname.Text",
            },
            roster: {
                baseUrl: "",
                sapphireInput: "",
                amberInput: "",
                selectedNameTemplate: "Player{index}.Text",
                maxPlayers: 6,
            },
            mappings: buildDefaultMappings(),
        },
    };
}

function loadConfig() {
    try {
        const parsed = loadJson(fs, CONFIG_PATH);
        return {
            ...defaultConfig(),
            ...parsed,
            ably: {
                ...defaultConfig().ably,
                ...(parsed.ably || {}),
            },
            vmix: {
                ...defaultConfig().vmix,
                ...(parsed.vmix || {}),
                nickname: {
                    ...defaultConfig().vmix.nickname,
                    ...((parsed.vmix && parsed.vmix.nickname) || {}),
                },
                roster: {
                    ...defaultConfig().vmix.roster,
                    ...((parsed.vmix && parsed.vmix.roster) || {}),
                },
                mappings: normalizeMappings(parsed.vmix && parsed.vmix.mappings),
            },
        };
    } catch {
        return defaultConfig();
    }
}

function saveConfig(config) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf8");
}

function sendJson(res, status, body) {
    const data = JSON.stringify(body, null, 2);
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Cache-Control": "no-cache",
    });
    res.end(data);
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";
        req.on("data", (chunk) => body += chunk);
        req.on("end", () => resolve(body));
        req.on("error", reject);
    });
}

function getContentType(filePath) {
    if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
    if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
    if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
    if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
    return "text/plain; charset=utf-8";
}

const cli = parseArgs();
const config = loadConfig();
const state = {
    connection_status: "idle",
    current: null,
    currentKey: "",
    history: [],
    available_usernames: [],
    team_rosters: {
        sapphire: [],
        amber: [],
    },
    received_count: 0,
    last_message_at: null,
    last_event_name: "",
    last_matched_mapping: null,
    last_unmapped_name: "",
    last_vmix_function: "",
    last_vmix_input: "",
    last_vmix_value: "",
    last_vmix_request: "",
    last_vmix_script_call: "",
    last_vmix_error: null,
    last_nickname_input: "",
    last_nickname_selected_name: "",
    last_nickname_value: "",
    last_nickname_request: "",
    last_nickname_script_call: "",
    last_nickname_error: null,
    last_roster_count: 0,
    last_roster_request: "",
    last_roster_error: null,
};

let ablyClient = null;
let subscribeAbort = 0;
const sseClients = new Set();

function broadcastSSE(message) {
    const payload = `data: ${JSON.stringify(message)}\n\n`;
    for (const client of sseClients) {
        try {
            client.write(payload);
        } catch {
            sseClients.delete(client);
        }
    }
}

function setConnectionStatus(status) {
    state.connection_status = status;
    broadcastSSE({ type: "status", status, state });
}

function addHistory(entry) {
    state.history.unshift(entry);
    if (state.history.length > MAX_HISTORY) state.history.length = MAX_HISTORY;
}

function addTeamRosterName(target) {
    const team = String(target && target.team || "").trim().toLowerCase();
    if (team !== "sapphire" && team !== "amber") return false;

    const candidate = String((target && (target.player_name || target.spectated_name || target.hero_name)) || "").trim();
    if (!candidate) return false;

    const list = state.team_rosters[team] || [];
    const already = list.some((name) => String(name).trim().toLowerCase() === candidate.toLowerCase());
    if (already) return false;

    state.team_rosters[team] = list.concat(candidate).slice(0, 6);
    return true;
}

async function sendVmixRequest(built) {
    const response = await fetch(built.url, { method: "GET" });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`vMix HTTP ${response.status}: ${body.slice(0, 300)}`);
    }
    return built;
}

async function updateVmixValue(value) {
    const built = buildVmixCall(config, value);
    await sendVmixRequest(built);

    state.last_vmix_function = built.functionName;
    state.last_vmix_input = built.input;
    state.last_vmix_value = built.value;
    state.last_vmix_request = built.url;
    state.last_vmix_script_call = built.scriptCall;
    state.last_vmix_error = null;
    return built;
}

async function updateVmixRoster() {
    const calls = buildVmixRosterCalls(config, state.team_rosters);
    for (const call of calls) {
        await sendVmixRequest(call);
    }

    state.last_roster_count = calls.length;
    state.last_roster_request = calls.length ? calls[calls.length - 1].url : "";
    state.last_roster_error = null;
    return calls;
}

async function updateRowNickname({ username, input, baseUrl, selectedName }) {
    const value = String(username || "").trim();
    const targetInput = String(input || "").trim();
    const nicknameConfig = config.vmix && config.vmix.nickname || {};
    const built = buildVmixTextCall(
        baseUrl || nicknameConfig.baseUrl || config.vmix.baseUrl,
        targetInput,
        selectedName || nicknameConfig.selectedName || "Nickname.Text",
        value
    );
    await sendVmixRequest(built);
    state.last_nickname_input = built.input;
    state.last_nickname_selected_name = built.selectedName;
    state.last_nickname_value = built.value;
    state.last_nickname_request = built.url;
    state.last_nickname_script_call = built.scriptCall;
    state.last_nickname_error = null;
    return built;
}

async function updateVmixNickname(target, force = false) {
    const nicknameConfig = config.vmix && config.vmix.nickname || {};
    if (!force && !nicknameConfig.enabled) return null;

    const built = buildVmixNicknameCall(config, target);
    await sendVmixRequest(built);

    state.last_nickname_input = built.input;
    state.last_nickname_selected_name = built.selectedName;
    state.last_nickname_value = built.value;
    state.last_nickname_request = built.url;
    state.last_nickname_script_call = built.scriptCall;
    state.last_nickname_error = null;
    return built;
}

function resetGameState() {
    state.current = null;
    state.currentKey = "";
    state.history = [];
    state.available_usernames = [];
    state.team_rosters = { sapphire: [], amber: [] };
    state.received_count = 0;
    state.last_message_at = null;
    state.last_event_name = "";
    state.last_matched_mapping = null;
    state.last_unmapped_name = "";
}

async function handleIncomingMessage(eventName, rawData) {
    const target = normalizeTarget(rawData);
    state.received_count++;
    state.last_message_at = new Date().toISOString();
    state.last_event_name = eventName;
    state.available_usernames = addAvailableUsername(state.available_usernames, target);
    const rosterChanged = addTeamRosterName(target);

    const key = buildTargetKey(target);
    if (key === state.currentKey) {
        broadcastSSE({ type: "heartbeat", state });
        return;
    }

    state.current = target;
    state.currentKey = key;

    const mapping = findMappingForTarget(config.vmix.mappings, target);
    const hasMappedValue = !!(mapping && String(mapping.value || "").trim());
    const unmappedValue = String(config.vmix.unmappedValue || "").trim();
    const shouldSendFallback = !hasMappedValue && !!unmappedValue;

    if (mapping) {
        state.last_matched_mapping = {
            rowIndex: mapping.rowIndex,
            username: mapping.username,
            value: mapping.value,
        };
    } else {
        state.last_matched_mapping = null;
    }

    if (!hasMappedValue) {
        state.last_unmapped_name = target.spectated_name;
    } else {
        state.last_unmapped_name = "";
    }

    addHistory({
        ...target,
        event_name: eventName,
        observed_at: new Date().toISOString(),
        mapped_row: mapping ? mapping.rowIndex + 1 : null,
        mapped_value: hasMappedValue ? mapping.value : (shouldSendFallback ? unmappedValue : ""),
        used_fallback: shouldSendFallback,
    });

    broadcastSSE({ type: "target", state });

    if (hasMappedValue || shouldSendFallback) {
        try {
            const valueToSend = hasMappedValue ? mapping.value : unmappedValue;
            const built = await updateVmixValue(valueToSend);
            const reason = hasMappedValue ? `mapped row ${mapping.rowIndex + 1}` : `unmapped fallback for ${target.spectated_name}`;
            console.log(`[VMIX-BRIDGE] Updated vMix via ${built.functionName}: ${valueToSend} (${reason})`);
            broadcastSSE({ type: "vmix_updated", state });
        } catch (error) {
            state.last_vmix_error = String(error && error.message ? error.message : error);
            console.error("[VMIX-BRIDGE] Update failed:", state.last_vmix_error);
            broadcastSSE({ type: "vmix_error", state });
        }
    }

    try {
        const built = await updateVmixNickname(target);
        if (built) {
            console.log(`[VMIX-BRIDGE] Updated vMix nickname: ${built.value}`);
            broadcastSSE({ type: "nickname_updated", state });
        }
    } catch (error) {
        state.last_nickname_error = String(error && error.message ? error.message : error);
        console.error("[VMIX-BRIDGE] Nickname update failed:", state.last_nickname_error);
        broadcastSSE({ type: "nickname_error", state });
    }

    if (rosterChanged) {
        broadcastSSE({ type: "roster_changed", state });
    }
}

async function connectAbly() {
    subscribeAbort++;
    const token = subscribeAbort;

    if (ablyClient) {
        try { ablyClient.close(); } catch {}
        ablyClient = null;
    }

    const ablyCfg = config.ably || {};
    if (!ablyCfg.apiKey || !ablyCfg.channel) {
        setConnectionStatus("not_configured");
        return;
    }

    setConnectionStatus("connecting");

    ablyClient = new Ably.Realtime({
        key: ablyCfg.apiKey,
        clientId: ablyCfg.clientId || "caster-vmix-bridge",
    });

    ablyClient.connection.on("connected", () => {
        if (token !== subscribeAbort) return;
        console.log("[VMIX-BRIDGE] Connected to Ably");
        setConnectionStatus("connected");
    });

    ablyClient.connection.on("disconnected", () => {
        if (token !== subscribeAbort) return;
        setConnectionStatus("disconnected");
    });

    ablyClient.connection.on("suspended", () => {
        if (token !== subscribeAbort) return;
        setConnectionStatus("suspended");
    });

    ablyClient.connection.on("failed", (error) => {
        if (token !== subscribeAbort) return;
        state.last_vmix_error = error && error.message ? error.message : "Ably connection failed";
        console.error("[VMIX-BRIDGE] Ably connection failed");
        setConnectionStatus("failed");
    });

    const channel = ablyClient.channels.get(ablyCfg.channel);
    await channel.subscribe("spectated-target", async (message) => {
        if (token !== subscribeAbort) return;
        await handleIncomingMessage(message.name, message.data || {});
    });

    console.log(`[VMIX-BRIDGE] Subscribed to channel: ${ablyCfg.channel}`);
}

function serveStatic(req, res, pathname) {
    const local = pathname === "/" ? "/index.html" : pathname;
    const filePath = path.join(PUBLIC_DIR, local.replace(/^\/+/, ""));

    if (!filePath.startsWith(PUBLIC_DIR)) {
        sendJson(res, 400, { error: "Invalid path" });
        return true;
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        return false;
    }

    res.writeHead(200, {
        "Content-Type": getContentType(filePath),
        "Cache-Control": "no-cache",
    });
    res.end(fs.readFileSync(filePath));
    return true;
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    if (req.method === "OPTIONS") {
        res.writeHead(204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        });
        res.end();
        return;
    }

    if (pathname === "/health" && req.method === "GET") {
        sendJson(res, 200, {
            status: "ok",
            connection_status: state.connection_status,
            current: state.current,
            received_count: state.received_count,
            available_usernames: state.available_usernames,
            last_message_at: state.last_message_at,
            last_matched_mapping: state.last_matched_mapping,
            last_unmapped_name: state.last_unmapped_name,
            last_vmix_function: state.last_vmix_function,
            last_vmix_value: state.last_vmix_value,
            last_vmix_error: state.last_vmix_error,
            last_nickname_value: state.last_nickname_value,
            last_nickname_error: state.last_nickname_error,
        });
        return;
    }

    if (pathname === "/state" && req.method === "GET") {
        sendJson(res, 200, { state });
        return;
    }

    if (pathname === "/config" && req.method === "GET") {
        sendJson(res, 200, config);
        return;
    }

    if (pathname === "/config" && req.method === "POST") {
        try {
            const raw = await readBody(req);
            const update = JSON.parse(raw || "{}");

            if (update.ably && typeof update.ably === "object") {
                config.ably = { ...config.ably, ...update.ably };
            }
            if (update.vmix && typeof update.vmix === "object") {
                config.vmix = {
                    ...config.vmix,
                    ...update.vmix,
                    nickname: {
                        ...(config.vmix.nickname || defaultConfig().vmix.nickname),
                        ...(update.vmix.nickname || {}),
                    },
                    roster: {
                        ...(config.vmix.roster || defaultConfig().vmix.roster),
                        ...(update.vmix.roster || {}),
                    },
                    mappings: update.vmix.mappings !== undefined
                        ? normalizeMappings(update.vmix.mappings)
                        : normalizeMappings(config.vmix.mappings),
                };
            } else {
                config.vmix.mappings = normalizeMappings(config.vmix.mappings);
            }

            saveConfig(config);
            await connectAbly();
            broadcastSSE({ type: "config", config, state });
            sendJson(res, 200, { status: "saved", config });
        } catch (error) {
            sendJson(res, 400, { error: String(error && error.message ? error.message : error) });
        }
        return;
    }

    if ((pathname === "/clear-available-usernames" || pathname === "/clear-usernames") && req.method === "POST") {
        resetGameState();
        broadcastSSE({ type: "cleared_usernames", state });
        sendJson(res, 200, { status: "cleared", state });
        return;
    }

    if (pathname === "/test-vmix" && req.method === "POST") {
        const target = state.current || normalizeTarget({ spectated_name: "SampleTarget", team: "amber" });
        const mapping = findMappingForTarget(config.vmix.mappings, target);
        const hasMappedValue = !!(mapping && String(mapping.value || "").trim());

        if (!hasMappedValue) {
            sendJson(res, 400, { error: `No mapped value found for ${target.spectated_name}` });
            return;
        }

        try {
            const built = await updateVmixValue(mapping.value);
            broadcastSSE({ type: "vmix_test", state });
            sendJson(res, 200, { status: "sent", mapping, built });
        } catch (error) {
            state.last_vmix_error = String(error && error.message ? error.message : error);
            sendJson(res, 400, { status: "error", error: state.last_vmix_error });
        }
        return;
    }

    if (pathname === "/send-row-nickname" && req.method === "POST") {
        try {
            const raw = await readBody(req);
            const body = raw ? JSON.parse(raw) : {};
            const built = await updateRowNickname(body);
            broadcastSSE({ type: "row_nickname_sent", state });
            sendJson(res, 200, { status: "sent", built });
        } catch (error) {
            state.last_nickname_error = String(error && error.message ? error.message : error);
            sendJson(res, 400, { status: "error", error: state.last_nickname_error });
        }
        return;
    }

    if (pathname === "/send-row-nicknames" && req.method === "POST") {
        try {
            const raw = await readBody(req);
            const body = raw ? JSON.parse(raw) : {};
            const rows = Array.isArray(body.rows) ? body.rows : [];
            const sent = [];
            for (const row of rows) {
                if (!String(row && row.username || "").trim() || !String(row && row.input || "").trim()) continue;
                sent.push(await updateRowNickname({
                    username: row.username,
                    input: row.input,
                    baseUrl: body.baseUrl,
                    selectedName: body.selectedName,
                }));
            }
            broadcastSSE({ type: "row_nicknames_sent", state });
            sendJson(res, 200, { status: "sent", count: sent.length, sent });
        } catch (error) {
            state.last_nickname_error = String(error && error.message ? error.message : error);
            sendJson(res, 400, { status: "error", error: state.last_nickname_error });
        }
        return;
    }

    if (pathname === "/test-nickname" && req.method === "POST") {
        try {
            const raw = await readBody(req);
            const body = raw ? JSON.parse(raw) : {};
            const value = typeof body.value === "string"
                ? body.value
                : (state.current && state.current.spectated_name) || "НУЖНЫЙ_ТЕКСТ";
            const target = normalizeTarget({ spectated_name: value, player_name: value, team: "test" });
            const built = await updateVmixNickname(target, true);
            broadcastSSE({ type: "nickname_test", state });
            sendJson(res, 200, { status: "sent", built });
        } catch (error) {
            state.last_nickname_error = String(error && error.message ? error.message : error);
            sendJson(res, 400, { status: "error", error: state.last_nickname_error });
        }
        return;
    }

    if (pathname === "/stream" && req.method === "GET") {
        if (sseClients.size >= MAX_SSE_CLIENTS) {
            sendJson(res, 429, { error: "Too many stream clients" });
            return;
        }

        res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
        });

        sseClients.add(res);
        res.write(`data: ${JSON.stringify({ type: "hello", config, state, mappingSlots: MAPPING_SLOTS })}\n\n`);
        req.on("close", () => sseClients.delete(res));
        return;
    }

    if (req.method === "GET" && serveStatic(req, res, pathname)) {
        return;
    }

    sendJson(res, 404, {
        error: "Not found",
        endpoints: ["/health", "/state", "/config", "/clear-available-usernames", "/clear-usernames", "/test-vmix", "/test-nickname", "/send-row-nickname", "/send-row-nicknames", "/stream"],
    });
});

server.listen(cli.port, async () => {
    console.log(`[VMIX-BRIDGE] UI listening on http://localhost:${cli.port}`);
    await connectAbly();
});
