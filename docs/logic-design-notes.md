> Earlier design notes from the research phase. **`SPEC.md` supersedes this file** wherever they differ: for example, the sleep target is now 8 h, contraception mode exists, and the fertility rules live in `fertility-rules.md`.

# Period tracker MVP: design for predictions, reminders, temperature graph, fertility and pain guide

No code or project files were written. The research came from web search results only. Every page fetch failed with DNS errors (cochrane.org, pubmed, pmc.ncbi, nhs.uk, arxiv.org), so the evidence below comes from search-result summaries, not full texts. Anything I couldn't confirm is marked **(unverified)**.

---

## 0. Key decisions in one screen

| Area | Decision |
|---|---|
| How things are computed | One pure function, `derive(logs, settings, today)`, produces cycles, the prediction, the fertility status, the pain-guide outlook, red flags and the list of reminders that should exist. Nothing derived is stored as truth. Any change to a log re-runs it and re-syncs notifications. |
| Cycle length | Next day 1 minus this day 1, in days. Spotting never starts a cycle. |
| Prediction | **Median** of the last 6 eligible cycles. The likely range runs from the shortest to the longest of those cycles, and is never narrower than ±2 days. Suspected missed logs and cycles affected by contraception or pregnancy are excluded. Genuinely long or short cycles are kept. |
| Prediction after ovulation | Once a temperature rise is confirmed, the next period is predicted from the estimated ovulation date plus the luteal length (the days from ovulation to the next period). This range is narrower because the luteal phase varies less than the first half of the cycle. |
| Reminders | Anchored to the **start of the range** (the earliest likely start), not the middle. Each reminder has a stable key `type:cycleStart`. A reminder already sent is never sent again. Reminders that are no longer wanted are cancelled. |
| Ovulation detection | A "3 over 6" rule with two exceptions. It confirms ovulation only after the fact, about 3 days after the rise. |
| Fertility | A calendar window plus mucus looks ahead; the temperature rise confirms afterwards. Body signs override the calendar. No day is ever shown as "safe". The feature must not be presented as contraception. |
| Pain guide | Shows "preparation", meaning which habits were kept up, rather than a prediction of low pain. Comparisons with the user's own past cycles start only at **3 or more cycles in each group** and are worded as patterns, not causes. Red flags always override the habit messages. |

---

## 1. Period prediction

### 1.1 Definitions

- **Flow scale:** `none | spotting | light | medium | heavy | very_heavy`. Spotting means a few drops or brown discharge with no pad or tampon needed. Define this in the UI.
- **Bleeding day:** flow is light or heavier. Spotting is not a bleeding day.
- **Period (bleeding episode):** the longest run of bleeding days. A gap of up to 1 day with no bleeding or no log is bridged, so one forgotten day doesn't split a period. Spotting next to the episode is displayed but does not start or extend it. The developer can make trailing spotting extend the displayed end.
- **Period start (day 1):** the first bleeding day of an episode. An explicit "my period started" toggle from the user always wins.
  - If the new episode would make the previous cycle **shorter than 21 days**, ask: "New period or bleeding between periods?" Until the user answers, count it as a new period only if the cycle would be 15 days or longer. Otherwise treat it as bleeding between periods, which feeds the red-flag counters.
- **Period end:** the last bleeding day of the episode. Period length = end − start + 1.
- **Cycle n:** from `start[n]` to `start[n+1] − 1`. Cycle length `L = start[n+1] − start[n]` in days. Cycle day = `date − start[n] + 1`. The current cycle is "open" and has no length yet.
- **Reference values:** FIGO 2018, as reported in secondary summaries (MSD Manual, StatPearls), gives a normal cycle frequency of 24–38 days, bleeding of 8 days or fewer, and regularity as a shortest-to-longest spread of 7 or fewer days (ages 26–41) or 9 or fewer days (ages 18–25 and 42–45) [12][13]. I did not open the primary FIGO paper.

### 1.2 Which cycles count, and outliers

A cycle is **eligible** for statistics unless any of these apply:
1. It overlaps a period the user marked as hormonal contraception, emergency contraception, pregnancy, postpartum or breastfeeding.
2. `L < 15` or `L > 90`. These are implausible or artifacts. For comparison, Bull 2019 excluded cycles outside 10–90 days in its analysis of the Natural Cycles dataset [1].
3. It is a **suspected missed log** and the user hasn't confirmed it was real.
4. The user marked it "ignore this cycle".

**Do not** drop real long or short cycles just because they are unusual. They are the evidence of how variable this user is, and the range should reflect that.

Missed-log detector. Missed logging is a known problem in app data, and Li, Urteaga et al. built a prediction model specifically to account for skipped tracking [5].

```python
def flag_suspected_missed(cycles, prior_len):
    for c in completed(cycles):
        ref = [x.length for x in nearest_eligible(cycles, exclude=c, k=6)]
        m = median(ref) if len(ref) >= 2 else prior_len
        if c.length >= 1.5 * m:
            c.ask_user = True                       # "Did you miss logging a period?"
        for k in (2, 3):
            if abs(c.length - k * m) <= max(5, 0.15 * k * m):
                c.suspected_missed_log = True       # excluded until the user confirms
# Example: median 29, L = 58 -> flagged. L = 45 -> asked about, but kept.
```

### 1.3 The algorithm

