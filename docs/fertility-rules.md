<!-- Not checked against the Sensiplan handbook. Not a validated or certified contraceptive algorithm. See SPEC.md, "Natural contraception". -->
# Conservative symptothermal rule specification (app v1)

## 0. Status, provenance and principle

This spec merges two derivations:
- **L**: the literature / Sensiplan derivation. Almost all of it came from search-result text, not from opened pages.
- **S**: the sympto@3.0.2 source plus drip's adapter.

Every rule carries one of these labels:

| Label | Meaning |
|---|---|
| **[L-seen]** | Stated in a source the literature agent saw, via search text |
| **[L-unverified]** | The literature agent's belief or inference; no source confirmed it |
| **[S]** | Behaviour of sympto/drip |
| **[App]** | A conservative choice made here, in neither source |

No new web sources were consulted while reconciling, so no new citations are added. **Nothing below has been checked against the Sensiplan handbook ("Natürlich & sicher" / "Natural & Safe").**

**Principle.** Every day is `fertile` unless a rule below proves otherwise from recorded data. Missing, unknown, provisional, contradictory or out-of-scope data always resolves to `fertile`. Where L and S differ, the option that declares fewer infertile days wins.

**Regulatory note [L-seen, inference].** A distributed app that tells users which days are infertile, for contraception, is the device type covered by:
- US: 21 CFR 884.5370 (product code PYT);
- EU: MDR Annex VIII Rule 15 (Class IIb).

Shipping infertile statuses on the App Store or Google Play in the US or EU without clearance carries regulatory and store-review risk (Apple 1.4.1). This spec is the algorithm only.

---

## 1. Units, storage, validation

**Temperatures**
- Store as integers in hundredths of the entry unit (°C or °F), together with the raw input, unit, measurement time, route and thermometer id.
- One unit, one route (oral, vaginal or rectal) and one thermometer per cycle. **[L-unverified]** for Sensiplan; **[App]** enforcement: if a cycle contains readings from more than one route or thermometer, temperature evaluation for that cycle returns NONE.
- Thermometer resolution must be 0.01 or 0.05 °C. A 1-decimal fever thermometer blocks evaluation. Basis: TCOYF says a 1-decimal fever thermometer is inadequate **[L-seen]**; blocking is **[App]**.
- Plausible range: 35.00–38.50 °C (95.00–101.30 °F). Values outside it are rejected at input.

**Thresholds** (integer hundredths of the unit)

| Name | °C | °F | Meaning |
|---|---|---|---|
| `ABOVE` | 5 (0.05 °C) | 9 (0.09 °F, which equals 0.05 °C) | "Higher than the coverline" |
| `RISE` | 20 (0.20 °C) | 36 (0.36 °F) | The 0.2 rule. **Note:** L's "0.9 °F" is wrong; 0.2 °C = 0.36 °F. |

**Why "higher" means at least 0.05 above, not "strictly greater" [App]**
- For any two readings, t − CL ≥ 0.05 implies both:
  - raw t > CL (L's definition);
  - t > CL after sympto's 0.05 rounding (S's definition).
- It is therefore at least as strict as both. Readings 0.01–0.04 above the coverline are treated as "on/below" (a dip).

**Why the 0.2 test uses raw values [App]**
- Rounding is monotone, so a raw difference ≥ 0.20 always passes after rounding too. The raw test is therefore at least as strict as sympto's rounded test.
- Example: CL 36.50 and a third reading of 36.69. Raw difference is 0.19, so it **fails** here. sympto rounds 36.69 to 36.70 and passes it.

---

## 2. Output per day and the evening rule

```
DayStatus = {
  date, cycleDay,
  status: 'fertile' | 'infertile_pre_ovulatory' | 'infertile_post_ovulatory' | 'period' | 'not_applicable',
  periodFertility?: 'fertile' | 'infertile_pre_ovulatory',   // only when status == 'period'
  eveningTransition?: true,  // day stays 'fertile'; infertile from this evening
  provisional?: true,        // future day projected from the current state
  reasons: string[],         // rule codes for "show the evidence"
  evidence?: { coverline, fhmDay, tempRule, tempCompleteDay, peakDay, effectivePeakDay, mucusCompleteDay }
}
```

**Post-ovulatory start.** Infertility begins on the evening of the confirming day S **[L-seen][S]**. In a day-granular app:
- Day S is `fertile` with `eveningTransition: true`. UI text: "Fertile today; infertile from this evening (temperature + mucus confirmed)".
- Days S+1 onward are `infertile_post_ovulatory`.

