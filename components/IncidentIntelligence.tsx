"use client";

import { BrainCircuit, Cpu, Gauge, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RunInspection, WorkflowRun } from "@/lib/types";

type IncidentCluster = {
  id: string;
  label: string;
  category: string;
  count: number;
  confidence: number;
  averageSimilarity: number | null;
  members: Array<{
    key: string;
    repo: string;
    workflow: string;
    branch: string;
    sha: string;
    text: string;
    category: string;
  }>;
};

type ProgressState = {
  stage: string;
  message: string;
  progress?: number;
};

export default function IncidentIntelligence({
  runs,
  onOpenRun,
}: {
  runs: WorkflowRun[];
  onOpenRun: (run: WorkflowRun) => void;
}) {
  const failedRuns=useMemo(()=>runs.filter((run)=>run.state==="failure").slice(0,12),[runs]);
  const workerRef=useRef<Worker|null>(null);
  const [clusters,setClusters]=useState<IncidentCluster[]>([]);
  const [runtime,setRuntime]=useState<"webgpu"|"wasm"|"heuristic"|null>(null);
  const [progress,setProgress]=useState<ProgressState|null>(null);
  const [busy,setBusy]=useState(false);
  const [warning,setWarning]=useState("");

  useEffect(()=>{
    return ()=>workerRef.current?.terminate();
  },[]);

  const analyze=async()=>{
    setBusy(true);
    setClusters([]);
    setRuntime(null);
    setWarning("");
    setProgress({stage:"evidence",message:"Reading deterministic GitHub job/step evidence…"});

    try{
      const enriched=await Promise.all(
        failedRuns.map(async(run)=>{
          let inspection:RunInspection|null=null;
          try{
            const params=new URLSearchParams({repo:run.repo,runId:String(run.id)});
            const response=await fetch(`/api/run?${params.toString()}`,{cache:"no-store"});
            if(response.ok) inspection=await response.json();
          }catch{
            inspection=null;
          }

          const failedStep=inspection?.failure?.step||"";
          const failedJob=inspection?.failure?.job||"";
          const logLines=inspection?.failure?.lines?.join(" ")||"";
          return {
            key:`${run.repo}:${run.id}`,
            repo:run.repo,
            workflow:run.name,
            branch:run.branch||"detached",
            sha:run.sha,
            text:[
              run.name,
              run.repo,
              run.branch||"",
              run.event,
              failedJob,
              failedStep,
              logLines,
            ].filter(Boolean).join(" | "),
          };
        })
      );

      if(!workerRef.current){
        workerRef.current=new Worker(new URL("../workers/incident-worker.ts",import.meta.url),{type:"module"});
      }

      const worker=workerRef.current;
      worker.onmessage=(event)=>{
        if(event.data?.type==="progress"){
          setProgress(event.data);
          return;
        }
        if(event.data?.type==="result"){
          setClusters(event.data.clusters||[]);
          setRuntime(event.data.runtime||"heuristic");
          setWarning(event.data.warning||"");
          setProgress(null);
          setBusy(false);
        }
      };
      worker.onerror=(event)=>{
        setWarning(event.message||"Local intelligence worker failed.");
        setRuntime("heuristic");
        setBusy(false);
        setProgress(null);
      };
      worker.postMessage({type:"analyze",items:enriched});
    }catch(error){
      setWarning(error instanceof Error?error.message:"Incident analysis failed.");
      setBusy(false);
      setProgress(null);
    }
  };

  const runtimeLabel=runtime==="webgpu"
    ?"WebGPU local embeddings"
    :runtime==="wasm"
      ?"WASM q8 local embeddings"
      :runtime==="heuristic"
        ?"Deterministic fallback"
        :"Not loaded";

  return (
    <div className="intel-layout">
      <section className="machine-panel intel-hero">
        <div className="intel-orb"><BrainCircuit size={34}/></div>
        <div className="intel-copy">
          <p className="eyebrow">LOCAL INCIDENT INTELLIGENCE</p>
          <h2>Failure Correlation Engine</h2>
          <p>
            GitHub remains authoritative. A local browser model only embeds and groups failure evidence;
            it cannot rerun, cancel, merge, or write to a repository.
          </p>
        </div>
        <button className="intel-run" onClick={analyze} disabled={busy||!failedRuns.length}>
          {busy?<RefreshCw className="spin" size={17}/>:<Sparkles size={17}/>}
          {busy?"Analyzing…":clusters.length?"Re-analyze":"Analyze failures"}
        </button>
      </section>

      <section className="intel-readouts">
        <div className="machine-panel intel-readout">
          <Cpu size={18}/>
          <div><span>Execution</span><strong>{runtimeLabel}</strong></div>
        </div>
        <div className="machine-panel intel-readout">
          <ShieldCheck size={18}/>
          <div><span>Authority</span><strong>Read-only intelligence</strong></div>
        </div>
        <div className="machine-panel intel-readout">
          <Gauge size={18}/>
          <div><span>Failure sample</span><strong>{failedRuns.length} runs</strong></div>
        </div>
      </section>

      {progress&&(
        <section className="machine-panel intel-progress">
          <div className="intel-progress-line">
            <span>{progress.message}</span>
            {typeof progress.progress==="number"&&<strong>{progress.progress}%</strong>}
          </div>
          <div className="intel-progress-track">
            <i style={{width:`${typeof progress.progress==="number"?progress.progress:28}%`}}/>
          </div>
          <small>First model load may download and cache files locally in the browser.</small>
        </section>
      )}

      {warning&&<div className="intel-warning">{warning}</div>}

      {!busy&&!clusters.length&&(
        <section className="machine-panel intel-empty">
          <BrainCircuit size={27}/>
          <div>
            <strong>{failedRuns.length?"Ready for local analysis":"No failed runs in the current scope"}</strong>
            <span>
              {failedRuns.length
                ?"The first pass enriches failures with GitHub job/step evidence, then clusters them locally."
                :"Change repository scope or wait for a failure sample."}
            </span>
          </div>
        </section>
      )}

      <section className="incident-grid">
        {clusters.map((cluster)=>(
          <article className="machine-panel incident-card" key={cluster.id}>
            <div className="incident-head">
              <div>
                <span className={`incident-category incident-${cluster.category.toLowerCase()}`}>{cluster.category}</span>
                <h3>{cluster.label}</h3>
              </div>
              <div className="incident-count">{cluster.count}</div>
            </div>
            <div className="incident-confidence">
              <span>Grouping confidence</span>
              <strong>{Math.round(cluster.confidence*100)}%</strong>
              <div><i style={{width:`${Math.round(cluster.confidence*100)}%`}}/></div>
            </div>
            <div className="incident-members">
              {cluster.members.map((member)=>{
                const run=failedRuns.find((item)=>`${item.repo}:${item.id}`===member.key);
                return (
                  <button key={member.key} onClick={()=>run&&onOpenRun(run)} disabled={!run}>
                    <span className="status-lamp lamp-failure"/>
                    <div>
                      <strong>{member.workflow}</strong>
                      <small>{member.repo.replace(/^SouthPaw302\//,"")} · {member.branch} · {member.sha}</small>
                    </div>
                  </button>
                );
              })}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
