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
