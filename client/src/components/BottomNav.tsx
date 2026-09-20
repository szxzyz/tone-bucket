import { useLocation } from "wouter";
import { useAdmin } from "@/hooks/useAdmin";
import { showNotification } from "@/components/AppNotification";

const ACTIVE = "#ffffff";
const DIM = "rgba(255,255,255,0.38)";
const HomeIcon = ({ active, c }: { active: boolean; c: string }) => <svg width="26" height="26" viewBox="0 0 24 24" fill="none">{active ? <><path d="M12 2L21.5 7.5V16.5L12 22L2.5 16.5V7.5Z" fill={c} opacity="0.15"/><path d="M12 2L21.5 7.5V16.5L12 22L2.5 16.5V7.5Z" stroke={c} strokeWidth="1.8" strokeLinejoin="round"/><circle cx="12" cy="12" r="2.5" fill={c}/><circle cx="12" cy="12" r="4.5" stroke={c} strokeWidth="1.2" opacity="0.4"/></> : <><path d="M12 2L21.5 7.5V16.5L12 22L2.5 16.5V7.5Z" stroke={c} strokeWidth="1.8" strokeLinejoin="round"/><circle cx="12" cy="12" r="2" fill={c} opacity="0.6"/></>}</svg>;
const TasksIcon = ({ active, c }: { active: boolean; c: string }) => <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="16" rx="3" fill={active ? c : "none"} opacity={active ? .15 : 1} stroke={c} strokeWidth="1.8"/><path d="M8 9h8M8 13h5M8 17h3" stroke={c} strokeWidth="1.8" strokeLinecap="round"/></svg>;
const FriendsIcon = ({ active, c }: { active: boolean; c: string }) => <svg width="25" height="25" viewBox="0 0 24 24" fill="none"><path d="M12 3.2 14.1 8l5.2.55-3.9 3.5 1.1 5.1L12 14.5l-4.5 2.65 1.1-5.1-3.9-3.5L9.9 8 12 3.2Z" fill={active ? c : "none"} opacity={active ? .16 : 1} stroke={c} strokeWidth="1.7" strokeLinejoin="round"/><path d="M4 19.5c1.1-1.5 2.6-2.25 4.5-2.25M20 19.5c-1.1-1.5-2.6-2.25-4.5-2.25" stroke={c} strokeWidth="1.7" strokeLinecap="round"/><circle cx="4" cy="19.5" r="1.2" fill={c}/><circle cx="20" cy="19.5" r="1.2" fill={c}/></svg>;
const MineIcon = ({ active, c }: { active: boolean; c: string }) => <svg width="25" height="25" viewBox="0 0 24 24" fill="none"><path d="M5 20 17.5 7.5M14.5 4.5l5 5M4 17l3 3" stroke={c} strokeWidth="1.8" strokeLinecap="round"/><path d="m13 3 8 8-2.5 2.5-8-8L13 3Z" fill={active ? c : "none"} opacity={active ? .18 : 1} stroke={c} strokeWidth="1.5" strokeLinejoin="round"/><path d="M3 21h8" stroke={c} strokeWidth="1.8" strokeLinecap="round"/></svg>;
const TABS = [
  { id: "home", label: "Home", path: "/" },
  { id: "mine", label: "Mine", path: "/mine" },
  { id: "tasks", label: "Mission", path: "/mission" },
  { id: "friends", label: "Friends", path: "/affiliates" },
] as const;
export default function BottomNav() {
  const [location, setLocation] = useLocation();
  const { isAdmin, isLoading } = useAdmin();
  return <nav style={{ position:"fixed", bottom:0, left:0, right:0, zIndex:600, display:"flex", alignItems:"stretch", height:72, paddingBottom:"max(var(--tg-content-safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)), 6px)", background:"#0a0a0a" }}>
    {TABS.map(tab => { const on = location === tab.path || (tab.id === "home" && location === "/game"); const c = on ? ACTIVE : DIM; return <button key={tab.id} onClick={() => { if (tab.id === "mine" && !isLoading && !isAdmin) { showNotification("Mining Under Update — page access is temporarily restricted.", "error"); return; } setLocation(tab.path); }} style={{ flex:1, height:"100%", border:"none", background:"transparent", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:5, position:"relative", padding:"6px 0 4px" }}>{on && <div style={{ position:"absolute", top:0, left:"25%", right:"25%", height:2, borderRadius:"0 0 3px 3px", background:ACTIVE }} />}<div style={{ display:"flex", alignItems:"center", justifyContent:"center", width:40, height:30 }}>{tab.id === "home" ? <HomeIcon active={on} c={c} /> : tab.id === "mine" ? <MineIcon active={on} c={c} /> : tab.id === "tasks" ? <TasksIcon active={on} c={c} /> : <FriendsIcon active={on} c={c} />}</div><span style={{ fontSize:10, fontWeight:on?700:500, letterSpacing:".03em", color:c, lineHeight:1 }}>{tab.label}</span></button>; })}
  </nav>;
}
