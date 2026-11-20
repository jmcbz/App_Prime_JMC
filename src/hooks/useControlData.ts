import {useEffect,useRef,useState} from 'react';
import {useAuth} from '../context/AuthContext';
export function useControlData<T>(fetcher:(signal:AbortSignal)=>Promise<T>) {
 const auth=useAuth();const [value,setValue]=useState<T|null>(null);const [error,setError]=useState('');const [loading,setLoading]=useState(true);const [retry,setRetry]=useState(0);const current=useRef<AbortController|null>(null);
 useEffect(()=>auth.onVerificationStart?.(()=>{current.current?.abort();}),[auth.onVerificationStart]);
 useEffect(()=>{
  const controller=new AbortController();current.current=controller;
  if(!auth.user||auth.loading||!auth.verified)return()=>controller.abort();
  setLoading(true);setError('');setValue(null);
  void fetcher(controller.signal).then(data=>{if(!controller.signal.aborted)setValue(data);}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Chargement indisponible');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[fetcher,auth.user?.id,auth.loading,auth.verified,auth.verificationEpoch,retry]);
 return {value,error,loading,reload:()=>setRetry(n=>n+1)};
}
