# vMix Bridge

Local subscriber app for the **caster** PC.

It subscribes to the Ably Pub/Sub channel and writes the current spectated target into local vMix using the vMix HTTP API on `127.0.0.1:8088`.

## Roles

- **developer**: owns the Ably account/app
- **observer**: runs the Deadlock relay and publishes target changes
- **caster**: runs this bridge on the vMix machine and subscribes to updates

## Security recommendation

Use separate Ably credentials:
- observer relay: **publish-only** key/capability
- caster bridge: **subscribe-only** key/capability

## Files

```text
bridge.js              # subscriber + local UI server
helpers.js             # helper functions
helpers.test.js        # tests
config.json            # local settings
public/
  index.html           # settings and event viewer UI
  app.js
  style.css
```

## Configure

Edit `config.json`:

```json
{
  "ably": {
    "apiKey": "YOUR_SUBSCRIBE_KEY",
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

## UI

Start the bridge:

```bash
npm install
npm test
npm start
```

Open:

```text
http://localhost:5011
```

The local UI lets the caster:
- modify Ably settings
- modify vMix target field settings
- see connection status
- view incoming events/history
- preview the text that will be sent to vMix
- manually test a vMix write

## vMix notes

Uses:
- `Function=SetText`
- `Input=<title input>`
- `SelectedName=<field>`
- `Value=<text>`

For GT titles, `selectedName` usually ends in `.Text`, for example:
- `Headline.Text`
- `PlayerName.Text`

## Example flow

1. Observer relay publishes `B3AN` to Ably channel `deadlock.spectated-target`
2. Bridge receives the event
3. Bridge converts it using `textTemplate`, for example:
   - `{spectated_name}` -> `B3AN`
   - `Spectating: {spectated_name}` -> `Spectating: B3AN`
4. Bridge calls local vMix API and updates the chosen title field

## Expected logs

- `[VMIX-BRIDGE] UI listening on http://localhost:5011`
- `[VMIX-BRIDGE] Connected to Ably`
- `[VMIX-BRIDGE] Subscribed to channel: deadlock.spectated-target`
- `[VMIX-BRIDGE] Updated vMix: B3AN`
