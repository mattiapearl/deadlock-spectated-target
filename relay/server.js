#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const Ably = require("ably");
const { parseSpecLine, buildTargetKey, buildOutboundPayload } = require("./parser.js");

const DEFAULT_PORT = 5010;
const CONFIG_PATH = path.join(__dirname, "config.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const DEFAULT_LOG_PATH = "C:/Program Files (x86)/Steam/steamapps/common/Deadlock/game/citadel/console.log";
const MAX_HISTORY = 30;
const MAX_SSE_CLIENTS = 20;

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = { port: DEFAULT_PORT, logPath: null, replay: false };

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--port" && args[i + 1]) opts.port = parseInt(args[++i], 10);
        else if (args[i] === "--log" && args[i + 1]) opts.logPath = args[++i];
        else if (args[i] === "--replay") opts.replay = true;
    }

    return opts;
}

function defaultConfig() {
    return {
        logPath: DEFAULT_LOG_PATH,
        destination: {
            enabled: false,
            type: "disabled",
            url: "",
            headers: {},
            ably: {
                apiKey: "",
                channel: "deadlock.spectated-target",
                clientId: "observer-relay",
            },
        },
    };
}

function loadConfig() {
    try {
        const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
        return {
            ...defaultConfig(),
            ...parsed,
            destination: {
                ...defaultConfig().destination,
                ...(parsed.destination || {}),
                ably: {
                    ...defaultConfig().destination.ably,
                    ...((parsed.destination && parsed.destination.ably) || {}),
                },
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
if (cli.logPath) config.logPath = cli.logPath;

const state = {
    current: null,
    currentKey: "",
    history: [],
    lineCount: 0,
    matchCount: 0,
    forwardCount: 0,
    forwardErrorCount: 0,
    lastForwardError: null,
    lastUpdateMs: 0,
};

let filePos = 0;
let partialLine = "";
let watchDebounce = null;
let ablyRest = null;
let ablyRestKey = "";
const sseClients = new Set();

function getAblyRestClient() {
    const ablyCfg = config.destination && config.destination.ably ? config.destination.ably : {};
    const apiKey = (ablyCfg.apiKey || "").trim();
    if (!apiKey) throw new Error("Ably API key is empty");

    if (!ablyRest || ablyRestKey !== apiKey) {
        ablyRest = new Ably.Rest({ key: apiKey, clientId: ablyCfg.clientId || "observer-relay" });
        ablyRestKey = apiKey;
    }

    return ablyRest;
}

async function publishToAbly(target, reason) {
    const ablyCfg = config.destination && config.destination.ably ? config.destination.ably : {};
    const channelName = (ablyCfg.channel || "deadlock.spectated-target").trim();
    if (!channelName) throw new Error("Ably channel is empty");

    const client = getAblyRestClient();
    const channel = client.channels.get(channelName);
    const payload = {
        ...buildOutboundPayload(target),
        relay_reason: reason || "change",
        producer_role: "observer",
    };

    await channel.publish("spectated-target", payload);
}

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

function addHistory(target) {
    const entry = {
        ...target,
        observed_at: new Date().toISOString(),
    };

    state.history.unshift(entry);
    if (state.history.length > MAX_HISTORY) state.history.length = MAX_HISTORY;
}

async function forwardTarget(target, reason) {
    const destination = config.destination || {};
    if (!destination.enabled || destination.type === "disabled") return;

    const payload = buildOutboundPayload(target);
    const headers = {
        "Content-Type": "application/json",
        ...(destination.headers || {}),
    };

    try {
        if (destination.type === "ably_pubsub") {
            await publishToAbly(target, reason);
        } else {
            if (!destination.url) throw new Error("Destination URL is empty");

            const response = await fetch(destination.url, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    ...payload,
                    relay_reason: reason || "change",
                }),
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
            }
        }

        state.forwardCount++;
        state.lastForwardError = null;
        console.log(`[RELAY] Forwarded target to ${destination.type || "post"}: ${target.spectated_name}`);
    } catch (error) {
        state.forwardErrorCount++;
        state.lastForwardError = String(error && error.message ? error.message : error);
        console.error("[RELAY] Forward failed:", state.lastForwardError);
    }
}

function processLine(line) {
    state.lineCount++;

    const target = parseSpecLine(line);
    if (!target) return;

    state.matchCount++;
    state.current = target;
    state.lastUpdateMs = Date.now();

    const key = buildTargetKey(target);
    if (key === state.currentKey) return;

    state.currentKey = key;
    addHistory(target);
    broadcastSSE({ type: "target", current: state.current, history: state.history });
    void forwardTarget(target, "change");
    console.log(`[RELAY] Target changed: ${target.spectated_name} (${target.team})`);
}

function readNewData() {
    let stat;
    try {
        stat = fs.statSync(config.logPath);
    } catch {
        return;
    }

    if (stat.size < filePos) {
        filePos = 0;
        partialLine = "";
    }

    if (stat.size <= filePos) return;

    const size = stat.size - filePos;
    const buffer = Buffer.alloc(size);
    const fd = fs.openSync(config.logPath, "r");
    fs.readSync(fd, buffer, 0, size, filePos);
    fs.closeSync(fd);
    filePos = stat.size;

    const text = partialLine + buffer.toString("utf8");
    const parts = text.split(/\r?\n/);
    partialLine = parts.pop() || "";

    for (const line of parts) {
        if (line) processLine(line);
    }
}

function startTail() {
    try {
        const stat = fs.statSync(config.logPath);
        filePos = cli.replay ? 0 : stat.size;
    } catch {
        filePos = 0;
    }

    if (cli.replay) {
        console.log("[RELAY] Replay mode: parsing existing log from the beginning");
    }

    readNewData();

    try {
        fs.watch(config.logPath, { persistent: true }, (eventType) => {
            if (eventType !== "change") return;
            if (watchDebounce) return;
            watchDebounce = setTimeout(() => {
                watchDebounce = null;
                readNewData();
            }, 5);
        });
    } catch (error) {
        console.error("[RELAY] fs.watch failed:", error.message);
    }

    setInterval(readNewData, 100);
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
            current_target: state.current,
            last_update_ago_sec: state.lastUpdateMs ? Math.round((Date.now() - state.lastUpdateMs) / 100) / 10 : null,
            lines_parsed: state.lineCount,
            target_lines_seen: state.matchCount,
            forwards_ok: state.forwardCount,
            forwards_failed: state.forwardErrorCount,
            last_forward_error: state.lastForwardError,
            log_path: config.logPath,
        });
        return;
    }

    if (pathname === "/current" && req.method === "GET") {
        sendJson(res, 200, {
            current: state.current,
            history: state.history,
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

            if (typeof update.logPath === "string" && update.logPath.trim()) {
                config.logPath = update.logPath.trim();
                filePos = 0;
                partialLine = "";
            }

            if (update.destination && typeof update.destination === "object") {
                config.destination = {
                    ...config.destination,
                    ...update.destination,
                    headers: update.destination.headers && typeof update.destination.headers === "object"
                        ? update.destination.headers
                        : config.destination.headers,
                    ably: update.destination.ably && typeof update.destination.ably === "object"
                        ? { ...config.destination.ably, ...update.destination.ably }
                        : config.destination.ably,
                };
            }

            saveConfig(config);
            broadcastSSE({ type: "config", config });
            sendJson(res, 200, { status: "saved", config });
        } catch (error) {
            sendJson(res, 400, { error: String(error && error.message ? error.message : error) });
        }
        return;
    }

    if (pathname === "/test-send" && req.method === "POST") {
        const sample = state.current || {
            spectated_name: "SampleTarget",
            player_name: "SampleTarget",
            hero_name: "",
            team: "amber",
        };

        await forwardTarget(sample, "manual_test");
        sendJson(res, 200, {
            status: state.lastForwardError ? "error" : "sent",
            last_forward_error: state.lastForwardError,
            sample,
        });
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
        res.write(`data: ${JSON.stringify({ type: "hello", current: state.current, history: state.history, config })}\n\n`);
        req.on("close", () => sseClients.delete(res));
        return;
    }

    if (req.method === "GET" && serveStatic(req, res, pathname)) {
        return;
    }

    sendJson(res, 404, {
        error: "Not found",
        endpoints: ["/health", "/current", "/config", "/test-send", "/stream"],
    });
});

server.listen(cli.port, () => {
    console.log(`[RELAY] Listening on http://localhost:${cli.port}`);
    console.log(`[RELAY] Tailing: ${config.logPath}`);
    startTail();
});
