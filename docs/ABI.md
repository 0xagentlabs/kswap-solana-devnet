# K-Swap 二进制接口

Program ID：`BsyakUNhxHsL1UdEbaUSHTRaLZ6fw2huHW34wHe7ut8c`，网络：Solana devnet。

本文只描述 K-Swap Program 的自定义二进制接口。Playground 的“创建 SPL Token”和“Mint Token”工具直接调用 Solana System Program、Associated Token Account Program 与经典 SPL Token Program，不会向 K-Swap Program 发送自定义指令，因此没有额外 discriminator，也不属于下述 ABI。

所有整数均为 little-endian。Pool PDA seeds 为 `["pool", owner_pubkey]`。Pool 数据固定 164 bytes：`discriminator:u8=1 | bump:u8 | fee_bps:u16 | owner:pubkey | mint_a:pubkey | mint_b:pubkey | vault_a:pubkey | vault_b:pubkey`。

## 指令 0：InitializePool

数据：`tag:u8=0 | fee_bps:u16`。手续费范围 `0..=1000`。

账户依次为：owner（signer、writable、payer）、pool PDA（writable）、vault A、vault B、System Program、Rent sysvar。两个 vault 必须是经典 SPL Token account、mint 不同、authority 均为 pool PDA。重复初始化失败。

## 指令 1：SwapExactIn

数据：`tag:u8=1 | amount_in:u64 | minimum_amount_out:u64`。

账户依次为：user（signer、writable）、pool、user source（writable）、user destination（writable）、source vault（writable）、destination vault（writable）、SPL Token Program。vault 可按 A→B 或 B→A 顺序传入，必须与 Pool 记录匹配。输出计算为 `reserve_out × amount_in × (10000-fee) / (reserve_in×10000 + amount_in×(10000-fee))`。

## 错误码

`1 InvalidAccounts`、`2 InvalidPda`、`3 InvalidState`、`4 InvalidMint`、`5 InvalidAmount`、`6 Slippage`、`7 MathOverflow`、`8 Unauthorized`、`9 InvalidFee`。
