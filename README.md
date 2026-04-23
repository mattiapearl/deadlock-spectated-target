# Deadlock Spectated Target

Minimal Deadlock spectator pipeline for one job only:
- detect who is currently being spectated in Deadlock
- relay that value
- optionally forward it to Ably or another HTTP destination
- let the caster's vMix machine receive and render that text

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
  config.json
  public/
    index.html
    app.js
    style.css
vmix-bridge/
  bridge.js
  helpers.js
  helpers.test.js
  config.json
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

In the relay UI or `relay/config.json`:

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

The vMix bridge subscribes to Ably, exposes a small local UI, and writes the current target into local vMix.

### Install and run

```bash
cd vmix-bridge
npm install
npm test
npm start
```

Open:

```text
http://localhost:5011
```

### Bridge features

- subscribes to Ably channel updates
- writes to local vMix via `SetText`
- local UI to modify settings
- shows connection status
- shows incoming events and history
- previews output text
- has a manual `Test vMix write` action

### Caster config

In `vmix-bridge/config.json`:

```json
{
  "ably": {
    "apiKey": "CASTER_SUBSCRIBE_KEY",
    "channel": "deadlock.spectated-target",
    "clientId": "caster-vmix-bridge"
  },
  "vmix": {
    "baseUrl": "http://127.0.0.1:8088/API",
    "input": "YOUR_TITLE_INPUT_NAME_OR_GUID",
    "selectedName": "Headline.Text",
    "textTemplate": "{spectated_name}"
  }
}
```

### vMix notes

The bridge calls:

```text
http://127.0.0.1:8088/API/?Function=SetText&Input=<input>&SelectedName=<field>&Value=<text>
```

For GT titles, `selectedName` usually ends in `.Text`, for example:
- `Headline.Text`
- `PlayerName.Text`

## End-to-end flow

1. Observer spectates in Deadlock
2. Addon emits `[SPEC_Target]...`
3. Relay parses and publishes to Ably
4. Caster bridge receives the update
5. Caster bridge updates local vMix text field

## Notes

- Hero name is currently empty in live testing; player name is the primary signal.
- The relay only forwards **new** target changes unless started with `--replay`.
- Do not commit real Ably keys. Keep committed config files blank/default and fill secrets locally.
