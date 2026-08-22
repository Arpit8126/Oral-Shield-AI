import React, { useState, useRef, useEffect } from "react";
import {
  Shield, Activity, Camera, Upload, FileText, AlertTriangle, CheckCircle,
  RefreshCw, UserCheck, FileDown, Eye, Sliders, MapPin, ClipboardList,
  Layers, Zap, ArrowLeft, ChevronRight
} from "lucide-react";
import { jsPDF } from "jspdf";

const NOTE_TEMPLATES = [
  "Referred for urgent incisional biopsy – Head & Neck Oncology.",
  "Toluidine Blue test recommended at next visit.",
  "Follow-up in 14 days post anti-inflammatory therapy.",
  "Patient counselled regarding tobacco cessation.",
  "No immediate intervention; routine monitoring in 6 weeks.",
  "Biopsy scheduled; results pending histopathological review."
];

const LESION_SITES = [
  "Buccal Mucosa (Cheek)", "Tongue – Lateral Border", "Tongue – Dorsum",
  "Floor of Mouth", "Hard Palate", "Soft Palate", "Gingiva (Gums)",
  "Lip (Vermilion Border)", "Retromolar Trigone", "Other / Unspecified"
];

// Unique ID: random 4 digits + last 4 chars of base-36 timestamp = highly unique
const genPatientId = () => {
  const r = Math.floor(1000 + Math.random() * 9000);
  const t = Date.now().toString(36).toUpperCase().slice(-4);
  return `PT-${r}-${t}`;
};

