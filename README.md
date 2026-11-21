# Fire & Salt Mining (live)

The live site for Harrison (Fire) and Salty's miner.

- **Switch pools or wallets:** edit `config.json` (pool `host`, `port`, `coin` btc/bch, `type` solo/pool, `login` only for a shared/party address, `btcWallet`, `bchWallet`). Saving it runs the collector right away.
- **Collector:** `.github/workflows/collect.yml` runs `scripts/collect.mjs` every ~10 minutes and saves pool stats, pool switches and wallet payouts (priced at that day) in `data/`.
- Costs, spends and money put in stay private on the Claude page.
