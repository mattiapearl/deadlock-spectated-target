"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { applyTemplate, buildTargetKey, normalizeTarget, buildVmixUrl } = require("./helpers.js");

test("applyTemplate substitutes target fields", () => {
    const text = applyTemplate("Now spectating: {spectated_name} [{team}]", {
        spectated_name: "B3AN",
        team: "amber",
    });

    assert.equal(text, "Now spectating: B3AN [amber]");
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

test("buildVmixUrl creates SetText request", () => {
    const built = buildVmixUrl({
        vmix: {
            baseUrl: "http://127.0.0.1:8088/API",
            input: "Title1",
            selectedName: "Headline.Text",
            textTemplate: "{spectated_name}",
        },
    }, {
        spectated_name: "B3AN",
    });

    assert.equal(built.text, "B3AN");
    assert.match(built.url, /Function=SetText/);
    assert.match(built.url, /Input=Title1/);
    assert.match(built.url, /SelectedName=Headline.Text/);
    assert.match(built.url, /Value=B3AN/);
});