```python
WINDOW = 6

def eligible_lengths(cycles):
    out = []
    for c in completed_newest_first(cycles):
        if c.excluded_reason or c.suspected_missed_log: continue
        if not 15 <= c.length <= 90: continue
        out.append(c.length)
        if len(out) == WINDOW: break
    return out

def predict_calendar(cur_start, lengths, prior_len):
    # prior_len = onboarding answer ("usually about X days"), else 28
    n = len(lengths)
    if n == 0:
        center = prior_len; lo, hi = center - 4, center + 7; conf = "estimate"
    elif n <= 2:
        center = round(mean(lengths + [prior_len]))   # shrink toward the prior
        spread = max(4, max(lengths) - min(lengths))
        lo, hi = center - spread, center + spread; conf = "early"
    else:
        center = median(lengths)                      # robust to one odd cycle
        lo = min(min(lengths), center - 2)
        hi = max(max(lengths), center + 2)
        conf = "building" if n < 6 else "established"
    regular = (n >= 3) and (max(lengths) - min(lengths) <= regularity_limit(age))  # 7 or 9 days (FIGO, per [12][13])
    return Prediction(cur_start + days(center), cur_start + days(lo),
                      cur_start + days(hi), conf, regular)
```

**Why the median, and why 6 cycles.** With 3 to 6 cycles, a single 40-day cycle drags the mean but barely moves the median. Six cycles is about six months: recent enough to follow drift with age, since Bull 2019 found cycles shorten about 0.18–0.19 days per year between ages 25 and 45 [1].

**What the range means.** If cycle lengths behave like independent draws, the chance that the next cycle falls inside the min–max of the previous *n* is (n−1)/(n+1). That is 50% for n = 3, 71% for n = 6 and 85% for n = 12. The chance it is *shorter* than all of them is 1/(n+1), which is about 14% for n = 6. So label the range "likely between…" and never "will start between". Normal variation is large: in Fehring 2006 (141 women, 1,060 cycles), 95% of cycles were 22–36 days and 42.5% of women varied by more than 7 days between cycles [3].

**Defaults with no history.** With 0 cycles, ask at onboarding for the last period start and "usually about how many days?" (with an "I don't know" option). The default is 28, with an asymmetric −4/+7 range because long cycles are more common than short ones. Large app cohorts report means of about 29 days (Bull: mean 29.3 days over 612,613 ovulatory cycles) [1]. With no last-period date, show no prediction and say "Log your next period to get predictions."

**Irregular cycles.** If `regular == False`, or the range is wider than 10 days:
- Show the window first and the date second. Drop countdown wording like "in 4 days".
- Use the prediction after ovulation (1.4) as soon as a temperature rise is confirmed.
- Persistent spreads outside the FIGO limits, or cycles regularly under 24 or over 38 days, feed a gentle red flag (5.5).
- Cycle-length variability differs a lot between users (Li et al. 2020, Clue data, 4.9M cycles) [4].

### 1.4 Prediction after ovulation

Once the temperature rule (section 3) confirms a rise, with the estimated ovulation on cycle day `O` and date `ov_date`:

```python
luteal = personal_luteal_median if n_confirmed_cycles >= 3 else 13
lut_lo, lut_hi = (min(personal) - 1, max(personal) + 1) if n_confirmed_cycles >= 3 else (11, 15)
next_start_center = ov_date + days(luteal + 1)          # luteal length = L - O
next_start_range  = (ov_date + days(lut_lo + 1), ov_date + days(lut_hi + 1))
```

Rationale: the first half of the cycle (before ovulation) causes most of the variation in cycle length (Fehring 2006 [3]). A 2024 Human Reproduction cohort (53 women, 694 cycles) found that within-woman variance in that first half was significantly greater than variance in the luteal phase [14]. Bull 2019 reports a mean luteal phase of 12.4 days [1]. The defaults of 13 days and 11–15 days are design choices.

### 1.5 Updates

- **Period logged early or on time.** The open cycle closes and its length goes into the statistics. If it is shorter than 21 days, the user is asked to confirm (1.1). A new cycle opens, and re-syncing reminders cancels everything keyed to the old cycle.
- **Period logged late.** Same handling. The median moves little; the range widens. That is intended.
- **Late with nothing logged.** **Do not slide the prediction forward every day.** Keep the window and show "N days later than your usual range". Then:
  - The day after the range ends: one check-in, "Has your period started?"
  - 7 days after the range ends: if the user is not on contraception and the stated goal makes it relevant, gently mention a pregnancy test. Otherwise ask whether they forgot to log.
  - Cycle day 90 or later with no period, not pregnant or breastfeeding: suggest seeing a clinician. The 90-day threshold is a design choice **(unverified)**.
- **Edits to past entries:** re-derive everything and re-sync reminders.
- **Accuracy tracking:** when each cycle starts, store a snapshot of the prediction (center, lo, hi). When the cycle closes, store the error (actual minus center) and whether it landed inside the range. Use this internally to tune the 6-cycle window and the ±2 minimum, and optionally show the user "your predictions were within the range in X of the last Y cycles".

---

## 2. Reminders (tea at 3 days before, sugar at 14 days before)

### 2.1 Principles
1. The *desired* reminders are derived from the current prediction. The *scheduled* ones are synced to match by diffing the two sets.
2. A reminder that has been **sent** is never sent again. A **pending** one can move or be cancelled.
3. Only the **current cycle's** reminders are scheduled. Nothing is scheduled for later cycles.
4. Notification text must not contain dates or countdowns, because local notifications can fire long after their text was written.

### 2.2 Anchor: start of the range, not the middle

