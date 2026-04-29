import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Progress } from './ui/progress';
import { ScrollArea } from './ui/scroll-area';
import { 
  SparklesIcon, 
  TrendingUpIcon, 
  AlertTriangleIcon, 
  AwardIcon,
  BrainCircuitIcon,
  FileTextIcon
} from 'lucide-react';
import { motion } from 'motion/react';
import * as tf from '@tensorflow/tfjs';
import { db } from '../lib/firebase';
import { ref, onValue } from 'firebase/database';

const SCALING = {
  brix: { min: 0, max: 30 },
  temp: { min: 15, max: 40 },
  ph: { min: 2.5, max: 4.5 }
};
const normalize = (val: number, min: number, max: number) => (val - min) / (max - min);

export default function PredictiveInsights() {
  const [model, setModel] = useState<tf.LayersModel | null>(null);
  const [currentTemp, setCurrentTemp] = useState<number | null>(null);
  const [currentPh, setCurrentPh] = useState<number | null>(null);
  const [currentBrix, setCurrentBrix] = useState<number | null>(null);
  const [batchDetails, setBatchDetails] = useState<any>(null);
  
  // ✅ ADDED: State for Historical Reports
  const [historicalReports, setHistoricalReports] = useState<any[]>([]);
  
  // AI Prediction States
  const [predDays, setPredDays] = useState<number>(0);
  const [predQuality, setPredQuality] = useState<number>(0);
  const [predRisk, setPredRisk] = useState<number>(0);
  const [lastUpdated, setLastUpdated] = useState<string>("Waiting for data...");

  useEffect(() => {
    async function loadModel() {
      try {
        const m = await tf.loadLayersModel('/model_master/model.json');
        setModel(m);
      } catch (e) { 
        console.error("Failed to load Master AI. Check public/model_master/ folder."); 
      }
    }
    loadModel();
  }, []);

  useEffect(() => {
    if (!db) return;
    
    // Live Sensors
    const unsubSensors = onValue(ref(db, 'sensors/current'), (s) => {
      if(s.exists()) { 
        setCurrentTemp(s.val().temperature); 
        setCurrentPh(s.val().ph); 
        setLastUpdated(new Date().toLocaleTimeString());
      }
    });
    const unsubSugar = onValue(ref(db, 'sensors/sugar/current/brix'), (s) => {
      if(s.exists()) setCurrentBrix(s.val());
    });
    
    // Active Batch
    const unsubBatch = onValue(ref(db, 'fermentation/currentBatch/details'), (s) => {
      if(s.exists()) setBatchDetails(s.val());
      else setBatchDetails(null);
    });

    // ✅ ADDED: Listen to Firebase History Node
    const unsubHistory = onValue(ref(db, 'fermentation/history'), (snap) => {
       if (snap.exists()) {
         const data = snap.val();
         const formattedHistory = Object.keys(data).map(key => ({
           id: key,
           ...data[key]
         })).sort((a, b) => b.completedAt - a.completedAt);
         setHistoricalReports(formattedHistory);
       }
    });
    
    return () => { unsubSensors(); unsubSugar(); unsubBatch(); unsubHistory(); };
  }, []);

  useEffect(() => {
    if (!model || currentBrix === null || currentTemp === null || currentPh === null || !batchDetails) return;

    const targetBrixNum = batchDetails.targetBrix || 2;

    const nBrix = normalize(currentBrix, SCALING.brix.min, SCALING.brix.max);
    const nTemp = normalize(currentTemp, SCALING.temp.min, SCALING.temp.max);
    const nPh = normalize(currentPh, SCALING.ph.min, SCALING.ph.max);
    const nTarget = normalize(targetBrixNum, SCALING.brix.min, SCALING.brix.max);

    const input = tf.tensor2d([[nBrix, nTemp, nPh, nTarget]]);
    const predictions = model.predict(input) as tf.Tensor;
    const data = predictions.dataSync(); 

    setPredDays(Math.max(0, Math.ceil(data[0])));
    setPredQuality(Math.min(99, Math.max(1, Math.round(data[1]))));
    setPredRisk(Math.min(99, Math.max(1, Math.round(data[2]))));

    input.dispose();
    predictions.dispose();
  }, [currentBrix, currentTemp, currentPh, batchDetails, model]);

  let qualityStatus = 'excellent';
  let qualityLabel = 'Premium Grade';
  if (predQuality < 70) { qualityStatus = 'warning'; qualityLabel = 'Standard Grade'; }
  else if (predQuality < 85) { qualityStatus = 'good'; qualityLabel = 'Good Grade'; }

  let riskStatus = 'safe';
  let riskLabel = 'Very Low';
  if (predRisk > 60) { riskStatus = 'warning'; riskLabel = 'High Risk'; }
  else if (predRisk > 30) { riskStatus = 'good'; riskLabel = 'Moderate'; }

  let expectedYield = "Calculating...";
  let yieldConfidence = 0;
  if (batchDetails) {
    const initVolString = String(batchDetails.initialVolume || "0");
    const volumeMatch = initVolString.match(/\d+/);
    const initialVolNum = volumeMatch ? parseInt(volumeMatch[0], 10) : 0;

    if (initialVolNum > 0) {
      expectedYield = `${Math.round(initialVolNum * 0.90)} Liters`;
      yieldConfidence = 85;
    }
  }

  const insights = [
    {
      id: 1,
      title: 'Harvest Readiness',
      prediction: predDays <= 0 ? 'Ready Now' : `Ready in ~${predDays} days`,
      confidence: 94,
      status: predDays < 3 ? 'excellent' : 'optimal',
      icon: TrendingUpIcon,
      details: 'Based on biological fermentation curves',
      color: 'from-green-500 to-emerald-600',
    },
    {
      id: 2,
      title: 'Quality Score',
      prediction: qualityLabel,
      confidence: predQuality,
      status: qualityStatus,
      icon: AwardIcon,
      details: 'Multi-variable quality projection',
      color: 'from-[#8B1538] to-[#6B1028]',
    },
    {
      id: 3,
      title: 'Spoilage Risk',
      prediction: riskLabel,
      confidence: predRisk,
      status: riskStatus,
      icon: AlertTriangleIcon,
      details: 'Live environmental stress analysis',
      color: 'from-blue-500 to-cyan-600',
    },
    {
      id: 4,
      title: 'Expected Yield',
      prediction: expectedYield,
      confidence: yieldConfidence,
      status: 'good',
      icon: SparklesIcon,
      details: 'Projected final volume after filtration',
      color: 'from-[#6B2C5D] to-[#4B1C3D]',
    },
  ];

  return (
    <div className="p-4 space-y-4 pb-20">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-gray-900 font-bold text-xl">Predictive Insights</h1>
          <p className="text-sm text-gray-500">AI-powered multi-variable analysis</p>
        </div>
        <BrainCircuitIcon className="w-6 h-6 text-[#8B1538]" />
      </div>

      <Card className="bg-gradient-to-r from-purple-50 to-pink-50 border-purple-200">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <motion.div animate={{ rotate: 360 }} transition={{ duration: 3, repeat: Infinity, ease: "linear" }}>
              <SparklesIcon className="w-6 h-6 text-[#6B2C5D]" />
            </motion.div>
            <div>
              <p className="text-gray-900 font-bold">
                {model ? "Neural Network Active" : "Initializing AI Engine..."}
              </p>
              <p className="text-xs text-gray-600">Last processed: {lastUpdated}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ✅ CONDITIONAL RENDERING: Only show predictions if there is an active batch */}
      {batchDetails ? (
        <div className="space-y-4">
          {insights.map((insight, index) => {
            const Icon = insight.icon;
            return (
              <motion.div key={insight.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.1 }}>
                <Card className="overflow-hidden">
                  <div className={`h-2 bg-gradient-to-r ${insight.color}`} />
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${insight.color} flex items-center justify-center`}>
                          <Icon className="w-6 h-6 text-white" />
                        </div>
                        <div>
                          <CardTitle className="text-sm">{insight.title}</CardTitle>
                          <p className="text-xs text-gray-500 mt-1">{insight.details}</p>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Prediction</span>
                      <span className="text-gray-900 font-bold">{insight.prediction}</span>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-600">{insight.id === 3 ? "Risk Probability" : "Model Rating"}</span>
                        <Badge variant="outline" className="text-xs">{insight.confidence}%</Badge>
                      </div>
                      <Progress value={insight.confidence} className="h-2" />
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t mt-2">
                      <span className="text-xs text-gray-500 uppercase font-medium">Status</span>
                      <Badge variant="outline" className={insight.status === 'optimal' || insight.status === 'excellent' ? 'border-green-500 text-green-600 bg-green-50' : insight.status === 'good' || insight.status === 'safe' ? 'border-blue-500 text-blue-600 bg-blue-50' : 'border-amber-500 text-amber-600 bg-amber-50'}>
                        {insight.status.charAt(0).toUpperCase() + insight.status.slice(1)}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <Card className="bg-gray-50 border-dashed py-8">
           <CardContent className="text-center text-gray-500">
              <p>No active batch to analyze.</p>
              <p className="text-xs mt-1">Start a new batch in the Tracker to see live insights.</p>
           </CardContent>
        </Card>
      )}

      <Card className="bg-gray-50 border-gray-200">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Model Specifications</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between text-xs"><span className="text-gray-500">Architecture</span><span className="text-gray-900 font-medium">Multi-Output Dense Network</span></div>
          <div className="flex justify-between text-xs"><span className="text-gray-500">Training Data</span><span className="text-gray-900 font-medium">50,000 synthetic batches</span></div>
          <div className="flex justify-between text-xs"><span className="text-gray-500">Processor</span><span className="text-green-600 font-bold">TensorFlow.js (Edge AI)</span></div>
        </CardContent>
      </Card>

      {/* ✅ ADDED: HISTORICAL AI REPORTS */}
      {historicalReports.length > 0 && (
        <div className="pt-6 mt-6 border-t border-gray-200 space-y-4">
          <h2 className="font-bold text-gray-900 flex items-center gap-2">
            <FileTextIcon className="w-5 h-5 text-[#8B1538]" /> AI Analysis Reports
          </h2>
          <p className="text-xs text-gray-500 mb-2">Final metrics of completed batches.</p>
          
          <ScrollArea className="h-64">
            <div className="space-y-3 pb-4">
               {historicalReports.map((report) => (
                 <Card key={report.id} className="overflow-hidden border-l-4 border-[#8B1538]">
                   <CardContent className="p-4">
                     <div className="flex justify-between items-start mb-3">
                       <div>
                         <p className="font-bold text-sm text-gray-900">{report.batchId}</p>
                         <p className="text-xs text-gray-500">Completed: {new Date(report.completedAt).toLocaleDateString()}</p>
                       </div>
                       <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                         {report.finalYield} Generated
                       </Badge>
                     </div>
                     
                     <div className="grid grid-cols-2 gap-3 pt-3 border-t border-gray-100">
                       <div>
                         <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Avg Temp</p>
                         <p className="text-sm font-medium">{report.averageTemp}°C</p>
                       </div>
                       <div>
                         <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Avg Acidity</p>
                         <p className="text-sm font-medium">{report.averagePh} pH</p>
                       </div>
                       <div>
                         <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Target Brix</p>
                         <p className="text-sm font-medium text-green-600">{report.targetBrixAchieved}</p>
                       </div>
                       <div>
                         <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Fruit Used</p>
                         <p className="text-sm font-medium">{report.fruitsUsed}</p>
                       </div>
                     </div>
                   </CardContent>
                 </Card>
               ))}
            </div>
          </ScrollArea>
        </div>
      )}

    </div>
  );
}