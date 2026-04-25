# vMix Bridge

Local subscriber app for the **caster** PC.

It subscribes to the Ably Pub/Sub channel, tracks usernames seen in the current game, and routes mapped usernames into local vMix using the vMix HTTP API.

## Research summary

### What vMix exposes
Verified from the vMix documentation:

- **HTTP Web API** on `http://127.0.0.1:8088/API`
- **VB.NET scripting API** where:
  ```vb
  API.Function(functionName As String, Optional input As String = "", Optional value As String = "", Optional duration As Integer = 0, Optional selectedName As String = "", Optional selectedIndex As Integer = 0)
  ```
  maps directly to the Web API shortcut function call.

### Relevant shortcut behavior
The shortcut reference documents:

- `SetLayer` — change a layer in an input according to `Value`
- `SetMultiViewOverlay` — similar behavior for multiview overlays

The official shortcut reference documents `SetLayer` as taking a raw `Value` parameter and gives an example of `1,2` to change Layer1 to Input2.

For this project, production has already validated a working pattern of the form:

```vb
API.Function("SetLayer", Input:="67", Value:="100")
```

So the bridge sends the configured mapping **value** raw to vMix, unchanged. That means:
- if your production works with `100`, enter `100`
- if a specific vMix input later requires `1,100`, enter `1,100`

## Roles

- **developer**: owns the Ably account/app
- **observer**: runs the Deadlock relay and publishes target changes
- **caster**: runs this bridge on the vMix machine and subscribes to updates

## Features

- subscribes to Ably updates
- keeps a live list of **available usernames** seen in the current game
- provides a **12-row mapping table** for `username -> raw vMix value -> nickname input`
- colors mapping rows by known Sapphire/Amber team
- supports an **unmapped fallback value** so unmapped players do not leave vMix on the previous mapped camera
- optionally sends a second live `SetText` nickname call to a separate vMix input/field
- sends per-row nickname `SetText` calls to configured input numbers when rows are edited, with a resend-all button
- lets the caster **clear available usernames** when a new game starts
- sends mapped values to vMix using the configured function and static input
- shows incoming events and current routing state in a local UI

## Files

```text
bridge.js              # subscriber + local UI server
helpers.js             # helper functions
helpers.test.js        # tests
config.example.json    # committed blank/default template
config.json            # local settings, ignored by git
public/
  index.html           # settings and event viewer UI
  app.js
  style.css
```

## Configure

Use the local UI, or copy `config.example.json` to local-only `config.json` and edit it.

`config.json` is intentionally ignored by git so production settings and Ably keys are not wiped by future code pulls or committed by accident.

```json
{
  "ably": {
    "apiKey": "YOUR_SUBSCRIBE_KEY",
    "channel": "deadlock.spectated-target",
    "clientId": "caster-vmix-bridge"
  },
  "vmix": {
    "baseUrl": "http://127.0.0.1:8088/API",
    "functionName": "SetLayer",
    "input": "67",
    "unmappedValue": "0",
    "nickname": {
      "enabled": true,
      "baseUrl": "",
      "input": "86",
      "selectedName": "Nickname.Text"
    },
    "mappings": [
      { "username": "PlayerOne", "value": "100", "nicknameInput": "86" },
      { "username": "PlayerTwo", "value": "101", "nicknameInput": "87" }
    ]
  }
}
```

## UI

Start the bridge:

```bash
npm install
npm test
npm start
```

Open:

```text
http://localhost:5015
```

The local UI lets the caster:
- modify Ably settings
- modify vMix settings
- edit the 12-row username/value/nickname-input mapping table with searchable username inputs and per-row choose dropdowns
- set an unmapped fallback value for players without mapping rows
- enable a second live nickname `SetText` call for a separate input/field
- configure per-row nickname inputs and send them individually on edit or all at once with a button
- see connection status
- view incoming events/history
- view the available usernames in the current game
- clear those usernames when a new game starts
- preview the exact `API.Function(...)` style call
- manually test the current mapped vMix call

## Settings persistence

Primary persistence is server-side local `config.json`, written by `POST /config` when you click **Save and reconnect**.

The UI also keeps a best-effort browser `localStorage` backup of the config form. If local `config.json` is missing or blank, the page restores the browser backup into the form and shows a message telling you to click **Save and reconnect**. This protects against accidental file resets and UI/browser crashes.

Note: the browser backup includes the Ably key because it is intended as a local recovery copy on the caster PC. Rotate keys if they were shared or exposed.

## How mapping works

1. Observer relay publishes spectator changes to Ably
2. Bridge receives the current `spectated_name`
3. Bridge adds that name to the **available usernames** list if it is new
4. Bridge looks for an exact username match in the mapping table
5. If found and the mapping row has a value, it calls vMix with that value
6. If not found and `unmappedValue` is set, it calls vMix with the fallback value instead

Mapped and fallback calls both use:

```text
http://127.0.0.1:8088/API/?Function=<functionName>&Input=<staticInput>&Value=<mappedValue>
```

Example:

```text
http://127.0.0.1:8088/API/?Function=SetLayer&Input=67&Value=100
```

Set `unmappedValue` to a safe blank/default camera value, for example `0` or whatever your vMix preset uses. Leave it blank only if unmapped players should send no command.

If nickname output is enabled, each target change also sends:

```text
http://127.0.0.1:8088/API/?Function=SetText&Input=<nicknameInput>&SelectedName=<nicknameField>&Value=<spectatedName>
```

Example:

```text
http://127.0.0.1:8088/API/?Function=SetText&Input=86&SelectedName=Nickname.Text&Value=EXAMPLE
```

The nickname value is URL-encoded with `URLSearchParams`, so spaces, quotes, symbols, and Russian characters are safe.

## Per-row nickname inputs

Each mapping row has a **Nickname input** column. If a row has both a username and nickname input, the UI sends this call after row edits settle:

```text
http://127.0.0.1:8088/API/?Function=SetText&Input=<rowNicknameInput>&SelectedName=Nickname.Text&Value=<rowUsername>
```

Example:

```text
http://127.0.0.1:8088/API/?Function=SetText&Input=86&SelectedName=Nickname.Text&Value=EXAMPLE
```

Rows are colored by the known team of the selected username:

- sapphire row background for Sapphire players
- amber row background for Amber players

Use **Send all row nicknames** to resend every row with both a username and nickname input.

## Example flow

1. Current spectated player becomes `B3AN`
2. `B3AN` appears in Available usernames
3. Caster maps:
   - `B3AN -> 100`
4. Next time `B3AN` is spectated, bridge sends:
   - `API.Function("SetLayer", Input:="67", Value:="100")`

## API endpoints

- `GET /health`
- `GET /state`
- `GET /config`
- `POST /config`
- `POST /clear-available-usernames`
- `POST /test-vmix`
- `POST /test-nickname`
- `GET /stream`