**Pre-ovulatory infertile days.** Granted only when that day's observation is final (`observationComplete`, normally logged in the evening), so the status covers that evening. **[App]** Before the day is final, today shows `fertile` with reason `awaiting_evening_observation`.

**Future days**
- `fertile`, except days after S while the post-ovulatory state is INFERTILE.
- Those show `infertile_post_ovulatory` with `provisional: true`.
- Future pre-ovulatory days are always `fertile`.

**Precedence per day**
1. Context `not_applicable`: active hormonal contraception (pill, patch, ring, injection, implant, hormonal IUD) or pregnancy.
2. Context lock, which forces `fertile` with a reason:
   - postpartum;
   - breastfeeding;
   - perimenopause flag;
   - emergency contraception taken in this cycle;
   - temperature evaluation blocked (route, thermometer or unit mix; resolution);
   - cycle with unknown start.
3. `infertile_post_ovulatory` (sections 7–8).
4. `infertile_pre_ovulatory` (section 9).
5. `fertile`.

If the day is in the period run (section 3) and the status is not `not_applicable`, output `status: 'period'` with `periodFertility` set to the result of steps 2–5. That can only be `fertile` or `infertile_pre_ovulatory`, because S ≥ CD 9.

---

## 3. Cycles and the period

**Cycle start**
- Cycle day 1 is the first day with flow ≥ light (not spotting). The user confirms "period started".
- Spotting before it belongs to the previous cycle and does not change that cycle's status.

**Period run.** CD1 plus the following contiguous days with any bleeding (spotting counts), with no gap days.

**Bleeding after the period run** (mid-cycle spotting):
- Logged as bleeding.
- Mucus on such days is usually "not assessable", which makes the day UNKNOWN.
- After CD5, any bleeding makes a pre-ovulatory day fertile **[L-unverified, adopted]**.

**Excluded cycles**
- A cycle whose start is unknown (app started mid-cycle) is all `fertile`. It is never used as a "previous cycle".
- A cycle is **affected** if it had hormonal contraception, emergency contraception, pregnancy, postpartum or breastfeeding on any day.
  - Affected cycles never pass the pre-ovulatory gate.
  - Affected cycles are never counted towards the 12.

**First cycle** (`firstCycle = true`) when any of these holds:
- there is no complete, known-start cycle immediately before this one in the app;
- that previous cycle was affected.

The first natural cycle after hormonal contraception is therefore a first cycle.

---

## 4. Mucus classification (quality Q)

Q values: 0 = t (dry), 1 = Ø (nothing), 2 = f (moist), 3 = S, 4 = S+, or UNKNOWN. Full mapping in the `mucus_mapping` output.

```
Q = max(SENS[sensation], APP[appearance], COLOR[color], stretchy ? 4 : -1)
if user marked "unsure":  Q = min(4, Q + 1)                        // [App] rate upwards
if Q >= 2:  return Q    // a fertile sign counts even if the entry is partial, provisional,
                        // marked not assessable, or contaminated by semen/lubricant
if sensation or appearance missing, or entry not observationComplete,
   or notAssessable (bleeding / possible infection / medication / semen / lubricant):
    return UNKNOWN
return Q   // 0 or 1
```

Rules:
- Sensation is rated upwards: "wet" maps to S+ **[App]**, where drip maps it to f.
- Sex drive is stored but never used **[L-unverified][S]**.

---

## 5. Temperature reading classes

| Class | When | Use as a low | Use as a higher reading |
|---|---|---|---|
| VALID | on time, no flags | yes | yes |
| SUSPECT (auto) **[App]** | see list below | yes (kept, so the coverline can only rise) | **no**: counts as on/below the coverline (dip) |
| EXCLUDED (user bracket) **[L-seen]** | user brackets it with a mandatory reason code: fever/illness, alcohol, short or disturbed sleep, late/early measurement, travel/time zone, medication, other | no (a gap) | no: counts as a dip |
| MISSING | no reading | gap | dip |

SUSPECT is assigned automatically when:
- measurement time differs from the usual time by more than 60 min (`OFF_TIME_MIN`); the usual time is the user setting, else the previous cycle's median;
- sleep before measurement is under 3 h, from the sleep log (threshold **[L-seen-anecdotal]**, TCOYF via Reddit);
- illness was logged that day, or alcohol the evening before, without the user bracketing the reading.

Bracketing rules:
- Never automatic.
- Never allowed without a reason.
- The UI warns that bracketing a low makes the coverline lower.

---

## 6. Temperature evaluation

### STRICT (used for status)

Inputs: cycle days 1..E, where E is the evaluation day, and `firstCycle`.

