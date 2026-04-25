"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
    MAPPING_SLOTS,
    buildDefaultMappings,
    buildTargetKey,
    normalizeTarget,
    normalizeMappings,
    findMappingForTarget,
    addAvailableUsername,
    buildVmixCall,
    buildVmixNicknameCall,
    buildVmixRosterCalls,
} = require("./helpers.js");

test("buildDefaultMappings creates 12 empty rows", () => {
    const mappings = buildDefaultMappings();
    assert.equal(mappings.length, MAPPING_SLOTS);
    assert.deepEqual(mappings[0], { username: "", value: "", nicknameInput: "" });
});

test("buildTargetKey is stable", () => {
    assert.equal(
        buildTargetKey({ spectated_name: "B3AN", player_name: "B3AN", hero_name: "", team: "amber" }),
        "amber|B3AN|B3AN|"
    );
});

test("normalizeTarget falls back to available names", () => {
    const target = normalizeTarget({ player_name: "", hero_name: "Mirage", team: "sapphire" });
    assert.equal(target.spectated_name, "Mirage");
    assert.equal(target.team, "sapphire");
});

test("normalizeMappings pads and normalizes rows", () => {
    const mappings = normalizeMappings([{ username: "A", value: "100", nicknameInput: "86" }]);
    assert.equal(mappings.length, MAPPING_SLOTS);
    assert.deepEqual(mappings[0], { username: "A", value: "100", nicknameInput: "86" });
    assert.deepEqual(mappings[1], { username: "", value: "", nicknameInput: "" });
});

test("findMappingForTarget matches spectated name case-insensitively", () => {
    const mapping = findMappingForTarget([
        { username: "b3an", value: "100" },
        { username: "Other", value: "200" },
    ], { spectated_name: "B3AN" });

    assert.deepEqual(mapping, {
        rowIndex: 0,
        username: "b3an",
        value: "100",
        nicknameInput: "",
    });
});

test("addAvailableUsername deduplicates seen names", () => {
    let list = addAvailableUsername([], { spectated_name: "B3AN" });
    list = addAvailableUsername(list, { spectated_name: "b3an" });
    list = addAvailableUsername(list, { player_name: "Other" });
    assert.deepEqual(list, ["B3AN", "Other"]);
});

test("buildVmixNicknameCall creates encoded SetText request for unicode nicknames", () => {
    const built = buildVmixNicknameCall({
        vmix: {
            baseUrl: "http://127.0.0.1:8088/API",
            nickname: {
                input: "86",
                selectedName: "Nickname.Text",
            },
        },
    }, { spectated_name: "филяй филяй & \"quoted\"" });

    assert.equal(built.functionName, "SetText");
    assert.equal(built.input, "86");
    assert.equal(built.selectedName, "Nickname.Text");
    assert.equal(built.value, "филяй филяй & \"quoted\"");
    assert.match(built.url, /Function=SetText/);
    assert.match(built.url, /Input=86/);
    assert.match(built.url, /SelectedName=Nickname\.Text/);
    assert.equal(new URL(built.url).searchParams.get("Value"), "филяй филяй & \"quoted\"");
    assert.equal(built.scriptCall, 'API.Function("SetText", Input:="86", SelectedName:="Nickname.Text", Value:="филяй филяй & ""quoted""")');
});

test("buildVmixRosterCalls creates team split SetText calls and clears empty slots", () => {
    const calls = buildVmixRosterCalls({
        vmix: {
            baseUrl: "http://127.0.0.1:8088/API",
            roster: {
                sapphireInput: "90",
                amberInput: "91",
                selectedNameTemplate: "Player{index}.Text",
                maxPlayers: 2,
            },
        },
    }, {
        sapphire: ["Сапфир One"],
        amber: ["Amber One", "Amber Two"],
    });

    assert.equal(calls.length, 4);
    assert.equal(calls[0].input, "90");
    assert.equal(calls[0].selectedName, "Player1.Text");
    assert.equal(calls[0].value, "Сапфир One");
    assert.equal(new URL(calls[0].url).searchParams.get("Value"), "Сапфир One");
    assert.equal(calls[1].value, "");
    assert.equal(calls[2].input, "91");
    assert.equal(calls[3].value, "Amber Two");
});

test("buildVmixCall creates SetLayer request and script syntax", () => {
    const built = buildVmixCall({
        vmix: {
            baseUrl: "http://127.0.0.1:8088/API",
            functionName: "SetLayer",
            input: "67",
        },
    }, "100");

    assert.equal(built.functionName, "SetLayer");
    assert.equal(built.input, "67");
    assert.equal(built.value, "100");
    assert.match(built.url, /Function=SetLayer/);
    assert.match(built.url, /Input=67/);
    assert.match(built.url, /Value=100/);
    assert.equal(built.scriptCall, 'API.Function("SetLayer", Input:="67", Value:="100")');
});
