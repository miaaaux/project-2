# Period Tracker

An iOS and Android app (Expo / React Native, TypeScript) for:

1. **Fertility awareness / natural contraception:** basal body temperature and cervical mucus, evaluated with conservative symptothermal rules. **Contraception mode** is opt-in.
2. **Period pain and habits:** cramps, headaches, sleep (8 h target), sugar and magnesium. Also a get-ready reminder 3 days before the period, an opt-in sugar reminder 2 weeks before, an exercise library, and personal patterns.

Read [`SPEC.md`](SPEC.md) first. The evidence is in [`docs/research-notes.md`](docs/research-notes.md), and the fertility algorithm is in [`docs/fertility-rules.md`](docs/fertility-rules.md).

> **Not a certified contraceptive.** The fertility rules have not been validated clinically or checked against the Sensiplan handbook. Publishing an app that labels days infertile for contraception is regulated as a medical device in the US and EU. See SPEC.md §5 and §11.

## Run it

The database is encrypted with SQLCipher, which needs a **development build**: the stock Expo Go app does not include it.

```bash
npm install
npx expo run:ios       # needs a Mac with Xcode
npx expo run:android   # needs Android Studio / an emulator or device
# or build in the cloud:
npx eas-cli@latest build --profile development --platform ios|android
```

Then `npx expo start` to develop against that build.

## Checks

```bash
npm test               # Jest: pure core, data layer, components
npm run typecheck      # tsc --noEmit
TZ=Europe/Berlin npm test -- src/core/fertility   # date logic must not depend on the time zone
```

## Layout

| Path | What |
|---|---|
| `src/core/` | Pure TypeScript domain logic, no React Native: dates, cycles, prediction, the fertility engine (`fertility/`), reminders, pain guide, red flags, exercises, all user-facing text (`content.ts`), and `derive()`, which ties it all together |
| `src/data/` | Encrypted SQLite document store, repository, export/delete |
| `src/notifications/` | Applies the reminder plan to local notifications |
| `src/state/` | `AppDataProvider`: loads data, runs `derive()`, syncs reminders, raises the edit-safety alert |
| `src/ui/` | Theme, shared components, temperature chart |
| `src/app/` | Screens (Expo Router) |

## Privacy

- No account, no network calls, no analytics or ad SDKs.
- The data never leaves the phone unless you export it.
- The database key is generated on the device and kept in the Keychain/Keystore, "this device only, when unlocked".
