# K-Swap 二进制接口

Program ID：`BsyakUNhxHsL1UdEbaUSHTRaLZ6fw2huHW34wHe7ut8c`，网络：Solana devnet。

本文只描述 K-Swap Program 的自定义二进制接口。Playground 的“创建 SPL Token”和“Mint Token”工具直接调用 Solana System Program、Associated Token Account Program 与经典 SPL Token Program，不会向 K-Swap Program 发送自定义指令，因此没有额外 discriminator，也不属于下述 ABI。

所有整数均为 little-endian。Pool PDA seeds 为 `["pool", owner_pubkey]`。Pool 数据固定 164 bytes：`discriminator:u8=1 | bump:u8 | fee_bps:u16 | owner:pubkey | mint_a:pubkey | mint_b:pubkey | vault_a:pubkey | vault_b:pubkey`。

`mint_a` 与 `mint_b` 是 Pool 的持久化 Token 标识。客户端通过 `getProgramAccounts` 且 `dataSize=164` 枚举 Pool，仍必须校验账户 owner、discriminator 和数据长度后才能解析。查询不是新的链上指令。

## 指令 0：InitializePool

数据：`tag:u8=0 | fee_bps:u16`。手续费范围 `0..=1000`。

账户依次为：owner（signer、writable、payer）、pool PDA（writable）、vault A、vault B、System Program、Rent sysvar。两个 vault 必须是经典 SPL Token account、mint 不同、authority 均为 pool PDA。重复初始化失败。

## 指令 1：SwapExactIn

数据：`tag:u8=1 | amount_in:u64 | minimum_amount_out:u64`。

账户依次为：user（signer、writable）、pool、user source（writable）、user destination（writable）、source vault（writable）、destination vault（writable）、SPL Token Program。vault 可按 A→B 或 B→A 顺序传入，必须与 Pool 记录匹配。输出计算为 `reserve_out × amount_in × (10000-fee) / (reserve_in×10000 + amount_in×(10000-fee))`。

## 指令 2：AddLiquidity

数据：`tag:u8=2 | maximum_amount_a:u64 | maximum_amount_b:u64 | minimum_lp_out:u64`。两个最大输入量均须大于零。

账户依次为：provider（signer）、pool、provider Token A（writable）、provider Token B（writable）、vault A（writable）、vault B（writable）、LP mint PDA（writable）、provider LP Token account（writable）、SPL Token Program。任何钱包均可调用；程序按当前储备比例取不超过 maximum 的两侧资产，并铸造 `min(maxA×supply/reserveA, maxB×supply/reserveB)` 份 LP Token。

## 指令 3：RemoveLiquidity

数据：`tag:u8=3 | lp_amount:u64 | minimum_amount_a:u64 | minimum_amount_b:u64`。

账户顺序与 AddLiquidity 相同。任何 LP 持有者均可调用；程序销毁调用者的 LP Token，并按 `reserve × lp_amount / total_supply` 将两侧资产转回调用者，两个 minimum 字段提供滑点保护。

## 指令 4/5：MigrateLegacyPool / SeedInitialLiquidity

旧 Pool 首次迁移由原 owner 在一个原子交易中依次调用：tag 4 创建 PDA `lp_mint=["lp_mint", pool]`（9 decimals、mint authority 为 Pool PDA），客户端创建 owner LP ATA，再由 tag 5 按 `floor(sqrt(reserve_a×reserve_b))` 向 owner 铸造初始 LP 份额。LP mint 已存在或 supply 非零时重复迁移失败。新建 Pool 的客户端在创建交易内直接完成相同步骤。

## 错误码

`1 InvalidAccounts`、`2 InvalidPda`、`3 InvalidState`、`4 InvalidMint`、`5 InvalidAmount`、`6 Slippage`、`7 MathOverflow`、`8 Unauthorized`、`9 InvalidFee`。