1. **Block.** If the readings up to E include more than one route, thermometer or unit, return NONE.
2. **Candidates.** Scan candidate days f = 7..E in order. A candidate's own reading must be VALID.
3. **Six lows.** Walk back from f−1 and collect VALID or SUSPECT readings until there are 6.
   - Each MISSING or EXCLUDED day passed over counts as a gap.
   - More than 2 gaps (`MAX_LOW_GAPS`), or reaching CD1 before 6 are collected: skip this candidate. **[App]** L suggested a cap; S has none.
   - Coverline CL = max(lows) **[L-seen][S]**. Lows come only from the current cycle **[S]**.
4. **First higher measurement (FHM).** f is the FHM candidate if temp(f) − CL ≥ ABOVE.
5. **Higher readings** are on consecutive calendar days f+1, f+2, f+3 (and one more in the first cycle) **[App]**.
   - A(d) = "above": VALID and temp(d) − CL ≥ ABOVE.
   - R(d) = "risen": VALID and temp(d) − CL ≥ RISE.
   - Any day that is not A, including MISSING, EXCLUDED and SUSPECT, is a **dip**.
6. **Rules**, tried in order. The two exceptions are never combined **[L-seen][S]**.

| Rule | Condition | Completes on |
|---|---|---|
| **Regular** **[L-seen][S]** | A(f+1), A(f+2) and R(f+2) | f+2 |
| **Exception 1** **[L-seen][S]** | A(f+1) and A(f+2), but not R(f+2); then A(f+3). The 4th reading only needs to be above the CL, not 0.2. | f+3 |
| **Exception 2** **[L-seen][S]** | Exactly one of f+1 and f+2 is a dip, the other is A; then R(f+3). How deep the dip goes does not matter. Only one dip is allowed **[L-unverified][S]**. | f+3 |
| **Fail** | Both f+1 and f+2 are dips, or the needed 4th reading fails. | — |

7. **First cycle [App].** NFPTA requires a 4th raised reading in the first recorded cycle **[L-seen]**. This spec makes it stricter: after any rule completes on day k, day k+1 must also satisfy A. Completion then moves to k+1. If it fails, the candidate fails.
8. **Pending and rescan.**
   - If a candidate needs a day later than E, return PENDING. Never jump to a later candidate while an earlier one is undecided.
   - If a candidate fails, continue scanning. Later candidates take their own 6 lows, which may include the failed readings **[S][L-unverified]**.
9. **Result.** The first CONFIRMED candidate wins **[S]**, returning `{fhm: f, CL, rule, completeDay}`. Otherwise NONE.

**Minimum data:**
- 6 lows within at most 8 calendar days;
- plus a VALID FHM;
- plus 2 more readings (3 under an exception);
- plus 1 more in the first cycle.

So at least 9 readings, and 10 or 11 in the first cycle.

### LENIENT (history only, for the minus-8 rule; equivalent to sympto) [S]

- Use all VALID and SUSPECT readings in order, ignoring gaps.
- Round to the 0.05 °C grid (5 hundredths in °C, 9 in °F).
- "Higher" means rounded value > rounded CL.
- RISE is tested on rounded values.
- Same three rules; no first-cycle extra.
- `fhmForHistory(cycle) = min(STRICT.fhm, LENIENT.fhm)` over whichever of the two confirmed. Using the earlier FHM can only shorten the pre-ovulatory phase **[App]**.

---

## 7. Mucus peak and P+3

Evaluated at day E using Q from section 4.

1. M = the highest known Q on days 1..E. This is the cycle maximum so far, which is at least as strict as sympto's running best **[App]**.
2. If M < 3, return NONE. **[App]** An f-only cycle has no peak; S allows f.
3. `first` = the first day with Q ≥ 2.
4. Effective peak p = the last day in [first, E] whose Q is UNKNOWN or ≥ M.
   - **[App]** A missing or unknown observation after fertile mucus might have been peak quality, so it is treated as one. sympto skips missing days.
   - `peakDay` = the last day ≤ E with Q == M (for display).
5. If p + 3 ≤ E, mucus is COMPLETE with `completeDay = p + 3`. By construction, days p+1..p+3 are known and lower than M.
   - Lower-quality mucus after the peak does not reset the count **[L-seen]**.
   - A return of best quality, or an unknown day, moves the peak **[L-seen] + [App]**.
6. Otherwise PENDING.

A peak that comes after the temperature completion is allowed **[S]**. The later of the two completions governs.

---

## 8. Double check and the post-ovulatory phase

**Start [L-seen][S]**
- S = the first evaluation day E on which STRICT temperature is CONFIRMED **and** mucus is COMPLETE.
- This equals max(tempCompleteDay, mucusCompleteDay).
- Freeze `CL` and `M_S = M` at that point.
- Day S: `fertile` with eveningTransition. From S+1: `infertile_post_ovulatory`.

