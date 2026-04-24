"use strict";

const MAPPING_SLOTS = 12;

function loadJson(fs, filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function buildDefaultMappings() {
    return Array.from({ length: MAPPING_SLOTS }, () => ({ username: "", value: "" }));
}

function buildTargetKey(target) {
    return [
        target && target.team || "",
        target && target.spectated_name || "",
        target && target.player_name || "",
        target && target.hero_name || "",
    ].join("|");
}

function normalizeTarget(target) {
    const raw = target || {};
    return {
        spectated_name: typeof raw.spectated_name === "string"
            ? raw.spectated_name
            : (typeof raw.player_name === "string" && raw.player_name)
                || (typeof raw.hero_name === "string" && raw.hero_name)
                || "unknown",
        player_name: typeof raw.player_name === "string" ? raw.player_name : "",
        hero_name: typeof raw.hero_name === "string" ? raw.hero_name : "",
        team: typeof raw.team === "string" ? raw.team : "",
        timestamp: typeof raw.timestamp === "string" ? raw.timestamp : new Date().toISOString(),
    };
}

function normalizeMappings(mappings) {
    const normalized = buildDefaultMappings();
    const source = Array.isArray(mappings) ? mappings : [];

    for (let i = 0; i < Math.min(source.length, normalized.length); i++) {
        const row = source[i] || {};
        normalized[i] = {
            username: typeof row.username === "string" ? row.username : "",
            value: typeof row.value === "string" ? row.value : "",
        };
    }

    return normalized;
}

function normalizeName(value) {
    return String(value || "").trim().toLocaleLowerCase();
}

function findMappingForTarget(mappings, target) {
    const normalized = normalizeMappings(mappings);
    const name = normalizeName(target && target.spectated_name);
    if (!name) return null;

    for (let i = 0; i < normalized.length; i++) {
        if (normalizeName(normalized[i].username) === name) {
            return {
                rowIndex: i,
                username: normalized[i].username,
                value: normalized[i].value,
            };
        }
    }

    return null;
}

function addAvailableUsername(list, target) {
    const next = Array.isArray(list) ? list.slice() : [];
    const candidate = String((target && (target.player_name || target.spectated_name || target.hero_name)) || "").trim();
    if (!candidate) return next;

    const key = normalizeName(candidate);
    const already = next.some((item) => normalizeName(item) === key);
    if (!already) next.push(candidate);
    return next;
}

function buildVmixCall(config, mappingValue) {
    const vmix = config.vmix || {};
    const functionName = String(vmix.functionName || "SetLayer").trim() || "SetLayer";
    const input = String(vmix.input || "").trim();
    const value = String(mappingValue || "").trim();

    if (!vmix.baseUrl || !input || !value) {
        throw new Error("vMix config is incomplete. baseUrl, input, and a mapped value are required.");
    }

    const url = new URL(vmix.baseUrl);
    url.searchParams.set("Function", functionName);
    url.searchParams.set("Input", input);
    url.searchParams.set("Value", value);

    return {
        functionName,
        input,
        value,
        url: url.toString(),
        scriptCall: `API.Function("${functionName}", Input:="${input}", Value:="${value}")`,
    };
}

module.exports = {
    MAPPING_SLOTS,
    loadJson,
    buildDefaultMappings,
    buildTargetKey,
    normalizeTarget,
    normalizeMappings,
    findMappingForTarget,
    addAvailableUsername,
    buildVmixCall,
};
