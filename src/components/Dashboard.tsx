import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input"; // ✅ Imported Input field
import {
  ThermometerIcon,
  DropletIcon,
  FlaskConicalIcon,
  TrendingUpIcon,
  AlertCircleIcon,
  GaugeIcon,
  PlayCircleIcon,
  StopCircleIcon,
  AlertTriangleIcon,
  XIcon // ✅ Imported XIcon for the close button
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { motion } from "motion/react";
import Logo from "./Logo";

import { db } from "../lib/firebase";
import {
  onValue,
  query,
  ref,
  limitToLast,
  off,
  Database,
  get,
  set,
  push,
  serverTimestamp,
} from "firebase/database";

interface DashboardProps {
  userRole: string;
}

type Point = { time: number; value: number };

const SCALING = {
  temp: { min: 20, max: 25 },
  ph: { min: 3.2, max: 3.8 },
  brix: { min: 14, max: 18 }
};

function formatTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function toPoints(obj: any): Point[] {
  if (!obj) return [];
  return Object.values(obj)
    .map((x: any) => ({ time: Number(x.time), value: Number(x.value) }))
    .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value))
    .sort((a, b) => a.time - b.time);
}

function toSugarHistoryPoints(obj: any): Point[] {
  if (!obj) return [];
  return Object.values(obj)
    .map((x: any) => ({ time: Number(x.time), value: Number(x.brix) }))
    .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value))
    .sort((a, b) => a.time - b.time);
}

function getStatus(value: number | null, min: number, max: number): "Normal" | "Alert" | "No Data" {
  if (value == null) return "No Data";
  if (value >= min && value <= max) return "Normal";
  return "Alert";
}

function badgeClass(status: string) {
  if (status === "Normal") return "border-green-500 text-green-600 text-xs";
  if (status === "Alert") return "border-red-500 text-red-600 text-xs";
  return "border-gray-300 text-gray-600 text-xs";
}

function pitchToBrix(pitch: number): number {
  const P_WATER = 17.49795; 
  const P_FINAL = 15.20;    

  let ratio = (P_WATER - pitch) / (P_WATER - P_FINAL);
  let brix = ratio * 24;

  if (!Number.isFinite(brix)) return NaN;
  if (brix < 0) brix = 0;
  if (brix > 30) brix = 30;
  return brix;
}