**Disagreement handling**
- Temperature confirmed, mucus not: fertile until P+3 **[L-seen]**.
- P+3 reached, no confirmed temperature: fertile **[L-seen][S]**.
- No mucus peak (M < 3, or no mucus logged): fertile all cycle. There is no temperature-only rule.

**Days after S without entries.** They stay infertile; the method needs no further observations after the double check **[S]**.

**Safeguard [App]** (S ignores later mucus; L is silent). It applies to days after S, up to today.

1. **Reopen.** If a known Q ≥ M_S is recorded (an observation, not a missing day), set state REOPENED with rp = that day. That day and later days are `fertile`, reason `fertile_mucus_after_confirmation`.
2. **While REOPENED.** Any day with Q UNKNOWN or Q ≥ M_S moves rp to that day.
3. **Re-confirm.** On day rp+3, if the temperatures on rp, rp+1, rp+2 and rp+3 are all VALID and ≥ CL + ABOVE, that day is `fertile` with eveningTransition. Infertile again from the next day.
4. **Otherwise** stay fertile until the next cycle, unless a new rp restarts the count.

**Effect on the next cycle.** A previous cycle that ended REOPENED without re-confirmation does not pass the next cycle's pre-ovulatory gate.

**Temperature after S [App]**
- Temperature falling after S does not change status; it is display only. Premenstrual drops are normal.
- An informational hint "consider a pregnancy test" is shown if 18 or more days after S remain ≥ CL + ABOVE **[L-unverified]**.

---

## 9. Pre-ovulatory infertile days

**Gate (all of these must hold; otherwise N = 0)**
- The current cycle is not affected and has a known start.
- The immediately preceding cycle:
  - is complete and has a known start;
  - is not affected;
  - had a full double-checked post-ovulatory phase (S found), not left REOPENED.

**[S]** requires this always. L required it only for beginners and asked only for an FHM. The stricter S version is used, always. So the first cycle, the first cycle after the pill, and any cycle after an anovulatory cycle have no pre-ovulatory infertile days.

**Length N**
```
fhms     = fhmForHistory(c) for every earlier cycle with temperature data
           (affected cycles included; temperature-only shifts included)   [App]
earliest = min(fhms);  cand = earliest - 8                               [L-seen][S]
if cand < 5:                                      N = max(cand, 0)   // shortening, from any single cycle [L-seen][S]
else if count(non-affected cycles with STRICT double check) >= 12:  N = cand   // lengthening [L-seen][S]
else:                                             N = 5              // 5-day rule [L-seen][S]
```
- Earliest FHM is taken over the whole history, with no rolling window **[S]**.
- Minus-20 is not implemented: unverified in L and absent in S/drip.

**Days**
- Day d (1 ≤ d ≤ N, d ≤ today) is `infertile_pre_ovulatory` only while every day 1..d is *compatible*.
- The first non-compatible day closes the phase for the rest of the cycle **[S][L-seen]**.
- Temperature is not consulted.

A day is **compatible** if all of these hold:
- an entry exists and is `observationComplete` (missing or provisional means fertile) **[L-unverified, adopted] + [App]**; S treats unrecorded days as infertile;
- no fertile sign: Q is not ≥ 2;
- one of:
  - no bleeding and Q ∈ {0, 1} (t or Ø);
  - bleeding or spotting on cycle day ≤ 5, with mucus Q ∈ {0, 1} or "not assessable (bleeding)".

Bleeding on day 6 or later is not compatible, because it hides mucus **[L-unverified, adopted]**.

---

## 10. Special situations

| Situation | Behaviour | Basis |
|---|---|---|
| Hormonal contraception active | `not_applicable` | — |
| First natural cycle after hormonal contraception | First-cycle rules: no pre-ovulatory phase, extra higher reading | **[L-seen]** a Sensiplan section exists, content unverified |
| Postpartum or breastfeeding | Lock (`fertile`, reason `method_not_supported_postpartum`) until the user ends it. The next full cycle is a first cycle. | **[L-seen]** WHO says delay use |
| Perimenopause flag | Lock | — |
| Emergency contraception | That cycle is locked and counts as affected | **[App]** |
| No temperature shift | Rest of the cycle is fertile; the next cycle has no pre-ovulatory phase | — |
| Cycle longer than 35 days without S | Informational message only | — |

---

## 11. Pseudo-code

