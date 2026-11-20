import {useEffect,useRef} from 'react';
import {useInRouterContext,useLocation} from 'react-router-dom';
type Props={ready:boolean;onOpen:(id:number)=>void;onError:(message:string)=>void};
function RoutedLink({ready,onOpen,onError}:Props){
 const location=useLocation();const consumed=useRef<string|null>(null);
 const latest=useRef({onOpen,onError});latest.current={onOpen,onError};
 useEffect(()=>{
  if(!ready||consumed.current===location.key)return;
  consumed.current=location.key;const value=new URLSearchParams(location.search).get('dossier');if(value===null)return;
  if(!/^[1-9]\d*$/.test(value)||!Number.isSafeInteger(Number(value))){latest.current.onError('Lien de dossier invalide');return;}
  latest.current.onOpen(Number(value));
 },[location.key,location.search,ready]);return null;
}
export default function DossierDeepLink(props:Props){const routed=useInRouterContext();return routed?<RoutedLink {...props}/>:null;}
