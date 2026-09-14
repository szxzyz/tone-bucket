import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { showNotification } from '@/components/AppNotification';

type Props = { open: boolean; onClose: () => void; userBalance: number };

export default function GameWithdrawPopup({ open, onClose, userBalance }: Props) {
  const queryClient = useQueryClient();
  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('');
  const { data: user } = useQuery<any>({ queryKey: ['/api/auth/user'], enabled: open, retry: false });
  const { data: settings } = useQuery<any>({ queryKey: ['/api/app-settings'], enabled: open, retry: false, staleTime: 60000 });
  const minimum = Math.max(1, Number(settings?.minimumCashoutGold || 100000));
  useEffect(() => { if (user?.payoutWalletAddress) setAddress(user.payoutWalletAddress); }, [user]);
  const saveWallet = useMutation({
    mutationFn: async () => (await apiRequest('PATCH', '/api/wallet/payout', { currency: 'TON', address: address.trim() })).json(),
    onSuccess: (data) => { if (!data.success) throw new Error(data.message); queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] }); showNotification('TON address saved successfully', 'success'); },
    onError: (e: any) => showNotification(e.message || 'Could not save TON address', 'error'),
  });
  const withdrawal = useMutation({
    mutationFn: async () => (await apiRequest('POST', '/api/payouts', { goldAmount: Number(amount) })).json(),
    onSuccess: (data) => { if (!data.success) throw new Error(data.message); queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] }); queryClient.invalidateQueries({ queryKey: ['/api/withdrawals'] }); showNotification('Gold withdrawal request sent to admin', 'success'); onClose(); },
    onError: (e: any) => showNotification(e.message || 'Could not create withdrawal request', 'error'),
  });
  if (!open) return null;
  const saved = Boolean(user?.payoutWalletAddress);
  const value = Number(amount || 0);
  const canSubmit = saved && Number.isInteger(value) && value >= minimum && value <= userBalance && !withdrawal.isPending;
  return <div onClick={onClose} style={{ position:'fixed', inset:0, zIndex:1200, display:'flex', alignItems:'flex-end' }}>
    <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.75)', backdropFilter:'blur(8px)' }} />
    <section onClick={e => e.stopPropagation()} style={{ position:'relative', width:'100%', maxHeight:'90vh', overflowY:'auto', background:'#0a0a0a', border:'1px solid rgba(255,255,255,0.06)', borderBottom:0, borderRadius:'20px 20px 0 0', padding:'0 16px max(32px, calc(env(safe-area-inset-bottom,0px) + 16px))' }}>
      <div style={{ position:'absolute', top:0, left:0, right:0, height:2, background:'linear-gradient(90deg, transparent, #2563eb, #3b82f6, #2563eb, transparent)' }} />
      <div style={{ width:32, height:3, borderRadius:2, background:'rgba(255,255,255,0.1)', margin:'12px auto 20px' }} />
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', marginBottom:20, color:'#fff', fontSize:18, fontWeight:800 }}>Withdraw Gold</div>
      <div style={{ background:'rgba(255,255,255,0.07)', borderRadius:14, marginBottom:14, overflow:'hidden' }}><Row label="Your balance" value={`${Math.floor(userBalance).toLocaleString()} GOLD`} /><Divider /><Row label="Minimum" value={`${minimum.toLocaleString()} GOLD`} /><Divider /><Row label="Request fee" value="0%" sub="Applied to requested Gold amount" /></div>
      <div style={{ marginBottom:14 }}><div style={labelStyle}>TON Wallet</div><input value={address} onChange={e=>setAddress(e.target.value)} placeholder="Enter your TON wallet address" style={inputStyle} /><button onClick={()=>saveWallet.mutate()} disabled={saveWallet.isPending || !address.trim()} style={{ ...primaryButton, opacity: saveWallet.isPending || !address.trim() ? .45 : 1 }}>{saveWallet.isPending ? 'Saving…' : saved ? 'Update TON Address' : 'Save TON Address'}</button></div>
      <div style={{ marginBottom:16 }}><div style={labelStyle}>Amount</div><div style={{ ...inputWrap }}><input inputMode="numeric" value={amount} onChange={e=>setAmount(e.target.value.replace(/[^0-9]/g,''))} placeholder={`Min ${minimum.toLocaleString()}`} style={{ ...inputStyle, margin:0, background:'transparent', padding:0, border:0 }} /><button onClick={()=>setAmount(String(Math.floor(userBalance)))} style={{ background:'none', border:0, color:'#60a5fa', fontSize:11, fontWeight:800 }}>MAX</button><span style={{ color:'rgba(255,255,255,.3)', fontSize:13, fontWeight:700 }}>GOLD</span></div>{value > 0 && value < minimum && <div style={{ color:'#f87171', fontSize:11, marginTop:6 }}>Minimum {minimum.toLocaleString()} GOLD required</div>}</div>
      <button onClick={()=>withdrawal.mutate()} disabled={!canSubmit} style={{ ...primaryButton, height:48, opacity:canSubmit?1:.4, display:'flex', justifyContent:'center', alignItems:'center', gap:8 }}>{withdrawal.isPending && <Loader2 size={16} style={{ animation:'spin 1s linear infinite' }} />}{withdrawal.isPending ? 'Submitting…' : 'Submit Withdrawal Request'}</button>
      <div style={{ color:'rgba(255,255,255,.25)', fontSize:11, marginTop:10, textAlign:'center' }}>Admin approval is required before manual TON payment.</div>
    </section>
  </div>;
}
const labelStyle = { fontSize:11, fontWeight:700, color:'rgba(255,255,255,.28)', textTransform:'uppercase' as const, letterSpacing:'.07em', marginBottom:8 };
const inputStyle = { width:'100%', height:44, boxSizing:'border-box' as const, border:0, borderRadius:12, padding:'0 14px', background:'rgba(255,255,255,.07)', color:'#fff', outline:'none', marginBottom:9 };
const inputWrap = { display:'flex', alignItems:'center', gap:10, padding:'0 14px', height:48, borderRadius:14, background:'rgba(255,255,255,.07)' };
const primaryButton = { width:'100%', padding:'14px 0', border:0, borderRadius:14, background:'linear-gradient(135deg,#2563eb,#3b82f6)', color:'#fff', fontSize:14, fontWeight:800, cursor:'pointer' };
function Row({ label, value, sub }: { label:string; value:string; sub?:string }) { return <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'13px 16px' }}><div><div style={{ color:'rgba(255,255,255,.5)', fontSize:14 }}>{label}</div>{sub && <div style={{ color:'rgba(255,255,255,.22)', fontSize:11, marginTop:2 }}>{sub}</div>}</div><span style={{ color:'#fff', fontSize:14, fontWeight:700 }}>{value}</span></div>; }
function Divider() { return <div style={{ height:1, background:'rgba(255,255,255,.05)', margin:'0 16px' }} />; }
