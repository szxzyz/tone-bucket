import { useLocation } from "wouter";

const ACTIVE = "#ffffff";
const DIM = "rgba(255,255,255,0.38)";
const HomeIcon = ({ active, c }: { active: boolean; c: string }) => <svg width="26" height="26" viewBox="0 0 24 24" fill="none">{active ? <><path d="M12 2L21.5 7.5V16.5L12 22L2.5 16.5V7.5Z" fill={c} opacity="0.15"/><path d="M12 2L21.5 7.5V16.5L12 22L2.5 16.5V7.5Z" stroke={c} strokeWidth="1.8" strokeLinejoin="round"/><circle cx="12" cy="12" r="2.5" fill={c}/><circle cx="12" cy="12" r="4.5" stroke={c} strokeWidth="1.2" opacity="0.4"/></> : <><path d="M12 2L21.5 7.5V16.5L12 22L2.5 16.5V7.5Z" stroke={c} strokeWidth="1.8" strokeLinejoin="round"/><circle cx="12" cy="12" r="2" fill={c} opacity="0.6"/></>}</svg>;
const TasksIcon = ({ active, c }: { active: boolean; c: string }) => <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="16" rx="3" fill={active ? c : "none"} opacity={active ? .15 : 1} stroke={c} strokeWidth="1.8"/><path d="M8 9h8M8 13h5M8 17h3" stroke={c} strokeWidth="1.8" strokeLinecap="round"/></svg>;
const FriendsIcon = ({ c }: { active: boolean; c: string }) => <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="7" r="4" stroke={c} strokeWidth="1.8"/><path d="M3 21c0-3.866 2.686-7 6-7s6 3.134 6 7M16 3.13a4 4 0 0 1 0 7.75M21 21c0-3.866-1.79-7-4-7" stroke={c} strokeWidth="1.8" strokeLinecap="round"/></svg>;
const TABS = [
  { id: "game", label: "Mine", path: "/game" },
  { id: "tasks", label: "Farming", path: "/mission" },
  { id: "friends", label: "Friends", path: "/affiliates" },
] as const;
export default function BottomNav() {
  const [location, setLocation] = useLocation();
  return <nav style={{ position:"fixed", bottom:0, left:0, right:0, zIndex:600, display:"flex", alignItems:"stretch", height:72, paddingBottom:"max(var(--tg-content-safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)), 6px)", background:"#0a0a0a" }}>
    {TABS.map(tab => { const on = location === tab.path || (tab.id === "game" && location === "/"); const c = on ? ACTIVE : DIM; return <button key={tab.id} onClick={() => setLocation(tab.path)} style={{ flex:1, height:"100%", border:"none", background:"transparent", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:5, position:"relative", padding:"6px 0 4px" }}>{on && <div style={{ position:"absolute", top:0, left:"25%", right:"25%", height:2, borderRadius:"0 0 3px 3px", background:ACTIVE }} />}<div style={{ display:"flex", alignItems:"center", justifyContent:"center", width:40, height:30 }}>{tab.id === "game" ? <HomeIcon active={on} c={c} /> : tab.id === "tasks" ? <TasksIcon active={on} c={c} /> : <FriendsIcon active={on} c={c} />}</div><span style={{ fontSize:10, fontWeight:on?700:500, letterSpacing:".03em", color:c, lineHeight:1 }}>{tab.label}</span></button>; })}
  </nav>;
}