```ts
const ABOVE = {C: 5, F: 9}, RISE = {C: 20, F: 36};
const MAX_LOW_GAPS = 2, MIN_PEAK_Q = 3, OFF_TIME_MIN = 60, SHORT_SLEEP_MIN = 180;

function tempKind(c, d): 'VALID'|'SUSPECT'|'EXCLUDED'|'MISSING' {
  const r = c.day(d)?.bbt; if (!r) return 'MISSING';
  if (r.excluded) return 'EXCLUDED';                       // reasonCode required by UI
  if (Math.abs(minutes(r.time) - minutes(c.refTime)) > OFF_TIME_MIN) return 'SUSPECT';
  if (r.sleepMinutesBefore != null && r.sleepMinutesBefore < SHORT_SLEEP_MIN) return 'SUSPECT';
  if (c.day(d).illness || c.day(d-1)?.alcohol) return 'SUSPECT';
  return 'VALID';
}

function evalTempStrict(c, E, firstCycle) {
  if (c.mixedRouteDeviceOrUnit(1, E) || c.lowResolution) return {status: 'NONE', reason: 'blocked'};
  const u = c.unit, T = (d) => c.day(d).bbt.v;           // integer hundredths
  for (let f = 7; f <= E; f++) {
    if (tempKind(c, f) !== 'VALID') continue;
    // collect 6 lows
    const lows = []; let gaps = 0, d = f - 1;
    while (d >= 1 && lows.length < 6) {
      const k = tempKind(c, d);
      if (k === 'VALID' || k === 'SUSPECT') lows.push(T(d)); else if (++gaps > MAX_LOW_GAPS) break;
      d--;
    }
    if (lows.length < 6 || gaps > MAX_LOW_GAPS) continue;
    const CL = Math.max(...lows);
    if (T(f) - CL < ABOVE[u]) continue;
    const A = (x) => tempKind(c, x) === 'VALID' && T(x) - CL >= ABOVE[u];
    const R = (x) => tempKind(c, x) === 'VALID' && T(x) - CL >= RISE[u];
    if (f + 2 > E) return {status: 'PENDING', fhm: f, CL};
    let k = null, rule = null; const bA = A(f+1), cA = A(f+2);
    if (bA && cA && R(f+2)) { k = f+2; rule = 'regular'; }
    else if (bA || cA) {
      if (f + 3 > E) return {status: 'PENDING', fhm: f, CL};
      if (bA && cA) { if (A(f+3)) { k = f+3; rule = 'exception1'; } }
      else          { if (R(f+3)) { k = f+3; rule = 'exception2'; } }   // exactly one dip
    }
    if (k !== null && firstCycle) {
      if (k + 1 > E) return {status: 'PENDING', fhm: f, CL};
      k = A(k+1) ? k + 1 : null;
    }
    if (k !== null) return {status: 'CONFIRMED', fhm: f, CL, rule, completeDay: k};
    // failed -> keep scanning
  }
  return {status: 'NONE'};
}

function evalTempLenient(c, E) {           // history only (minus-8)
  const g = c.unit === 'C' ? 5 : 9, rd = (v) => Math.round(v / g) * g;
  const s = days(1, E).filter(d => ['VALID','SUSPECT'].includes(tempKind(c, d)))
                      .map(d => ({d, v: rd(c.day(d).bbt.v)}));
  for (let i = 6; i + 2 < s.length; i++) {
    const CL = Math.max(...s.slice(i-6, i).map(x => x.v));
    if (s[i].v <= CL) continue;
    const b = s[i+1].v > CL, cc = s[i+2].v > CL;
    if (b && cc && s[i+2].v - CL >= RISE[c.unit]) return {fhm: s[i].d};
    if (i + 3 < s.length) {
      if (b && cc && s[i+3].v > CL) return {fhm: s[i].d};
      if (b !== cc && s[i+3].v - CL >= RISE[c.unit]) return {fhm: s[i].d};
    }
  }
  return null;
}
const fhmForHistory = (c) => minNonNull(evalTempStrict(c, c.length, c.firstCycle).fhm, evalTempLenient(c, c.length)?.fhm);

function evalMucus(c, E) {
  let M = -1, first = null;
  for (let d = 1; d <= E; d++) { const q = mucusQ(c.day(d));
    if (q !== null) { M = Math.max(M, q); if (q >= 2 && first === null) first = d; } }
  if (M < MIN_PEAK_Q) return {status: 'NONE'};
  let p = first;
  for (let d = first; d <= E; d++) { const q = mucusQ(c.day(d)); if (q === null || q >= M) p = d; }
  return p + 3 <= E ? {status: 'COMPLETE', M, effectivePeak: p, completeDay: p + 3}
                    : {status: 'PENDING', M, effectivePeak: p};
}

function compatiblePre(c, d) {
  const e = c.day(d); if (!e || !e.observationComplete) return false;
  const q = mucusQ(e); if (q !== null && q >= 2) return false;
  if (e.bleeding !== 'none') return d <= 5;
  return q !== null;                                    // t or Ø
}

function preOvLength(c, hist) {
  const prev = hist.at(-1);
  if (c.affected || !c.knownStart || !prev || !prev.immediatelyBefore(c) || prev.affected
      || !prev.knownStart || !prev.result.S || prev.result.reopenedUnresolved) return 0;
  const earliest = Math.min(...hist.map(fhmForHistory).filter(x => x != null));
  const cand = earliest - 8;
  if (cand < 5) return Math.max(cand, 0);
  const n = hist.filter(h => !h.affected && h.result.S).length;
  return n >= 12 ? cand : 5;
}

function evaluateCycle(c, hist, today) {
  const L = c.lastIndexOnOrBefore(today), first = c.firstCycle;
  let S = null, CL = null, M = null;
  for (let E = 1; E <= L && !c.locked; E++) {
    const t = evalTempStrict(c, E, first); if (t.status !== 'CONFIRMED') continue;
    const m = evalMucus(c, E);
    if (m.status === 'COMPLETE') { S = E; CL = t.CL; M = m.M; break; }
  }
  const N = c.locked ? 0 : preOvLength(c, hist);
  let preOpen = N > 0, post = 'NONE', rp = null; const out = [];
  for (let d = 1; d <= c.length; d++) {
    let s = 'fertile'; const reasons = []; let evening = false, provisional = false;
    const q = d <= L ? mucusQ(c.day(d)) : null;
    if (S !== null && d > S) {
      if (post === 'NONE') post = 'INFERTILE';
      if (d <= L) {
        if (post === 'INFERTILE' && q !== null && q >= M) { post = 'REOPENED'; rp = d; reasons.push('fertile_mucus_after_confirmation'); }
        else if (post === 'REOPENED' && (q === null || q >= M)) rp = d;
      }
      if (post === 'INFERTILE') { s = 'infertile_post_ovulatory'; provisional = d > L; }
      else if (d <= L && d === rp + 3 &&
               [rp, rp+1, rp+2, rp+3].every(x => tempKind(c, x) === 'VALID' && c.day(x).bbt.v - CL >= ABOVE[c.unit])) {
        evening = true; post = 'INFERTILE';            // infertile from next day
      }
    }
    if (s === 'fertile' && d <= N && d <= L && preOpen && post === 'NONE') {
      if (compatiblePre(c, d)) s = 'infertile_pre_ovulatory'; else preOpen = false;
    }
    if (d === S) evening = true;
    const lock = c.contextLock(d);                          // 'not_applicable' | 'locked' | null
    if (lock === 'not_applicable') s = 'not_applicable';
    else if (lock === 'locked') { s = 'fertile'; evening = false; }
    const base = {cycleDay: d, reasons, eveningTransition: evening || undefined, provisional: provisional || undefined};
    out.push(s !== 'not_applicable' && c.inPeriodRun(d)
      ? {...base, status: 'period', periodFertility: s}
      : {...base, status: s});
  }
  return out;
}
```

