"use strict";

function loadJson(fs, filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function applyTemplate(template, target) {
    const data = target || {};
    return String(template || "{spectated_name}").replace(/\{(\w+)\}/g, (_, key) => {
        const value = data[key];
        return value == null ? "" : String(value);
    });
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
        spectated_name: typeof raw.spectated_name === "string" ? raw.spectated_name : (typeof raw.player_name === "string" && raw.player_name) || (typeof raw.hero_name === "string" && raw.hero_name) || "unknown",
        player_name: typeof raw.player_name === "string" ? raw.player_name : "",
        hero_name: typeof raw.hero_name === "string" ? raw.hero_name : "",
        team: typeof raw.team === "string" ? raw.team : "",
        timestamp: typeof raw.timestamp === "string" ? raw.timestamp : new Date().toISOString(),
    };
}

function buildVmixUrl(config, target) {
    const vmix = config.vmix || {};
    if (!vmix.baseUrl || !vmix.input || !vmix.selectedName) {
        throw new Error("vMix config is incomplete. baseUrl, input, and selectedName are required.");
    }

    const text = applyTemplate(vmix.textTemplate || "{spectated_name}", target);
    const url = new URL(vmix.baseUrl);
    url.searchParams.set("Function", "SetText");
    url.searchParams.set("Input", vmix.input);
    url.searchParams.set("SelectedName", vmix.selectedName);
    url.searchParams.set("Value", text);

    return { url: url.toString(), text };
}

module.exports = {
    loadJson,
    applyTemplate,
    buildTargetKey,
    normalizeTarget,
    buildVmixUrl,
};
