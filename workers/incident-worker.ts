import { env, pipeline } from "@huggingface/transformers";

export {};

type FailureInput = {
  key: string;
  repo: string;
  workflow: string;
  branch: string;
  sha: string;
  text: string;
};

type ClusterMember = FailureInput & {
  category: string;
};

type IncidentCluster = {
  id: string;
  label: string;
  category: string;
  count: number;
  confidence: number;
  averageSimilarity: number | null;
  members: ClusterMember[];
};

const scope: any = self;
let extractorPromise: Promise<any> | null = null;
let runtime: "webgpu" | "wasm" | "heuristic" = "heuristic";

env.useBrowserCache = true;
env.useWasmCache = true;

function categoryFor(text: string) {
  const value = text.toLowerCase();
  if (/auth|oauth|token|permission|forbidden|unauthorized|credential|secret/.test(value)) return "AUTH";
  if (/dependency|npm|package|lockfile|module not found|resolution|install/.test(value)) return "DEPENDENCY";
  if (/deploy|vercel|release|production|preview/.test(value)) return "DEPLOYMENT";
  if (/timeout|runner|network|rate limit|api|infrastructure|disk|memory/.test(value)) return "INFRASTRUCTURE";
  if (/contract|attestation|manifest|guard|policy|validator|validation/.test(value)) return "CONTRACT";
  if (/test|assert|spec|pytest|playwright|vitest|jest/.test(value)) return "TEST";
  if (/build|compile|typescript|typecheck|webpack|next build|lint/.test(value)) return "BUILD";
  return "UNKNOWN";
}