The whole history is re-evaluated from scratch after any edit. Each day's status as shown to the user at the time is logged, so later edits are auditable.

---

## 12. Test fixtures (referenced by the test cases)

All readings are oral, from one 2-decimal thermometer, taken at the usual time, and VALID unless stated. All mucus entries are `observationComplete`.

**P** (temperatures CD1–15, °C):
`36.50, 36.40, 36.45, 36.40, 36.50, 36.45, 36.40, 36.45, 36.50, 36.40, 36.45, 36.40, 36.50, 36.45, 36.40`
- No day in CD7–15 is ≥ 0.05 above its 6 lows.
- For a candidate on CD16, the coverline (lows CD10–15) = 36.50.

**Mbase** (bleeding and mucus):

| Days | Bleeding | Sensation / appearance | Q |
|---|---|---|---|
| CD1–4 | heavy, heavy, medium, light | not assessable (bleeding) | UNKNOWN |
| CD5 | spotting | dry / none | t |
| CD6–8 | none | dry / none | t |
| CD9–10 | none | nothing / none | Ø |
| CD11 | none | moist / none | f |
| CD12–13 | none | nothing / creamy | S |
| CD14–15 | none | slippery / egg-white | S+ |
| CD16 | none | nothing / creamy | S |
| CD17 | none | moist / none | f |
| CD18 | none | nothing / none | Ø |
| CD19 to end | none | dry / none | t |

With Mbase: M = 4, effective peak CD15, mucus complete CD18.