export default function Dashboard({ userRole }: DashboardProps) {
  const [tempNow, setTempNow] = useState<number | null>(null);
  const [brixNow, setBrixNow] = useState<number | null>(null);
  const [phNow, setPhNow] = useState<number | null>(null);
  const [pressureNow, setPressureNow] = useState<number | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const [tempHistory, setTempHistory] = useState<Point[]>([]);
  const [brixHistory, setBrixHistory] = useState<Point[]>([]);
  const [phHistory, setPhHistory] = useState<Point[]>([]);
  const [pressureHistory, setPressureHistory] = useState<Point[]>([]);

  const [isLive, setIsLive] = useState(false);
  const [canNotify, setCanNotify] = useState(false);
  
  const [isBatchActive, setIsBatchActive] = useState<boolean>(false);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [activeBatchDetails, setActiveBatchDetails] = useState<any>(null);

  const [isStopModalOpen, setIsStopModalOpen] = useState<boolean>(false);
  
  // ✅ ADDED: State for the Start Batch Modal
  const [isStartModalOpen, setIsStartModalOpen] = useState<boolean>(false);
  const [newBatch, setNewBatch] = useState({ volume: '', fruits: '', targetBrix: '2.0' });

  const serverOffsetRef = useRef<number>(0);
  const lastTiltTsRef = useRef<number | null>(null);
  const processingRef = useRef(false);

  const lastNotifiedTemp = useRef<number | null>(null);
  const lastNotifiedPh = useRef<number | null>(null);
  const lastNotifiedBrix = useRef<number | null>(null);

  const dbReady = !!db;

  useEffect(() => {
    const timer = setTimeout(() => {
      setCanNotify(true);
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  const pushNotification = async (title: string, message: string, iconName: string) => {
    if (!db) return;
    try {
      const notificationsRef = ref(db, 'notifications');
      await push(notificationsRef, {
        type: 'warning',
        title,
        message,
        timestamp: serverTimestamp(),
        iconName,
        unread: true
      });
    } catch (e) {
      console.error("Failed to push notification:", e);
    }
  };

  const checkAndTriggerNotification = (type: 'temp' | 'ph' | 'brix', value: number) => {
    if (!canNotify || !isBatchActive) return;

    let min, max, title, unit, icon, lastNotifiedRef;

    if (type === 'temp') {
      min = SCALING.temp.min; max = SCALING.temp.max;
      title = "Temperature Alert";
      unit = "°C";
      icon = "ThermometerIcon";
      lastNotifiedRef = lastNotifiedTemp;
    } else if (type === 'ph') {
      min = SCALING.ph.min; max = SCALING.ph.max;
      title = "Acidity (pH) Alert";
      unit = "pH";
      icon = "FlaskConicalIcon";
      lastNotifiedRef = lastNotifiedPh;
    } else {
      min = SCALING.brix.min; max = SCALING.brix.max;
      title = "Sugar Content Alert";
      unit = "Brix";
      icon = "DropletIcon";
      lastNotifiedRef = lastNotifiedBrix;
    }

    const isAlert = value < min || value > max;

    if (isAlert) {
      if (lastNotifiedRef.current !== value) {
        const direction = value > max ? "high" : "low";
        const message = `${type.toUpperCase()} is too ${direction}: ${value.toFixed(1)}${unit}. Optimal range is ${min}-${max}.`;
        pushNotification(title, message, icon);
        lastNotifiedRef.current = value; 
      }
    } else {
      lastNotifiedRef.current = null;
    }
  };

  useEffect(() => {
    if (!db) {
      setIsLive(false);
      return;
    }

    const database: Database = db;

    const batchRef = ref(database, "fermentation/currentBatch/details");
    onValue(batchRef, (snap) => {
      if (snap.exists()) {
        setIsBatchActive(true);
        const details = snap.val();
        setActiveBatchId(details.batchId);
        setActiveBatchDetails(details);
      } else {
        setIsBatchActive(false);
        setActiveBatchId(null);
        setActiveBatchDetails(null);
      }
    });

    const offsetRef = ref(database, ".info/serverTimeOffset");
    onValue(offsetRef, (snap) => {
      serverOffsetRef.current = Number(snap.val()) || 0;
    });

    const serverNow = () => Date.now() + (serverOffsetRef.current || 0);

    const currentRef = ref(database, "sensors/current");
    onValue(currentRef, (snap) => {
      const v = snap.val();
      if (!v) {
        setTempNow(null); setPhNow(null); setPressureNow(null);
        return;
      }
      const t = typeof v.temperature === "number" ? v.temperature : null;
      const p = typeof v.ph === "number" ? v.ph : null;
      
      setTempNow(t); setPhNow(p);
      setPressureNow(typeof v.pressurePSI === "number" ? v.pressurePSI : null);

      if (t !== null) checkAndTriggerNotification('temp', t);
      if (p !== null) checkAndTriggerNotification('ph', p);
    }, () => setIsLive(false));

    const sugarCurrentRef = ref(database, "sensors/sugar/current");
    onValue(sugarCurrentRef, (snap) => {
      const v = snap.val();
      if (!v) { setBrixNow(null); return; }
      
      const brixVal = typeof v.brix === "number" ? v.brix : null;
      setBrixNow(brixVal);

      if (brixVal !== null) checkAndTriggerNotification('brix', brixVal);

      if (typeof v.time === "number") {
        setUpdatedAt(v.time);
        setIsLive(true);
      }
    });

    const tiltRef = ref(database, "sensors/tilt/current");
    const sugarHistoryRef = ref(database, "sensors/sugar/history");

    onValue(tiltRef, async (snap) => {
        const tilt = snap.val();
        if (!tilt) return;
        const pitch = typeof tilt.pitch === "number" ? tilt.pitch : null;
        if (pitch == null) return;
        const ts = typeof tilt.ts_ms === "number" && tilt.ts_ms > 1_000_000_000_000 ? tilt.ts_ms : serverNow();

        if (lastTiltTsRef.current === ts) return;
        lastTiltTsRef.current = ts;

        if (processingRef.current) return;
        processingRef.current = true;

        try {
          const brix = pitchToBrix(pitch);
          if (!Number.isFinite(brix)) return;

          const prevSnap = await get(sugarCurrentRef);
          const prev = prevSnap.exists() ? prevSnap.val() : null;

          if (prev && typeof prev.time === "number" && typeof prev.brix === "number" && prev.time !== ts) {
            if (isBatchActive) {
               await push(sugarHistoryRef, { brix: Number(prev.brix), time: Number(prev.time) });
            }
          }

          await set(sugarCurrentRef, { brix, pitch, time: ts });

          setBrixNow(brix);
          setUpdatedAt(ts);
          setIsLive(true);
          
          checkAndTriggerNotification('brix', brix);
        } finally {
          processingRef.current = false;
        }
      }, () => setIsLive(false)
    );

    const tempQ = query(ref(database, "sensors/history/temperature"), limitToLast(30));
    const phQ = query(ref(database, "sensors/history/ph"), limitToLast(30));
    const pressureQ = query(ref(database, "sensors/history/pressurePSI"), limitToLast(30));
    const sugarHistQ = query(ref(database, "sensors/sugar/history"), limitToLast(30));

    onValue(tempQ, (snap) => setTempHistory(toPoints(snap.val())));
    onValue(phQ, (snap) => setPhHistory(toPoints(snap.val())));
    onValue(pressureQ, (snap) => setPressureHistory(toPoints(snap.val())));
    onValue(sugarHistQ, (snap) => setBrixHistory(toSugarHistoryPoints(snap.val())));

    return () => {
      off(offsetRef); off(currentRef); off(tiltRef); off(sugarCurrentRef); off(batchRef);
      off(ref(database, "sensors/history/temperature")); off(ref(database, "sensors/history/ph"));
      off(ref(database, "sensors/history/pressurePSI")); off(ref(database, "sensors/sugar/history"));
    };
  }, [canNotify, isBatchActive]); 

  useEffect(() => {
    const id = setInterval(() => {
      if (!updatedAt) return;
      const stale = Date.now() - updatedAt > 2 * 60 * 1000;
      setIsLive(!stale);
    }, 5000);
    return () => clearInterval(id);
  }, [updatedAt]);

  // ✅ ACTION: Create the Batch using the User's Real Input
  const handleStartBatch = async (e: any) => {
    e.preventDefault();
    if (!db) return;
    
    // Wipe ghosts
    await set(ref(db, 'sensors/history'), null);
    await set(ref(db, 'sensors/sugar/history'), null);
    await set(ref(db, 'sensors/current'), null);
    await set(ref(db, 'sensors/sugar/current'), null);
    await set(ref(db, 'sensors/tilt/current'), null);

    setTempNow(null);
    setPhNow(null);
    setBrixNow(null);
    setPressureNow(null);

    // Save with the ACTUAL user input from the modal
    await set(ref(db, 'fermentation/currentBatch'), {
      details: {
        batchId: `Batch #${Date.now().toString().slice(-4)}`,
        overallProgress: 0,
        initialVolume: `${newBatch.volume}L`,
        fruitsUsed: `${newBatch.fruits}kg`,
        targetBrix: Number(newBatch.targetBrix),
        startDate: new Date().toLocaleDateString()
      },
      stages: [
        { id: 1, name: 'Sorting', status: 'completed', date: new Date().toLocaleDateString() },
        { id: 2, name: 'Fermentation', status: 'active', date: new Date().toLocaleDateString(), progress: 0 },
        { id: 3, name: 'Filtration', status: 'pending', date: 'TBD' },
        { id: 4, name: 'Harvest', status: 'pending', date: 'TBD' }
      ]
    });

    setIsStartModalOpen(false); // Close Modal
    setNewBatch({ volume: '', fruits: '', targetBrix: '2.0' }); // Reset Form
  };

  const handleStopBatch = async () => {
    if (!db) return;
    
    let finalYield = "Unknown";
    if (activeBatchDetails) {
      // It now accurately parses the real volume you typed in!
      const initVolMatch = String(activeBatchDetails.initialVolume || "0").match(/\d+/);
      const initialVolNum = initVolMatch ? parseInt(initVolMatch[0], 10) : 0;
      finalYield = initialVolNum > 0 ? `${Math.round(initialVolNum * 0.90)}L` : "Unknown";
    }

    const historyRef = push(ref(db, 'fermentation/history'));
    
    await set(historyRef, {
      batchId: activeBatchId || "Legacy Batch",
      startDate: activeBatchDetails?.startDate || "Unknown Date", 
      completedAt: Date.now(),
      finalYield: finalYield,
      fruitsUsed: activeBatchDetails?.fruitsUsed || "Unknown",
      targetBrixAchieved: brixNow !== null ? brixNow.toFixed(1) : "Unknown",
      averageTemp: tempNow !== null ? tempNow.toFixed(1) : "N/A",
      averagePh: phNow !== null ? phNow.toFixed(1) : "N/A"
    });

    await set(ref(db, 'fermentation/currentBatch'), null);

    await set(ref(db, 'sensors/history'), null);
    await set(ref(db, 'sensors/sugar/history'), null);
    
    setIsStopModalOpen(false); 
  };

  const temperatureData = useMemo(() => tempHistory.map((p) => ({ time: formatTime(p.time), value: p.value })), [tempHistory]);
  const pressureData = useMemo(() => pressureHistory.map((p) => ({ time: formatTime(p.time), value: p.value })), [pressureHistory]);
  const phData = useMemo(() => phHistory.map((p) => ({ time: formatTime(p.time), value: p.value })), [phHistory]);
  const sugarData = useMemo(() => {
    const hist = brixHistory.map((p) => ({ time: formatTime(p.time), value: p.value }));
    if (brixNow != null && updatedAt != null) {
      const lastT = brixHistory.length ? brixHistory[brixHistory.length - 1].time : 0;
      if (updatedAt > lastT) {
        hist.push({ time: formatTime(updatedAt), value: brixNow });
      }
    }
    return hist;
  }, [brixHistory, brixNow, updatedAt]);

  const tempStatus = isBatchActive ? getStatus(tempNow, SCALING.temp.min, SCALING.temp.max) : "No Data";
  const brixStatus = isBatchActive ? getStatus(brixNow, SCALING.brix.min, SCALING.brix.max) : "No Data";
  const phStatus = isBatchActive ? getStatus(phNow, SCALING.ph.min, SCALING.ph.max) : "No Data";
  const pressureStatus = isBatchActive ? getStatus(pressureNow, 0, 30) : "No Data"; 

  if (!dbReady) {
    return (
      <div className="p-4">
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4">
            <p className="text-sm text-red-700 font-medium">Realtime Database not available</p>
            <p className="text-xs text-red-600 mt-1">Check your src/lib/firebase.ts configuration.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 pb-20">
      {/* Header */}
      <div className="flex justify-between items-start mb-6">
        <div className="flex items-center gap-3">
          <Logo size="sm" />
          <div>
            <h1 className="text-gray-900">Dashboard</h1>
            <p className="text-sm text-gray-500">Welcome back, {userRole}</p>
            <p className="text-xs text-gray-400">
              {updatedAt ? `Updated: ${new Date(updatedAt).toLocaleString()}` : "No data yet"}
            </p>
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
           <div className="flex items-center gap-2">
             <motion.div
               animate={{ scale: [1, 1.2, 1] }}
               transition={{ duration: 2, repeat: Infinity }}
               className={`w-2 h-2 rounded-full ${isLive ? "bg-green-500" : "bg-gray-400"}`}
             />
             <span className="text-sm text-gray-600">{isLive ? "Live Data" : "Offline"}</span>
           </div>
           <div className="flex items-center gap-1.5 opacity-60">
             <div className={`w-1.5 h-1.5 rounded-full ${canNotify && isBatchActive ? 'bg-blue-500' : 'bg-amber-500'}`} />
             <span className="text-[10px] uppercase font-bold text-gray-500">
                {canNotify && isBatchActive ? 'Alerts Armed' : 'Alerts Disabled'}
             </span>
           </div>
        </div>
      </div>

      {/* BATCH CONTROL CARD */}
      <Card className={`${isBatchActive ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-dashed'}`}>
        <CardContent className="p-4 flex justify-between items-center">
           <div>
             <p className="text-sm font-bold text-gray-900">Batch Control</p>
             <p className="text-xs text-gray-600 mt-1">
               {isBatchActive ? `Currently monitoring ${activeBatchId}` : 'No active batch. Graphs will not record history.'}
             </p>
           </div>
           {isBatchActive ? (
              <Button 
                onClick={() => setIsStopModalOpen(true)} 
                size="sm" 
                className="gap-1 bg-red-500 hover:bg-red-600 text-white shadow-sm border-none"
              >
                <StopCircleIcon className="w-4 h-4" /> End Batch
              </Button>
           ) : (
              // ✅ CHANGED: Opens the modal instead of instantly starting
              <Button onClick={() => setIsStartModalOpen(true)} size="sm" className="gap-1 bg-[#8B1538] text-white hover:bg-[#6b102b] border-none shadow-sm">
                <PlayCircleIcon className="w-4 h-4" /> Start New Batch
              </Button>
           )}
        </CardContent>
      </Card>

      {/* Status Cards */}
      <div className="grid grid-cols-2 gap-3">
        <Card className={`bg-gradient-to-br ${isBatchActive ? 'from-[#8B1538] to-[#6B1028]' : 'from-gray-400 to-gray-600'} text-white`}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm opacity-90 mb-1">Wine Status</p>
                <p className="text-white">{isBatchActive ? 'Active' : 'Idle'}</p>
              </div>
              <FlaskConicalIcon className="w-8 h-8 opacity-80" />
            </div>
          </CardContent>
        </Card>

        <Card className={`bg-gradient-to-br ${isBatchActive ? 'from-[#2D5016] to-[#1D3010]' : 'from-gray-400 to-gray-600'} text-white`}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm opacity-90 mb-1">System Stability</p>
                <p className="text-white">{isBatchActive ? 'Optimal' : 'Standby'}</p>
              </div>
              <TrendingUpIcon className="w-8 h-8 opacity-80" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sensor Readings */}
      <div className={!isBatchActive ? 'opacity-60 grayscale-[0.3] pointer-events-none' : ''}>
        <h2 className="text-gray-900 mb-3 flex items-center justify-between">
          <span>Real-time Sensors</span>
          {!isBatchActive && <span className="text-xs text-amber-600 font-bold px-2 py-1 bg-amber-100 rounded">Monitoring Disabled</span>}
        </h2>

        {/* Temperature Card */}
        <Card className="mb-3">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
                  <ThermometerIcon className="w-5 h-5 text-orange-600" />
                </div>
                <div>
                  <CardTitle className="text-sm">Temperature</CardTitle>
                  <p className="text-xs text-gray-500">Optimal: {SCALING.temp.min}-{SCALING.temp.max}°C</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-gray-900">{!isBatchActive || tempNow == null ? "--" : `${tempNow.toFixed(1)}°C`}</p>
                <Badge variant="outline" className={badgeClass(tempStatus)}>
                  {tempStatus}
                </Badge>
              </div>
            </div>
          </CardHeader>

          <CardContent className="pt-0">
            <ResponsiveContainer width="100%" height={100}>
              <LineChart data={isBatchActive ? temperatureData : []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} domain={[20, 26]} />
                <Tooltip />
                <Line type="monotone" dataKey="value" stroke="#f97316" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Pressure Card */}
        <Card className="mb-3">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 bg-sky-100 rounded-full flex items-center justify-center">
                  <GaugeIcon className="w-5 h-5 text-sky-700" />
                </div>
                <div>
                  <CardTitle className="text-sm">Pressure</CardTitle>
                  <p className="text-xs text-gray-500">Unit: PSI</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-gray-900">
                  {!isBatchActive || pressureNow == null ? "--" : `${pressureNow.toFixed(2)} PSI`}
                </p>
                <Badge variant="outline" className={badgeClass(pressureStatus)}>
                  {pressureStatus}
                </Badge>
              </div>
            </div>
          </CardHeader>

          <CardContent className="pt-0">
            <ResponsiveContainer width="100%" height={100}>
              <LineChart data={isBatchActive ? pressureData : []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
                <Tooltip />
                <Line type="monotone" dataKey="value" stroke="#0284c7" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Sugar Content Card */}
        <Card className="mb-3">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
                  <DropletIcon className="w-5 h-5 text-[#6B2C5D]" />
                </div>
                <div>
                  <CardTitle className="text-sm">Sugar Content</CardTitle>
                  <p className="text-xs text-gray-500">Target: {SCALING.brix.min}-{SCALING.brix.max} Brix</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-gray-900">
                  {!isBatchActive || brixNow == null ? "--" : `${brixNow.toFixed(1)} Brix`}
                </p>
                <Badge variant="outline" className={badgeClass(brixStatus)}>
                  {brixStatus}
                </Badge>
              </div>
            </div>
          </CardHeader>

          <CardContent className="pt-0">
            <ResponsiveContainer width="100%" height={100}>
              <LineChart data={isBatchActive ? sugarData : []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} domain={[0, 30]} />
                <Tooltip />
                <Line type="monotone" dataKey="value" stroke="#6B2C5D" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Acidity Card */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                  <FlaskConicalIcon className="w-5 h-5 text-[#8B1538]" />
                </div>
                <div>
                  <CardTitle className="text-sm">Acidity (pH)</CardTitle>
                  <p className="text-xs text-gray-500">Optimal: {SCALING.ph.min}-{SCALING.ph.max}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-gray-900">{!isBatchActive || phNow == null ? "--" : `${phNow.toFixed(2)} pH`}</p>
                <Badge variant="outline" className={badgeClass(phStatus)}>
                  {phStatus}
                </Badge>
              </div>
            </div>

            {(isBatchActive && phData.length > 0) && (
              <div className="mt-3">
                <ResponsiveContainer width="100%" height={80}>
                  <LineChart data={phData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} domain={[3.0, 4.2]} />
                    <Tooltip />
                    <Line type="monotone" dataKey="value" stroke="#8B1538" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Alert */}
      <Card className="bg-amber-50 border-amber-200">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <AlertCircleIcon className="w-5 h-5 text-amber-600 mt-0.5" />
            <div>
              <p className="text-amber-900 text-sm font-semibold">System Notice</p>
              <p className="text-amber-700 text-xs mt-1">
                Sugar (Brix) is dynamically computed from tilt pitch sensor logic and synced with AI thresholds. Graphs only record when a batch is active.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ✅ NEW: START BATCH MODAL */}
      {isStartModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="w-full max-w-sm">
            <Card className="p-6 bg-white rounded-3xl shadow-xl">
              <div className="flex justify-between items-center mb-4">
                 <h3 className="font-bold text-lg">Initialize New Batch</h3>
                 <button onClick={() => setIsStartModalOpen(false)}><XIcon className="w-5 h-5 text-gray-500 hover:text-gray-900 transition-colors"/></button>
              </div>
              <form onSubmit={handleStartBatch} className="space-y-4">
                <Input required type="number" placeholder="Must Volume (Liters)" value={newBatch.volume} onChange={e => setNewBatch({...newBatch, volume: e.target.value})} />
                <Input required type="number" placeholder="Fruit Weight (kg)" value={newBatch.fruits} onChange={e => setNewBatch({...newBatch, fruits: e.target.value})} />
                <Input required type="number" step="0.1" placeholder="Target Brix" value={newBatch.targetBrix} onChange={e => setNewBatch({...newBatch, targetBrix: e.target.value})} />
                <Button type="submit" className="w-full bg-[#8B1538] hover:bg-[#6b102b] py-6 text-white border-none transition-colors">Start Production</Button>
              </form>
            </Card>
          </motion.div>
        </div>
      )}

      {/* WARNING MODAL FOR ENDING BATCH */}
      {isStopModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="w-full max-w-sm">
            <Card className="p-6 bg-white rounded-3xl border-red-200 shadow-xl">
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center text-red-600">
                  <AlertTriangleIcon className="w-7 h-7" />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-gray-900">End Current Batch?</h3>
                  <p className="text-sm text-gray-500 mt-2">
                    Are you sure you want to stop monitoring <strong className="text-gray-900">{activeBatchId}</strong>? This will archive the data and clear the live graphs.
                  </p>
                </div>
                <div className="flex gap-3 w-full mt-4">
                  <Button onClick={() => setIsStopModalOpen(false)} variant="outline" className="flex-1 text-gray-700 border-gray-300 bg-white">
                    Cancel
                  </Button>
                  <Button 
                    onClick={handleStopBatch} 
                    className="flex-1 bg-[#8B1538] hover:bg-[#6b102b] text-white border-none shadow-md"
                  >
                    Confirm End
                  </Button>
                </div>
              </div>
            </Card>
          </motion.div>
        </div>
      )}
    </div>
  );
}