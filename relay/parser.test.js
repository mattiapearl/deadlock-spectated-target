"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseSpecLine, buildTargetKey, buildOutboundPayload } = require("./parser.js");

test("parseSpecLine parses PanoramaScript log lines", () => {
    const line = '[PanoramaScript] [SPEC_Target]{"spectated_name":"B3AN","player_name":"B3AN","hero_name":"","team":"amber"}';
    const parsed = parseSpecLine(line);

    assert.deepEqual(parsed, {
        spectated_name: "B3AN",
        player_name: "B3AN",
        hero_name: "",
        team: "amber",
    });
});

test("parseSpecLine returns null for unrelated lines", () => {
    assert.equal(parseSpecLine("[Client] hello"), null);
});

test("parseSpecLine falls back to hero name when spectated_name is missing", () => {
    const line = '[SPEC_Target]{"player_name":"","hero_name":"Mirage","team":"sapphire"}';
    const parsed = parseSpecLine(line);

    assert.equal(parsed.spectated_name, "Mirage");
    assert.equal(parsed.hero_name, "Mirage");
    assert.equal(parsed.team, "sapphire");
});

test("buildTargetKey is stable", () => {
    const key = buildTargetKey({
        spectated_name: "B3AN",
        player_name: "B3AN",
        hero_name: "",
        team: "amber",
    });

    assert.equal(key, "amber|B3AN|B3AN|");
});

test("buildOutboundPayload adds standard relay metadata", () => {
    const payload = buildOutboundPayload({
        spectated_name: "B3AN",
        player_name: "B3AN",
        hero_name: "",
        team: "amber",
    });

    assert.equal(payload.source, "deadlock-spectated-target");
    assert.equal(payload.spectated_name, "B3AN");
    assert.equal(payload.team, "amber");
    assert.equal(typeof payload.timestamp, "string");
});
