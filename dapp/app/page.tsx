"use client";
import { useEffect, useMemo, useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createCloseAccountInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  ArrowDownUp,
  Coins,
  Droplets,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { initializeIx, poolPda, quote, swapIx } from "@/lib/amm";
import {
  createMetadataInstruction,
  validateTokenMetadata,
} from "@/lib/tokenMetadata";
import PoolDirectory from "@/components/PoolDirectory";

type Mode = "swap" | "pool" | "token";
type TokenAction = "create" | "mint" | "cleanup";
type CleanupPlan = {
  mint: PublicKey;
  source: PublicKey;
  destination: PublicKey;
  amount: bigint;
};
const INCINERATOR = new PublicKey(
  "1nc1nerator11111111111111111111111111111111",
);
const txExplorer = (s: string) =>
  `https://explorer.solana.com/tx/${s}?cluster=devnet`;
const addressExplorer = (s: string) =>
  `https://explorer.solana.com/address/${s}?cluster=devnet`;

export default function Home() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [mode, setMode] = useState<Mode>("swap"),
    [tokenAction, setTokenAction] = useState<TokenAction>("create");
  const [mintA, setMintA] = useState(""),
    [mintB, setMintB] = useState(""),
    [amount, setAmount] = useState(""),
    [second, setSecond] = useState("");
  const [fee, setFee] = useState("30"),
    [slippage, setSlippage] = useState("0.5"),
    [tokenMint, setTokenMint] = useState(""),
    [tokenAmount, setTokenAmount] = useState(""),
    [decimals, setDecimals] = useState("9"),
    [tokenName, setTokenName] = useState(""),
    [tokenSymbol, setTokenSymbol] = useState(""),
    [tokenUri, setTokenUri] = useState(""),
    [createdMint, setCreatedMint] = useState("");
  const [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  const [cleanupPlan, setCleanupPlan] = useState<CleanupPlan | null>(null);
  const pool = useMemo(
    () => (wallet.publicKey ? poolPda(wallet.publicKey) : null),
    [wallet.publicKey],
  );

  const send = async (tx: Transaction, signers: Keypair[] = []) => {
    if (!wallet.publicKey || !wallet.sendTransaction)
      throw new Error("请先连接钱包");
    const latest = await connection.getLatestBlockhash();
    tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = latest.blockhash;
    if (signers.length) tx.partialSign(...signers);
    const sim = await connection.simulateTransaction(tx);
    if (sim.value.err)
      throw new Error(`模拟失败: ${JSON.stringify(sim.value.err)}`);
    setStatus("模拟成功，等待钱包签名…");
    const sig = await wallet.sendTransaction(tx, connection);
    await connection.confirmTransaction(
      { ...latest, signature: sig },
      "confirmed",
    );
    setStatus(`SUCCESS:${sig}`);
  };

  const submitAmm = async () => {
    if (!wallet.publicKey) return setStatus("请先连接钱包");
    setBusy(true);
    setStatus("正在校验并模拟交易…");
    try {
      const a = new PublicKey(mintA),
        b = new PublicKey(mintB);
      if (a.equals(b)) throw new Error("两种代币 mint 必须不同");
      const p = poolPda(wallet.publicKey),
        va = getAssociatedTokenAddressSync(a, p, true),
        vb = getAssociatedTokenAddressSync(b, p, true),
        ua = getAssociatedTokenAddressSync(a, wallet.publicKey),
        ub = getAssociatedTokenAddressSync(b, wallet.publicKey),
        tx = new Transaction();
      if (mode === "pool") {
        if (await connection.getAccountInfo(p))
          throw new Error("该钱包已初始化过池");
        if (!(await connection.getAccountInfo(va)))
          tx.add(
            createAssociatedTokenAccountInstruction(wallet.publicKey, va, p, a),
          );
        if (!(await connection.getAccountInfo(vb)))
          tx.add(
            createAssociatedTokenAccountInstruction(wallet.publicKey, vb, p, b),
          );
        tx.add(
          initializeIx(wallet.publicKey, va, vb, Number(fee)),
          createTransferInstruction(ua, va, wallet.publicKey, BigInt(amount)),
          createTransferInstruction(ub, vb, wallet.publicKey, BigInt(second)),
        );
      } else {
        const ra = (await getAccount(connection, va)).amount,
          rb = (await getAccount(connection, vb)).amount,
          input = BigInt(amount),
          out = quote(input, ra, rb, Number(fee)),
          min =
            (out * BigInt(Math.floor((100 - Number(slippage)) * 100))) / 10000n;
        tx.add(swapIx(wallet.publicKey, p, ua, ub, va, vb, input, min));
      }
      await send(tx);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "交易失败");
    } finally {
      setBusy(false);
    }
  };

  const submitToken = async () => {
    if (!wallet.publicKey) return setStatus("请先连接钱包");
    setBusy(true);
    setStatus("正在校验并模拟交易…");
    try {
      if (tokenAction === "create") {
        validateTokenMetadata(tokenName, tokenSymbol, tokenUri);
        const mint = Keypair.generate(),
          rent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE),
          tx = new Transaction().add(
            SystemProgram.createAccount({
              fromPubkey: wallet.publicKey,
              newAccountPubkey: mint.publicKey,
              lamports: rent,
              space: MINT_SIZE,
              programId: TOKEN_PROGRAM_ID,
            }),
            createInitializeMint2Instruction(
              mint.publicKey,
              Number(decimals),
              wallet.publicKey,
              wallet.publicKey,
            ),
            createMetadataInstruction(
              mint.publicKey,
              wallet.publicKey,
              tokenName,
              tokenSymbol,
              tokenUri,
            ),
          );
        await send(tx, [mint]);
        const address = mint.publicKey.toBase58();
        setCreatedMint(address);
        setTokenMint(address);
      } else {
        const mint = new PublicKey(tokenMint),
          ata = getAssociatedTokenAddressSync(mint, wallet.publicKey),
          tx = new Transaction();
        if (!(await connection.getAccountInfo(ata)))
          tx.add(
            createAssociatedTokenAccountInstruction(
              wallet.publicKey,
              ata,
              wallet.publicKey,
              mint,
            ),
          );
        tx.add(
          createMintToInstruction(
            mint,
            ata,
            wallet.publicKey,
            BigInt(tokenAmount),
          ),
        );
        await send(tx);
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "交易失败");
    } finally {
      setBusy(false);
    }
  };
  const prepareCleanup = async () => {
    if (!wallet.publicKey) return setStatus("请先连接钱包");
    setBusy(true);
    setStatus("正在读取并校验 Token 账户…");
    try {
      const mint = new PublicKey(tokenMint),
        mintInfo = await connection.getAccountInfo(mint);
      if (!mintInfo || !mintInfo.owner.equals(TOKEN_PROGRAM_ID))
        throw new Error("仅支持经典 SPL Token mint");
      const source = getAssociatedTokenAddressSync(mint, wallet.publicKey),
        account = await getAccount(
          connection,
          source,
          undefined,
          TOKEN_PROGRAM_ID,
        );
      if (!account.owner.equals(wallet.publicKey) || !account.mint.equals(mint))
        throw new Error("Token 账户所有者或 mint 不匹配");
      const destination = getAssociatedTokenAddressSync(
        mint,
        INCINERATOR,
        true,
      );
      setCleanupPlan({ mint, source, destination, amount: account.amount });
      setStatus("");
    } catch (e) {
      setCleanupPlan(null);
      setStatus(e instanceof Error ? e.message : "无法读取 Token 账户");
    } finally {
      setBusy(false);
    }
  };
  const confirmCleanup = async () => {
    if (!wallet.publicKey || !cleanupPlan) return setStatus("请先生成清理摘要");
    setBusy(true);
    setStatus("正在模拟清理交易…");
    try {
      const current = await getAccount(
        connection,
        cleanupPlan.source,
        undefined,
        TOKEN_PROGRAM_ID,
      );
      if (
        !current.owner.equals(wallet.publicKey) ||
        !current.mint.equals(cleanupPlan.mint) ||
        current.amount !== cleanupPlan.amount
      )
        throw new Error("账户余额已变化，请重新预览");
      const tx = new Transaction();
      if (
        cleanupPlan.amount > 0n &&
        !(await connection.getAccountInfo(cleanupPlan.destination))
      )
        tx.add(
          createAssociatedTokenAccountInstruction(
            wallet.publicKey,
            cleanupPlan.destination,
            INCINERATOR,
            cleanupPlan.mint,
            TOKEN_PROGRAM_ID,
          ),
        );
      if (cleanupPlan.amount > 0n)
        tx.add(
          createTransferInstruction(
            cleanupPlan.source,
            cleanupPlan.destination,
            wallet.publicKey,
            cleanupPlan.amount,
            [],
            TOKEN_PROGRAM_ID,
          ),
        );
      tx.add(
        createCloseAccountInstruction(
          cleanupPlan.source,
          wallet.publicKey,
          wallet.publicKey,
          [],
          TOKEN_PROGRAM_ID,
        ),
      );
      await send(tx);
      setCleanupPlan(null);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "清理失败");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    setStatus("");
    setCleanupPlan(null);
  }, [mode, tokenAction, tokenMint, wallet.publicKey]);
  const tokenReady =
    tokenAction === "create"
      ? /^\d+$/.test(decimals) &&
        Number(decimals) <= 9 &&
        Boolean(tokenName.trim() && tokenSymbol.trim())
      : tokenAction === "mint"
        ? Boolean(tokenMint && tokenAmount && BigInt(tokenAmount || "0") > 0n)
        : Boolean(tokenMint);

  return (
    <main>
      <header>
        <a className="brand" href="#" aria-label="K-Swap 首页">
          <span>K</span>SWAP
        </a>
        <a className="header-link" href="#pools">
          Pool 列表
        </a>
        <div className="network">
          <i />
          DEVNET
        </div>
        <WalletMultiButton />
      </header>
      <section className="hero">
        <div>
          <p className="eyebrow">PINOCCHIO-POWERED AMM</p>
          <h1>
            交换资产，
            <br />
            <em>保持掌控。</em>
          </h1>
          <p className="lead">
            直接从钱包创建恒定乘积流动池，或在 Solana devnet 上以原子交易完成
            SPL Token 交换。
          </p>
          <div className="trust">
            <span>
              <ShieldCheck aria-hidden="true" />
              链上校验
            </span>
            <span>
              <RefreshCw aria-hidden="true" />
              实时储备
            </span>
            <span>
              <Droplets aria-hidden="true" />x · y = k
            </span>
            <span>
              <Coins aria-hidden="true" />
              测试代币工具
            </span>
          </div>
        </div>
        <div className="trade-card" aria-busy={busy}>
          <nav aria-label="操作模式">
            <button
              className={mode === "swap" ? "active" : ""}
              onClick={() => setMode("swap")}
            >
              Swap
            </button>
            <button
              className={mode === "pool" ? "active" : ""}
              onClick={() => setMode("pool")}
            >
              创建池
            </button>
            <button
              className={mode === "token" ? "active" : ""}
              onClick={() => setMode("token")}
            >
              测试 Token
            </button>
          </nav>
          {mode === "token" ? (
            <>
              <div
                className="sub-tabs"
                role="group"
                aria-label="测试 Token 操作"
              >
                <button
                  className={tokenAction === "create" ? "active" : ""}
                  onClick={() => setTokenAction("create")}
                >
                  创建 Token
                </button>
                <button
                  className={tokenAction === "mint" ? "active" : ""}
                  onClick={() => setTokenAction("mint")}
                >
                  Mint Token
                </button>
                <button
                  className={tokenAction === "cleanup" ? "active" : ""}
                  onClick={() => setTokenAction("cleanup")}
                >
                  清理 Token
                </button>
              </div>
              {tokenAction === "create" ? (
                <>
                  <label>
                    Token Name
                    <input
                      value={tokenName}
                      onChange={(e) => setTokenName(e.target.value)}
                      maxLength={32}
                      placeholder="例如 K-Swap USD"
                    />
                  </label>
                  <label>
                    Token Symbol
                    <input
                      value={tokenSymbol}
                      onChange={(e) =>
                        setTokenSymbol(e.target.value.toUpperCase())
                      }
                      maxLength={10}
                      placeholder="例如 KUSD"
                    />
                  </label>
                  <label>
                    Metadata URI（可选）
                    <input
                      value={tokenUri}
                      onChange={(e) => setTokenUri(e.target.value.trim())}
                      placeholder="https://… 或 ipfs://…"
                    />
                  </label>
                  <label>
                    小数位（0–9）
                    <input
                      inputMode="numeric"
                      value={decimals}
                      onChange={(e) =>
                        setDecimals(e.target.value.replace(/\D/g, ""))
                      }
                      placeholder="9"
                    />
                  </label>
                  <p className="helper">
                    名称、Symbol 和 URI 将写入 Metaplex Token
                    Metadata；当前钱包拥有 mint、freeze 与 metadata update
                    authority。
                  </p>
                </>
              ) : tokenAction === "mint" ? (
                <>
                  <label>
                    Token mint
                    <input
                      value={tokenMint}
                      onChange={(e) => setTokenMint(e.target.value.trim())}
                      placeholder="Solana mint 地址"
                    />
                  </label>
                  <label>
                    增发数量（最小单位）
                    <input
                      inputMode="numeric"
                      value={tokenAmount}
                      onChange={(e) =>
                        setTokenAmount(e.target.value.replace(/\D/g, ""))
                      }
                      placeholder="0"
                    />
                  </label>
                  <p className="helper">
                    接收账户为当前钱包的 ATA；若不存在，交易会自动创建。
                  </p>
                </>
              ) : (
                <>
                  <label>
                    要清理的 Token mint
                    <input
                      value={tokenMint}
                      onChange={(e) => setTokenMint(e.target.value.trim())}
                      placeholder="经典 SPL Token mint 地址"
                    />
                  </label>
                  <div className="danger-note">
                    <strong>不可撤销操作</strong>
                    <span>
                      全部 Token 将转入 Incinerator 黑洞地址，随后关闭当前钱包的
                      ATA；账户租金退回当前钱包。
                    </span>
                  </div>
                  {cleanupPlan && (
                    <div className="cleanup-summary">
                      <strong>签名前确认</strong>
                      <dl>
                        <div>
                          <dt>网络</dt>
                          <dd>Solana devnet</dd>
                        </div>
                        <div>
                          <dt>数量（最小单位）</dt>
                          <dd>{cleanupPlan.amount.toString()}</dd>
                        </div>
                        <div>
                          <dt>源 ATA</dt>
                          <dd>{cleanupPlan.source.toBase58()}</dd>
                        </div>
                        <div>
                          <dt>黑洞 ATA</dt>
                          <dd>{cleanupPlan.destination.toBase58()}</dd>
                        </div>
                        <div>
                          <dt>租金接收</dt>
                          <dd>{wallet.publicKey?.toBase58()}</dd>
                        </div>
                      </dl>
                    </div>
                  )}
                </>
              )}
              {createdMint && tokenAction !== "cleanup" && (
                <div className="mint-result">
                  <span>最近创建的 mint</span>
                  <a
                    href={addressExplorer(createdMint)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {createdMint}
                    <ExternalLink aria-hidden="true" />
                  </a>
                </div>
              )}
              <button
                className={
                  tokenAction === "cleanup" ? "submit danger" : "submit"
                }
                disabled={busy || !wallet.connected || !tokenReady}
                onClick={
                  tokenAction === "cleanup"
                    ? cleanupPlan
                      ? confirmCleanup
                      : prepareCleanup
                    : submitToken
                }
              >
                {busy
                  ? "处理中…"
                  : !wallet.connected
                    ? "请先连接钱包"
                    : tokenAction === "create"
                      ? "创建测试 Token"
                      : tokenAction === "mint"
                        ? "增发到当前钱包"
                        : cleanupPlan
                          ? "确认转移全部 Token 并关闭 ATA"
                          : "预览清理交易"}
              </button>
            </>
          ) : (
            <>
              <label>
                Token A mint
                <input
                  value={mintA}
                  onChange={(e) => setMintA(e.target.value.trim())}
                  placeholder="Solana mint 地址"
                />
              </label>
              <label>
                {mode === "pool"
                  ? "A 初始数量（最小单位）"
                  : "输入数量（最小单位）"}
                <input
                  inputMode="numeric"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
                  placeholder="0"
                />
              </label>
              <button
                className="flip"
                aria-label="交换代币方向"
                disabled={mode === "pool"}
                onClick={() => {
                  setMintA(mintB);
                  setMintB(mintA);
                }}
              >
                <ArrowDownUp />
              </button>
              <label>
                Token B mint
                <input
                  value={mintB}
                  onChange={(e) => setMintB(e.target.value.trim())}
                  placeholder="Solana mint 地址"
                />
              </label>
              {mode === "pool" ? (
                <>
                  <label>
                    B 初始数量（最小单位）
                    <input
                      inputMode="numeric"
                      value={second}
                      onChange={(e) =>
                        setSecond(e.target.value.replace(/\D/g, ""))
                      }
                      placeholder="0"
                    />
                  </label>
                  <label>
                    手续费（bps，最高 1000）
                    <input
                      inputMode="numeric"
                      value={fee}
                      onChange={(e) =>
                        setFee(e.target.value.replace(/\D/g, ""))
                      }
                    />
                  </label>
                </>
              ) : (
                <label>
                  滑点容忍度（%）
                  <input
                    inputMode="decimal"
                    value={slippage}
                    onChange={(e) => setSlippage(e.target.value)}
                  />
                </label>
              )}
              <div className="details">
                <span>Pool PDA</span>
                <code>
                  {pool
                    ? `${pool.toBase58().slice(0, 8)}…${pool.toBase58().slice(-6)}`
                    : "连接钱包后推导"}
                </code>
              </div>
              <button
                className="submit"
                disabled={
                  busy ||
                  !wallet.connected ||
                  !mintA ||
                  !mintB ||
                  !amount ||
                  (mode === "pool" && !second)
                }
                onClick={submitAmm}
              >
                {busy
                  ? "处理中…"
                  : !wallet.connected
                    ? "请先连接钱包"
                    : mode === "pool"
                      ? "创建并注入流动性"
                      : "预检并交换"}
              </button>
            </>
          )}
          {status && (
            <div
              className={
                status.startsWith("SUCCESS") ? "notice success" : "notice"
              }
              role="status"
              aria-live="polite"
            >
              {status.startsWith("SUCCESS") ? (
                <a
                  href={txExplorer(status.slice(8))}
                  target="_blank"
                  rel="noreferrer"
                >
                  交易已确认 <ExternalLink aria-hidden="true" />
                </a>
              ) : (
                status
              )}
            </div>
          )}
        </div>
      </section>
      <div id="pools">
        <PoolDirectory />
      </div>
      <footer>
        <span>
          Program <code>BsyakU…7ut8c</code>
        </span>
        <span>仅限 devnet · 请勿使用真实资产</span>
      </footer>
    </main>
  );
}