export default function App() {
  const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://127.0.0.1:8000";

  // Stage: "intake" = input form | "results" = output view
  const [stage, setStage] = useState("intake");

  const [patientInfo, setPatientInfo] = useState({ id: genPatientId(), name: "", age: "", gender: "Male" });
  const [lesionSite, setLesionSite] = useState("");
  const [habitHistory, setHabitHistory] = useState({ tobacco: false, tobaccoType: "", tobaccoYears: "", smoking: false, alcohol: false, lesionDuration: "" });
  const [symptoms, setSymptoms] = useState({ pain: false, ulceration: false, induration: false, bleeding: false });
  const [lesionColor, setLesionColor] = useState("");
  const [lesionMorphology, setLesionMorphology] = useState("");

  const [selectedImage, setSelectedImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);

  const [analyzing, setAnalyzing] = useState(false);
  const [gradcamAlpha, setGradcamAlpha] = useState(0.4);
  const [gradcamMode, setGradcamMode] = useState("sidebyside");
  const [doctorNotes, setDoctorNotes] = useState("");
  const [error, setError] = useState(null);
  const [analysisResult, setAnalysisResult] = useState(null);

  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const getTriageTier = (prob) => {
    if (prob >= 75) return { tier: "HIGH RISK", label: "Urgent", color: "#c0392b", action: "Urgent Incisional Biopsy & Referral to Head & Neck Oncology" };
    if (prob >= 48) return { tier: "MODERATE RISK", label: "Monitor", color: "#d4a017", action: "14-day Follow-up post Anti-inflammatory Therapy or Toluidine Blue Test" };
    return { tier: "LOW RISK", label: "Routine", color: "#5fa657", action: "Routine Monitoring & Reassurance; Re-evaluate at next scheduled visit" };
  };

  const loadDemoLesion = async () => {
    setError(null);
    try {
      const blob = await fetch("/oral_lesion_mock.jpg").then(r => r.blob());
      const file = new File([blob], "oral_lesion_mock.jpg", { type: "image/jpeg" });
      setSelectedImage(file);
      const reader = new FileReader();
      reader.onloadend = () => setImagePreview(reader.result);
      reader.readAsDataURL(file);
      setAnalysisResult(null);
    } catch { setError("Failed to load demo lesion image."); }
  };

  const startCamera = async () => {
    setCameraLoading(true); setError(null);
    try {
      if (streamRef.current) stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); }
      setIsCameraActive(true);
    } catch { setError("Failed to access camera. Upload manually instead."); }
    finally { setCameraLoading(false); }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setIsCameraActive(false);
  };

  const capturePhoto = () => {
    if (!videoRef.current) return;
    const v = videoRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth || 640; canvas.height = v.videoHeight || 480;
    canvas.getContext("2d").drawImage(v, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/jpeg");
    setImagePreview(url); setSelectedImage(url); stopCamera(); setError(null);
  };

  const processFile = (file) => {
    if (!file.type.startsWith("image/")) { setError("Please select a valid image file."); return; }
    setError(null); setSelectedImage(file);
    const r = new FileReader();
    r.onloadend = () => setImagePreview(r.result);
    r.readAsDataURL(file);
  };

  const runDiagnosis = async () => {
    if (!selectedImage) { setError("Please upload or capture a lesion image first."); return; }
    setAnalyzing(true); setError(null); setAnalysisResult(null);
    try {
      const formData = new FormData();
      if (typeof selectedImage === "string") {
        const blob = await fetch(selectedImage).then(r => r.blob());
        formData.append("file", blob, "captured_lesion.jpg");
      } else { formData.append("file", selectedImage); }
      const response = await fetch(`${backendUrl}/predict?gradcam=true`, { method: "POST", body: formData });
      if (!response.ok) { const e = await response.json(); throw new Error(e.detail || "API error."); }
      const result = await response.json();
      setAnalysisResult(result);
      setStage("results"); // Switch to results view on success
      // Scroll to top on mobile so results are visible immediately
      setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 50);
    } catch (err) {
      setError(err.message || "Network Error: Could not reach diagnostic server.");
    } finally { setAnalyzing(false); }
  };

  const handleReset = () => {
    setSelectedImage(null); setImagePreview(null); setAnalysisResult(null);
    setError(null); stopCamera(); setDoctorNotes("");
    setLesionSite(""); setLesionColor(""); setLesionMorphology("");
    setHabitHistory({ tobacco: false, tobaccoType: "", tobaccoYears: "", smoking: false, alcohol: false, lesionDuration: "" });
    setSymptoms({ pain: false, ulceration: false, induration: false, bleeding: false });
    setPatientInfo({ id: genPatientId(), name: "", age: "", gender: "Male" });
    setStage("intake");
  };

  const insertNoteTemplate = (t) => setDoctorNotes(prev => prev ? `${prev}\n${t}` : t);
  const toggleSymptom = (k) => setSymptoms(p => ({ ...p, [k]: !p[k] }));

  const getImageFormat = (uri) => {
    const m = uri?.match(/^data:image\/(\w+);base64,/);
    if (m) { const f = m[1].toUpperCase(); return f === "JPG" ? "JPEG" : f; }
    return "JPEG";
  };

  const exportPDFReport = () => {
    if (!analysisResult) return;
    try {
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pw = doc.internal.pageSize.getWidth();
      const m = 20;
      const triage = getTriageTier(analysisResult.suspicion_probability);

      doc.setFillColor(0, 0, 0); doc.rect(0, 0, pw, 42, "F");
      doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(22);
      doc.text("ORALSHIELD AI", m, 18);
      doc.setFont("helvetica", "normal"); doc.setFontSize(10);
      doc.text("Clinical Intraoral Mucosal Screening & Explainability Assistant", m, 26);
      doc.text("Hospital Diagnostic Report", m, 31);
      doc.setFontSize(9);
      doc.text(`Date: ${new Date().toLocaleString()}`, pw - m - 55, 18);
      doc.text(`Ref: ${patientInfo.id}`, pw - m - 55, 24);
      doc.text("Status: Completed", pw - m - 55, 30);

      doc.setTextColor(0,0,0); doc.setFont("helvetica","bold"); doc.setFontSize(13);
      doc.text("I. PATIENT INFORMATION", m, 54);
      doc.setDrawColor(38,38,38); doc.setLineWidth(0.5); doc.line(m, 57, pw-m, 57);
      doc.setFont("helvetica","normal"); doc.setFontSize(10);
      doc.text(`ID: ${patientInfo.id}`, m, 64);
      doc.text(`Name: ${patientInfo.name||"UNSPECIFIED"}`, m, 70);
      doc.text(`Age: ${patientInfo.age||"-"}`, m+90, 64);
      doc.text(`Gender: ${patientInfo.gender}`, m+90, 70);
      doc.text(`Lesion Site: ${lesionSite||"Not recorded"}`, m, 76);
      doc.text(`Duration: ${habitHistory.lesionDuration||"Not recorded"}`, m+90, 76);

      doc.setFont("helvetica","bold"); doc.setFontSize(11);
      doc.text("II. RISK FACTOR & CLINICAL HISTORY", m, 86);
      doc.line(m, 89, pw-m, 89);
      doc.setFont("helvetica","normal"); doc.setFontSize(9.5);
      const tbStr = habitHistory.tobacco ? `Yes – ${habitHistory.tobaccoType||"unspecified"}, ${habitHistory.tobaccoYears||"?"}yr` : "No";
      doc.text(`Tobacco/Betel/Areca: ${tbStr}`, m, 95);
      doc.text(`Smoking: ${habitHistory.smoking?"Yes":"No"}`, m, 101);
      doc.text(`Alcohol: ${habitHistory.alcohol?"Yes":"No"}`, m+90, 101);
      const sx = Object.entries(symptoms).filter(([,v])=>v).map(([k])=>k[0].toUpperCase()+k.slice(1));
      doc.text(`Symptoms: ${sx.length?sx.join(", "):"None"}`, m, 107);
      doc.text(`Color: ${lesionColor||"Not tagged"}`, m, 113);
      doc.text(`Morphology: ${lesionMorphology||"Not tagged"}`, m+90, 113);

      doc.setFillColor(13,13,13); doc.rect(m,120,pw-2*m,30,"F");
      doc.setDrawColor(38,38,38); doc.rect(m,120,pw-2*m,30,"S");
      doc.setFont("helvetica","bold"); doc.setFontSize(10.5); doc.setTextColor(255,255,255);
      doc.text("III. AI CLINICAL PHOTOGRAPHIC TRIAGE RESULT", m+6, 127);
      if (analysisResult.prediction==="Sus") {
        doc.setTextColor(212,160,23); doc.text("ALERT: SUSPICIOUS ORAL MUCOSAL PATTERNS DETECTED", m+6, 134);
        doc.setFontSize(9.5); doc.text(`Action: ${triage.action}`, m+6, 140);
      } else {
        doc.setTextColor(95,166,87); doc.text("CONTROL: NO SUSPICIOUS PATTERNS DETECTED", m+6, 134);
        doc.setFontSize(9.5); doc.text("Routine monitoring recommended.", m+6, 140);
      }
      doc.setTextColor(204,204,204); doc.setFont("helvetica","normal"); doc.setFontSize(9);
      doc.text(`Risk Index: ${analysisResult.suspicion_probability}%  |  Tier: ${triage.tier}  |  Confidence: ${analysisResult.confidence}%`, m+6, 146);

      doc.setTextColor(0,0,0); doc.setFont("helvetica","bold"); doc.setFontSize(13);
      doc.text("IV. CLINICAL INTRAORAL PHOTOGRAPHIC VISUALIZATION", m, 160);
      doc.line(m, 163, pw-m, 163);
      const iw=78, ih=65;
      doc.setFont("helvetica","bold"); doc.setFontSize(9.5);
      doc.text("Original Intraoral Photograph", m, 169);
      doc.text("Grad-CAM Explainability Map", pw-m-iw, 169);
      doc.setDrawColor(38,38,38); doc.rect(m,172,iw,ih);
      try { doc.addImage(imagePreview, getImageFormat(imagePreview), m,172,iw,ih); } catch {}
      doc.rect(pw-m-iw,172,iw,ih);
      if (analysisResult.gradcam_image) {
        try { doc.addImage(`data:image/jpeg;base64,${analysisResult.gradcam_image}`,"JPEG",pw-m-iw,172,iw,ih); } catch {}
      }

      const ny=250;
      doc.setTextColor(0,0,0); doc.setFont("helvetica","bold"); doc.setFontSize(13);
      doc.text("V. DENTAL PATHOLOGIST NOTES & SIGNOFF", m, ny);
      doc.line(m, ny+3, pw-m, ny+3);
      doc.setDrawColor(38,38,38); doc.rect(m,ny+7,pw-2*m,22);
      doc.setFont("helvetica","normal"); doc.setFontSize(9.5);
      doc.text(doc.splitTextToSize(doctorNotes||"No notes recorded.", pw-2*m-8), m+4, ny+13);

      doc.line(pw-m-50,278,pw-m,278);
      doc.setFont("helvetica","bold"); doc.setFontSize(8.5);
      doc.text("Dental Pathologist Signature", pw-m-47, 282);
      doc.setFont("helvetica","normal"); doc.text("Registration No: _________________", pw-m-47, 286);

      doc.setFillColor(255,245,245); doc.setDrawColor(212,160,23);
      doc.rect(m,278,pw-2*m,11,"F"); doc.rect(m,278,pw-2*m,11,"S");
      doc.setTextColor(153,51,51); doc.setFont("helvetica","bold"); doc.setFontSize(7.5);
      doc.text("CLINICAL DISCLAIMER: Screening aid only. Final diagnosis must be confirmed by a licensed dental pathologist.", m+4, 283);
      doc.text("AI outputs do not replace professional clinical judgment. Biopsy mandatory for all suspicious cases.", m+4, 286);

      doc.save(`OralShield_Report_${(patientInfo.name||"NoName").replace(/[^a-zA-Z0-9_-]/g,"_")}.pdf`);
    } catch (e) { console.error(e); setError("Failed to generate PDF report."); }
  };

  // ─── INTAKE STAGE ─────────────────────────────────────────────────────────────
  const IntakeView = () => (
    <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">

      {/* LEFT: Demographics + Clinical Metadata */}
      <section className="flex flex-col gap-5">

        {/* Patient Details */}
        <div className="bg-[#141414] border border-[#262626] p-6">
          <div className="flex items-center gap-2.5 mb-5 border-b border-[#262626] pb-4">
            <UserCheck className="h-4 w-4 text-white" />
            <h2 className="text-sm font-display uppercase tracking-wider text-white font-semibold">Patient Intake Records</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div className="col-span-1 sm:col-span-2">
              <label className="block text-[11px] font-mono-text uppercase tracking-wider text-white font-bold mb-1.5">Patient ID (Auto-Generated)</label>
              <div className="border border-[#262626] px-4 py-2 text-xs text-[#c3d9f3] font-mono-text">{patientInfo.id}</div>
            </div>
            <div className="col-span-1 sm:col-span-2">
              <label className="block text-[11px] font-mono-text uppercase tracking-wider text-white font-bold mb-1">Full Name</label>
              <input type="text" value={patientInfo.name} onChange={e => setPatientInfo({...patientInfo, name: e.target.value})} placeholder="Enter full name..." className="w-full bg-transparent border-b border-[#3a3a3a] focus:border-white py-2 px-0 text-sm text-white placeholder-[#aaaaaa] focus:outline-none transition font-serif-text" />
            </div>
            <div>
              <label className="block text-[11px] font-mono-text uppercase tracking-wider text-white font-bold mb-1">Age</label>
              <input type="number" value={patientInfo.age} onChange={e => setPatientInfo({...patientInfo, age: e.target.value})} placeholder="Years" className="w-full bg-transparent border-b border-[#3a3a3a] focus:border-white py-2 px-0 text-sm text-white placeholder-[#aaaaaa] focus:outline-none transition font-serif-text" />
            </div>
            <div>
              <label className="block text-[11px] font-mono-text uppercase tracking-wider text-white font-bold mb-1">Biological Gender</label>
              <select value={patientInfo.gender} onChange={e => setPatientInfo({...patientInfo, gender: e.target.value})} className="w-full bg-transparent border-b border-[#3a3a3a] focus:border-white py-2 px-0 text-sm text-white focus:outline-none transition font-serif-text appearance-none cursor-pointer">
                <option className="bg-[#141414]">Male</option>
                <option className="bg-[#141414]">Female</option>
                <option className="bg-[#141414]">Other</option>
              </select>
            </div>
          </div>
        </div>

        {/* Lesion Site & Metadata */}
        <div className="bg-[#141414] border border-[#262626] p-6 flex-1 flex flex-col">
          <div className="flex items-center gap-2.5 mb-5 border-b border-[#262626] pb-4">
            <MapPin className="h-4 w-4 text-white" />
            <h2 className="text-sm font-display uppercase tracking-wider text-white font-semibold">Lesion Site & Clinical Metadata</h2>
          </div>
          <div className="flex flex-col gap-5">
            <div>
              <label className="block text-[11px] font-mono-text uppercase tracking-wider text-white font-bold mb-2">Anatomical Lesion Site</label>
              <select value={lesionSite} onChange={e => setLesionSite(e.target.value)} className="w-full bg-[#0d0d0d] border border-[#262626] focus:border-white py-2.5 px-3 text-sm text-white focus:outline-none transition font-serif-text appearance-none cursor-pointer">
                <option value="" className="text-[#aaaaaa]">-- Select Site --</option>
                {LESION_SITES.map(s => <option key={s} value={s} className="bg-[#141414]">{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-mono-text uppercase tracking-wider text-white font-bold mb-2">Lesion Duration</label>
              <div className="flex flex-wrap gap-2">
                {["< 2 weeks", "2 – 3 weeks", "> 3 weeks"].map(d => (
                  <button key={d} onClick={() => setHabitHistory(p => ({...p, lesionDuration: p.lesionDuration===d?"":d}))} className={`text-[10px] font-mono-text uppercase tracking-wider px-3.5 py-1.5 border transition ${habitHistory.lesionDuration===d?"border-white text-white bg-white/10":"border-[#262626] text-[#aaaaaa] hover:text-[#999999]"}`}>{d}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-mono-text uppercase tracking-wider text-white font-bold mb-2">Visual Descriptor — Color</label>
              <div className="flex flex-wrap gap-2">
                {[{label:"Erythroplakic (Red)",color:"#c0392b"},{label:"Leukoplakic (White)",color:"#cccccc"},{label:"Mixed",color:"#d4a017"}].map(({label,color}) => (
                  <button key={label} onClick={() => setLesionColor(p => p===label?"":label)} className="text-[10px] font-mono-text uppercase tracking-wider px-3 py-1.5 border transition" style={{borderColor:lesionColor===label?color:"#262626",color:lesionColor===label?color:"#aaaaaa",background:lesionColor===label?`${color}18`:"transparent"}}>{label}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-mono-text uppercase tracking-wider text-white font-bold mb-2">Visual Descriptor — Morphology</label>
              <div className="flex flex-wrap gap-2">
                {["Ulcerative","Exophytic (Growth)","Flat / Macular"].map(m => (
                  <button key={m} onClick={() => setLesionMorphology(p => p===m?"":m)} className={`text-[10px] font-mono-text uppercase tracking-wider px-3.5 py-1.5 border transition ${lesionMorphology===m?"border-white text-white bg-white/10":"border-[#262626] text-[#aaaaaa] hover:text-[#999999]"}`}>{m}</button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* RIGHT COL: Habit History + Image Upload */}
      <section className="flex flex-col gap-5">

        {/* Habit History */}
        <div className="bg-[#141414] border border-[#262626] p-6">
          <div className="flex items-center gap-2.5 mb-5 border-b border-[#262626] pb-4">
            <ClipboardList className="h-4 w-4 text-white" />
            <h2 className="text-sm font-display uppercase tracking-wider text-white font-semibold">Patient Habit & Risk History</h2>
          </div>
          <div className="flex flex-col gap-5">
            <div>
              <label className="block text-[11px] font-mono-text uppercase tracking-wider text-white font-bold mb-2">Tobacco / Betel Quid / Areca Nut Use</label>
              <div className="flex items-center gap-3">
                <button onClick={() => setHabitHistory(p=>({...p,tobacco:!p.tobacco}))} className={`shrink-0 text-[10px] font-mono-text uppercase tracking-wider px-4 py-1.5 border transition min-w-[56px] ${habitHistory.tobacco?"border-[#d4a017] text-[#d4a017] bg-[#d4a017]/10":"border-[#262626] text-[#aaaaaa]"}`}>{habitHistory.tobacco?"Yes":"No"}</button>
                {habitHistory.tobacco && <>
                  <select value={habitHistory.tobaccoType} onChange={e=>setHabitHistory(p=>({...p,tobaccoType:e.target.value}))} className="flex-1 bg-[#0d0d0d] border border-[#262626] py-1.5 px-2 text-xs text-white focus:outline-none font-serif-text appearance-none">
                    <option value="">-- Type --</option>
                    <option>Smokeless / Chewing</option><option>Betel Quid</option><option>Areca Nut</option><option>Cigarette Smoking</option><option>Bidi / Hookah</option>
                  </select>
                  <input type="number" value={habitHistory.tobaccoYears} onChange={e=>setHabitHistory(p=>({...p,tobaccoYears:e.target.value}))} placeholder="Yrs" className="w-14 bg-transparent border-b border-[#3a3a3a] focus:border-white py-1.5 px-0 text-xs text-white placeholder-[#aaaaaa] focus:outline-none text-center font-serif-text" />
                </>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-mono-text uppercase tracking-wider text-white font-bold mb-2">Smoking History</label>
                <button onClick={() => setHabitHistory(p=>({...p,smoking:!p.smoking}))} className={`w-full text-[10px] font-mono-text uppercase tracking-wider py-2 border transition ${habitHistory.smoking?"border-[#d4a017] text-[#d4a017] bg-[#d4a017]/10":"border-[#262626] text-[#aaaaaa]"}`}>{habitHistory.smoking?"Yes":"No"}</button>
              </div>
              <div>
                <label className="block text-[11px] font-mono-text uppercase tracking-wider text-white font-bold mb-2">Alcohol Consumption</label>
                <button onClick={() => setHabitHistory(p=>({...p,alcohol:!p.alcohol}))} className={`w-full text-[10px] font-mono-text uppercase tracking-wider py-2 border transition ${habitHistory.alcohol?"border-[#d4a017] text-[#d4a017] bg-[#d4a017]/10":"border-[#262626] text-[#aaaaaa]"}`}>{habitHistory.alcohol?"Yes":"No"}</button>
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-mono-text uppercase tracking-wider text-white font-bold mb-2">Associated Symptoms</label>
              <div className="grid grid-cols-2 gap-2">
                {[{key:"pain",label:"Pain"},{key:"ulceration",label:"Ulceration"},{key:"induration",label:"Induration"},{key:"bleeding",label:"Bleeding on Touch"}].map(({key,label}) => (
                  <button key={key} onClick={() => toggleSymptom(key)} className={`text-[10px] font-mono-text uppercase tracking-wider px-3 py-2 border transition text-left ${symptoms[key]?"border-[#c0392b] text-[#c0392b] bg-[#c0392b]/10":"border-[#262626] text-[#aaaaaa] hover:text-[#999999]"}`}>{symptoms[key]?"✓ ":""}{label}</button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Image Upload + Analyze */}
        <div className="bg-[#141414] border border-[#262626] p-6 flex-1 flex flex-col">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-5 border-b border-[#262626] pb-4 gap-4">
            <div className="flex items-center gap-2.5">
              <Camera className="h-4 w-4 text-white" />
              <h2 className="text-sm font-display uppercase tracking-wider text-white font-semibold">Oral Mucosa Input Source</h2>
            </div>
            {!imagePreview && !isCameraActive && (
              <div className="flex gap-2">
                <button onClick={loadDemoLesion} className="flex items-center gap-1.5 text-[10px] bg-transparent hover:bg-white/5 text-[#999999] hover:text-white border border-[#262626] hover:border-white px-3 py-1.5 rounded-full font-mono-text uppercase tracking-wider transition"><Activity className="h-3 w-3" />Load Demo</button>
                <button onClick={startCamera} disabled={cameraLoading} className="flex items-center gap-1.5 text-[10px] bg-transparent hover:bg-white/5 text-[#999999] hover:text-white border border-[#262626] hover:border-white px-3 py-1.5 rounded-full font-mono-text uppercase tracking-wider transition"><Camera className="h-3 w-3" />Camera</button>
              </div>
            )}
          </div>

          <div className={!imagePreview && !isCameraActive ? "flex-1 flex flex-col justify-center min-h-[280px]" : ""}>
            {isCameraActive && (
              <div className="relative overflow-hidden bg-black border border-[#262626]">
                <video ref={videoRef} className="w-full h-auto aspect-[4/3] object-cover scale-x-[-1]" playsInline muted />
                <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-3">
                  <button onClick={capturePhoto} className="bg-transparent text-white text-[10px] font-mono-text uppercase tracking-wider border border-white px-4 py-2 rounded-full hover:bg-white/10 transition">Snap Lesion</button>
                  <button onClick={stopCamera} className="bg-transparent text-[#999999] text-[10px] font-mono-text uppercase tracking-wider border border-[#262626] px-4 py-2 rounded-full hover:text-white transition">Cancel</button>
                </div>
              </div>
            )}
            {!isCameraActive && !imagePreview && (
              <div className="border border-dashed border-[#2e2e2e] hover:border-white/30 p-10 flex flex-col items-center justify-center text-center cursor-pointer group transition" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f)processFile(f);}} onClick={()=>document.getElementById("fileIn").click()}>
                <Upload className="h-9 w-9 text-[#2e2e2e] group-hover:text-white/40 mb-4 transition" />
                <p className="text-[10px] font-mono-text uppercase tracking-widest text-[#aaaaaa] group-hover:text-white transition">Drag & drop or click to upload</p>
                <p className="text-[10px] text-[#aaaaaa] mt-1.5 mb-5 italic font-serif-text">JPG, JPEG or PNG</p>
                <label className="border border-[#262626] hover:border-white text-white text-[10px] font-mono-text uppercase tracking-widest px-4 py-2.5 rounded-full cursor-pointer transition hover:bg-white/10">
                  Browse Files
                  <input id="fileIn" type="file" accept="image/*" onChange={e=>{if(e.target.files[0])processFile(e.target.files[0])}} className="hidden" />
                </label>
              </div>
            )}
            {!isCameraActive && imagePreview && (
              <div className="relative overflow-hidden bg-black border border-[#262626]">
                <img src={imagePreview} alt="Mucosa Preview" className="w-full h-auto block" />
                <div className="absolute top-3 right-3">
                  <button onClick={()=>{setSelectedImage(null);setImagePreview(null);setAnalysisResult(null);}} className="bg-black/80 border border-[#262626] text-[#999999] hover:text-white p-2 rounded-full transition" title="Remove"><RefreshCw className="h-4 w-4" /></button>
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="mt-4 p-3 bg-red-950/20 border border-red-900/40 text-[#d4a017] flex items-start gap-2.5 text-xs font-serif-text">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /><span>{error}</span>
            </div>
          )}

          <div className="mt-6 pt-5 border-t border-[#262626] flex flex-col sm:flex-row gap-3">
            <button onClick={runDiagnosis} disabled={analyzing || !selectedImage} className="flex-1 bg-transparent hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed text-white font-mono-text text-xs uppercase tracking-[0.2em] border border-white py-4 rounded-full transition flex items-center justify-center gap-2">
              {analyzing ? (<><RefreshCw className="h-3.5 w-3.5 animate-spin" />Analyzing Mucosal Patterns...</>) : (<><Activity className="h-3.5 w-3.5" />Run Diagnostic Triage<ChevronRight className="h-3.5 w-3.5 ml-1" /></>)}
            </button>
            <button onClick={handleReset} className="bg-transparent hover:bg-white/5 text-[#999999] hover:text-white border border-[#262626] px-6 py-4 rounded-full font-mono-text text-xs uppercase tracking-[0.2em] transition">Reset</button>
          </div>
        </div>
      </section>
    </main>
  );

  // ─── RESULTS STAGE ────────────────────────────────────────────────────────────
  const ResultsView = () => {
    if (!analysisResult) return null;
    const triage = getTriageTier(analysisResult.suspicion_probability);
    const isSus = analysisResult.prediction === "Sus";

    return (
      <div className="flex-1 flex flex-col">
        {/* Patient Summary Bar */}
        <div className="border-b border-[#262626] bg-[#0a0a0a] px-4 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[10px] font-mono-text uppercase tracking-wider">
            <span className="text-[#c3d9f3]">{patientInfo.id}</span>
            {patientInfo.name && <span className="text-white">{patientInfo.name}</span>}
            {patientInfo.age && <span className="text-[#999999]">{patientInfo.age}y / {patientInfo.gender}</span>}
            {lesionSite && <span className="text-[#999999]">{lesionSite}</span>}
            <span className="font-bold uppercase text-[10px]" style={{ color: triage.color }}>{triage.tier}</span>
          </div>
          <button onClick={handleReset} className="flex items-center gap-1.5 shrink-0 text-[10px] font-mono-text uppercase tracking-wider text-[#999999] hover:text-white border border-[#262626] hover:border-white px-3.5 py-1.5 rounded-full transition">
            <ArrowLeft className="h-3 w-3" />New Case
          </button>
        </div>

        <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* LEFT: Images + Grad-CAM */}
          <section className="flex flex-col gap-5">

            {/* Original image */}
            <div className="bg-[#141414] border border-[#262626] p-5">
              <h3 className="text-[10px] font-mono-text uppercase tracking-wider text-[#999999] mb-3 flex items-center gap-2"><Camera className="h-3.5 w-3.5" />Intraoral Photograph</h3>
              <div className="overflow-hidden bg-black border border-[#1a1a1a]">
                {/* Full image, no crop — constrained to max height */}
                <img
                  src={imagePreview}
                  alt="Original"
                  className="w-full block"
                  style={{ maxHeight: 260, objectFit: 'contain', background: '#000' }}
                />
              </div>
            </div>

            {/* Grad-CAM */}
            <div className="bg-[#141414] border border-[#262626] p-5 flex-1">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-3 gap-2">
                <h3 className="text-[10px] font-mono-text uppercase tracking-wider text-[#999999] flex items-center gap-2"><Layers className="h-3.5 w-3.5" />Grad-CAM Heatmap</h3>
                <div className="flex border border-[#262626] rounded-full overflow-hidden shrink-0 self-start">
                  <button onClick={()=>setGradcamMode("sidebyside")} className={`text-[9px] font-mono-text uppercase tracking-wider px-3 py-1.5 flex items-center gap-1 transition ${gradcamMode==="sidebyside"?"bg-white text-black":"text-[#aaaaaa] hover:text-[#999999]"}`}><Layers className="h-3 w-3" />Side</button>
                  <button onClick={()=>setGradcamMode("overlay")} className={`text-[9px] font-mono-text uppercase tracking-wider px-3 py-1.5 flex items-center gap-1 transition ${gradcamMode==="overlay"?"bg-white text-black":"text-[#aaaaaa] hover:text-[#999999]"}`}><Eye className="h-3 w-3" />Blend</button>
                </div>
              </div>

              {analysisResult.gradcam_image ? (
                <div className="flex flex-col gap-3">
                  {gradcamMode === "sidebyside" && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-[8px] font-mono-text uppercase tracking-wider text-[#aaaaaa] text-center mb-1">Original</p>
                        <div className="border border-[#1a1a1a] overflow-hidden bg-black"><img src={imagePreview} alt="Original" className="w-full h-auto block" /></div>
                      </div>
                      <div>
                        <p className="text-[8px] font-mono-text uppercase tracking-wider text-[#aaaaaa] text-center mb-1">Heatmap</p>
                        <div className="border border-[#1a1a1a] overflow-hidden bg-black"><img src={`data:image/jpeg;base64,${analysisResult.gradcam_image}`} alt="Gradcam" className="w-full h-auto block" /></div>
                      </div>
                    </div>
                  )}
                  {gradcamMode === "overlay" && (
                    <>
                      {/*
                        ALIGNMENT FIX: Both base image and overlay use object-contain so
                        the gradcam heatmap aligns with the actual image content.
                        object-cover caused the heatmap to fill black letterbox bars.
                        A shared max-height ensures both images render in the same bounding box.
                      */}
                      <div className="relative border border-[#1a1a1a] bg-black overflow-hidden" style={{ maxHeight: 300 }}>
                        <img
                          src={imagePreview}
                          alt="Base"
                          className="w-full block"
                          style={{ maxHeight: 300, objectFit: 'contain' }}
                        />
                        <img
                          src={`data:image/jpeg;base64,${analysisResult.gradcam_image}`}
                          alt="Overlay"
                          style={{ opacity: gradcamAlpha }}
                          className="absolute inset-0 w-full h-full object-contain transition-opacity duration-200"
                        />
                      </div>
                      <div className="bg-black border border-[#1a1a1a] p-3 flex flex-col gap-2">
                        <div className="flex justify-between text-[8px] font-mono-text uppercase tracking-wider text-[#aaaaaa]">
                          <span>Original</span>
                          <span>Blend {Math.round(gradcamAlpha*100)}%</span>
                          <span>Heatmap</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <Eye className="h-3.5 w-3.5 text-[#999999] shrink-0" />
                          {/* Custom smooth-drag slider — no jump-to-click like native range input */}
                          <div
                            className="flex-1 relative flex items-center cursor-grab active:cursor-grabbing select-none"
                            style={{ height: 28 }}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              const rect = e.currentTarget.getBoundingClientRect();
                              const update = (clientX) => {
                                const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
                                setGradcamAlpha(Math.round((x / rect.width) * 20) / 20);
                              };
                              update(e.clientX);
                              const onMove = (e) => update(e.clientX);
                              const onUp = () => {
                                window.removeEventListener('mousemove', onMove);
                                window.removeEventListener('mouseup', onUp);
                              };
                              window.addEventListener('mousemove', onMove);
                              window.addEventListener('mouseup', onUp);
                            }}
                            onTouchStart={(e) => {
                              e.preventDefault();
                              const rect = e.currentTarget.getBoundingClientRect();
                              const update = (touch) => {
                                const x = Math.max(0, Math.min(touch.clientX - rect.left, rect.width));
                                setGradcamAlpha(Math.round((x / rect.width) * 20) / 20);
                              };
                              update(e.touches[0]);
                              const onMove = (e) => update(e.touches[0]);
                              const onEnd = () => {
                                window.removeEventListener('touchmove', onMove);
                                window.removeEventListener('touchend', onEnd);
                              };
                              window.addEventListener('touchmove', onMove, { passive: false });
                              window.addEventListener('touchend', onEnd);
                            }}
                          >
                            {/* Track background */}
                            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[3px] bg-[#3a3a3a]">
                              {/* Filled portion */}
                              <div className="h-full bg-white transition-none" style={{ width: `${gradcamAlpha * 100}%` }} />
                            </div>
                            {/* Thumb */}
                            <div
                              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-white border border-black shadow-md"
                              style={{ left: `${gradcamAlpha * 100}%` }}
                            />
                          </div>
                          <Sliders className="h-3.5 w-3.5 text-[#888888] shrink-0" />
                        </div>
                      </div>
                    </>
                  )}

                </div>
              ) : (
                <div className="p-4 border border-[#262626] text-center text-xs text-[#aaaaaa] font-mono-text uppercase">Heatmap not returned from server.</div>
              )}
            </div>
          </section>

          {/* RIGHT: Clinical Output */}
          <section className="flex flex-col gap-5">

            {/* ── Clinical Result Card ── */}
            <div className="bg-[#141414] border border-[#262626] p-6">
              <div className="flex items-center gap-2.5 mb-5 border-b border-[#262626] pb-4">
                <FileText className="h-4 w-4 text-white" />
                <h2 className="text-sm font-display uppercase tracking-wider text-white font-semibold">Diagnostic Clinical Photographic Analytics</h2>
              </div>

              {/* Status row — clean, clinical */}
              <div className="border border-[#262626] mb-5">
                {/* Status header strip */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-[#262626]" style={{ borderLeftWidth: 3, borderLeftColor: triage.color }}>
                  <div className="flex items-center gap-3">
                    {isSus
                      ? <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: triage.color }} />
                      : <CheckCircle className="h-4 w-4 shrink-0" style={{ color: triage.color }} />}
                    <span className="font-display uppercase tracking-wider text-white text-xs font-normal">
                      {isSus ? "Suspicious Mucosal Patterns Detected" : "No Suspicious Patterns Detected"}
                    </span>
                  </div>
                  <span className="text-[9px] font-mono-text uppercase tracking-widest shrink-0 ml-3" style={{ color: triage.color }}>{triage.tier}</span>
                </div>
                {/* Quantitative grid */}
                <div className="grid grid-cols-3 divide-x divide-[#262626]">
                  <div className="px-5 py-4">
                    <span className="block text-[9px] text-[#aaaaaa] font-mono-text uppercase tracking-wider mb-1.5">Risk Index</span>
                    <span className="text-xl font-display" style={{ color: triage.color }}>{analysisResult.suspicion_probability}%</span>
                  </div>
                  <div className="px-5 py-4">
                    <span className="block text-[9px] text-[#aaaaaa] font-mono-text uppercase tracking-wider mb-1.5">Confidence</span>
                    <span className="text-xl font-display text-white">{analysisResult.confidence}%</span>
                  </div>
                  <div className="px-5 py-4">
                    <span className="block text-[9px] text-[#aaaaaa] font-mono-text uppercase tracking-wider mb-1.5">Threshold</span>
                    <span className="text-xl font-display text-[#888888]">&ge;{analysisResult.threshold.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Triage Action — clinical table row */}
              <div className="border border-[#262626] grid grid-cols-1 sm:grid-cols-12 divide-y sm:divide-y-0 sm:divide-x divide-[#262626]">
                <div className="sm:col-span-4 px-5 py-4">
                  <span className="block text-[9px] text-[#aaaaaa] font-mono-text uppercase tracking-wider mb-1">Recommended Action</span>
                  <span className="text-xs font-display uppercase tracking-wider font-bold" style={{ color: triage.color }}>{triage.label}</span>
                </div>
                <div className="sm:col-span-8 px-5 py-4">
                  <span className="block text-[9px] text-[#aaaaaa] font-mono-text uppercase tracking-wider mb-1">Clinical Protocol</span>
                  <p className="text-xs text-[#cccccc] leading-relaxed font-serif-text">{triage.action}</p>
                </div>
              </div>

              {/* Contextual note */}
              <p className="mt-4 text-xs text-[#aaaaaa] leading-relaxed font-serif-text">
                {isSus
                  ? "AI model features indicate structural malignancy or dysplastic characteristics. This result should be corroborated with clinical examination, palpation, and histopathological biopsy before issuing a final diagnosis."
                  : "Diagnostic pattern analysis reflects normal mucosal epithelial characteristics. Clinical surveillance during routine examinations is sufficient; reassess if lesion persists or changes morphology."}
              </p>
            </div>

            {/* Doctor Notes */}
            <div className="bg-[#141414] border border-[#262626] p-6">
              <div className="flex items-center gap-2.5 mb-4 border-b border-[#262626] pb-4">
                <FileText className="h-4 w-4 text-white" />
                <h2 className="text-sm font-display uppercase tracking-wider text-white font-semibold">Pathologist Review Notes</h2>
              </div>
              <div className="flex flex-wrap gap-2 mb-3">
                {NOTE_TEMPLATES.map((t, i) => (
                  <button key={i} onClick={() => insertNoteTemplate(t)} title={t} className="text-[9px] font-mono-text uppercase tracking-wider border border-[#262626] text-[#aaaaaa] hover:border-white hover:text-white px-2.5 py-1 transition max-w-[190px] truncate">
                    + {t.substring(0,28)}…
                  </button>
                ))}
              </div>
              <textarea rows="4" value={doctorNotes} onChange={e=>setDoctorNotes(e.target.value)} placeholder="Add clinical observations, biopsy scheduling, or remarks..." className="w-full bg-transparent border border-[#262626] focus:border-white p-3.5 text-sm text-white placeholder-[#444444] focus:outline-none transition resize-none font-serif-text" />
            </div>

            {/* Export */}
            <div className="flex flex-col sm:flex-row gap-3">
              <button onClick={exportPDFReport} className="w-full bg-transparent hover:bg-white/10 text-white font-mono-text text-[10px] sm:text-xs uppercase tracking-[0.15em] border border-white py-4 px-4 rounded-full transition flex items-center justify-center gap-2.5">
                <FileDown className="h-4 w-4 shrink-0" />Download Patient PDF Report
              </button>
              <button onClick={handleReset} className="w-full bg-transparent hover:bg-white/5 text-[#999999] hover:text-white border border-[#262626] py-4 rounded-full font-mono-text text-xs uppercase tracking-[0.2em] transition">New Case</button>
            </div>
          </section>
        </main>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col bg-black text-[#cccccc] font-serif-text">
      <header className="sticky top-0 z-30 border-b border-[#262626] bg-black/90 backdrop-blur-md px-6 py-4">
        <h1 className="text-base sm:text-xl font-display uppercase tracking-[0.12em] sm:tracking-[0.25em] text-white font-normal">OralShield</h1>
      </header>

      {stage === "intake" ? <IntakeView /> : <ResultsView />}

      {/* Analyzing overlay */}
      {analyzing && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center z-50">
          <div className="relative h-20 w-20 flex items-center justify-center mb-6">
            <div className="absolute inset-0 rounded-full border-2 border-white/10 border-t-white animate-spin" />
            <Activity className="h-8 w-8 text-white animate-pulse" />
          </div>
          <h3 className="font-display uppercase tracking-[0.3em] text-white text-sm">Analyzing</h3>
          <p className="text-xs text-[#999999] mt-2 font-serif-text italic max-w-xs text-center">Processing intraoral photograph through diagnostic model...</p>
        </div>
      )}

      <footer className="border-t border-[#262626] bg-black py-6 px-6 mt-auto">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-[10px] text-[#444444] font-serif-text">
          <span className="italic">&copy; {new Date().getFullYear()} OralShield Diagnostic Suite. Developed in partnership with Clinical Hospital Research Network.</span>
          <span className="font-display uppercase tracking-[0.35em] text-[#999999] font-normal">OralShield</span>
        </div>
      </footer>
    </div>
  );
}
