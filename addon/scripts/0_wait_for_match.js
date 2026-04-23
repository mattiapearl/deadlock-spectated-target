"use strict";

var SPEC_MATCH_READY = false;
var SPEC_TopBar = null;
var SPEC_AmberContainer = null;
var SPEC_SapphireContainer = null;

function SPEC_Log(message) {
    $.Msg("[SPEC_Log] " + message);
}

function SPEC_Error(message) {
    $.Msg("[SPEC_Error] " + message);
}

(function WaitForMatch() {
    try {
        SPEC_TopBar = $.GetContextPanel();
        SPEC_Log("Script loaded. Context panel: " + (SPEC_TopBar ? SPEC_TopBar.paneltype : "null"));

        if (!SPEC_TopBar) {
            $.Schedule(1.0, WaitForMatch);
            return;
        }

        var teamFriendly = SPEC_TopBar.FindChildTraverse("TeamFriendly");
        var teamEnemy = SPEC_TopBar.FindChildTraverse("TeamEnemy");

        if (!teamFriendly || !teamEnemy) {
            SPEC_Log("Waiting for TeamFriendly / TeamEnemy...");
            $.Schedule(1.0, WaitForMatch);
            return;
        }

        SPEC_AmberContainer = teamFriendly.FindChildTraverse("PlayersContainer");
        SPEC_SapphireContainer = teamEnemy.FindChildTraverse("PlayersContainer");

        if (!SPEC_AmberContainer || !SPEC_SapphireContainer) {
            var friendlyChildren = teamFriendly.Children();
            var enemyChildren = teamEnemy.Children();
            var i;

            for (i = 0; i < friendlyChildren.length; i++) {
                if (friendlyChildren[i] && friendlyChildren[i].Children && friendlyChildren[i].Children().length > 0) {
                    SPEC_AmberContainer = friendlyChildren[i];
                    break;
                }
            }

            for (i = 0; i < enemyChildren.length; i++) {
                if (enemyChildren[i] && enemyChildren[i].Children && enemyChildren[i].Children().length > 0) {
                    SPEC_SapphireContainer = enemyChildren[i];
                    break;
                }
            }
        }

        if (!SPEC_AmberContainer || !SPEC_SapphireContainer) {
            SPEC_Log("Waiting for player containers...");
            $.Schedule(1.0, WaitForMatch);
            return;
        }

        waitForPlayers();
    } catch (e) {
        SPEC_Error("WaitForMatch crashed: " + e);
        $.Schedule(2.0, WaitForMatch);
    }

    function waitForPlayers() {
        try {
            var amberPlayers = SPEC_AmberContainer.Children();
            var sapphirePlayers = SPEC_SapphireContainer.Children();
            var totalPlayers = amberPlayers.length + sapphirePlayers.length;

            if (totalPlayers < 2) {
                SPEC_Log("Waiting for players...");
                $.Schedule(1.0, waitForPlayers);
                return;
            }

            SPEC_MATCH_READY = true;
            SPEC_Log("Match ready! " + amberPlayers.length + "v" + sapphirePlayers.length);
        } catch (e) {
            SPEC_Error("waitForPlayers crashed: " + e);
            $.Schedule(2.0, waitForPlayers);
        }
    }
})();
