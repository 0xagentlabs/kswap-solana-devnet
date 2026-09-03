import PoolDetail from "@/components/PoolDetail";
export default async function PoolPage({params}:{params:Promise<{address:string}>}){const {address}=await params;return <PoolDetail address={address}/>}
