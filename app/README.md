# openlaunch.lol — app

**Launch a token. Free. Open source. On Base, Robinhood Chain or Arc.**

The site for the [openlaunch](../README.md) launchpad. One transaction deploys a fixed-supply ERC-20,
opens a Uniswap v4 pool and locks 100% of the supply as liquidity in an ownerless locker — forever.
No platform fee anywhere. Contracts live in `../contracts` (`LaunchFactory.sol`, `LaunchLocker.sol`,
`LaunchToken.sol`; design in `../contracts/docs/LAUNCHPAD.md`).

Next 16 app router, React 19, Tailwind 4, wagmi 3 + viem 2, Postgres (postgres.js). Runs on Fly.io
(two web machines + an attached Postgres with WAL backups to Tigris); see `LAUNCH.md` for the runbook.

## Pages / API
- `/` list (new · active · volume · market cap) + live tape · `/launch` form · `/t/<token>` trade + fees
- `/rules` how it works · `/agents` contract call + JSON · `/llms.txt`
- `GET /api/launch/list?sort=&limit=` · `GET /api/launch/feed` · `GET /api/launch/meta/<token>`
- `POST /api/launch/meta` (metadata before launching → `{uri, token}`) · `POST /api/launch/sync?tx=` · `GET /api/health`

## How it hangs together
- `src/lib/launchpad/` — `abi.ts` (factory / locker / PoolManager Swap / StateView / Quoter /
  Universal Router / Permit2), `math.ts` (ticks ↔ prices, FDV, formatting), `swap.ts` (V4_SWAP
  encoding), `meta.ts`, `queries.ts`, `indexer.ts` (receipt apply + chunked poller), `loop.ts`.
- Trades happen in the page through the Universal Router (`TradePanel.tsx`): buys send ETH as
  value; sells approve the token to Permit2 once, then a 30-day Permit2 allowance to the router.
- `db/schema.sql` — `bb_launches`, `bb_launch_swaps`, `bb_launch_fee_events`, `bb_launch_meta`,
  `bb_launch_sync_state` (+ `bb_migrations`). Idempotent; applied on every deploy.

## Local dev against a Base fork
```
anvil --fork-url https://mainnet.base.org --port 8545 --chain-id 8453
cd ../contracts && DEPLOYER_PRIVATE_KEY=<anvil key 0> forge script script/dev/SeedLaunchpadLocal.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
createdb basebid_dev && DATABASE_URL=postgres://localhost/basebid_dev npm run migrate
# .env.development.local: NEXT_PUBLIC_CHAIN=base, NEXT_PUBLIC_RPC_URL/BASE_RPC_URL=http://127.0.0.1:8545,
#   NEXT_PUBLIC_LAUNCH_FACTORY/_LOCKER + LAUNCH_DEPLOY_BLOCK from the seed output, LAUNCH_SYNC_CONFIRMATIONS=0, LAUNCH_SYNC_LOOP=1
npm run dev
```
Gotcha: anvil's default accounts carry EIP-7702 delegations on Base mainnet — ETH sent to them is
forwarded away. Use a fresh key (`cast wallet new` + `anvil_setBalance`) when testing sells.

## Deploy
See `LAUNCH.md`.
