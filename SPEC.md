# Period tracker: spec (v1)

A phone app (iOS and Android) with two goals:

1. **Fertility awareness for natural contraception.** Track basal body temperature (BBT) and cervical mucus, and tell the user whether today is fertile. It uses conservative symptothermal rules (see §5).
2. **Period pain and good habits.** Track cramps, headaches, sleep, sugar and magnesium. Help the user prepare before each period, and show personal patterns between habits and pain.

The evidence behind each decision is in [`docs/research-notes.md`](docs/research-notes.md). The fertility algorithm is specified in [`docs/fertility-rules.md`](docs/fertility-rules.md), and its test cases are in [`docs/fertility-test-cases.json`](docs/fertility-test-cases.json).

---

## 1. Platform and architecture

| Choice | Decision |
|---|---|
| Framework | Expo SDK 57, React Native 0.86, TypeScript, Expo Router (`src/app/`) |
| Storage | On-device SQLite (`expo-sqlite`), encrypted with SQLCipher. The key is generated on first launch and kept in `expo-secure-store`. |
| Network | **None.** No account, no cloud sync, no analytics or ad SDKs. |
| Notifications | Local notifications only (`expo-notifications`), discreet by default |
| Chart | `react-native-svg`, drawn by the app |
| Logic | `src/core/`: pure TypeScript with no React Native imports, fully unit-tested. Functions take `today`/`now` as arguments and never read the clock. |
| Data rights | Export everything as JSON; delete everything with one confirmation |

Dates are local calendar days (`YYYY-MM-DD`, see `src/core/date.ts`). They are never UTC instants, so travel and daylight saving can't move a log to the wrong day.

---

## 2. What the user logs

"Not logged" is always distinct from "none". An empty day is never read as dry, no pain or no magnesium.

| Area | Field | Input |
|---|---|---|
| Bleeding | flow | none / spotting / light / medium / heavy |
| | period started | explicit tap. **This is the only thing that starts a cycle**; spotting never does |
| | flooding | soaking a pad or tampon in 1–2 h, or clots larger than about 2.5 cm |
| Temperature | BBT | 2 decimals in °C or °F, with measurement time, route (oral/vaginal/rectal) and thermometer. An optional "exclude this reading" needs a reason (fever, alcohol, short sleep, off-time, travel, medication, other). |
| | disturbances | illness today; alcohol the previous evening |
| Cervical mucus | sensation | dry / nothing felt / moist / wet / slippery |
| | appearance (consistency) | nothing / sticky / creamy / watery / egg-white; stretchy yes/no |
| | color | none / white / cream / yellowish / cloudy / clear / blood-tinged / green-grey |
| | unsure, not assessable | toggles. "Not assessable" needs a reason (bleeding, possible infection, vaginal medication, semen, lubricant). |
| | final for today | confirmed in the evening (from 18:00 by default): this was the most fertile observation of the day |
| Sex | sex drive | 1–5 (shown on the chart, never used by the rules) |
| | intercourse | none / protected / unprotected (used for safety alerts only) |
| Comfort | cramps, headache | 0–10 each |
| | impact | none / some / couldn't do usual things |
| | woke from cramps, pain relief doses, heat used, tea taken | toggles and counts |
| Habits | sleep | hours (0.5 steps; target **8 h**), quality 1–5 |
| | sugar | sweet foods or drinks today: none / 1 / 2 / 3+ |
| | magnesium | taken yes/no, optional mg |
| | exercise | sessions: routine or kind, minutes, optional pain before/after, "made it worse" flag |
| Context | periods of time | hormonal contraception, pregnancy, postpartum, breastfeeding, perimenopause, emergency contraception |
| | cycle check-in | asked at onboarding and at every period start: birth in the last 12 months? breastfeeding? hormonal or emergency contraception since the last period? |

Types: `src/core/types.ts`.

---

## 3. Cycles and period prediction

