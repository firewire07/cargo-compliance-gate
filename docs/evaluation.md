# Sanctions evaluation (T10)

Name-only screening versus contextual screening on a synthetic set of 100 air waybills. The question is not "which model is smarter" but how many unnecessary analyst holds we can avoid without missing a true listed party.

## Method

Both modes run **directly against the rule functions**. There is no Kafka, no Postgres and no running service in this evaluation. Re-run it with:

```sh
npm run eval
```

The dataset is `apps/screening-svc/data/evaluation/synthetic-awbs.v1.json`. It is clearly marked synthetic. The parties, addresses and dates are fictional. The only overlap with the real world is names already on the local demo sanctions list.

| Category | Count | Label | What it represents |
| --- | ---: | --- | --- |
| True hit, exact name | 10 | HIT | Listed party, matching country and registration |
| True hit, close variant | 6 | HIT | Typo or legal suffix, matching country |
| True hit, route only | 4 | HIT | Exact name, no party country, route still goes to the listed country |
| True hit, possible evasion | 2 | HIT | Exact name, conflicting claimed country, no registration date |
| Look-alike | 26 | PASS | Similar name, but country, address and registration belong to a different fictional company |
| Look-alike, exact name | 2 | PASS | Exact listed name, different country, no registration date |
| Clean | 50 | PASS | Ordinary commercial names with no resemblance to the list |
| **Total** | **100** | 22 HIT / 78 PASS | |

A case is a **true positive** when the sanctions check alerts on a HIT label, and a **false positive** when it alerts on a PASS label. Precision, recall, false-positive rate and alert volume are reported for each mode. "Analyst holds saved" is the drop in false positives, because in this system a sanctions hit becomes a hold for an analyst.

Name-only is the **default** in the running service (`SANCTIONS_MODE=name-only`). Contextual scoring is selected with `SANCTIONS_MODE=contextual`.

### How contextual scoring works

The name score is unchanged. Explainable adjustments are then added or subtracted:

| Signal | When it applies | Weight |
| --- | --- | ---: |
| Country | Party country matches or conflicts with the list entry | ±0.12 |
| Address | Similar or clearly different, and only when the name is not near-exact | ±0.10 |
| Date of birth or registration | Present on both sides and equal or different | ±0.12 |
| Route | Origin, destination or routing visits the listed country | +0.08 |
| Commodity / HS code | Goods text or HS prefix matches a listed risk hint | +0.05 |

Missing fields are ignored, not treated as a penalty. A near-exact listed name with only a country mismatch still alerts, because a front address is cheap to fake. Conflicting registration or date of birth can take a look-alike below the 0.85 threshold. The final score is clamped to 0–1 and compared with the same 0.85 threshold as name-only.

These weights were chosen on this same 100-AWB set.

## Results

From `npm run eval` (14 Nov 2026, Asia/Kuala Lumpur):

| Mode | TP | FP | FN | TN | Precision | Recall | FPR | Alerts |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Name-only | 22 | 28 | 0 | 50 | 44.0% | 100% | 35.9% | 50 |
| Contextual | 22 | 2 | 0 | 76 | 91.7% | 100% | 2.6% | 24 |

- **Alert volume was cut by 52%** (50 → 24) **at 100% recall**.
- **26 of 28 name-only false holds were avoided** (92.9%).
- The two leftover contextual alerts are `020-80000049` (Northern Star Logistics claimed in GB) and `020-80000050` (Midnight Cargo Services claimed in the US). Both use an exact listed name and only disagree on country. That is also what a front company would look like, so the rule still alerts.

## User impact

Every false hold is delayed cargo and analyst time. Every missed hit is a listed party that might fly. On this set, contextual screening kept every true hit and removed most of the look-alike holds, so analysts would see fewer queues without a measured recall cost.

The leftover exact-name alerts are the deliberate trade-off: I would rather an analyst review two extra look-alikes than clear an exact listed name because the shipment claimed a different country.

## Honest limits

- The data is synthetic and I labelled it myself. It is not historical customs or carrier data.
- The sample is small (100 AWBs, 22 true hits, 10 list entries).
- The weights and the look-alike stories were tuned on this same set. There is no held-out slice, so the 52% cut and 100% recall should not be quoted as a production guarantee.
- Name-only false positives are mostly legal-suffix variants of the listed names. A noisier, real-world name distribution would look different.
- Date-of-birth and registration dates are often missing in a real booking. When they are missing, contextual scoring cannot use that signal, and an exact-name look-alike will still alert.
- DG and embargo checks are out of scope here. A shipment can still be held for those reasons even if sanctions is a PASS.

## What I would do next

1. Re-run the same metrics on a held-out slice, then on labelled historical cases with an analyst in the loop.
2. Tune thresholds on a training split only, and report confidence intervals, not a single point.
3. Add known-good counterparties and repeat-shipper history as an extra supporting signal, with a documented expiry.
4. Keep name-only as a shadow score in production for a while, so a contextual PASS that name-only would have held can still be sampled for review.
5. Ingest real sanctions feeds with source, version and a documented matching policy, rather than growing the demo list.

Until that validation exists, the running service stays on **name-only**.
