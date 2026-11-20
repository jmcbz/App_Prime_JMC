import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { UNSAFE_DataRouterContext, useBlocker } from 'react-router-dom';
import type { DraftState, ReportDraft } from './SuivisBoard';

export function useSuivisDrafts() {
  const states=useRef(new Map<string,DraftState>());
  const [state,setState]=useState<DraftState>({dirty:false,busy:false});
  const onDraftState: ReportDraft=useCallback((id,next)=>{
    if(next)states.current.set(id,next);else states.current.delete(id);
    const values=[...states.current.values()];
    const nextState={dirty:values.some(v=>v.dirty),busy:values.some(v=>v.busy)};
    setState(old=>old.dirty===nextState.dirty && old.busy===nextState.busy?old:nextState);
  },[]);
  const canLeave=useCallback(()=>{
    const values=[...states.current.values()];
    if(values.some(v=>v.busy))return false;
    return !values.some(v=>v.dirty) || window.confirm('Des modifications non enregistrées seront perdues. Continuer ?');
  },[]);
  useEffect(()=>{
    const unload=(event:BeforeUnloadEvent)=>{if([...states.current.values()].some(v=>v.dirty||v.busy)){event.preventDefault();event.returnValue='';}};
    const logout=(event:Event)=>{if(!canLeave())event.preventDefault();};
    window.addEventListener('beforeunload',unload);
    window.addEventListener('client-onboarding:before-logout',logout);
    return ()=>{window.removeEventListener('beforeunload',unload);window.removeEventListener('client-onboarding:before-logout',logout);};
  },[canLeave]);
  return { ...state,onDraftState,canLeave };
}
function RouterGuard({dirty,busy,canLeave}:{dirty:boolean;busy:boolean;canLeave:()=>boolean}) {
  const blocker=useBlocker(dirty||busy);
  useEffect(()=>{
    if(blocker.state==='blocked'){
      if(canLeave())blocker.proceed();else blocker.reset();
    }
  },[blocker,canLeave]);
  return null;
}
// The real app uses a data router. Isolated component fixtures need no router.
export function SuivisNavigationGuard(props:{dirty:boolean;busy:boolean;canLeave:()=>boolean}) {
  const router=useContext(UNSAFE_DataRouterContext);
  return router?<RouterGuard {...props}/>:null;
}