A reminder that arrives after the period has started is useless. Anchoring to `lo` means that, with 6 cycles of history, the tea reminder comes at least 3 days before the period in roughly 6 of 7 cycles (from 1.3: P(next < min) ≈ 1/7). The cost is that variable users get reminders earlier, so the wording stays vague ("in the next few days").

```python
def desired_reminders(cycle, pred, settings):
    if settings.reminders_off or cycle.mode in {"pregnant", "postpartum", "hormonal_contraception"}:
        return []
    out = []
    p = pred.post_ovulation or pred.calendar           # use the narrower range when available
    tea   = p.lo_date - days(3)
    sugar = p.lo_date - days(14)
    sugar = max(sugar, cycle.period_end + days(1), cycle.start + days(5))  # never during the period
    if settings.tea_on:
        out.append(R("tea", cycle.start, at_local(tea, settings.time)))
    if settings.sugar_on and (tea - sugar).days >= 4:   # very short cycle: drop sugar
        out.append(R("sugar", cycle.start, at_local(sugar, settings.time)))
    if cycle.shift_confirmed and settings.sugar_on:     # irregular users: confirmed rise is a better anchor
        out = [r if r.type != "sugar" else r.earliest(at_local(cycle.confirm_date, settings.time))
               for r in out]
    return out
```

### 2.3 Sync (idempotent, no duplicates)

```python
def sync(desired, store, now):
    want = {r.key: r for r in desired}                  # key = f"{type}:{cycle_start_iso}"
    for key, s in store.items():
        if s.status == "pending" and key not in want:
            os_cancel(key); s.status = "cancelled"
    for key, r in want.items():
        s = store.get(key)
        if s and s.status in ("sent", "skipped"): continue
        if recently_sent(store, r.type, within=days(10 if r.type == "tea" else 18)):
            continue                                    # guards against duplicates when a cycle start is edited
        if r.fire_at <= now:
            if past_due_still_useful(r, now): r.fire_at = next_allowed_slot(now)
            else: store[key] = State("skipped"); continue
        os_schedule(id=key, at=r.fire_at, body=text(r))  # the same id replaces the old request; it doesn't duplicate
        store[key] = State("pending", r.fire_at)
# Mark "sent" when the notification fires or is opened, or on the next app open after fire_at.
```

Past-due rule: a tea reminder still goes out if the period hasn't started and today is before `center`. A sugar reminder still goes out if the period hasn't started and `lo` is at least 5 days away. Otherwise the reminder is marked skipped.

Run `derive` and `sync` on every log or edit, on every app open, when settings change, and in a daily background task where the operating system allows it. Background execution is not guaranteed, which is another reason the text stays generic. Schedule against local wall-clock time, not a UTC instant, so DST and travel don't shift the hour. Default to at most one app notification per day; tea outranks the "late" check-in.

### 2.4 Situations

| Situation | Behaviour |
|---|---|
| Period starts before the tea reminder | The new cycle opens, the old keys aren't in the desired set, and the old reminder is cancelled. |
| Period started but not logged | The reminder may still fire. Its text includes "If it's already started, tap to log it." |
| Prediction moves later (temperature rise, new data) | Pending reminders move later. Sent reminders stay sent. |
| Prediction moves earlier and the fire time has passed | Apply the past-due rule. |
| Very short cycle (about 21 days or less) | Sugar is clamped to after the period ends. If tea and sugar would be less than 4 days apart, sugar is dropped. |
| Irregular (range wider than 10 days) | Tea uses `lo` and becomes accurate once the rise is confirmed. Sugar goes out at the calendar anchor, or at confirmation if that comes first. |
| Late period | No repeated tea reminders. One check-in (1.5). |
| Pregnancy, postpartum, hormonal contraception | Reminders paused. Offer the user a choice. |
| Notifications not permitted | Show the same content as an in-app card on the home screen. |
| Sensitive data on the lock screen | Offer "discreet notifications" (for example "You have a reminder") and make it the default. |

### 2.5 What "14 days before" means

Fourteen days before the period is roughly ovulation in a typical cycle (mean luteal phase 12.4 days [1]). The sugar reminder therefore covers the luteal phase, and for users trying to conceive it overlaps the end of the fertile window. Keep the two messages separate.

Make the sugar reminder **opt-in or easy to turn off**, with neutral wording. Food-restriction nudges can harm people with a history of eating disorders, and people with diabetes have their own dietary plans.

Example wording:
- Tea: "Your period may be coming in the next few days. A good time to have your tea ready."
- Sugar: "You're likely in the second half of your cycle. If you're following your 'less sugar' plan, now's when it applies."

---

## 3. Temperature graph

### 3.1 Layout
- **X axis:** cycle day 1…N, with the calendar date as a secondary label or tooltip. Toggle between "this cycle" and calendar view.
- **Y axis:** °C, stored to 0.01 and displayed to 0.05. Auto-scale with a minimum span of about 1.0 °C so normal noise doesn't look dramatic. Optional °F display (`F = C × 9/5 + 32`). Detection thresholds convert too: 0.20 °C = 0.36 °F, 0.05 °C = 0.09 °F. Always store °C.
- **Points:** a filled dot for each valid reading. Lines join **only** valid readings on consecutive days, so a missing day leaves a gap. Never interpolate.
- **Disturbed readings:** a hollow marker with a reason tooltip. Not joined by the line and excluded from detection. Reasons: illness or fever, alcohol, short or broken sleep, measured more than ±1 h from the usual time, travel or timezone change, different thermometer or method. Suggest the flag automatically when logged sleep is very short or the measurement time differs; the user confirms.
- **Period days:** background shading with opacity by flow, plus a shape or pattern so it doesn't rely on colour alone.
- **Mucus strip** below the plot: one categorical marker per day (dry, sticky, creamy, watery, egg-white), with colour as a secondary cue and the peak day marked "P". Optional thin sex-drive strip.
- **Coverline:** a horizontal line drawn *after* detection, from the six low readings onward.
- **Estimated ovulation:** a dashed vertical line labelled "Estimated ovulation (confirmed afterwards, ±1–2 days)". Before confirmation, show "Temperature rising: 2 of 3 readings".
- **Overlay:** up to 3 previous cycles as thin faded lines, aligned by cycle day, with a toggle to **align by temperature rise** ("days from rise"). That alignment removes the variation in the first half of the cycle and is usually the more useful comparison.

