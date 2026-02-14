// CDP Profile types (from Profiler.consoleProfileFinished)
export interface CallFrame {
  functionName: string;
  scriptId: string;
  url: string;
  lineNumber: number;
  columnNumber: number;
}

export interface ProfileNode {
  id: number;
  callFrame: CallFrame;
  hitCount?: number;
  children?: number[];
}

export interface Profile {
  nodes: ProfileNode[];
  startTime: number;  // microseconds, V8 monotonic clock
  endTime: number;
  samples?: number[];
  timeDeltas?: number[];
}

// Capture metadata
export interface CaptureInfo {
  index: number;
  label: string;
  duration: number;  // milliseconds
  overlappingInvocations: number;
  profile: Profile;
  files: {
    cpu: string;
    network?: string;
  };
}

// Session state
export interface SessionState {
  id: string;
  startMark: string;
  endMark: string;
  target: 'main' | 'worker';
  workerUrl?: string;
  captures: CaptureInfo[];
  captureIndex: number;
  active: boolean;
  startedAt: number;
}

// Worker session info
export interface WorkerSession {
  sessionId: string;
  url: string;
  type: string;
}

// Stats result
export interface StatsResult {
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  stddev: number;
}

// Profile comparison result
export interface FunctionDiff {
  functionName: string;
  url: string;
  lineNumber: number;
  hitsA: number;
  hitsB: number;
  delta: number;
  percentA: number;
  percentB: number;
}

// Session summary (returned by stop_profiling_session)
export interface SessionSummary {
  sessionId: string;
  startMark: string;
  endMark: string;
  totalCaptures: number;
  captures: Array<{
    index: number;
    label: string;
    duration: number;
    overlappingInvocations: number;
    files: { cpu: string };
  }>;
  stats: {
    cpu: StatsResult;
  };
  outliers: Array<{
    label: string;
    metric: string;
    value: number;
    zscore: number;
  }>;
}