**Hstd** (standard history): the immediately previous cycle had a STRICT double check (FHM CD15), there are fewer than 12 cycles, and the earliest FHM in history is ≥ CD13. So N = 5 and the cycle is not a first cycle.

**T1hi** (high temperatures): CD16 36.60, CD17 36.65, CD18 36.75, CD19–28 36.75. Next period on CD29.
---

# Amendments (binding)

These amendments come from an adversarial red-team review of the rules above. **They override sections 0–11 wherever the two disagree.** Each one closes a path by which the original rules could mark a fertile day as infertile. When a test case in `fertility-test-cases.json` conflicts with an amendment, the amendment wins. The test is then updated and the reason is recorded in a comment.

Data comes from `src/core/types.ts`. Cycles come from `src/core/cycles.ts`: a cycle starts only on a day with `periodStartConfirmed`. Dates are `YYYY-MM-DD` local dates from `src/core/date.ts`. Never use millisecond arithmetic.

## A1. Ending post-ovulatory infertility (critical)
After S, the post-ovulatory state ends and days become `fertile` at the earliest of:
- (a) **reason `possible_new_cycle`**: any day after S with flow ≥ light, whether or not it was confirmed as a period start;
- (b) **reason `possible_new_cycle`**: 2 consecutive spotting days on or after FHM+10;
- (c) **reason `temperature_drop`**: 2 consecutive VALID readings ≤ CL on or after FHM+10;
- (d) **reason `luteal_phase_too_long`**: day FHM+19 (a hard cap). From then on the UI suggests logging the period or taking a pregnancy test.

Future days (after today) never get an infertile status. Only today and the past are evaluated, so there is no `provisional` projection.

## A2. Typed mucus mapping (critical)
- Use exhaustive `Record<Enum, number>` maps, with `-1` meaning "no contribution".
- An unknown or unmapped value gives UNKNOWN, unless another input on the same day gives Q ≥ 2.
- Assert that Q is an integer in 0..4; anything else is UNKNOWN.
- `evalMucus` returns NONE when no day has Q ≥ 2.
- Guard every `Math.min`/`Math.max` over a possibly empty list, and every arithmetic result, with `Number.isFinite`. A failed check fails closed (fertile).

## A3. Both signs must describe the same ovulation (critical)
1. **Patch reset.** Before S, if Q falls to ≤ 1 on a known, complete day after an effective peak, and later rises to ≥ 2 again, the old peak is discarded. M and p are recomputed over the latest patch only.
2. **Pairing window.** A temperature candidate pairs with the mucus result only if the effective peak lies within [FHM − 5, FHM + 3]. Otherwise that candidate is not accepted, and scanning continues to later candidates. This is an app safeguard and is not verified as a Sensiplan rule.
3. **Sustained rise.** If mucusCompleteDay > tempCompleteDay, every reading from FHM to S must be VALID and ≥ CL + ABOVE, apart from the single dip already excused by Exception 2. Otherwise the candidate is void and scanning continues.

## A4. Temperature collapse after S (major)
If 2 consecutive VALID readings fall to ≤ CL after S but before FHM+10, the cycle reopens as `fertile` with reason `temperature_collapse` for the rest of the cycle. On or after FHM+10, rule A1(c) applies instead.

## A5. Measurement time (major)
- Missing or unparseable `measuredAt` makes the reading SUSPECT.
- No usual measurement time in effect on that date (`settings.usualMeasurementTimes`, effective-dated, never retroactive) blocks temperature evaluation for the cycle, with reason `set_usual_measurement_time`.
- Compare the measurement time with the usual time in effect *on that date*. More than 60 min off makes the reading SUSPECT.
- A candidate or higher reading is also SUSPECT if its time differs by more than 60 min from the median time of its own 6 lows.