### 3.2 Detection rule: "3 over 6" with two exceptions

Thresholds differ between methods, so these are design choices. The Taking Charge of Your Fertility (TCOYF) Celsius guidelines draw the coverline 0.05 °C above the highest of the last 6 lows. They require the 3rd high to be at least 0.15 °C above the coverline, or else a 4th high anywhere above it (slow rise or fallback) [15]. The 0.20 °C third-reading threshold often attributed to the Sensiplan method is **(unverified)**. Marshall's original "3 over 6" dates from 1968, and variants exist [16]. I chose the stricter 0.20 °C to reduce false confirmations.

```python
COVER_MARGIN   = 0.00   # TCOYF uses +0.05
THIRD_MIN_RISE = 0.20   # TCOYF uses 0.15
MAX_LOW_SPAN   = 9      # the six lows must fall within this many calendar days
MAX_HIGH_SPAN  = 5      # the 3-4 highs (plus one dip) must fall within this many days

def detect_shift(readings):          # current cycle, ordered; disturbed readings already removed
    v = [r for r in readings if r.valid]
    for i in range(6, len(v)):
        lows = v[i-6:i]
        if (lows[-1].date - lows[0].date).days > MAX_LOW_SPAN: continue
        cover = max(r.temp for r in lows) + COVER_MARGIN
        if v[i].temp <= cover: continue
        highs, dips = [v[i]], 0
        for r in v[i+1:]:
            if (r.date - v[i].date).days > MAX_HIGH_SPAN: break
            if r.temp > cover: highs.append(r)
            else:
                dips += 1
                if dips > 1: break                                 # second dip: give up on this candidate
            if dips == 0 and len(highs) == 3 and highs[2].temp >= cover + THIRD_MIN_RISE:
                return Shift(v[i], highs[2].date, cover, "standard")
            if len(highs) == 4:                                    # slow rise, or one fallback day
                return Shift(v[i], highs[3].date, cover, "slow_rise" if dips == 0 else "fallback")
    return None
# ovulation_est = date of the last low before the first high (convention; error about ±1-2 days)
```

After confirmation, if 2 of the next 3 valid readings fall to or below the coverline, mark the rise "uncertain" and say so.

Detection needs 6 or more valid readings before the rise. If the user starts measuring mid-cycle, show "Not enough readings this cycle to detect a temperature rise".

**This method confirms ovulation only afterwards.** The rise follows ovulation, and confirmation comes about 3 days later. It cannot predict ovulation in the current cycle; it only feeds the luteal-based prediction (1.4) and future cycles.

---

## 4. Fertility (goal 1)

### 4.1 What each signal can do

| Signal | Looks ahead? | Confirms afterwards? | MVP use |
|---|---|---|---|
| Cycle history (calendar) | Yes, wide window | No | Base window |
| Cervical mucus | Yes, the best early sign of the fertile window | Peak day, known the next day | Opens, extends and closes the window |
| Temperature (BBT) | No | Yes (rise) | Confirms ovulation; learns personal luteal length |
| Sex drive | No (anecdotal) | No | Show on the timeline only; not used in the algorithm |

### 4.2 Calendar window

In cycle days, with ovulation `O = L − luteal`:

```
O_min = lo - luteal_max ;  O_max = hi - luteal_min
fertile_calendar = [O_min - 5, O_max + 1]
# Example: regular 28-day user (lo 26, hi 30), luteal 11-15 -> O 11-19 -> window CD 6-20
```

The width is honest:
- Wilcox 2000 (221 women, 696 cycles) found that even women with regular cycles had at least a 10% chance of being in the fertile window on every day from 6 to 21. Only about 30% had the whole window inside days 10–17 [6].
- The "−5 … ovulation" span comes from Wilcox 1995: conception occurred only with intercourse in the 6 days ending on the estimated ovulation day, with probability rising from about 0.10 five days before to about 0.33 on the day [7].
- The +1 day after ovulation is a safety margin (design choice).

### 4.3 Mucus rules
- Consistency (ordinal): `dry/none < sticky < creamy < watery < egg_white`. **Fertile-type** = watery or egg-white.
- Colour (`clear, white, cloudy, yellow, pink/brown, green/grey`) is secondary for fertility. Clear supports fertile-type. Pink or brown means blood (spotting). Green or grey, or yellow with itching or odour, is a *health* note: "worth checking with a clinician". It is not a fertility input.
- **Peak day** = the last day of fertile-type mucus, identified the next day when mucus becomes less fertile.
- Mucus-based window: from the first day of fertile-type mucus (or of any mucus, for the conservative option) to peak + 3 days. This "peak + 3" convention comes from mucus methods and is **(unverified)** here.

### 4.4 Combined daily status (first match wins)

