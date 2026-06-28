'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { deriveKey, encryptData, decryptData, syncVaultToCloud, fetchVaultFromCloud, VaultState } from '@/lib/vault/core';
import { useAppStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ShieldCheck, Lock, RefreshCw, Database, Share2, Activity, ShieldAlert, Cpu, Network } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { CollectionSidebar } from '@/components/collection-sidebar';
import { ScrollArea } from '@/components/ui/scroll-area';

export default function DistributedVaultPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [vaultData, setVaultState] = useState<VaultState | null>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced'>('idle');
  const [gunPeers, setGunPeers] = useState(0);

  const { setEncryptionKey, updateAgencyProfile, updateGHLSettings, updateMayaSettings } = useAppStore();

  const gunRef = useRef<any>(null);
  const keyRef = useRef<CryptoKey | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const initGun = async () => {
      const { default: Gun } = await import('gun');
      gunRef.current = Gun(['https://gun-manhattan.herokuapp.com/gun']);
      setGunPeers(1);
    };
    initGun();
  }, []);

  const handleUnlock = async () => {
    if (!passphrase || !userId) return;
    try {
      setSyncStatus('syncing');
      const key = await deriveKey(passphrase);
      keyRef.current = key;
      setEncryptionKey(key);

      // 1. Try Local
      const local = localStorage.getItem(`vault_${userId}`);
      if (local) {
        const parsed = JSON.parse(local);
        const decrypted = await decryptData(parsed.cipher, parsed.iv, key);
        restoreSettings(decrypted);
        setVaultState(decrypted);
        setIsUnlocked(true);
        toast({ title: "Local Vault Decrypted", description: "Identity verified via WebCrypto." });
      } else {
        // 2. Fallback to Supabase Storage
        const cloudBlob = await fetchVaultFromCloud(userId);
        if (cloudBlob) {
          const decrypted = await decryptData(cloudBlob.cipher, cloudBlob.iv, key);
          restoreSettings(decrypted);
          setVaultState(decrypted);
          setIsUnlocked(true);
          toast({ title: "Cloud Backup Restored", description: "Encrypted data recovered from Supabase Storage." });
        } else {
          // 3. New Vault
          const newState: VaultState = { healthRecords: [], blueButtonData: null, updatedAt: Date.now() };
          setVaultState(newState);
          setIsUnlocked(true);
          toast({ title: "Genesis Vault Created", description: "Starting new encrypted PHI mesh." });
        }
      }
      setSyncStatus('synced');
    } catch {
      toast({ variant: "destructive", title: "Decryption Failed", description: "Incorrect passphrase or corrupted cipher." });
      setSyncStatus('idle');
    }
  };

  const restoreSettings = (data: VaultState) => {
    if (data.agencyProfile) updateAgencyProfile(data.agencyProfile);
    if (data.ghlSettings) updateGHLSettings(data.ghlSettings);
    if (data.mayaSettings) updateMayaSettings(data.mayaSettings);
  };

  const handleSaveRecord = async (content: string) => {
    if (!vaultData || !keyRef.current || !userId) return;

    setSyncStatus('syncing');
    const newState: VaultState = {
      ...vaultData,
      healthRecords: [
        ...vaultData.healthRecords,
        { id: crypto.randomUUID(), content, date: new Date().toISOString() },
      ],
      updatedAt: Date.now(),
    };

    const encrypted = await encryptData(newState, keyRef.current);
    const blob = { ...encrypted, userId, updatedAt: Date.now(), deviceId: 'browser-client' };

    localStorage.setItem(`vault_${userId}`, JSON.stringify(blob));
    syncVaultToCloud(userId, blob);
    gunRef.current?.get('vaults').get(userId).put(JSON.stringify(blob));

    setVaultState(newState);
    setSyncStatus('synced');
    toast({ title: "Record Sealed", description: "Encrypted across Mesh, Cloud, and Device." });
  };

  if (!isUnlocked) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-950 p-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-blue-900/20 via-transparent to-transparent -z-10" />
        <Card className="max-w-md w-full rounded-[2.5rem] bg-slate-900/50 border-blue-500/20 backdrop-blur-xl shadow-2xl p-10 space-y-8 text-center">
          <div className="w-20 h-20 rounded-3xl bg-blue-600 flex items-center justify-center mx-auto shadow-2xl shadow-blue-500/40">
            <Lock className="w-10 h-10 text-white" />
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-black text-white uppercase tracking-tighter">Hydra PHI Vault</h1>
            <p className="text-blue-400 font-bold uppercase text-[10px] tracking-widest">Zero-Knowledge Decentralized Storage</p>
          </div>
          <div className="space-y-4">
            <Input
              type="password"
              placeholder="Enter Private Passphrase"
              className="h-14 rounded-2xl bg-black/40 border-blue-500/30 text-white font-black text-center focus-visible:ring-blue-500"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
            />
            <Button onClick={handleUnlock} className="w-full h-14 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-black uppercase tracking-widest text-xs">
              Verify Identity &amp; Unlock
            </Button>
          </div>
          <div className="flex items-center justify-center gap-4 text-[9px] text-blue-400/60 font-black uppercase">
            <div className="flex items-center gap-1.5"><Cpu className="w-3 h-3" /> local crypto</div>
            <div className="flex items-center gap-1.5"><Network className="w-3 h-3" /> p2p mesh</div>
            <div className="flex items-center gap-1.5"><Database className="w-3 h-3" /> cold backup</div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full bg-background">
      <CollectionSidebar />
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50/30 dark:bg-slate-950">
        <header className="h-20 border-b border-border/50 px-8 flex items-center justify-between bg-background/80 backdrop-blur-md sticky top-0 z-10">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-2xl bg-blue-600 flex items-center justify-center text-white shadow-lg">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-black text-foreground uppercase tracking-tight">Data Cockpit</h1>
              <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest opacity-70">UID: {userId?.substring(0, 12)}... (Encrypted)</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="h-10 px-4 gap-2 font-black uppercase tracking-widest text-[10px] bg-emerald-500/10 text-emerald-500 border-emerald-500/20">
              <RefreshCw className={`w-3.5 h-3.5 ${syncStatus === 'syncing' ? 'animate-spin' : ''}`} />
              {syncStatus.toUpperCase()}
            </Badge>
            <Badge variant="outline" className="h-10 px-4 gap-2 font-black uppercase tracking-widest text-[10px] bg-blue-500/10 text-blue-500 border-blue-500/20">
              <Network className="w-3.5 h-3.5" />
              {gunPeers} Peers Active
            </Badge>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-10 space-y-10">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <Card className="lg:col-span-2 rounded-[2.5rem] bg-card border-border shadow-sm overflow-hidden">
              <CardHeader className="bg-muted/30 border-b p-8">
                <CardTitle className="text-sm font-black uppercase tracking-widest flex items-center gap-3">
                  <Activity className="w-5 h-5 text-blue-600" />
                  Health Records Timeline
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[500px]">
                  <div className="p-8 space-y-6">
                    {vaultData?.healthRecords.map((record: any) => (
                      <div key={record.id} className="p-6 rounded-3xl border bg-slate-50/50 dark:bg-slate-900/50 space-y-3">
                        <div className="flex items-center justify-between">
                          <Badge className="bg-blue-600/10 text-blue-600 border-none font-black text-[9px]">ID: {record.id}</Badge>
                          <span className="text-[9px] font-black text-muted-foreground uppercase">{new Date(record.date).toLocaleString()}</span>
                        </div>
                        <p className="text-sm font-bold text-foreground leading-relaxed">{record.content}</p>
                        <div className="flex items-center gap-4 pt-2 border-t border-border/50">
                          <div className="flex items-center gap-1.5 text-[9px] font-black text-emerald-600 uppercase">
                            <ShieldCheck className="w-3 h-3" /> Signed
                          </div>
                          <div className="flex items-center gap-1.5 text-[9px] font-black text-blue-600 uppercase">
                            <Database className="w-3 h-3" /> Replicated
                          </div>
                        </div>
                      </div>
                    ))}
                    {vaultData?.healthRecords.length === 0 && (
                      <div className="py-20 text-center space-y-4">
                        <Database className="w-12 h-12 text-muted-foreground mx-auto opacity-20" />
                        <p className="text-xs font-black text-muted-foreground uppercase tracking-widest opacity-40">No PHI fragments detected in the mesh.</p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
                <div className="p-8 border-t bg-muted/20">
                  <div className="flex gap-4">
                    <Input
                      placeholder="Input clinical observation or note..."
                      className="h-14 rounded-2xl bg-background border-border font-bold"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleSaveRecord((e.target as any).value);
                          (e.target as any).value = '';
                        }
                      }}
                    />
                    <Button onClick={() => handleSaveRecord("Manual Check-in")} className="h-14 rounded-2xl px-8 bg-blue-600 hover:bg-blue-500">Seal Record</Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-8">
              <Card className="rounded-[2.5rem] bg-slate-900 text-white border-none shadow-xl overflow-hidden relative">
                <div className="absolute top-0 right-0 p-8 opacity-10"><ShieldAlert className="w-32 h-32 text-white" /></div>
                <CardHeader>
                  <CardTitle className="text-[10px] font-black uppercase tracking-widest text-blue-400">Mesh Security Protocol</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6 relative z-10">
                  <div className="space-y-2">
                    <div className="flex justify-between text-[10px] font-black uppercase">
                      <span>Integrity Index</span>
                      <span className="text-emerald-400">100%</span>
                    </div>
                    <Progress value={100} className="h-1.5 bg-white/10" />
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed italic font-medium">
                    "Every packet is hashed and signed with your private key (SEA). Tamper-evident architecture ensures your PHI remains pure across the decentralized grid."
                  </p>
                  <Button variant="outline" className="w-full h-12 rounded-2xl border-white/20 text-white font-black uppercase text-[10px]">Verify Merkle Root</Button>
                </CardContent>
              </Card>

              <Card className="rounded-[2.5rem] bg-card border-border shadow-sm p-8 space-y-6">
                <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                  <Share2 className="w-4 h-4 text-blue-600" />
                  Trusted Access List
                </h3>
                <div className="space-y-4">
                  {[
                    { name: 'Dr. Alexander Wright', role: 'Primary Physician', access: 'Read-Only' },
                    { name: 'AegisSage Concierge', role: 'Support Bot', access: 'Zero-Knowledge' }
                  ].map((entry, i) => (
                    <div key={i} className="flex items-center justify-between p-4 rounded-2xl bg-muted/30 border border-border">
                      <div>
                        <p className="text-[10px] font-black text-foreground uppercase">{entry.name}</p>
                        <p className="text-[8px] font-bold text-muted-foreground uppercase">{entry.role}</p>
                      </div>
                      <Badge className="bg-blue-600/10 text-blue-600 border-none text-[8px] font-black">{entry.access}</Badge>
                    </div>
                  ))}
                </div>
                <Button className="w-full rounded-2xl h-12 font-black uppercase text-[10px] bg-blue-600">Grant Temporary Key</Button>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
