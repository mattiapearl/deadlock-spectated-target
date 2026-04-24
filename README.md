# Deadlock Spectated Target

Minimal Deadlock spectator pipeline for one job only:
- detect who is currently being spectated in Deadlock
- relay that value
- optionally forward it to Ably or another HTTP destination
- let the caster's vMix machine receive that target and drive vMix

## Project structure

```text
addon/
  layout/
    citadel_hud_top_bar.xml
    citadel_hud_top_bar_player.xml
  scripts/
    0_wait_for_match.js
    1_watch_spectated.js
  deploy.sh
relay/
  server.js
  parser.js
  parser.test.js
  config.example.json
  config.json         # local only, ignored by git after first save/copy
  public/
    index.html
    app.js
    style.css
vmix-bridge/
  bridge.js
  helpers.js
  helpers.test.js
  config.example.json
  config.json         # local only, ignored by git after first save/copy
  README.md
  public/
    index.html
    app.js
    style.css
DECISIONS.md
```

## Roles

- **developer**: owns the codebase and the Ably app/account
- **observer**: runs the Deadlock addon + relay and publishes target changes
- **caster**: runs the vMix bridge on the vMix PC and subscribes to those changes

## 1. Addon

The addon overrides the spectator TopBar and emits lines like:

```text
[PanoramaScript] [SPEC_Target]{"spectated_name":"B3AN","player_name":"B3AN","hero_name":"","team":"amber"}
```

### Files

```text
addon/
  layout/
    citadel_hud_top_bar.xml
    citadel_hud_top_bar_player.xml
  scripts/
    0_wait_for_match.js
    1_watch_spectated.js
  deploy.sh
```

### Deploy

```bash
cd addon
bash deploy.sh
```

Then:
1. Open CSDK 12
2. Select addon `spectatedtarget`
3. Compile
4. Copy the generated VPK into Deadlock's `game/citadel/addons/`
5. Launch Deadlock with `-dev -condebug`

### Verify

Watch:

```text
C:\Program Files (x86)\Steam\steamapps\common\Deadlock\game\citadel\console.log
```

Expected:
- `[SPEC_Log] ...` startup messages
- `[SPEC_Target]...` whenever the spectated player changes

## 2. Relay (observer PC)

The relay tails Deadlock `console.log`, parses `[SPEC_Target]...`, shows a local UI, and forwards updates.

### Install and run

```bash
cd relay
npm install
npm test
npm start
```

Open:

```text
http://localhost:5010
```

### Relay features

- tails Deadlock `console.log`
- parses `[SPEC_Target]...`
- shows current and recent spectated targets
- local UI with live updates via SSE
- supports generic HTTP destinations
- supports **Ably Pub/Sub** for the three-person workflow

### Relay API

- `GET /health`
- `GET /current`
- `GET /config`
- `POST /config`
- `POST /test-send`
- `GET /stream`

## 3. Ably setup

Use **Pub/Sub**.

Recommended channel:

```text
deadlock.spectated-target
```

Recommended keys:
- `observer-publish` -> publish only
- `caster-subscribe` -> subscribe only

The observer relay publishes to Ably.
The caster bridge subscribes from Ably.

### Observer relay Ably config

Use the relay UI, or copy `relay/config.example.json` to local-only `relay/config.json` and edit it:

```json
{
  "logPath": "C:/Program Files (x86)/Steam/steamapps/common/Deadlock/game/citadel/console.log",
  "destination": {
    "enabled": true,
    "type": "ably_pubsub",
    "url": "",
    "headers": {},
    "ably": {
      "apiKey": "OBSERVER_PUBLISH_KEY",
      "channel": "deadlock.spectated-target",
      "clientId": "observer-relay"
    }
  }
}
```

## 4. vMix bridge (caster PC)

The vMix bridge subscribes to Ably, exposes a small local UI, tracks usernames seen in the current game, and routes matched usernames into local vMix using a raw `SetLayer`-style shortcut call.

### Install and run

```bash
cd vmix-bridge
npm install
npm test
npm start
```

Open:

```text
http://localhost:5015
```

### Bridge features

- subscribes to Ably channel updates
- keeps a live list of usernames seen in the current game
- provides a 12-row `username -> value` mapping table with searchable username inputs and choose dropdowns
- clears available usernames for a new game with one click
- writes to local vMix via a configured shortcut function such as `SetLayer`
- local UI to modify settings
- shows connection status
- shows incoming events and history
- previews the exact `API.Function(...)` style call
- has a manual `Test current mapping` action

### Caster config

Use the vMix bridge UI, or copy `vmix-bridge/config.example.json` to local-only `vmix-bridge/config.json` and edit it:

```json
{
  "ably": {
    "apiKey": "CASTER_SUBSCRIBE_KEY",
    "channel": "deadlock.spectated-target",
    "clientId": "caster-vmix-bridge"
  },
  "vmix": {
    "baseUrl": "http://127.0.0.1:8088/API",
    "functionName": "SetLayer",
    "input": "67",
    "mappings": [
      { "username": "PlayerOne", "value": "100" },
      { "username": "PlayerTwo", "value": "101" }
    ]
  }
}
```

### vMix notes

Verified from the vMix docs:
- `API.Function(functionName, input, value, ...)` maps to the HTTP Web API shortcut function call
- the shortcut reference documents `SetLayer` as a shortcut function that changes a layer in an input according to `Value`

The bridge calls:

```text
http://127.0.0.1:8088/API/?Function=<functionName>&Input=<staticInput>&Value=<mappedValue>
```

Production-specific example:

```text
http://127.0.0.1:8088/API/?Function=SetLayer&Input=67&Value=100
```

The mapping value is sent raw. So if your production wants `100`, enter `100`. If a particular vMix input later expects something like `1,100`, enter exactly that string in the mapping table.

## Settings persistence

- `relay/config.json` and `vmix-bridge/config.json` are now local-only and ignored by git so pulls/commits do not wipe production settings.
- Use `config.example.json` as the committed template.
- The vMix bridge UI also keeps a best-effort browser `localStorage` backup of the config form. If `config.json` is missing or blank, the UI restores the browser backup into the form and tells you to click **Save and reconnect** to write it back.

## End-to-end flow

1. Observer spectates in Deadlock
2. Addon emits `[SPEC_Target]...`
3. Relay parses and publishes to Ably
4. Caster bridge receives the update
5. Caster bridge matches the current username to a configured value
6. Caster bridge calls local vMix with that mapped value

## Notes

- Hero name is currently empty in live testing; player name is the primary signal.
- The relay only forwards **new** target changes unless started with `--replay`.
- Do not commit real Ably keys. Keep local `config.json` files private; committed `config.example.json` files stay blank/default.
