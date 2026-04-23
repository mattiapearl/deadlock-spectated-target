#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const Ably = require("ably");
const { loadJson, buildTargetKey, normalizeTarget, buildVmixUrl } = require("./helpers.js");

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
            input: "",
            selectedName: "Headline.Text",
            textTemplate: "{spectated_name}",
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
    received_count: 0,
    last_message_at: null,
    last_vmix_text: "",
    last_vmix_error: null,
    last_event_name: "",
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

async function updateVmix(target) {
    const built = buildVmixUrl(config, target);
    const response = await fetch(built.url, { method: "GET" });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`vMix HTTP ${response.status}: ${body.slice(0, 300)}`);
    }

    state.last_vmix_text = built.text;
    state.last_vmix_error = null;
    return built.text;
}

async function handleIncomingMessage(eventName, rawData) {
    const target = normalizeTarget(rawData);
    state.received_count++;
    state.last_message_at = new Date().toISOString();
    state.last_event_name = eventName;

    const key = buildTargetKey(target);
    if (key === state.currentKey) {
        broadcastSSE({ type: "heartbeat", state });
        return;
    }

    state.current = target;
    state.currentKey = key;

    const historyEntry = {
        ...target,
        event_name: eventName,
        observed_at: new Date().toISOString(),
    };

    addHistory(historyEntry);
    broadcastSSE({ type: "target", state });

    try {
        const text = await updateVmix(target);
        console.log(`[VMIX-BRIDGE] Updated vMix: ${text}`);
        broadcastSSE({ type: "vmix_updated", state });
    } catch (error) {
        state.last_vmix_error = String(error && error.message ? error.message : error);
        console.error("[VMIX-BRIDGE] Update failed:", state.last_vmix_error);
        broadcastSSE({ type: "vmix_error", state });
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
            last_message_at: state.last_message_at,
            last_vmix_text: state.last_vmix_text,
            last_vmix_error: state.last_vmix_error,
        });
        return;
    }

    if (pathname === "/state" && req.method === "GET") {
        sendJson(res, 200, {
            state,
        });
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
                config.vmix = { ...config.vmix, ...update.vmix };
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

    if (pathname === "/test-vmix" && req.method === "POST") {
        const sample = state.current || {
            spectated_name: "SampleTarget",
            player_name: "SampleTarget",
            hero_name: "",
            team: "amber",
            timestamp: new Date().toISOString(),
        };

        try {
            const text = await updateVmix(sample);
            broadcastSSE({ type: "vmix_test", text, state });
            sendJson(res, 200, { status: "sent", text, sample });
        } catch (error) {
            state.last_vmix_error = String(error && error.message ? error.message : error);
            sendJson(res, 400, { status: "error", error: state.last_vmix_error, sample });
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
        res.write(`data: ${JSON.stringify({ type: "hello", config, state })}\n\n`);
        req.on("close", () => sseClients.delete(res));
        return;
    }

    if (req.method === "GET" && serveStatic(req, res, pathname)) {
        return;
    }

    sendJson(res, 404, {
        error: "Not found",
        endpoints: ["/health", "/state", "/config", "/test-vmix", "/stream"],
    });
});

server.listen(cli.port, async () => {
    console.log(`[VMIX-BRIDGE] UI listening on http://localhost:${cli.port}`);
    await connectAbly();
});