- **Cycle:** from a confirmed period start to the day before the next one (`src/core/cycles.ts`).
- **Period run:** day 1, plus contiguous light/medium/heavy days, plus at most 2 trailing spotting days.
- **Unconfirmed bleeding:** bleeding that looks like a period but wasn't confirmed prompts "Did your period start?".
- **Prediction:**
  - Use the **median** of the last 6 eligible cycle lengths.
  - Show it as a **range** from the shortest to the longest of those cycles, never narrower than ±2 days.
  - Ineligible cycles:
    - cycles shorter than 15 or longer than 90 days;
    - suspected missed logs (about 2× or 3× the median), until the user confirms them;
    - cycles that overlap a context period.
- **Early data:**
  - With 0 cycles, use the onboarding answer (or 28) with a range of −4/+7.
  - With 1–2 cycles, average them with that prior and use a range of at least ±4 days.
- **After a confirmed temperature rise:** re-predict as the first higher temperature + the personal median days to the next period, defaulting to 12 with a range of 10–16. This is narrower, because the phase after ovulation varies less.
- **Late period:**
  - Never slide the prediction forward each day.
  - Show "N days later than your usual range", then one check-in.
  - In contraception mode, suggest a pregnancy test 7 days after the range ends.
- **Accuracy:** store a snapshot of each prediction and compare it with the actual start, to measure accuracy.

---

## 4. Temperature chart

- **X axis:** cycle day (date in the tooltip). **Y axis:** the entry unit, auto-scaled to a span of at least 1.0 °C or 1.8 °F.
- **Missing days** leave gaps: never interpolate. **Excluded and suspect readings** are hollow markers, with the reason on tap.
- **Period days** are shaded, with a pattern as well as colour. A **mucus strip** sits under the plot (one marker per day, peak day marked "P"), and a thin sex-drive strip under that.
- **After a temperature rise is detected:** a coverline and a dashed "estimated ovulation (confirmed afterwards)" marker.
- **Overlay:** up to 3 previous cycles, aligned by cycle day or by the day of the temperature rise.

---

## 5. Natural contraception (contraception mode)

**Contraception mode is off by default.** Turning it on requires reading a method explainer and acknowledging these points:
- the app is **not a certified contraceptive**;
- the rules have not been checked against the Sensiplan handbook;
- learning the method from a certified teacher is strongly recommended;
- on fertile days, use a condom or abstain.

With contraception mode off, the app still shows the chart, the detected temperature rise and the mucus peak, but never labels a day "infertile".

With it on, each day has one status:

| Status | Meaning | Shown as |
|---|---|---|
| `fertile` | the default; anything unknown or missing is fertile | "Fertile: use a condom or abstain" |
| `infertile_pre_ovulatory` | early-cycle days, only under strict conditions | "Not fertile (early cycle)", for days already observed |
| `infertile_post_ovulatory` | after the double check: temperature rise **and** mucus peak + 3 days | "Not fertile (after ovulation, double-checked)" |
| `not_applicable` | hormonal contraception or pregnancy | "Method not active" |

Key rules (full detail in `docs/fertility-rules.md`, where the amendments are binding):

**Temperature rise**
- Three readings higher than the previous six; the third must be at least 0.20 °C above the coverline.
- Two exceptions exist, and they are never combined.
- Excluded readings count as gaps; suspect readings never count as higher readings.

**Mucus peak**
- The last day of the best-quality mucus, which must be at least "S".
- It must be followed by 3 complete days of lower quality.
- A new mucus patch resets the peak.

**The two signs must match**
- The mucus peak must lie within 5 days before to 3 days after the first higher reading.
- The temperature must stay up until the double check completes.

**Ending the infertile phase after ovulation**
It ends as soon as any of these happens:
- period-like bleeding;
- 2 spotting days, or 2 low readings, from 10 days after the rise;
- the temperature collapses before then;
- a hard cap 19 days after the rise is reached.

**Early-cycle infertile days**
- Only if the previous cycle was fully charted, plausible (21–40 days) and double-checked.
- Up to 5 days, or fewer if earlier cycles had early rises (the "minus 8" rule). The count can lengthen only after 12 qualifying cycles.
- Every such day needs a complete evening observation of dry or nothing.

