# Decisions

## 2026-04-23

- This project is separate from MEX/MEXR and does not modify those addons or relays.
- The addon only emits the currently spectated target from TopBar using the `SpectatorTarget` class.
- Emitted log tag is `[SPEC_Target]`.
- Current payload shape:
  - `spectated_name`
  - `player_name`
  - `hero_name`
  - `team`
- Hero name binding is currently empty in live testing, but that is acceptable for now because player name is working.
- Relay is intentionally minimal and destination-agnostic:
  - generic webhook / HTTP POST
  - Google Apps Script / Sheets via POST URL
  - Ably Pub/Sub for internet-safe low-latency transport
  - no direct Google Docs integration in the relay itself
- Relay UI should stay simple: current target, destination config, test send.
- Final role split for the Ably workflow:
  - developer = Ably account/app owner
  - observer = publishes spectated target changes
  - caster = subscribes on the vMix PC and writes to local vMix API
- vMix bridge behavior changed from direct text writes to raw shortcut-function routing.
- vMix docs confirmed:
  - `API.Function(functionName, input, value, ...)` maps directly to the HTTP Web API shortcut call.
  - `SetLayer` is a shortcut function documented in the shortcut reference.
- Because production has a validated pattern like `API.Function("SetLayer", Input:="67", Value:="100")`, the bridge sends the mapping value raw and does not transform it.
- The caster workflow now centers on:
  - tracking available usernames in the current game
  - maintaining a 12-row username-to-value table
  - clearing available usernames when a new game starts
- Local runtime settings now live in ignored `config.json` files with committed `config.example.json` templates to avoid wiping real setups during code updates.
- The vMix bridge UI keeps a browser localStorage backup of its config form and restores it if the server-side config is missing or blank.