1. Bleeding → **Period**
2. Rise confirmed, today is after the confirmation date, **and** (today ≥ peak + 4, or no mucus data) → **"Ovulation likely passed"** (state whether temperature and mucus agree, or temperature only)
3. Fertile-type mucus today, or inside first-mucus…peak + 3 → **"Fertile signs"**
4. Inside the calendar window → **"Predicted fertile window"**
5. Otherwise → **"Outside predicted window"**. Never say "safe" or "infertile".

When signals disagree:

| Situation | Show |
|---|---|
| Fertile mucus before the calendar window | "Your body signs suggest your fertile window may have started earlier than predicted." Body signs win. |
| Calendar window, no mucus logged | "Predicted fertile window. Log mucus to refine." A missing log is not the same as dry. |
| Calendar window, mucus logged dry | "Predicted window; your signs don't show fertile mucus yet." Ovulation may come later. |
| Calendar window over, no rise, no peak | "Ovulation not detected yet; it may be later this cycle." Extend the window until a rise or peak appears. |
| Rise confirmed, mucus still fertile | "Temperature suggests ovulation passed; mucus still looks fertile." Stay at status 3 until both signs agree. |
| Peak passed, no rise | "Mucus peak passed; temperature hasn't confirmed it." |
| No rise all cycle | "No clear temperature rise this cycle. This can happen with missed or disturbed readings, and sometimes in cycles without ovulation." If this recurs and the user is trying to conceive, suggest talking to a clinician. |

### 4.5 Not contraception

Show "Fertility estimates are for awareness only. They are not a method of contraception" at onboarding, on the fertility screen and in the store listing. There are no green or "safe" days.

Turn the fertility status off ("not available") during hormonal contraception, pregnancy, postpartum or breastfeeding, and flag the first cycles after stopping the pill. Making contraceptive claims would probably bring medical-device regulation into play; get regulatory advice **(unverified)**.

---

## 5. Pain guide (goal 2)

### 5.0 What the evidence supports (search summaries only)

| Behaviour | Best evidence seen | Certainty | What this means for the app |
|---|---|---|---|
| Exercise | Cochrane 2019 (Armour et al.): 12 RCTs, 854 women; meta-analysis of 10 trials, 754 women. A large effect versus no treatment, about **25 mm on a 100 mm pain scale**. Regimens were mostly **at least 3 times a week, 45–60 min**. Unclear whether the benefit lasts after stopping or applies to women over 25. Comparison with NSAIDs inconclusive. Study counts were reported slightly differently across summaries [8]. | **Low** (the authors cite imprecision, inconsistency and bias from lack of blinding) | The strongest of the four. "May help" wording. |
| Magnesium | 2001 Cochrane review of herbal and dietary therapies: **3 small RCTs** against placebo; magnesium was more effective for pain relief, with less need for extra medication [9]. The 2016 update, "Dietary supplements for dysmenorrhoea" (27 RCTs, 3,101 women), found **no high-quality evidence for any supplement**; all evidence low or very low. I could not confirm whether magnesium was assessed in the update [10]. | **Low or very low** | "Some small studies"; never prescribe a dose; add a safety note. |
| Sugar | Observational only. Al-Husban 2022, Jordan, cross-sectional: 660 women with period pain out of 1,988 surveyed; frequent sugar (and fizzy drinks, coffee, **tea**, energy drinks) was associated with severe pain [11]. A Georgian adolescent survey reported an association, but its p-value is internally inconsistent [17]. | **Very low** (cross-sectional; pain could drive cravings) | Present as a personal experiment, not established advice. |
| Sleep | Cross-sectional: sleeping **under 7 h** associated with severe pain (Jordan, p = 0.005) [11]; poor sleep-quality scores associated with pain in Indonesian student samples [18]. | **Very low** (pain disrupts sleep, so the cause may run the other way) | Measure sleep *before* the period, not during it. |
| Tea (if ginger tea) | The 2016 Cochrane abstract, as summarised, lists ginger among supplements with very limited, low-quality evidence [10]. Caffeinated tea was associated with *worse* pain in the Jordan survey [11]. | **Low** | Clarify what "tea" means (section 7). |

### 5.1 Adherence per behaviour

For a completed cycle whose next period starts on `P`:
- The window `luteal14` is `[P−14, P−1]`, or `[ov+1, P−1]` if ovulation was confirmed.
- The window `last28` is `[P−28, P−1]`.

For the upcoming period, compute the same windows from the sugar-reminder anchor up to today.

| Behaviour | Field | Window | Metric | Default "on track" | Notes |
|---|---|---|---|---|---|
| Magnesium | `mg_taken` (bool) | luteal14 | days taken ÷ days logged | ≥ 70% | Trial regimens varied; the app does not recommend a dose. |
| Exercise | `exercise_min`, `exercise_type` | **last28** | sessions of ≥ 20 min per week | ≥ 3 a week on average | Trials used regular exercise at 3+ times a week, 45–60 min [8]. A pre-period-only window doesn't match the evidence. |
| Sugar | `sugar_level` (low/usual/high) | luteal14 | share of logged days marked "low" | ≥ 70% | Relative to the user's own normal. |
| Sleep | `sleep_h` (night ending on that date) | luteal14 | mean hours | ≥ 7.0 | 7 h matches the threshold in [11]. |

```python
MIN_COVERAGE = 0.6
def adherence(logs, field, window, metric, target):
    logged = [logs[d][field] for d in window if logs.get(d) and logs[d][field] is not None]
    cov = len(logged) / len(window)
    if cov < MIN_COVERAGE: return Unknown(cov)          # not logged != not done
    val = metric(logged)
    return Known(val, on_track = val >= target, coverage = cov)
```

