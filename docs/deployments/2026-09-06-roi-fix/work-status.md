Current status — COMPLETE, 2026-09-07 15:16 ICT.

Implementation, tests, backtests, deployment and persistent minute monitoring are complete. Final authoritative report: [deployment-review.md](deployment-review.md). Both PM2 apps online with zero restarts; 36/36 ledger coverage; Binance wallet 34.27714639 USDT; monitor alerts empty. Adaptive remains shadow. Earlier checkpoints below are historical and superseded, including statements that apps are stopped or builds are pending.

---

# ROI accounting/routing/risk deployment

Authorized objective: implement fixes, test, backtest, deploy, monitor. In progress.

Rollback snapshot (private): /home/ubuntu/.local/state/chuyen-gia-crypto/deployments/20260906-roi-fix/pre-change.tar.gz and database.dump. Existing dirty changes preserved; no git reset/checkout.

Implemented pending validation: quantity-based closed-round accounting, entry+exit commissions and signed funding; stable income pagination, saturated fill-window subdivision with explicit failure; idempotent position/outcome net reconciliation with raw fill/income evidence in pnl_ledger_v2 events; preserved capital baseline; periodic recent-close reconcile; all fresh scans reach adaptive observation, raw HTF parity, live trend still requires core pass; no stop tightening to fit wallet, no synthetic target extension; fees/slippage and projected daily budget before entry; actual provider request telemetry; real cost coverage; backtest fees per fill leg and optional wallet/lot/cost qualification.

Tests/logs: /tmp/roi-fix-tests.log (46 passed, six shadow regressions subsequently fixed); /tmp/roi-fix-regression.log (targeted pass); /tmp/roi-fix-all-tests.log (running at writing). Old tsc reported errors already edited; final isolated build still required.

Remaining: finish tests/isolated build; verify accounting against 36 exchange rounds and review reconcile dry-run; run frozen core/pullback + adaptive replay; current exchange flat check; apply reviewed accounting, set adaptive mode shadow and normalization false, deploy candidate dist via PM2; monitor at least two market/dispatch cycles and establish persistent read-only monitor; final deployment report with limitations.


2026-09-07 10:09 ICT checkpoint:
- Full acceptance suite: 100 files / 592 tests passed (/tmp/roi-fix-acceptance-tests.log). Additional provider telemetry/int64 income parser/pagination: 8 tests passed (/tmp/roi-fix-extra-tests.log), 4 of them newly added (596 unique tests total).
- Latest source change: selective lossless income tranId JSON parser on /fapi/v1/income, motivated by 51 historical IDs beyond Number.MAX_SAFE_INTEGER. Final candidate build rerunning, then verify actual API IDs are strings. No other source changes planned.
- Core 60d replay completed four comparisons; baseline nominal 4 trades +3.12732844 USD, wallet-qualified 1 trade -0.64958966 USD; pullback0.50 shadow nominal 8 +5.52494089 USD, wallet-qualified3 +0.13508220 USD. Fee 0.05% per fill leg plus 0.10% slippage total. All small samples; no live pullback promotion.
- Adaptive180d still RUNNING: unified exec session13853, OS PID2937760 (script scripts/verify-roi-replay.cjs). Do not restart the core replay if adaptive fails: core-backtest.json is saved; rerun only adaptive if needed.
- Exchange verified flat 2026-09-07T02:53:40Z; wallet34.27714639, 0positions/0orders/0algo. DB also0open/0pending; ledger not yet applied.
- PM2 original daemon2252 still owns worker2670883/API2670890; its old socket became inaccessible after sandbox transition. An empty new PM2 daemon2937182 owns current socket, with0apps. Original apps remain healthy. Backup original dump captured privately. scripts/deploy-roi-fix.py has strict process-ownership checks and gracefully stops empty new daemon then original daemon before any new worker is started. Do not start a second worker manually.
- Reviewed deploy helper requires completed core+adaptive backtests and green acceptance tests; checks fresh build, exchange flat, captures immediate DB/env backup, repairs PM2, applies/repeats ledger idempotently, sets adaptive shadow + disables legacy minlot normalization, swaps candidate dist, starts/saves PM2, writes build manifest.
- Monitor scripts/monitor-roi.py uses read-only PID files, API and SQL, avoiding pm2 jlist daemon-start side effects. Not installed in cron yet. Must verify two natural scheduler cycles and install minute monitor after deploy. Goal still active, deployment not yet done.


2026-09-07 10:18 ICT deployment recovery:
- First deploy stopped empty/new PM2 and original daemon safely after two flat-exchange checks. Both apps currently STOPPED; no positions/pending orders. Dist has NOT been swapped.
- Original per-position reconcile hit Binance -1003 rate quota during the second pass;32/36 ledger rows corrected, net currently-5.57942933. No data rollback or trade mutations. Fixed source: runClosedPositionPnlReconcile now fetches fill/income history once per batch and passes immutable rounds into each resolver. Verified dedicated batch test (3 positions, one fill fetch + one income fetch) plus qty/pagination,6tests pass.
- Latest build is RUNNING unified exec74395, OS tsc2946227; build log /tmp/roi-fix-build-verified.log. Must wait authoritative process completion. Source changes only accounting batch, backtest artifacts remain applicable.
- Resume helper scripts/resume-roi-deploy.py verifies no old app processes, new build, exchange flat, applies ledger + idempotence check, swaps dist, starts/saves PM2, writes manifest. Run AFTER build success. Do NOT rerun original deploy helper (it expects old daemon2252 alive).
- Runtime .env already set adaptive shadow, minimum-lot normalization false, adaptive fee0.0005. Backups intact at private path. Latest actual Binance income parse verified166/166 transaction IDs are strings (51 funding rows).
- Adaptive180d done11range trades; costs repriced in adaptive-cost-sensitivity.json: fee0.05% each +0.10%slippage =>range net1.248R PF1.19976, micro net2.0005R PF1.14551, earlyflip1loss. No live promotion.
