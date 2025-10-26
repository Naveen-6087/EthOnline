# Meme Sentinels – AI-Powered Memecoin Intelligence Platform

Meme Sentinels is an **AI-driven DeFi intelligence platform** designed to make **memecoin investing safer, faster, and data-driven**. It automatically discovers, analyzes, and ranks thousands of ERC-20 tokens using **real-time on-chain data** and a **multi-agent AI architecture**.

This repository uses **Turborepo** to manage the project as a **monorepo**, making development scalable and maintainable across multiple apps and packages.

---

## 🚀 Project Overview

Meme Sentinels provides a **complete intelligence layer** for memecoin investors:

- **Token Discovery:** Fetches and analyzes 2,300+ ERC-20 tokens using **Envio Hypersync**.
- **On-Chain Analysis:** Calculates liquidity, market cap, yield, trading pairs, and transaction history to generate an **on-chain score**.
- **Social Analysis:** Aggregates sentiment from **Twitter (X)** and **Reddit** for top memecoins to create a social score.
- **Meme Sentinel Score:** Combines on-chain and social data to create a dynamic score updated every 5–30 minutes.
- **Wallet Tracking:** Monitors top-performing traders and their transactions to identify profitable trends.
- **AI Trading Agent:** Users can securely deposit funds into a smart contract; AI executes **buy/sell trades** via **Uniswap v2**, without withdrawal access.
- **Multi-Agent System:** Six specialized agents (Scout, Yield, Risk, Alert, Settlement, Orchestrator) handle discovery, analysis, risk detection, alerting, settlement, and orchestration.
- **Immutable Records:** Uses **Hedera Consensus Service (HCS)** to log alerts and AI decisions for transparency.
- **Personal Assistant:** Chat interface powered by **Groq** provides users with personalized insights and analytics.

---

## 🏗️ Turborepo Architecture

### Apps and Packages

| Name | Description |
|------|-------------|
| `web` | Main Next.js frontend app with dashboard and trading interface |
| `docs` | Next.js documentation site |
| `@repo/ui` | Shared React component library for both `web` and `docs` |
| `@repo/eslint-config` | ESLint configurations with Next.js & Prettier presets |
| `@repo/typescript-config` | Shared TypeScript configurations (`tsconfig.json`) |

### Utilities & Tools

- **TypeScript** — static type checking
- **ESLint** — code linting
- **Prettier** — code formatting

---

## ⚡ Development

### Start all apps/packages:

```bash
# With global turbo installed
turbo dev

# Without global turbo
npx turbo dev
yarn exec turbo dev
pnpm exec turbo dev
```

### Start a specific package:

```bash
# Example: web app
turbo dev --filter=web
npx turbo dev --filter=web
yarn exec turbo dev --filter=web
pnpm exec turbo dev --filter=web
```

---

## 🏗️ Build

### Build all apps/packages:

```bash
turbo build

# or
npx turbo build
yarn dlx turbo build
pnpm exec turbo build
```

### Build a specific package:

```bash
turbo build --filter=docs
npx turbo build --filter=docs
yarn exec turbo build --filter=docs
pnpm exec turbo build --filter=docs
```

---

## ☁️ Remote Caching

Turborepo supports remote caching to share build artifacts across machines and CI/CD pipelines.

1. **Create a Vercel account:** https://vercel.com/signup

2. **Log in to Turborepo:**

```bash
turbo login
# or
npx turbo login
```

3. **Link repo for remote caching:**

```bash
turbo link
# or
npx turbo link
```

---

## 🔧 Tech Stack

- **Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS, Radix UI
- **Wallet/Blockchain:** RainbowKit, Wagmi v2, Viem, Uniswap V2 Router, Hedera HCS, Hedera Agentkit
- **Backend:** Node.js, Express.js, Envio Hypersync
- **AI / Automation:** Google A2A Protocol, Groq integration
- **External APIs:** CoinGecko, DeFiLlama, multiple DEX APIs

---

## 📝 Key Features

- AI-powered token discovery and analysis
- Real-time social sentiment aggregation
- Multi-agent orchestration for alerts and risk detection
- Secure automated trading via smart contracts
- Immutable audit trail using Hedera HCS
- Dynamic Meme Sentinel Score updated every 5–30 minutes
- Wallet monitoring to track "smart money" movements

---

## 🌐 Useful Links

- [Turborepo Documentation](https://turbo.build/repo/docs)
- [Next.js](https://nextjs.org/)
- [Envio Hypersync](https://docs.envio.dev/)
- [Hedera Network](https://hedera.com/)
- [Uniswap V2](https://docs.uniswap.org/contracts/v2/overview)

---

## 📄 License

This project is licensed under the MIT License.

---

## 🤝 Contributing

Contributions are welcome! Please open an issue or submit a pull request.

---

Built with ❤️ by the Meme Sentinels team