# K-Swap

K-Swap 是部署在 Solana devnet 的恒定乘积（`x · y = k`）SPL Token AMM。链上程序使用 Rust + Pinocchio，浏览器 playground 使用 Next.js、TypeScript、Wallet Adapter 与 `@solana/web3.js`。用户可从自己的钱包创建池、注入初始流动性、执行双向 exact-in swap，并创建和增发 devnet 测试 Token。

> 仅供 devnet 演示与学习。项目未经第三方审计，请勿使用主网或真实资产。

## 已实现功能

- 创建 AMM Pool PDA，并配置池级手续费（0–1000 bps）。
- 为两种经典 SPL Token 注入初始流动性。
- 按实时储备报价并执行带滑点保护的 A→B / B→A swap。
- 创建经典 SPL Token mint，可配置 0–9 位小数。
- 向连接钱包的关联代币账户（ATA）增发测试 Token；ATA 不存在时自动创建。
- 所有页面交易在请求钱包签名前先进行 RPC 模拟，确认后提供 devnet Explorer 链接。

当前演示范围不包含 Token-2022、LP Token 和后续增减流动性。一个 owner 钱包当前只能初始化一个 Pool。

## 在线地址

- Playground：<https://kswap-solana-devnet.vercel.app>
- Program：<https://explorer.solana.com/address/BsyakUNhxHsL1UdEbaUSHTRaLZ6fw2huHW34wHe7ut8c?cluster=devnet>
- Program ID：`BsyakUNhxHsL1UdEbaUSHTRaLZ6fw2huHW34wHe7ut8c`

## 目录

```text
program/src/lib.rs       Pinocchio 链上程序、账户校验和定价逻辑
dapp/app/page.tsx        Swap、建池和测试 Token 页面
dapp/lib/amm.ts          ABI 编码、PDA 推导和客户端报价
docs/ABI.md              链上二进制接口、账户顺序和错误码
docs/项目使用说明书.md      完整安装、操作、查询、部署和排错指南
```

## 快速开始

要求 Node.js 20+、npm、浏览器 Solana 钱包；构建链上程序还需 Rust、Solana CLI 和 `cargo-build-sbf`。

```bash
git clone https://github.com/0xagentlabs/kswap-solana-devnet.git
cd kswap-solana-devnet/dapp
npm ci
cp .env.example .env.local
npm run dev
```

打开 <http://localhost:3000>，将钱包切换到 devnet 后连接。默认 RPC 为 `https://api.devnet.solana.com`，可通过 `.env.local` 中的 `NEXT_PUBLIC_SOLANA_RPC_URL` 替换。

## 创建并增发测试 Token

1. 在页面选择“测试 Token”→“创建 SPL Token”。
2. 输入小数位（0–9），点击“创建测试 Token”并签名；连接的钱包成为 mint authority 和 freeze authority。
3. 保存页面显示的 mint 地址，再选择“Mint Token”。
4. 填入 mint 地址和增发数量。数量使用最小单位，例如 9 位小数 Token 的 `1_000_000_000` 最小单位等于 1 个展示单位。
5. 点击“增发到当前钱包”并签名。页面会自动创建当前钱包 ATA（如需要）并增发 Token。

创建 mint 会消耗 devnet SOL 账户租金和交易费；Mint Token 要求当前钱包仍是该 mint 的 mint authority。更完整的页面流程、CLI 等价命令和故障排查见 `docs/项目使用说明书.md`。

## 验证与构建

```bash
NO_DNA=1 cargo fmt --check
NO_DNA=1 cargo clippy --workspace --all-targets
NO_DNA=1 cargo test --workspace
NO_DNA=1 cargo build-sbf --manifest-path program/Cargo.toml
cd dapp
npm ci
npm run typecheck
npm run build
```

链上客户端必须严格遵循 `docs/ABI.md`，不能假设项目存在 Anchor IDL。Program keypair 与任何钱包私钥均不得提交到仓库。