**Never infertile**
- The first charted cycle, any cycle after hormonal contraception or birth, and any unanswered cycle check-in.
- Future days.

**Edits**
If an edit turns a day the user already saw as infertile into fertile, the app shows a blocking alert. It lists any unprotected intercourse on that day and gives emergency contraception guidance.

**Context:** Sensiplan, taught in person, has strong published data: 0.6 pregnancies per 100 women over 13 cycles with no unprotected intercourse in the fertile time, and 1.8 per 100 overall (Frank-Herrmann 2007). **Those are not this app's numbers.** The app has not been validated.

**Regulation:** distributing an app that labels days infertile for contraception is a regulated medical device.
- **US:** 21 CFR 884.5370, product code PYT, Class II. Natural Cycles needed a De Novo in 2018, and Clue Birth Control a 510(k) in 2021.
- **EU:** MDR Rule 15, Class IIb.
- **Apple:** App Review Guideline 1.4.1 rejects apps whose "accuracy or methodology cannot be validated".

See *Open decisions*.

---

## 6. Reminders

All reminders anchor to the **start** of the predicted range (the earliest likely day). They are re-synced after every log, edit and app open. A reminder is never sent twice, and only the current cycle's reminders are scheduled. Lock-screen text is discreet by default ("You have a reminder").

| When | Reminder | Default |
|---|---|---|
| 3 days before | **Get ready:** tea (caffeine-free, e.g. ginger or chamomile), heat pad or hot-water bottle, pads/tampons/cup, and check you have your usual pain relief (ask a pharmacist if unsure) | on |
| 2 weeks before | **Sugar experiment:** "swap one sugary drink a day this cycle". Framed as an experiment, not a rule, with no shaming | **opt-in** |

Edge cases:
- If the period starts early, pending reminders are cancelled.
- In very short cycles, the sugar reminder is dropped if it would fall within 4 days of the get-ready reminder, and it never fires during the period.
- Reminders pause during pregnancy, postpartum and hormonal contraception.
- If notifications are denied, the same content shows as a card on the home screen.

---

## 7. Pain guide

The spec's original rule, "if magnesium, exercise, low sugar and good sleep, the period is expected to be low-pain", **is not supported by the evidence and is not promised.** Exercise has low-certainty evidence; magnesium, sugar and sleep have weak evidence (see research notes). Instead, the pain guide has three parts:

**Period prep card (upcoming period).** It shows which of four habits are on track, as neutral counts ("3 of 4"), with no streak-shaming:

| Habit | Window | On track when |
|---|---|---|
| Magnesium | 14 days before the predicted start, to today | taken on ≥ 70 % of logged days |
| Exercise | last 28 days | ≥ 3 exercise days a week on average (any session of ≥ 10 min) |
| Sugar | 14 days before the predicted start, to today | ≤ 1 serving on ≥ 70 % of logged days |
| Sleep | last 7 nights | average ≥ 8 h |

A habit with fewer than 60 % of days logged shows as "not enough logs", not as missed.

**Your patterns (after enough cycles).**
- The outcome for each cycle is its peak cramp score from 2 days before day 1 to day 3, with at least 2 logged days.
- For each habit, cycles where it was on track are compared with cycles where it wasn't, shown as medians with *n*.
- A comparison appears only when each group has **at least 3 cycles**.
- All four habits are always shown, not just the best-looking one.
- Differences under 2 points are reported as "no clear difference".
- The wording says it is a pattern in your logs, not proof that the habit caused it. Pain relief taken is shown alongside.

**Red flags (they override everything above).** Each shows "worth talking to a doctor", never "try harder":
- peak cramps ≥ 8, or "couldn't do usual things";
- ≥ 7 in 2 of the last 3 cycles;
- worsening by ≥ 2 points over the baseline;
- pain on 3 or more days outside the period;
- flooding;
- bleeding longer than 8 days;
- bleeding between periods in 2 cycles;
- cycles persistently under 24 or over 38 days;
- 90 days with no period (when not pregnant or breastfeeding).

