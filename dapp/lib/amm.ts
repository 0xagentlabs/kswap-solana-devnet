import {AccountInfo,AccountMeta,Connection,PublicKey,SystemProgram,SYSVAR_RENT_PUBKEY,TransactionInstruction} from "@solana/web3.js";
export const PROGRAM_ID=new PublicKey("BsyakUNhxHsL1UdEbaUSHTRaLZ6fw2huHW34wHe7ut8c");
export const TOKEN_PROGRAM_ID=new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const POOL_ACCOUNT_SIZE=164;
export type PoolState={address:PublicKey;bump:number;feeBps:number;owner:PublicKey;mintA:PublicKey;mintB:PublicKey;vaultA:PublicKey;vaultB:PublicKey};
export const poolPda=(owner:PublicKey)=>PublicKey.findProgramAddressSync([Buffer.from("pool"),owner.toBuffer()],PROGRAM_ID)[0];
export const lpMintPda=(pool:PublicKey)=>PublicKey.findProgramAddressSync([Buffer.from("lp_mint"),pool.toBuffer()],PROGRAM_ID)[0];
const u64=(v:bigint)=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(v);return b};
const ix=(keys:AccountMeta[],data:Buffer)=>new TransactionInstruction({programId:PROGRAM_ID,keys,data});
export function initializeIx(owner:PublicKey,vaultA:PublicKey,vaultB:PublicKey,feeBps:number){const b=Buffer.alloc(3);b[0]=0;b.writeUInt16LE(feeBps,1);return ix([{pubkey:owner,isSigner:true,isWritable:true},{pubkey:poolPda(owner),isSigner:false,isWritable:true},{pubkey:vaultA,isSigner:false,isWritable:false},{pubkey:vaultB,isSigner:false,isWritable:false},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false},{pubkey:SYSVAR_RENT_PUBKEY,isSigner:false,isWritable:false}],b)}
export function swapIx(user:PublicKey,pool:PublicKey,userSource:PublicKey,userDest:PublicKey,vaultSource:PublicKey,vaultDest:PublicKey,amountIn:bigint,minOut:bigint){return ix([{pubkey:user,isSigner:true,isWritable:true},{pubkey:pool,isSigner:false,isWritable:false},{pubkey:userSource,isSigner:false,isWritable:true},{pubkey:userDest,isSigner:false,isWritable:true},{pubkey:vaultSource,isSigner:false,isWritable:true},{pubkey:vaultDest,isSigner:false,isWritable:true},{pubkey:TOKEN_PROGRAM_ID,isSigner:false,isWritable:false}],Buffer.concat([Buffer.from([1]),u64(amountIn),u64(minOut)]))}
export function liquidityIx(tag:2|3,user:PublicKey,pool:PublicKey,userA:PublicKey,userB:PublicKey,vaultA:PublicKey,vaultB:PublicKey,lpMint:PublicKey,userLp:PublicKey,first:bigint,second:bigint,third:bigint){return ix([{pubkey:user,isSigner:true,isWritable:false},{pubkey:pool,isSigner:false,isWritable:false},{pubkey:userA,isSigner:false,isWritable:true},{pubkey:userB,isSigner:false,isWritable:true},{pubkey:vaultA,isSigner:false,isWritable:true},{pubkey:vaultB,isSigner:false,isWritable:true},{pubkey:lpMint,isSigner:false,isWritable:true},{pubkey:userLp,isSigner:false,isWritable:true},{pubkey:TOKEN_PROGRAM_ID,isSigner:false,isWritable:false}],Buffer.concat([Buffer.from([tag]),u64(first),u64(second),u64(third)]))}
export function createLpMintIx(owner:PublicKey,pool:PoolState){const mint=lpMintPda(pool.address);return ix([{pubkey:owner,isSigner:true,isWritable:true},{pubkey:pool.address,isSigner:false,isWritable:false},{pubkey:pool.vaultA,isSigner:false,isWritable:false},{pubkey:pool.vaultB,isSigner:false,isWritable:false},{pubkey:mint,isSigner:false,isWritable:true},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false},{pubkey:SYSVAR_RENT_PUBKEY,isSigner:false,isWritable:false},{pubkey:TOKEN_PROGRAM_ID,isSigner:false,isWritable:false}],Buffer.from([4]))}
export function seedInitialLiquidityIx(owner:PublicKey,pool:PoolState,ownerLp:PublicKey){const mint=lpMintPda(pool.address);return ix([{pubkey:owner,isSigner:true,isWritable:false},{pubkey:pool.address,isSigner:false,isWritable:false},{pubkey:pool.vaultA,isSigner:false,isWritable:false},{pubkey:pool.vaultB,isSigner:false,isWritable:false},{pubkey:mint,isSigner:false,isWritable:true},{pubkey:ownerLp,isSigner:false,isWritable:true}],Buffer.from([5]))}
export function quote(amount:bigint,reserveIn:bigint,reserveOut:bigint,feeBps:number){const e=amount*BigInt(10000-feeBps);return reserveOut*e/(reserveIn*10000n+e)}

export function parsePool(address:PublicKey,account:AccountInfo<Buffer>):PoolState{
  const data=account.data;
  if(!account.owner.equals(PROGRAM_ID)||data.length!==POOL_ACCOUNT_SIZE||data[0]!==1)throw new Error("无效的 K-Swap Pool 账户");
  return {address,bump:data[1],feeBps:data.readUInt16LE(2),owner:new PublicKey(data.subarray(4,36)),mintA:new PublicKey(data.subarray(36,68)),mintB:new PublicKey(data.subarray(68,100)),vaultA:new PublicKey(data.subarray(100,132)),vaultB:new PublicKey(data.subarray(132,164))};
}

export async function fetchPools(connection:Connection){
  const accounts=await connection.getProgramAccounts(PROGRAM_ID,{filters:[{dataSize:POOL_ACCOUNT_SIZE}]});
  return accounts.flatMap(({pubkey,account})=>{try{return [parsePool(pubkey,account)]}catch{return []}});
}

export async function fetchPool(connection:Connection,address:PublicKey){
  const account=await connection.getAccountInfo(address);
  if(!account)throw new Error("Pool 不存在");
  return parsePool(address,account);
}

export const shortAddress=(address:PublicKey|string)=>{const value=typeof address==="string"?address:address.toBase58();return `${value.slice(0,6)}…${value.slice(-6)}`};
export const tokenAmount=(account:AccountInfo<Buffer>)=>account.data.readBigUInt64LE(64);
export const mintDecimals=(account:AccountInfo<Buffer>)=>account.data[44];
export const formatTokenAmount=(amount:bigint,decimals:number)=>{const value=amount.toString().padStart(decimals+1,"0");if(!decimals)return value;const whole=value.slice(0,-decimals),fraction=value.slice(-decimals).replace(/0+$/,"");return fraction?`${whole}.${fraction}`:whole};
