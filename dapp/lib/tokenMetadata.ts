import {PublicKey,SystemProgram,SYSVAR_RENT_PUBKEY,TransactionInstruction} from "@solana/web3.js";

export const TOKEN_METADATA_PROGRAM_ID=new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

const utf8=new TextEncoder();
const encodeString=(value:string)=>{const bytes=utf8.encode(value),length=Buffer.alloc(4);length.writeUInt32LE(bytes.length);return Buffer.concat([length,Buffer.from(bytes)])};

export function validateTokenMetadata(name:string,symbol:string,uri:string){
  if(!name.trim())throw new Error("Token Name 不能为空");
  if(!symbol.trim())throw new Error("Token Symbol 不能为空");
  if(utf8.encode(name.trim()).length>32)throw new Error("Token Name 最多 32 个 UTF-8 字节");
  if(utf8.encode(symbol.trim()).length>10)throw new Error("Token Symbol 最多 10 个 UTF-8 字节");
  if(utf8.encode(uri.trim()).length>200)throw new Error("Metadata URI 最多 200 个 UTF-8 字节");
  if(uri.trim()){try{const parsed=new URL(uri.trim());if(parsed.protocol!=="https:"&&parsed.protocol!=="ipfs:")throw new Error()}catch{throw new Error("Metadata URI 必须是 https:// 或 ipfs:// 地址")}}
}

export function metadataPda(mint:PublicKey){return PublicKey.findProgramAddressSync([Buffer.from("metadata"),TOKEN_METADATA_PROGRAM_ID.toBuffer(),mint.toBuffer()],TOKEN_METADATA_PROGRAM_ID)[0]}

export function createMetadataInstruction(mint:PublicKey,authority:PublicKey,name:string,symbol:string,uri:string){
  const normalized={name:name.trim(),symbol:symbol.trim(),uri:uri.trim()};
  validateTokenMetadata(normalized.name,normalized.symbol,normalized.uri);
  // Metaplex CreateMetadataAccountV3: discriminator + DataV2 + is_mutable + collection_details.
  const data=Buffer.concat([
    Buffer.from([33]),encodeString(normalized.name),encodeString(normalized.symbol),encodeString(normalized.uri),
    Buffer.from([0,0]), // seller_fee_basis_points = 0
    Buffer.from([0,0,0]), // creators, collection and uses = None
    Buffer.from([1,0]), // mutable = true, collection_details = None
  ]);
  return new TransactionInstruction({programId:TOKEN_METADATA_PROGRAM_ID,keys:[
    {pubkey:metadataPda(mint),isSigner:false,isWritable:true},
    {pubkey:mint,isSigner:false,isWritable:false},
    {pubkey:authority,isSigner:true,isWritable:false},
    {pubkey:authority,isSigner:true,isWritable:true},
    {pubkey:authority,isSigner:false,isWritable:false},
    {pubkey:SystemProgram.programId,isSigner:false,isWritable:false},
    {pubkey:SYSVAR_RENT_PUBKEY,isSigner:false,isWritable:false},
  ],data});
}