### 5.2 Outlook card: "Period prep", not "expect low pain"

- 4 of 4 known and on track: "You've kept up all four habits that may help with period pain this cycle. After your period we'll compare it with your earlier ones."
- 2–3 on track: "You're on track with sleep and magnesium. Movement and sugar haven't been logged much. Small steps still count."
- 0–1 on track: "Busy cycle. Anything you can manage in the next few days may still help. Pain relief and heat are fine to use too." That last sentence is not evidence-checked here; have a clinician review it **(unverified)**.
- Mostly unknown: "Log sleep and sugar for a few more days to see your prep summary."
- Once 5.3 has enough data, add a line about the user's own pattern.
- Show each behaviour's evidence level behind an info button (5.0).

If the product owner insists on the original rule, the most it should say is: "You've done everything on the list that may lower period pain." It must not say "your period should be low-pain."

### 5.3 Comparing the user's own cycles

**Outcome per cycle:** `peak_cramp` = the highest cramp score (0–10) over 2 days before day 1 through cycle day 3. This needs at least 2 logged days in that span; otherwise the outcome is unknown. Secondary outcomes: mean cramp score over the same days, headache days, painkiller days and high-impact days.

```python
def insight(cycles, b):
    elig = [c for c in cycles if c.pain_known and not c.excluded and c.adh[b].known]
    on   = [c.peak_cramp for c in elig if c.adh[b].on_track]
    off  = [c.peak_cramp for c in elig if not c.adh[b].on_track]
    if min(len(on), len(off)) < 3: return NeedMore(3 - len(on), 3 - len(off))
    diff = median(off) - median(on)
    label = "early pattern" if min(len(on), len(off)) < 5 else "pattern"
    if abs(diff) < 2: return NoClearDifference(label)
    return Pattern(b, median(on), len(on), median(off), len(off), label)
```

**Why at least 3 cycles per group (about 6 or more months) to show anything, and 5 for a firmer label:**
- Pain varies a lot from one cycle to the next. With 1–2 cycles per group, one unusual month (illness, stress, a cycle where painkillers were taken early) decides the result. A median of 3 tolerates one outlier.
- A significance test is pointless at these sizes. With 3 vs 3 cycles, even perfect separation gives an exact permutation p of 2/20 = 0.10 (two-sided). With 4 vs 4 the minimum is about 0.03; with 5 vs 5, about 0.008. So show descriptive numbers and n, never "significant".
- The 2-point threshold on a 0–10 scale is a commonly used "meaningful change" convention **(unverified here)**.

Caveats to build in:
- **Show all four behaviours, not just the best-looking one.** Four comparisons at once will produce chance "findings".
- Behaviours occur together (motivated months), so they can't be separated with few cycles. Painkiller use, contraception changes and illness confound. **Log painkiller use** (section 7).
- Regression to the mean: people often start tracking after a bad period, so later periods tend to look better whatever the user does. Say so in onboarding copy.
- The user knows what they did when rating their pain, so there is no blinding.

Example text: "In your last 8 cycles, peak cramps averaged 4/10 after cycles with 7+ hours of sleep (4 cycles) and 6/10 otherwise (4 cycles). This is a pattern in your logs. It doesn't show that sleep caused the difference."

### 5.4 Wording

| Avoid | Use |
|---|---|
| "Expect a low-pain period" | "You've done the things that may help" |
| "Your pain was high because you skipped magnesium" | "Pain varies from cycle to cycle for many reasons" |
| "Magnesium treats cramps" | "Some small studies suggest magnesium may help some people" |
| Streaks or "failed" badges | Neutral counts ("3 of 4") with no red colouring for misses |
| "You must cut sugar" | "If you're trying less sugar this cycle…" |

### 5.5 Red flags (these override the pain-guide messages)

Wording pattern: "Your logs show [pattern]. That's worth talking to a doctor or nurse about. There are effective treatments, and sometimes a cause like endometriosis or fibroids that can be checked. This isn't a diagnosis." Once a red flag is active, the guide stops implying that more habits are the answer.

| Rule (defaults) | Data needed | Level | Source |
|---|---|---|---|
| Peak cramp ≥ 8, **or** impact = "couldn't do usual activities / couldn't sleep / hard to move or talk" | cramps, `pain_impact` | See a clinician | NHS description of severe period pain, via nidirect and search summary [19][20] |
| Peak cramp ≥ 7 in at least 2 of the last 3 cycles despite usual measures | cramps, painkillers | See a clinician | Design choice; "not responding to treatment" is a common referral trigger **(unverified)** |
| Worsening: median of the last 3 cycles ≥ 2 points above the median of cycles 4–9 (needs ≥ 3 baseline cycles) | cramps | See a clinician | Progressive worsening suggests secondary dysmenorrhoea (AAFP review) [21] |
| New pain: baseline median ≤ 3, then the last 2 cycles ≥ 6; or pain starting after age 25 | cramps, birth year | See a clinician | Onset after 25 points to a secondary cause [22] |
| Pelvic pain ≥ 5 on 3 or more days outside the period and the 2 days before it | cramps by cycle day | See a clinician | [21] |
| Heavy bleeding: `very_heavy` (changing every 1–2 h, doubling up, clots > 2.5 cm) on any day | flow, clots, product changes | See a clinician | NHS heavy periods [20] |
| Bleeding lasting more than 8 days | episodes | See a clinician | FIGO limit [12][13] |
| Bleeding between periods or after sex in 2 cycles | episodes, sex log | See a clinician | NHS [20] |
| Cycles persistently under 24 or over 38 days, spread beyond the FIGO limit, or no period for 90 days or more when not pregnant | cycles | See a clinician (gentle) | [12][13] |
| **Urgent:** very heavy bleeding with dizziness or fainting; sudden severe pain; pain with a positive pregnancy test; fever (≥ 38.0 °C) with pelvic pain; vomiting that stops eating | symptom check-in | Seek urgent care now | Fainting and vomiting per a GP quoted in a news summary [19]; positive test plus pain is a commonly cited urgent trigger. Clinician review recommended **(unverified)** |
| Severe headache (≥ 8) or a new headache pattern | headache | See a clinician | Design choice **(unverified)** |

