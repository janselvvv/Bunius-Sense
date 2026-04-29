import { useMemo, useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { ScrollArea } from "./ui/scroll-area";
import {
  DownloadIcon,
  TrendingUpIcon,
  DropletIcon,
  ThermometerIcon,
  FileTextIcon,
  FileSpreadsheetIcon,
  PrinterIcon,
  Loader2Icon,
  Trash2Icon,
  LeafIcon // ✅ Added Leaf icon for Fruits
} from "lucide-react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

import { db } from "../lib/firebase";
import { ref, onValue, off, set } from "firebase/database";

type TabType = "weekly" | "monthly" | "seasonal";
type ExportType = "pdf" | "excel" | "print";

export default function ReportsAnalytics() {
  const [activeTab, setActiveTab] = useState<TabType>("weekly");
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [historicalData, setHistoricalData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // 1. FETCH ACTUAL FIREBASE HISTORY
  useEffect(() => {
    if (!db) {
      setIsLoading(false);
      return;
    }

    const historyRef = ref(db, 'fermentation/history');
    onValue(historyRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        const formattedHistory = Object.keys(data).map(key => ({
          id: key,
          ...data[key]
        })).sort((a, b) => a.completedAt - b.completedAt);
        
        setHistoricalData(formattedHistory);
      } else {
        setHistoricalData([]);
      }
      setIsLoading(false);
    });

    return () => off(historyRef);
  }, []);

  // ✅ ACTION: Clear all old test data
  const handleWipeHistory = async () => {
    if (window.confirm("Are you sure you want to permanently delete all historical batch reports? This is useful for clearing test data before your final defense.")) {
      if (db) await set(ref(db, 'fermentation/history'), null);
    }
  };

  // 2. DYNAMIC METRICS CALCULATION (Now with precise decimal parsing)
  const avgTemp = useMemo(() => {
    if (historicalData.length === 0) return "--°C";
    const validTemps = historicalData.filter(d => d.averageTemp !== "N/A" && !isNaN(parseFloat(d.averageTemp)));
    if (validTemps.length === 0) return "--°C";
    
    const sum = validTemps.reduce((acc, curr) => acc + parseFloat(curr.averageTemp), 0);
    return `${(sum / validTemps.length).toFixed(1)}°C`;
  }, [historicalData]);

  const avgPh = useMemo(() => {
    if (historicalData.length === 0) return "-- pH";
    const validPh = historicalData.filter(d => d.averagePh !== "N/A" && !isNaN(parseFloat(d.averagePh)));
    if (validPh.length === 0) return "-- pH";
    
    const sum = validPh.reduce((acc, curr) => acc + parseFloat(curr.averagePh), 0);
    return `${(sum / validPh.length).toFixed(1)} pH`;
  }, [historicalData]);

  const totalYield = useMemo(() => {
    if (historicalData.length === 0) return "0L";
    const sum = historicalData.reduce((acc, curr) => {
      // ✅ FIX: Extract exact decimals for accurate math
      const match = String(curr.finalYield || "0").match(/\d+(\.\d+)?/);
      return acc + (match ? parseFloat(match[0]) : 0);
    }, 0);
    return `${sum.toFixed(1)}L`;
  }, [historicalData]);

  const totalFruits = useMemo(() => {
    if (historicalData.length === 0) return "0kg";
    const sum = historicalData.reduce((acc, curr) => {
      // ✅ FIX: Extract exact decimals for fruit weight
      const match = String(curr.fruitsUsed || "0").match(/\d+(\.\d+)?/);
      return acc + (match ? parseFloat(match[0]) : 0);
    }, 0);
    return `${sum.toFixed(1)}kg`;
  }, [historicalData]);

  // 3. DYNAMIC GRAPH DATA PROCESSING
  const weeklyGraphData = useMemo(() => {
    return historicalData.slice(-7).map(batch => ({
      batchId: batch.batchId.replace('Batch #', '#'),
      temperature: parseFloat(batch.averageTemp) || 0,
      sugar: parseFloat(batch.targetBrixAchieved) || 0,
      ph: parseFloat(batch.averagePh) || 0
    }));
  }, [historicalData]);

  const yieldGraphData = useMemo(() => {
    return historicalData.slice(-10).map(batch => {
       const match = String(batch.finalYield).match(/\d+(\.\d+)?/);
       return {
         batchId: batch.batchId.replace('Batch #', '#'),
         yield: match ? parseFloat(match[0]) : 0
       };
    });
  }, [historicalData]);

  const qualityDistribution = useMemo(() => {
    let premium = 0, standard = 0, below = 0;
    historicalData.forEach(batch => {
      const brix = parseFloat(batch.targetBrixAchieved);
      if (isNaN(brix)) return;
      
      if (brix >= 15 && brix <= 18) premium++;
      else if (brix >= 13 && brix < 15) standard++;
      else below++;
    });

    return [
      { name: "Premium (15-18 Brix)", value: premium, color: "#2D5016" },
      { name: "Standard (13-14 Brix)", value: standard, color: "#8B1538" },
      { name: "Below Standard", value: below, color: "#6B2C5D" },
    ];
  }, [historicalData]);

  // 4. EXPORT ENGINE
  const getReportData = () => {
    return {
      title: "Full Fermentation History",
      headers: ["Batch ID", "Start Date", "Completed At", "Final Yield", "Fruits Used", "Avg Temp", "Avg pH", "Final Brix"],
      rows: historicalData.map((item) => [
        item.batchId,
        item.startDate || "Unknown",
        new Date(item.completedAt).toLocaleDateString(),
        item.finalYield || "Unknown",
        item.fruitsUsed || "Unknown",
        `${item.averageTemp}°C`,
        item.averagePh,
        item.targetBrixAchieved
      ]),
      sheetName: "Batch History",
    };
  };

  const exportToPDF = () => {
    const report = getReportData();
    const doc = new jsPDF();

    doc.setFontSize(16);
    doc.text("Bunius-Sense Reports & Analytics", 14, 15);

    doc.setFontSize(12);
    doc.text(report.title, 14, 24);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 31);

    autoTable(doc, {
      head: [report.headers],
      body: report.rows,
      startY: 38,
    });

    doc.save(`BuniusSense-Report-${Date.now()}.pdf`);
  };

  const exportToExcel = () => {
    const report = getReportData();
    const workbook = XLSX.utils.book_new();

    const mainSheetData = [report.headers, ...report.rows];
    const worksheet = XLSX.utils.aoa_to_sheet(mainSheetData);

    XLSX.utils.book_append_sheet(workbook, worksheet, report.sheetName);
    XLSX.writeFile(workbook, `BuniusSense-Report-${Date.now()}.xlsx`);
  };

  const printReport = () => {
    const report = getReportData();

    let html = `
      <html>
        <head>
          <title>Bunius-Sense ${report.title}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #222; }
            h1, h2 { margin-bottom: 8px; }
            p { margin-top: 0; margin-bottom: 16px; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; margin-bottom: 24px; }
            th, td { border: 1px solid #ccc; padding: 10px; text-align: left; font-size: 12px; }
            th { background: #f5f5f5; }
          </style>
        </head>
        <body>
          <h1>Bunius-Sense Production Report</h1>
          <h2>${report.title}</h2>
          <p>Generated: ${new Date().toLocaleString()}</p>
          <table>
            <thead>
              <tr>${report.headers.map((header) => `<th>${header}</th>`).join("")}</tr>
            </thead>
            <tbody>
              ${report.rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}
            </tbody>
          </table>
        </body>
      </html>
    `;

    const printWindow = window.open("", "_blank", "width=900,height=700");
    if (!printWindow) {
      alert("Popup blocked. Please allow popups to print the report.");
      return;
    }

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();

    printWindow.focus();
    printWindow.print();
  };

  const handleExport = (type: ExportType) => {
    setShowExportMenu(false);
    if (type === "pdf") exportToPDF();
    if (type === "excel") exportToExcel();
    if (type === "print") printReport();
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-gray-500">
         <Loader2Icon className="w-10 h-10 animate-spin text-[#8B1538] mb-4" />
         <p>Loading historical data...</p>
      </div>
    );
  }

  const reversedHistory = [...historicalData].reverse();

  return (
    <div className="p-4 space-y-4 pb-20">
      {/* Header & Export */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-gray-900 font-bold text-xl">Reports & Analytics</h1>
          <p className="text-sm text-gray-500">Production insights from {historicalData.length} completed batches</p>
        </div>

        <div className="flex gap-2">
          {/* ✅ NEW WIPE HISTORY BUTTON */}
          <Button
            size="icon"
            variant="outline"
            className="border-red-200 text-red-600 hover:bg-red-50"
            onClick={handleWipeHistory}
            disabled={historicalData.length === 0}
            title="Clear all historical data"
          >
            <Trash2Icon className="w-4 h-4" />
          </Button>

          <div className="relative">
            <Button
              size="sm"
              className="bg-[#8B1538] hover:bg-[#6B1028] text-white"
              onClick={() => setShowExportMenu((prev) => !prev)}
              disabled={historicalData.length === 0}
            >
              <DownloadIcon className="w-4 h-4 mr-2" />
              Export
            </Button>

            {showExportMenu && (
              <div className="absolute right-0 mt-2 w-44 bg-white border rounded-lg shadow-lg z-20 overflow-hidden">
                <button onClick={() => handleExport("pdf")} className="w-full px-4 py-3 text-left text-sm hover:bg-gray-50 flex items-center gap-2">
                  <FileTextIcon className="w-4 h-4 text-red-600" /> Export PDF
                </button>
                <button onClick={() => handleExport("excel")} className="w-full px-4 py-3 text-left text-sm hover:bg-gray-50 flex items-center gap-2">
                  <FileSpreadsheetIcon className="w-4 h-4 text-green-600" /> Export Excel
                </button>
                <button onClick={() => handleExport("print")} className="w-full px-4 py-3 text-left text-sm hover:bg-gray-50 flex items-center gap-2">
                  <PrinterIcon className="w-4 h-4 text-gray-600" /> Direct Print
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ✅ UPDATED METRIC CARDS (Now 4 Columns to include Fruits Used) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-gradient-to-br from-[#2D5016] to-[#1D3010] text-white">
          <CardContent className="p-3 text-center flex flex-col justify-center h-full">
            <TrendingUpIcon className="w-5 h-5 mx-auto mb-1 opacity-80" />
            <p className="text-white font-bold text-lg">{avgPh}</p>
            <p className="text-[10px] opacity-90 mt-0.5 uppercase tracking-wider">Avg pH</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-[#8B1538] to-[#6B1028] text-white">
          <CardContent className="p-3 text-center flex flex-col justify-center h-full">
            <DropletIcon className="w-5 h-5 mx-auto mb-1 opacity-80" />
            <p className="text-white font-bold text-lg">{totalYield}</p>
            <p className="text-[10px] opacity-90 mt-0.5 uppercase tracking-wider">Total Yield</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-[#d97706] to-[#9a3412] text-white">
          <CardContent className="p-3 text-center flex flex-col justify-center h-full">
            <LeafIcon className="w-5 h-5 mx-auto mb-1 opacity-80" />
            <p className="text-white font-bold text-lg">{totalFruits}</p>
            <p className="text-[10px] opacity-90 mt-0.5 uppercase tracking-wider">Fruit Used</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-[#6B2C5D] to-[#4B1C3D] text-white">
          <CardContent className="p-3 text-center flex flex-col justify-center h-full">
            <ThermometerIcon className="w-5 h-5 mx-auto mb-1 opacity-80" />
            <p className="text-white font-bold text-lg">{avgTemp}</p>
            <p className="text-[10px] opacity-90 mt-0.5 uppercase tracking-wider">Avg Temp</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(value: string) => setActiveTab(value as TabType)}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="weekly">Recent Trends</TabsTrigger>
          <TabsTrigger value="monthly">Yield Analysis</TabsTrigger>
          <TabsTrigger value="seasonal">Quality Spread</TabsTrigger>
        </TabsList>

        {historicalData.length === 0 ? (
           <Card className="mt-4 py-12 border-dashed bg-gray-50">
              <CardContent className="flex flex-col items-center text-center">
                <FileTextIcon className="w-12 h-12 text-gray-300 mb-3" />
                <p className="text-gray-500 font-medium">No Historical Data</p>
                <p className="text-xs text-gray-400 mt-1">Start and complete a batch to generate analytics.</p>
              </CardContent>
           </Card>
        ) : (
          <>
            {/* TAB 1: Recent Trends */}
            <TabsContent value="weekly" className="space-y-4 mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Batch Environment Trends</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={weeklyGraphData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="batchId" tick={{ fontSize: 10 }} />
                      <YAxis yAxisId="left" tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
                      <Tooltip />
                      <Legend />
                      <Line yAxisId="left" type="monotone" dataKey="temperature" stroke="#f97316" strokeWidth={2} name="Temp (°C)" />
                      <Line yAxisId="right" type="monotone" dataKey="sugar" stroke="#8B1538" strokeWidth={2} name="Final Brix" />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </TabsContent>

            {/* TAB 2: Yield Analysis */}
            <TabsContent value="monthly" className="space-y-4 mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Production Yield per Batch (Liters)</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={yieldGraphData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="batchId" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Bar dataKey="yield" fill="#8B1538" radius={[4, 4, 0, 0]} name="Yield (L)" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </TabsContent>

            {/* TAB 3: Quality Spread */}
            <TabsContent value="seasonal" className="space-y-4 mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Lifetime Quality Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie
                        data={qualityDistribution.filter(d => d.value > 0)}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name.split(' ')[0]} ${((percent ?? 0) * 100).toFixed(0)}%`}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {qualityDistribution.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </TabsContent>
          </>
        )}
      </Tabs>

      {/* BATCH REPORT LIST */}
      {historicalData.length > 0 && (
        <div className="pt-6 mt-6 border-t border-gray-200 space-y-4">
          <h2 className="font-bold text-gray-900 flex items-center gap-2">
            <FileTextIcon className="w-5 h-5 text-[#8B1538]" /> Production Reports Log
          </h2>
          <p className="text-xs text-gray-500 mb-2">Raw data from all completed batches.</p>
          
          <ScrollArea className="h-[400px]">
            <div className="space-y-3 pb-4">
               {reversedHistory.map((report) => (
                 <Card key={report.id} className="overflow-hidden border-l-4 border-green-600 shadow-sm">
                   <CardContent className="p-4">
                     <div className="flex justify-between items-start mb-3">
                       <div>
                         <p className="font-bold text-sm text-gray-900">{report.batchId}</p>
                         <p className="text-xs text-gray-500">Started: {report.startDate || "Unknown"}</p>
                         <p className="text-xs text-gray-500">Completed: {new Date(report.completedAt).toLocaleDateString()}</p>
                       </div>
                       <div className="flex flex-col items-end gap-1">
                         <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                           {report.finalYield} Yield
                         </Badge>
                         <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                           {report.fruitsUsed} Fruit
                         </Badge>
                       </div>
                     </div>
                     
                     <div className="grid grid-cols-3 gap-3 pt-3 border-t border-gray-100">
                       <div>
                         <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Avg Temp</p>
                         <p className="text-sm font-medium">{report.averageTemp}°C</p>
                       </div>
                       <div>
                         <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Avg Acidity</p>
                         <p className="text-sm font-medium">{report.averagePh} pH</p>
                       </div>
                       <div>
                         <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Final Brix</p>
                         <p className="text-sm font-medium text-[#8B1538]">{report.targetBrixAchieved}</p>
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