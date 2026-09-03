# K-Swap

基于 Rust + Pinocchio 的 Solana devnet 恒定乘积 SPL Token AMM，以及 Next.js playground。外部钱包通过 playground 创建自己的池并成为 owner；部署不会抢先初始化。

- 链上程序：`program/`
- Web playground：`dapp/`
- ABI：`docs/ABI.md`
- 使用说明：`docs/项目使用说明书.md`

```bash
NO_DNA=1 cargo test
NO_DNA=1 cargo build-sbf --manifest-path program/Cargo.toml
cd dapp && npm ci && npm run typecheck && npm run build
```

仅供 devnet 演示与学习，未经审计。

