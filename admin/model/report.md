# Winner model report

Generated 2026-10-08T02:06:22.459Z from `firestore-backup-2026-10-07T21-58-17-142Z.json`.
Matches used: 1680 (burn-in 186 dropped), train 1456, test (last 90 days) 224.

## Parameters (fit on all usable matches; shipped)
s = 1115.3, c = 0.0116, kappa = 43.29

## Backtest (fit on train, evaluated on test), P(red wins)
| model | Brier | log-loss |
|---|---|---|
| beta-binomial | 0.2105 | 0.6068 |
| binomial (kappa=inf) | 0.2116 | 0.6105 |

### Calibration (favourite's win probability)
| bin | n | mean predicted | observed |
|---|---|---|---|
| 0.5–0.6 | 75 | 0.547 | 0.520 |
| 0.6–0.7 | 57 | 0.641 | 0.632 |
| 0.7–0.8 | 44 | 0.756 | 0.750 |
| 0.8–0.9 | 34 | 0.859 | 0.765 |
| 0.9–1.0 | 14 | 0.936 | 0.929 |

### Margin distribution on test (predicted vs observed)
| margin | predicted | observed |
|---|---|---|
| 1 | 0.210 | 0.246 |
| 2 | 0.233 | 0.250 |
| 3 | 0.237 | 0.237 |
| 4 | 0.204 | 0.161 |
| 5 | 0.117 | 0.107 |

Note: the client prices with season-cache ELO; at a season start gaps are small and odds near even.

## Props

Samples: scoreline 1680, goal log 1636.

### Duration to the last goal (Weibull, scale = lambda·exp(b·|gap|); live matches 30 s – 30 min)
| fit | lambda | k | b | n | median at gap 0 |
|---|---|---|---|---|---|
| shipped (all) | 308.6 | 2.508 | -2.325e-4 | 1628 | 267 s |
| train | 306.5 | 2.471 | -2.177e-4 | 1406 | 264 s |

### Per-prop backtest (fit on train, evaluated on test; both team sides pooled)
| family | n | mean p | observed | Brier model | Brier base rate | Brier logistic |
|---|---|---|---|---|---|---|
| comebackAtLeast:1 | 444 | 0.225 | 0.214 | 0.1682 | 0.1683 | 0.1717 |
| comebackAtLeast:2 | 444 | 0.074 | 0.079 | 0.0728 | 0.0727 | 0.0736 |
| durationOver:240 | 222 | 0.548 | 0.568 | 0.2450 | 0.2467 | 0.2469 |
| durationOver:270 | 222 | 0.447 | 0.423 | 0.2422 | 0.2444 | 0.2445 |
| durationOver:300 | 222 | 0.353 | 0.347 | 0.2238 | 0.2276 | 0.2281 |
| durationOver:330 | 222 | 0.268 | 0.243 | 0.1835 | 0.1841 | 0.1845 |
| durationOver:360 | 222 | 0.195 | 0.176 | 0.1442 | 0.1448 | 0.1449 |
| firstScorerWins:- | 222 | 0.676 | 0.703 | 0.2091 | 0.2096 | 0.2100 |
| goesToFourFour:- | 224 | 0.210 | 0.246 | 0.1837 | 0.1863 | 0.1862 |
| marginAtLeast:2 | 448 | 0.404 | 0.377 | 0.2037 | 0.2352 | 0.2041 |
| marginAtLeast:3 | 448 | 0.286 | 0.252 | 0.1714 | 0.1896 | 0.1713 |
| marginAtLeast:4 | 448 | 0.165 | 0.134 | 0.1123 | 0.1166 | 0.1115 |
| scoresFirst:- | 444 | 0.505 | 0.500 | 0.2237 | 0.2500 | 0.2231 |
| shutout:- | 448 | 0.061 | 0.054 | 0.0515 | 0.0507 | 0.0515 |

Excluded from offers: none.

Rule: a test is excluded if, over its families pooled, the model's test Brier exceeds the base-rate Brier by
more than 0.005 or the logistic benchmark's by more than 0.01. Spec deviation: instead of switching such a
prop to the benchmark model it is simply not offered (simpler, and safe).