**Urgent, "seek care now":** in contraception mode, a late period with severe one-sided pain, fainting, or shoulder-tip pain (possible ectopic pregnancy).

---

## 8. Period exercises

There is a built-in library of 10 exercises:
- yoga: cobra, cat-cow, supported fish;
- stretches: pelvic tilt, butterfly;
- strength: glute bridge, modified plank, squat with heel raise;
- relaxation: progressive muscle relaxation;
- aerobic: brisk walking.

Each has step-by-step instructions, a dose, cautions and its evidence. They are grouped into routines:

| Routine | Schedule | Based on |
|---|---|---|
| 10-minute stretch & strength | twice a day, 3 days a week, for 8 weeks | Shahr-jerdy 2012 dose (exact exercises unverified) |
| Luteal yoga: 3 poses | about 20 min, about 3 times a week, from the confirmed temperature rise (or about 14 days before the predicted period) until bleeding | Rakhshaee 2011 (cobra, cat, fish) |
| Weekly aerobic goal | 3 × 45–60 min a week | Cochrane 2019 typical dose |
| Relax & release (PMR) | about 20 min, 3 times a week, from ovulation to the period; also on demand | Celenay 2024 |

Safety rules:
- **Weekly goal:** 3 exercise days a week. Judge the effect after 2–3 cycles.
- **No pelvic-floor strengthening (Kegels) by default**, because it can worsen pain with a tight pelvic floor.
- Stop if pain sharply worsens. An exercise flagged "made it worse" is no longer suggested.
- On heavy or high-pain days, offer only gentle options.

---

## 9. Wording rules

- Never say "safe days", "expect a low-pain period", or that pain is the user's fault.
- Never give medication or supplement doses. The magnesium info card states the 350 mg/day limit for supplements, and the kidney-disease and medication cautions.
- Every pain screen has a footer: "If pain stops you doing normal things, doesn't ease with over-the-counter pain relief, or is getting worse, please talk to a doctor."
- Evidence strength is shown honestly behind an info button on each habit.

---

## 10. Not in v1

- Apple Health / Health Connect import.
- Wearable temperature.
- Cervix observations.
- Cloud sync and accounts.
- Partner sharing.
- Trying-to-conceive mode.
- Localisation beyond English. Temperature input already accepts a decimal comma.

---

## 11. Open decisions (for the owner)

1. **Distribution.** Is this for personal use, or will it be published in app stores? Publishing infertile statuses in the US or EU needs medical-device clearance, and Apple can reject it under 1.4.1. If you publish without clearance, contraception mode would have to become a charting aid that never labels days infertile.
2. **License** for the app's code. It must not copy code from `sympto` or `drip` (AGPL/GPL); the rules here were implemented independently.
3. **Method check.** Before relying on contraception mode, compare `docs/fertility-rules.md` with the Sensiplan handbook ("Natural & Safe"), ideally with a certified teacher.
4. **No-period red flag.** Besides pregnancy and breastfeeding (the spec), postpartum and hormonal contraception also silence the "no period for 90 days" flag, because implants and hormonal coils often stop periods. This is kept as the default; say if you want the stricter reading.

## 12. Known limitations (v1)

- The resend guard (no second reminder of the same type within 10 or 18 days) can drop a sugar reminder after an unusually short cycle.
- Prediction accuracy can be scored (`predictionSnapshot`, `scorePredictions`), but snapshots are not yet stored.
- The calendar's period shading uses the cycle module's period run (at most 2 trailing spotting days). The fertility engine uses the method's own definition (every contiguous bleeding day), so the two can differ by a spotting day or two.
- The fertility engine only shows infertile labels when contraception mode is on and acknowledged. It enforces this itself, not only the UI.
- No on-device testing has been done yet: the app is typechecked, linted, unit- and render-tested, and bundles for iOS and Android, but has not been run on a phone or simulator.