---

## 6. Data fields

### 6.1 Daily log (one row per user per **local date**; null means not logged)

| Field | Type / scale |
|---|---|
| `date` | local date (part of the primary key) |
| `flow` | enum: none, spotting, light, medium, heavy, very_heavy |
| `period_start_mark` / `period_end_mark` | bool (user overrides) |
| `clots_large` | bool (> 2.5 cm), suggested |
| `product_changes` | int per day, suggested (for heavy-bleeding detection) |
| `bbt_c` | decimal(4,2) °C |
| `bbt_time` | local time |
| `bbt_method` | enum: oral, vaginal, rectal, wearable |
| `bbt_disturbed` | bool |
| `disturb_reasons` | set: illness, alcohol, short_sleep, late_measure, travel, other |
| `mucus_consistency` | enum: not_checked, dry, sticky, creamy, watery, egg_white |
| `mucus_color` | enum: not_checked, clear, white, cloudy, yellow, pink_brown, green_grey |
| `sex_drive` | int 1–5 |
| `intercourse` | enum: none, protected, unprotected, suggested (needed for trying to conceive and the bleeding-after-sex flag) |
| `cramps` | int 0–10 (0 means logged as none) |
| `headache` | int 0–10 |
| `pain_impact` | enum: none, some, couldnt_do_usual |
| `painkiller_taken` | bool (plus `doses` int), suggested |
| `sleep_h` | decimal 0–16 in 0.5 steps (the night ending on this date) |
| `sleep_quality` | int 1–5 (optional) |
| `sugar_level` | enum: low, usual, high (relative to own normal) |
| `mg_taken` | bool |
| `mg_mg` | int (optional) |
| `exercise_min` | int |
| `exercise_type` | enum: stretching_yoga, aerobic, strength, other |
| `tea_taken` | bool (closes the loop on the reminder) |
| `note` | text |
| `updated_at` | timestamp |

### 6.2 Profile and settings
- Birth year.
- Units (°C or °F).
- Goal: awareness, trying to conceive, or avoiding pregnancy (awareness only, no contraception claims).
- Contraception periods (type, start, end).
- Pregnancy, postpartum and breastfeeding periods.
- Onboarding values: last period start, typical cycle length.
- Reminder time, per-reminder on/off switches, discreet notifications.
- Adherence targets (configurable constants).

### 6.3 Derived per cycle
- **Dates and lengths:** `start`, `end`, `length`, `period_length`, `heavy_days`, `spotting_outside_days`
- **Eligibility:** `eligible`, `excluded_reason`, `suspected_missed_log`, `ask_user`
- **Prediction snapshot:** center, lo and hi when the cycle started; error; whether it landed in range
- **Temperature:** `n_valid_bbt`, `coverline_c`, `first_high_date`, `confirm_date`, `shift_rule`, `ovulation_est_day`, `luteal_length`, `shift_uncertain`
- **Mucus:** `first_mucus_day`, `first_fertile_mucus_day`, `peak_day`
- **Fertility windows:** `fertile_calendar_[lo,hi]`, `fertile_observed_[lo,hi]`
- **Pain:** `peak_cramp`, `mean_cramp_d-2..3`, `headache_days`, `painkiller_days`, `high_impact_days`
- **Adherence:** `adh_{mg, exercise, sugar, sleep}` = {known, value, coverage, on_track}
- **Red flags:** `red_flags[]`

### 6.4 Reminder state
`key` (type:cycleStart), `type`, `fire_at`, `status` (pending, sent, cancelled, skipped), `os_id` (equal to key), `sent_at`.

---

## 7. Gaps and edge cases for the developer to decide

