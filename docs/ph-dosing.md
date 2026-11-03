# Dosing pH Up / pH Down

- Relay 3: pH Up. Relay 4: pH Down. Both use the existing Home Assistant mappings.
- Calibration is shared by app and web in `dosingPumps`: elapsed `seconds` and measured `ml`. The UI can accept minutes and converts them to seconds.
- Calculation: `doseSeconds = requestedMl / measuredMl * measuredSeconds`.
- Example: 150 ml over 60 minutes (3600 seconds), requesting 10 ml gives 240 seconds (4 minutes).
- Measurement duration accepts 0.5 seconds to 24 hours. An actual pH dose accepts 0.5 seconds to 60 minutes. Manual relay tests still stop after 3 seconds; AB mix still has its 60-second limit.

Authenticated, ownership-checked endpoints:

1. `POST /api/devices/:id/nutrients/ph/plan` with `{channel: "phUp" | "phDown", ml}` returns duration, calibration key, readiness and issues. This does not turn on a pump.
2. `POST /api/devices/:id/nutrients/ph/dose` with the same channel/ml plus `calibrationKey` and a unique `requestId` starts a background job. Retry with the same request ID to retrieve the latest result without repeating that dose.
3. `POST /api/devices/:id/nutrients/ph/stop` cancels the current pH job and sends OFF to the mapped pH pumps.
4. `GET /api/devices/:id/nutrients` includes `phDose` with status, channel, volume, duration, timestamps and any error.

Only one dosing job can run per panel. All mapped relays must initially be OFF. Calibration/mapping changes and AB mixing are blocked during pH dosing. The server owns the timer; closing the client does not cancel it. OFF is attempted on completion, cancellation and errors. Graceful shutdown cancels jobs. On restart, an interrupted dose is marked failed, OFF is attempted, and it is never resumed automatically.

The volume is an estimate from calibration, not a flow-sensor measurement. This feature does not decide how many ml are chemically necessary from the pH reading.

## Rollout

Deploy backend, web and app together. Backend startup automatically applies migration `AddPhDosing1793750400000`; it adds nullable `devices.lastPhDose`, leaving calibration and sensor mappings intact. Back up the database before a production rollout. The compose backend now allows 45 seconds for graceful shutdown and relay OFF attempts. Do not deploy an updated client against an older backend without these endpoints.

## Validation

After `npm run build`:

```sh
node --test scripts/test-ph-dosing.js scripts/test-nutrients.js scripts/test-ha-relays.js scripts/test-nutrient-http-and-settings.js
```

Tests use an in-memory database, mocked HA traffic, and accelerated long timers. They never contact or activate hardware. Flutter coverage is in `mobile/test/ph_dosing_test.dart`.
