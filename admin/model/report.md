# Winner model report

Generated 2026-10-07T22:59:46.862Z from `firestore-backup-2026-10-07T21-58-17-142Z.json`.
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