1. **Blank third bullet under Bleeding.** Likely candidates are spotting, clots or product changes, or blood colour. I'd add spotting plus clots and product changes, because heavy-bleeding detection depends on them.
2. **"get tean".** Probably "tea", but which kind? Ginger has some low-quality evidence [10]. Caffeinated tea was associated with worse pain in one survey [11]. It could also be a typo for **TENS**, a pain-relief device, which is speculative. Or "get ready". Ask.
3. **"Period exercises" are in the pain guide but not in the tracked fields.** Add a field and define what counts (type, minutes).
4. **How sugar is entered:** a 3-level relative scale (proposed) or counted servings? How sleep is entered: hours, quality, and which night? Magnesium: yes/no or a dose? Never give dose advice; add a safety note about kidney disease and medicines.
5. **Pain scale:** 0–10 (proposed) or 4 levels? Which days count as "the period's pain" (proposed: 2 days before day 1 through day 3)? Should headaches be scored separately?
6. **Spotting:** never starts a cycle; mid-cycle spotting shows on the timeline and feeds the red-flag counter.
7. **Hormonal contraception:** pill bleeds are withdrawal bleeds, not periods. There's no temperature rise and fertility features are meaningless. Hormonal and copper IUDs differ. Post-pill cycles are often irregular.
8. **Pregnancy:** handling a late period, a pregnancy mode that pauses reminders and supplement nudges, and handling pregnancy loss with care.
9. **Postpartum, breastfeeding, perimenopause, the first years after periods begin, PCOS or thyroid conditions:** predictions and fertility windows are unreliable. Show this clearly.
10. **Missing versus "no":** an unlogged day must stay null. It is never "dry", "no magnesium" or "0 pain".
11. **Timezones, DST, travel:** store local dates. Temperature time shifts after travel should prompt the "disturbed" flag.
12. **Thermometer precision:** two decimals are needed. Wearable continuous temperatures have different baselines, and the thresholds in section 3 may not transfer.
13. **Backfilled history and edits:** re-derive everything; the sync step prevents duplicate reminders.
14. **Multiple devices or offline use:** if the app syncs, decide whether conflicts resolve per field with last-write-wins. The reminder-sent state must sync too, or the same reminder fires twice.
15. **Operating-system limits:** caps on pending local notifications and limits on background tasks **(unverified)**. Scheduling only the current cycle keeps the count small.
16. **Privacy:** reproductive health data is sensitive. Prefer local-first storage with encryption, no third-party analytics SDKs, discreet notifications and an export/delete option.
17. **Claims and regulation:** no contraception claims and no "low pain" promises. Avoid saying any supplement "treats" anything.
18. **Sensitive nudges:** the sugar reminder should be opt-in or easy to disable (eating disorders, diabetes).
19. **Minors:** age-appropriate consent and wording if teenagers use the app.
20. **Sex drive:** pick a scale (1–5 proposed). Decide whether it is shown only, or analysed later as a personal pattern.
21. **Clinician review:** the red-flag thresholds and urgent-care wording should be reviewed by a clinician before launch.

---

## Sources

All of these came from search results; no page could be opened, so details rest on search summaries.

1. Bull et al. 2019, npj Digital Medicine, real-world cycle characteristics: https://discovery.ucl.ac.uk/id/eprint/10084180/
2. Contemporary OB/GYN summary of Bull 2019 (exclusion criteria): https://www.contemporaryobgyn.net/mobile-app-reveals-real-world-data-about-menstrual-cycles
3. Fehring, Schneider & Raviele 2006, Variability in the phases of the menstrual cycle: https://pubmed.ncbi.nlm.nih.gov/16700687/
4. Li et al. 2020, npj Digital Medicine (Clue data): https://pmc.ncbi.nlm.nih.gov/articles/PMC7250828
5. Li, Urteaga et al., generative model for cycle lengths accounting for skipped tracking: https://arxiv.org/abs/2102.12439v1
6. Wilcox, Dunson & Baird 2000, BMJ, timing of the fertile window: https://pubmed.ncbi.nlm.nih.gov/11082086/
7. Wilcox, Weinberg & Baird 1995, NEJM, timing of intercourse relative to ovulation: https://www.talmudology.com/s/TIMING-OF-SEXUAL-INTERCOURSE-IN-RELATION-TO-OVULATION-NEJM-1995.pdf
8. Armour et al. 2019, Cochrane, Exercise for dysmenorrhoea: https://pubmed.ncbi.nlm.nih.gov/31538328/ and https://cochranelibrary.com/cdsr/doi/10.1002/14651858.CD004142.pub4/information/en
9. Cochrane 2001, Herbal and dietary therapies for primary and secondary dysmenorrhoea (authorship not confirmed in results): https://pubmed.ncbi.nlm.nih.gov/11687013/
10. Cochrane 2016, Dietary supplements for dysmenorrhoea: https://pubmed.ncbi.nlm.nih.gov/27000311/
11. Al-Husban et al. 2022, Int J Women's Health, Jordan cross-sectional study: https://pmc.ncbi.nlm.nih.gov/articles/PMC9013668 (registered as https://clinicaltrials.gov/study/NCT04583943)
12. MSD Manual, Normal Menstrual Parameters (FIGO 2018): https://www.msdmanuals.com/professional/multimedia/table/normal-menstrual-parameters
13. StatPearls, Physiology, Menstrual Cycle: https://ncbi.nlm.nih.gov/books/NBK500020
14. Human Reproduction 2024, 39(11):2565, luteal versus follicular variance: https://academic.oup.com/humrep/article/39/11/2565/7775370
15. Taking Charge of Your Fertility (TCOYF), Guidelines for Celsius Temperatures: https://www.tcoyf.com/celsius-guidelines/
16. Patent describing a 3-over-6 variant: https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/9155523
17. Georgian adolescent survey (I believe it is this URL; the link between URL and study is unverified): https://pmc.ncbi.nlm.nih.gov/articles/PMC3939234
18. Indonesian cross-sectional study, junk food and sleep quality and dysmenorrhoea: https://journal.poltekkesjambi.ac.id/index.php/JBKM/article/view/1169
19. nidirect, Period problems: https://www.nidirect.gov.uk/conditions/period-problems
20. NHS, Heavy periods: https://www.nhs.uk/conditions/heavy-periods/
21. AAFP 2021 dysmenorrhoea review: https://www.aafp.org/pubs/afp/issues/2021/0800/p164.pdf
22. PubMed review on secondary dysmenorrhoea and onset after 25: https://pubmed.ncbi.nlm.nih.gov/3054962/