function normalizeWorkflow(name: string) {
  return name
    .toLowerCase()
    .replace(/\b(run|job|workflow|gate|check|validation|verify|verification)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function dot(a: number[], b: number[]) {
  let total=0;
  const length=Math.min(a.length,b.length);
  for(let i=0;i<length;i+=1) total+=a[i]*b[i];
  return total;
}

function mean(vectors: number[][]) {
  if(!vectors.length) return [];
  const result=new Array(vectors[0].length).fill(0);
  for(const vector of vectors){
    for(let i=0;i<result.length;i+=1) result[i]+=vector[i];
  }
  let norm=0;
  for(let i=0;i<result.length;i+=1){
    result[i]/=vectors.length;
    norm+=result[i]*result[i];
  }
  norm=Math.sqrt(norm)||1;
  return result.map((value)=>value/norm);
}

function titleFor(category: string, representative: FailureInput) {
  const prefix: Record<string,string> = {
    AUTH: "Authentication",
    DEPENDENCY: "Dependency",
    DEPLOYMENT: "Deployment",
    INFRASTRUCTURE: "Infrastructure",
    CONTRACT: "Contract / Guard",
    TEST: "Test",
    BUILD: "Build",
    UNKNOWN: "Unclassified",
  };
  return `${prefix[category] || category} · ${representative.workflow}`;
}

async function getExtractor() {
  if(extractorPromise) return extractorPromise;

  extractorPromise=(async()=>{
    const hasWebGpu=Boolean((navigator as any).gpu);
    if(hasWebGpu){
      try{
        scope.postMessage({type:"progress",stage:"model",message:"Loading local embedding model on WebGPU…"});
        const pipe=await pipeline(
          "feature-extraction",
          "onnx-community/all-MiniLM-L6-v2-ONNX",
          {
            device:"webgpu",
            dtype:"fp16",
            progress_callback:(event:any)=>{
              if(event?.status==="progress_total" && typeof event.progress==="number"){
                scope.postMessage({type:"progress",stage:"download",progress:Math.round(event.progress),message:"Downloading local embedding model…"});
              }
            },
          } as any,
        );
        runtime="webgpu";
        return pipe;
      }catch(error){
        scope.postMessage({type:"progress",stage:"fallback",message:"WebGPU unavailable for this model; falling back to WASM q8."});
      }
    }

    try{
      const pipe=await pipeline(
        "feature-extraction",
        "onnx-community/all-MiniLM-L6-v2-ONNX",
        {
          device:"wasm",
          dtype:"q8",
          progress_callback:(event:any)=>{
            if(event?.status==="progress_total" && typeof event.progress==="number"){
              scope.postMessage({type:"progress",stage:"download",progress:Math.round(event.progress),message:"Downloading local embedding model…"});
            }
          },
        } as any,
      );
      runtime="wasm";
      return pipe;
    }catch(error){
      runtime="heuristic";
      return null;
    }
  })();

  return extractorPromise;
}

function heuristicClusters(items: FailureInput[]): IncidentCluster[] {
  const buckets=new Map<string,FailureInput[]>();
  for(const item of items){
    const category=categoryFor(item.text);
    const workflow=normalizeWorkflow(item.workflow) || item.workflow.toLowerCase();
    const key=`${category}::${workflow}`;
    const current=buckets.get(key)||[];
    current.push(item);
    buckets.set(key,current);
  }

  return [...buckets.entries()]
    .map(([key,members],index)=>{
      const category=key.split("::")[0];
      return {
        id:`heuristic-${index}`,
        label:titleFor(category,members[0]),
        category,
        count:members.length,
        confidence:members.length>1?0.78:0.58,
        averageSimilarity:null,
        members:members.map((item)=>({...item,category})),
      };
    })
    .sort((a,b)=>b.count-a.count);
}

async function embeddingClusters(items: FailureInput[]) {
  const extractor=await getExtractor();
  if(!extractor) return heuristicClusters(items);

  scope.postMessage({type:"progress",stage:"embedding",message:"Computing local incident embeddings…"});
  const output=await extractor(items.map((item)=>item.text), {pooling:"mean",normalize:true});
  const vectors=output.tolist() as number[][];
  const clusters:Array<{
    category:string;
    members:FailureInput[];
    vectors:number[][];
    centroid:number[];
    similarities:number[];
  }>=[];

  items.forEach((item,index)=>{
    const category=categoryFor(item.text);
    const vector=vectors[index];
    let best=-1;
    let bestSimilarity=-1;

    clusters.forEach((cluster,clusterIndex)=>{
      if(cluster.category!==category && category!=="UNKNOWN" && cluster.category!=="UNKNOWN") return;
      const similarity=dot(vector,cluster.centroid);
      if(similarity>bestSimilarity){
        bestSimilarity=similarity;
        best=clusterIndex;
      }
    });

    const workflowMatch=clusters.findIndex((cluster)=>
      normalizeWorkflow(cluster.members[0].workflow)===normalizeWorkflow(item.workflow)
    );

    if(best>=0 && bestSimilarity>=0.78){
      const cluster=clusters[best];
      cluster.members.push(item);
      cluster.vectors.push(vector);
      cluster.similarities.push(bestSimilarity);
      cluster.centroid=mean(cluster.vectors);
    }else if(workflowMatch>=0 && clusters[workflowMatch].category===category){
      const cluster=clusters[workflowMatch];
      cluster.members.push(item);
      cluster.vectors.push(vector);
      cluster.similarities.push(dot(vector,cluster.centroid));
      cluster.centroid=mean(cluster.vectors);
    }else{
      clusters.push({
        category,
        members:[item],
        vectors:[vector],
        centroid:vector,
        similarities:[],
      });
    }
  });

  return clusters
    .map((cluster,index)=>{
      const avg=cluster.similarities.length
        ? cluster.similarities.reduce((sum,value)=>sum+value,0)/cluster.similarities.length
        : 1;
      return {
        id:`semantic-${index}`,
        label:titleFor(cluster.category,cluster.members[0]),
        category:cluster.category,
        count:cluster.members.length,
        confidence:Math.max(0.58,Math.min(0.99,cluster.members.length>1?avg:0.66)),
        averageSimilarity:cluster.members.length>1?avg:null,
        members:cluster.members.map((item)=>({...item,category:cluster.category})),
      };
    })
    .sort((a,b)=>b.count-a.count || b.confidence-a.confidence);
}

scope.onmessage=async(event:any)=>{
  if(event.data?.type!=="analyze") return;
  const items=(event.data.items||[]) as FailureInput[];

  try{
    if(!items.length){
      scope.postMessage({type:"result",runtime:"heuristic",clusters:[]});
      return;
    }

    const clusters=await embeddingClusters(items);
    scope.postMessage({type:"result",runtime,clusters});
  }catch(error){
    const clusters=heuristicClusters(items);
    scope.postMessage({
      type:"result",
      runtime:"heuristic",
      clusters,
      warning:error instanceof Error?error.message:"Local model failed; heuristic grouping used.",
    });
  }
};
