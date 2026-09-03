"use client";
import Link from "next/link";
import {useCallback,useEffect,useState} from "react";
import {useConnection} from "@solana/wallet-adapter-react";
import {ArrowRight,RefreshCw} from "lucide-react";
import {fetchPools,PoolState,shortAddress} from "@/lib/amm";

export default function PoolDirectory(){
  const {connection}=useConnection();
  const [pools,setPools]=useState<PoolState[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState("");
  const load=useCallback(async()=>{setLoading(true);setError("");try{setPools(await fetchPools(connection))}catch(e){setError(e instanceof Error?e.message:"Pool 列表加载失败")}finally{setLoading(false)}},[connection]);
  useEffect(()=>{void load()},[load]);
  return <section className="pool-directory" aria-labelledby="pool-list-title">
    <div className="section-heading"><div><p className="eyebrow">ON-CHAIN POOLS</p><h2 id="pool-list-title">探索流动池</h2><p>直接读取 K-Swap 程序账户；每个池自动展示链上记录的两种 Token。</p></div><button className="secondary-button" onClick={()=>void load()} disabled={loading}><RefreshCw aria-hidden="true"/>{loading?"刷新中…":"刷新"}</button></div>
    {error?<div className="empty-state" role="alert"><strong>无法加载 Pool</strong><span>{error}</span><button onClick={()=>void load()}>重试</button></div>:loading?<div className="pool-grid" aria-label="正在加载 Pool"><div className="pool-skeleton"/><div className="pool-skeleton"/></div>:pools.length===0?<div className="empty-state"><strong>暂时没有 Pool</strong><span>连接钱包并在上方创建第一个流动池。</span></div>:<div className="pool-grid">{pools.map(pool=><Link className="pool-card" href={`/pools/${pool.address.toBase58()}`} key={pool.address.toBase58()}><div className="token-pair"><span>A</span><span>B</span><strong>{shortAddress(pool.mintA)} / {shortAddress(pool.mintB)}</strong></div><dl><div><dt>手续费</dt><dd>{pool.feeBps/100}%</dd></div><div><dt>Pool</dt><dd>{shortAddress(pool.address)}</dd></div><div><dt>Owner</dt><dd>{shortAddress(pool.owner)}</dd></div></dl><span className="card-link">查看详情并 Swap <ArrowRight aria-hidden="true"/></span></Link>)}</div>}
  </section>;
}