## A6. Time zones (major)
A reading taken within 3 days after the device UTC offset changed by ≥ 60 min (compared with the previous reading's `utcOffsetMinutes`) is SUSPECT.

## A7. Several readings on one date (minor)
For the coverline, the day's value is the maximum of its non-excluded readings. As a higher reading, the day is SUSPECT, and its value is the minimum.

## A8. Units, rounding and resolution (major)
- Compare only integers, in the unit the reading was entered in.
- If a cycle's readings use more than one unit, route or `thermometerId`, temperature evaluation is blocked for the whole cycle.
- Never convert stored readings between units.
- Fahrenheit thresholds are ABOVE = 9 and RISE = 36 (hundredths of °F).
- The LENIENT grid in °F is `3200 + 9k`.
- On a 0.01 thermometer, if ≥ 80 % of a cycle's readings end in 0 hundredths, evaluation is blocked with reason `low_resolution_readings`.
- On a 0.05 thermometer, any hundredths digit other than 0 or 5 blocks evaluation.
- Readings above 38.50 °C (101.30 °F) are treated as EXCLUDED (fever).

## A9. Coverline and SUSPECT lows (major)
- Collect the 6 lows from VALID readings only.
- CL = max(those 6 lows, and every SUSPECT reading within the walked span). EXCLUDED readings are ignored, which is faithful to the method's bracketing.
- Gaps (MISSING or EXCLUDED days) passed over while walking back: at most 2.

## A10. Incomplete and late mucus entries (major)
- Days p+1..p+3 must each have an `observationComplete` entry with known Q < M.
- An incomplete entry is UNKNOWN when placing the peak (it moves p). Its Q ≥ 2 still counts toward M and still closes the pre-ovulatory phase.
- An observation `completedAt` before `settings.eveningObservationTime` on its own date is not complete.
- **Recalled entries.** A mucus entry whose `updatedAt` is later than 12:00 local on the day after its date is "recalled". So is a reading whose `enteredAt` is that late. For a recalled mucus entry, Q ≥ 2 counts but Q ≤ 1 is UNKNOWN. A recalled temperature reading is SUSPECT.
- To compare an instant with a local date, use the reading's or log's `utcOffsetMinutes` where available, otherwise the device offset passed in by the caller.

## A11. What counts as a first cycle (major)
`firstCycle = true` unless the immediately previous cycle was **charted**, which means all of:
- it is complete and not affected;
- it has temperatures on ≥ 80 % of its days;
- it has complete mucus entries on ≥ 80 % of its days;
- it has no run of more than 3 consecutive days with neither.

## A12. Plausibility gate for pre-ovulatory days (major)
In addition to section 9's gate, the previous cycle must meet all of:
- length 21–40 days;
- current CD1 ≥ previous FHM + 10;
- temperatures recorded on ≥ 70 % of the days from S to its end;
- no logging gap of more than 3 days.
Otherwise N = 0.

## A13. Affected and locked cycles (major)
- A cycle is **locked** (`cycleLocked`) if it is affected (any context period overlaps it, or a `CycleContextAnswer` for its start says yes to anything), if its context question for its start is unanswered, or if temperature evaluation is blocked by A8. A blocked temperature only prevents post-ovulatory infertility; the pre-ovulatory rules still need the gate.
- A locked cycle grants no infertile status of any kind.
- Readings and mucus from days inside a context period are never used.
- Hormonal contraception or pregnancy on a day gives `not_applicable`.

## A14. Unsure (major)
- `unsure` on a day makes it not compatible for the pre-ovulatory phase, with Q = max(Q + 1, 2).
- An unsure day is UNKNOWN for the post-peak count.

## A15. Strict pre-ovulatory compatibility (major)
- `flow` undefined means not compatible.
- On a bleeding or spotting day ≤ CD5: compatible only if Q ∈ {0, 1} or `notAssessable === 'bleeding'`.
- Bleeding on CD6 or later is not compatible.
- Every compatible day needs explicit user-entered values.

## A16. Minus-8 history (major)
- For every completed, known-start cycle with no FHM from STRICT or LENIENT, use a pseudo-FHM of `length − 16`.
- Count the 12 cycles for lengthening only if they have a known start, are not affected, are not locked, have S, and did not end reopened.
- Leading spotting days before CD1 (`Cycle.leadingSpottingDays`) reduce N by the same number of days.

## A17. Edit safety (major)
- The engine is pure and stateless.
- The app layer stores every status shown for today, with a timestamp.
- If re-evaluation turns a previously shown infertile day into a fertile one, the app shows a blocking alert that lists any `intercourse: 'unprotected'` on the affected days and points to emergency contraception time limits.
- The engine exports a function to diff two evaluations for this purpose.

## A18. Display (minor)
- Fertility status is primary.
- A period is a secondary badge: `inPeriod: boolean` on the day result, never a status of its own.
- Period days can still be `fertile`.

## A19. Re-confirmation after reopening uses the same route and thermometer only (minor)
Otherwise the cycle stays fertile until the next cycle.

## Output contract (replaces section 2's type)
```ts
type FertilityStatus = 'fertile' | 'infertile_pre_ovulatory' | 'infertile_post_ovulatory' | 'not_applicable';
interface DayFertility {
  date: ISODate; cycleDay: number | null; status: FertilityStatus;
  inPeriod: boolean;
  eveningTransition?: true;      // day stays fertile; infertile from this evening
  reasons: string[];             // stable rule codes for "why"
}
```
Days before the first confirmed cycle start are `fertile`, with reason `cycle_start_unknown`.
