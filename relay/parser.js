"use strict";

const SPEC_TAG = "[SPEC_Target]";

function normalizeTarget(raw) {
    if (!raw || typeof raw !== "object") return null;

    const target = {
        spectated_name: typeof raw.spectated_name === "string" ? raw.spectated_name : "",
        player_name: typeof raw.player_name === "string" ? raw.player_name : "",
        hero_name: typeof raw.hero_name === "string" ? raw.hero_name : "",
        team: typeof raw.team === "string" ? raw.team : "",
    };

    if (!target.spectated_name) {
        target.spectated_name = target.player_name || target.hero_name || "unknown";
    }

    return target;
}

function parseSpecLine(line) {
    if (!line || typeof line !== "string") return null;

    const tagIndex = line.indexOf(SPEC_TAG);
    if (tagIndex === -1) return null;

    const jsonText = line.slice(tagIndex + SPEC_TAG.length).trim();
    if (!jsonText) return null;

    try {
        return normalizeTarget(JSON.parse(jsonText));
    } catch {
        return null;
    }
}

function buildTargetKey(target) {
    if (!target) return "";
    return [
        target.team || "",
        target.spectated_name || "",
        target.player_name || "",
        target.hero_name || "",
    ].join("|");
}

function buildOutboundPayload(target) {
    const normalized = normalizeTarget(target);
    if (!normalized) return null;

    return {
        source: "deadlock-spectated-target",
        spectated_name: normalized.spectated_name,
        player_name: normalized.player_name,
        hero_name: normalized.hero_name,
        team: normalized.team,
        timestamp: new Date().toISOString(),
    };
}

module.exports = {
    SPEC_TAG,
    normalizeTarget,
    parseSpecLine,
    buildTargetKey,
    buildOutboundPayload,
};
