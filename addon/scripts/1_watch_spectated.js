"use strict";

var SPEC_POLL_INTERVAL = 0.20;
var SPEC_LastTargetKey = "";

function SPEC_StripHtml(text) {
    if (!text) return "";
    return ("" + text).replace(/<[^>]*>/g, "").trim();
}

function SPEC_SafeText(panel) {
    if (panel && panel.text) return SPEC_StripHtml(panel.text);
    return "";
}

function SPEC_TitleCase(text) {
    if (!text) return "";
    return text.replace(/\b[a-z]/g, function(match) {
        return match.toUpperCase();
    });
}

function SPEC_NormalizeHeroName(heroName) {
    var hero = SPEC_StripHtml(heroName);
    if (!hero) return "";

    hero = hero.replace(/^npc_dota_hero_/, "");
    hero = hero.replace(/^citadel_hero_/, "");
    hero = hero.replace(/^hero_/, "");
    hero = hero.replace(/^citadel_/, "");
    hero = hero.replace(/[\/_-]+/g, " ");
    hero = hero.replace(/\s+/g, " ").trim();

    return SPEC_TitleCase(hero);
}

function SPEC_ReadPlayerIdentity(panel) {
    if (!panel) return null;

    var dataLabel = panel.FindChildTraverse("SPEC_PlayerData");
    if (!dataLabel) return null;

    var parts = SPEC_SafeText(dataLabel).split("|");
    var playerName = parts.length > 0 ? SPEC_StripHtml(parts[0]) : "";
    var heroName = parts.length > 1 ? SPEC_NormalizeHeroName(parts[1]) : "";
    var spectatedName = playerName || heroName || "unknown";

    return {
        spectated_name: spectatedName,
        player_name: playerName,
        hero_name: heroName
    };
}

function SPEC_FindCurrentTarget() {
    var containers = [
        { ref: SPEC_AmberContainer, team: "amber" },
        { ref: SPEC_SapphireContainer, team: "sapphire" }
    ];

    for (var c = 0; c < containers.length; c++) {
        if (!containers[c].ref) continue;

        var children = containers[c].ref.Children();
        for (var i = 0; i < children.length; i++) {
            var panel = children[i];
            if (!panel || !panel.BHasClass || !panel.BHasClass("SpectatorTarget")) continue;

            var identity = SPEC_ReadPlayerIdentity(panel);
            if (!identity) continue;

            identity.team = containers[c].team;
            return identity;
        }
    }

    return null;
}

function SPEC_EmitTarget(target) {
    $.Msg("[SPEC_Target]" + JSON.stringify(target));
}

function SPEC_WatchLoop() {
    try {
        if (!SPEC_MATCH_READY) {
            $.Schedule(1.0, SPEC_WatchLoop);
            return;
        }

        var target = SPEC_FindCurrentTarget();
        var targetKey = target
            ? [target.team, target.spectated_name, target.player_name, target.hero_name].join("|")
            : "";

        if (target && targetKey !== SPEC_LastTargetKey) {
            SPEC_LastTargetKey = targetKey;
            SPEC_EmitTarget(target);
        }
    } catch (e) {
        SPEC_Error("WatchLoop crashed: " + e);
    }

    $.Schedule(SPEC_POLL_INTERVAL, SPEC_WatchLoop);
}

SPEC_WatchLoop();
