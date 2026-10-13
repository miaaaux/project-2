# Research notes

These are the evidence behind `SPEC.md`, gathered by research agents with independent fact-checkers, in October 2026.

**Method limits:**
- Almost every paper page failed to load from the research sandbox (DNS blocks), so most figures come from search-result abstracts and snippets.
- Some fact-checkers ran out of web searches before finishing.
- Check the key numbers against the full papers before showing any of them in the app.

## Pain-guide factors

| Factor | Verdict | Key evidence | Verification |
|---|---|---|---|
| Exercise | **Supported, low certainty.** The strongest of the four. | Cochrane 2019 (Armour et al., 12 RCTs, 854 women): about 25 mm less pain on a 100 mm scale vs no exercise. Typical dose ≥ 3×/week for 45–60 min over 4–12 weeks. No trial tested short routines done only on period days. | Two independent agents found the same figures. The Cochrane figure was later confirmed from its PubMed abstract. |
| Magnesium | **Weak** | Small, mostly old positive trials (150–300 mg/day, often started around cycle day 15). Cochrane 2016 ("Dietary supplements for dysmenorrhoea", 27 RCTs) found no high-quality evidence for any supplement and did not assess magnesium. | Independently fact-checked; the verdict was "weak, if anything weaker". |
| Sugar | **Weak** (observational only) | Cross-sectional links between sweets or sugary drinks and more pain (e.g. Al-Husban 2022, n = 1,988). No trial of cutting sugar. **No evidence for the "2 weeks before" timing.** Appetite rises naturally in the luteal phase. | Fact-check could not run (search cap). |
| Sleep | **Mixed:** a consistent association, direction unclear | Pain disrupts sleep, and poor sleep may amplify pain. No interventional trial. Only sleep *before* the period is useful as a predictor. | Fact-check could not run (search cap). |
| Tea | **Weak** as a treatment | Ginger has small-trial evidence, mostly from capsules (750–2,000 mg/day, days 1–3), not tea. Caffeinated tea was associated with more pain in one survey and hurts sleep. **Heat** has better evidence (e.g. heat patch vs ibuprofen, Akin 2001). | Fact-check could not run (search cap). |

Safety points adopted from the research:
- **Magnesium:** at most 350 mg/day from supplements (NIH ODS). Avoid with kidney disease, and watch interactions with antibiotics, bisphosphonates, diuretics and proton-pump inhibitors.
- **Sugar nudges** are opt-in, because of eating-disorder and diabetes risk.
- **No medication dosing** in the app.
- **Red flags** point to secondary dysmenorrhoea (e.g. endometriosis) and to ectopic pregnancy.

## Exercises

These are the source trials behind the library in `src/core/exercises.ts`. Full research output, including corrections, is in `docs/exercise-research.json`.

- **Rakhshaee 2011** (n = 92, PEDro reportedly 4/10): cobra, cat and fish poses in the luteal phase reduced pain intensity and duration. Session about 20 min; frequency was "about 3×/week" per a secondary source, so "daily" is not supported.
- **Shahr-jerdy 2012** (n = 179, ages 15–17): 10-min home routine, twice a day, 3 days a week, for 8 weeks. Pain fell from 7.65 to 4.88. The exact exercises are unverified.
- **Vaziri 2015** (n = 105): stretching or aerobic exercise 3×/week for 8 weeks; both beat control.
- **Tsai 2024** network meta-analysis (29 RCTs): every exercise type beat control by 8 weeks; relaxation ranked first at 4 weeks.
- **Kannan 2019** (PEDro 6/10): aerobic training; benefits lasted to 7 months.
- **Celenay 2024:** progressive muscle relaxation from ovulation to the period, 3×/week.
- **Cochrane 2019** reports that its trials gave no adverse-event data, so safety, including on bleeding days, is not established.

## Natural contraception

- **Rules:** see `docs/fertility-rules.md`. Two independent derivations were reconciled conservatively:
  - the Sensiplan literature;
  - the open-source `sympto` library, read for its rules only. It is AGPL-licensed and no code was copied.
- **Red team:** a review found 3 critical and about 20 major or minor failure modes. All fixes are adopted as binding amendments.
- **Effectiveness (Sensiplan taught in person, Frank-Herrmann et al., Hum Reprod 2007;22:1310):** 900 women, 17,638 cycles. 0.6 pregnancies per 100 women over 13 cycles with no unprotected intercourse in the fertile time; 1.8 per 100 overall. These are *not* this app's figures.
- **Comparison:** Natural Cycles' FDA figures are 1.8 % perfect use and 6.5 % typical use (15,570 women). The Standard Days calendar method is 4.75 % correct use and 11.96 % typical use (Arevalo 2002).

**Regulation (fact-checked):**
- **US:** 21 CFR 884.5370, product code PYT, Class II.
  - Natural Cycles: De Novo DEN170052, 2018-08-10.
  - Clue Birth Control: K193330, 2021-02-18.
  - Special controls include clinical performance testing, human factors testing, and software verification and validation.
- **EU:** MDR Annex VIII Rule 15, Class IIb.
- **Apple App Review Guideline 1.4.1:** "…if the level of accuracy or methodology cannot be validated, we will reject your app."
- **Google Play:** a health apps declaration is required. A non-device health app must say it is "not a medical device".

## Main sources

- Cochrane, Exercise for dysmenorrhoea (2019): https://pubmed.ncbi.nlm.nih.gov/31538328/
- Cochrane, Dietary supplements for dysmenorrhoea (2016): https://pubmed.ncbi.nlm.nih.gov/27000311/
- Cochrane, Herbal and dietary therapies (2001, magnesium): https://pubmed.ncbi.nlm.nih.gov/11687013/
- Al-Husban 2022, diet, sleep and dysmenorrhoea: https://pmc.ncbi.nlm.nih.gov/articles/PMC9013668
- Bull 2019, 600k real-world cycles: https://discovery.ucl.ac.uk/id/eprint/10084180/
- Wilcox 2000, BMJ, fertile window timing: https://pubmed.ncbi.nlm.nih.gov/11082086/
- Frank-Herrmann 2007 (abstract via RRM Academy): https://rrmacademy.org/library/the-effectiveness-of-a-fertility-awareness-based-method-to-avoid-pregnancy-in-re-recfwatewz6ucgakm/
- FDA, Natural Cycles De Novo announcement: https://www.fda.gov/NewsEvents/Newsroom/PressAnnouncements/ucm616511.htm
- Clue K193330 (510(k) database): https://www.510kdatabase.net/k193330/
- Federal Register 84 FR 7994 (21 CFR 884.5370): https://www.govinfo.gov/content/pkg/FR-2019-03-06/pdf/2019-04014.pdf
- Apple App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- Google Play health policy: https://support.google.com/googleplay/android-developer/answer/16555673
- Rakhshaee 2011 yoga RCT: https://www.qigonginstitute.org/abstract-print/6371
- Nationwide Children's, yoga for cramps: https://www.nationwidechildrens.org/yoga-exercises-and-menstrual-cramps
- Vaziri 2015: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4405513/
- Kirmizigil 2020 registry: https://clinicaltrials.gov/study/NCT03625375
- TCOYF temperature guidelines: https://www.tcoyf.com/celsius-guidelines/
- NHS, heavy periods: https://www.nhs.uk/conditions/heavy-periods/
