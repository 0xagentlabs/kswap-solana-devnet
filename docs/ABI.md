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

数据：`tag:u8=2 | amount_a:u64 | amount_b:u64`。两个数量均须大于零。

账户依次为：owner（signer）、pool、owner Token A（writable）、owner Token B（writable）、vault A（writable）、vault B（writable）、SPL Token Program。调用者必须等于 Pool 持久化 owner；用户 Token 账户的 authority 必须为 owner，mint 和 vault 必须与 Pool 完全匹配。两侧资产通过 CPI 成对转入 vault。

## 指令 3：RemoveLiquidity

数据：`tag:u8=3 | amount_a:u64 | amount_b:u64`。两个数量均须大于零，且不得超过对应 vault 余额。

账户顺序与 AddLiquidity 相同。调用者必须为 Pool owner；Program 使用 Pool PDA seeds 签署两次 SPL Token Transfer，将指定数量成对转回 owner 的 Token 账户。当前版本没有 LP Token，因此不允许其他钱包增减流动性。

## 错误码

`1 InvalidAccounts`、`2 InvalidPda`、`3 InvalidState`、`4 InvalidMint`、`5 InvalidAmount`、`6 Slippage`、`7 MathOverflow`、`8 Unauthorized`、`9 InvalidFee`。
