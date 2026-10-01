/**
 * Provider topology graph — ported from the 9router-vscode monitor
 * (src/graph-app/index.tsx), itself a 1:1 port of the dashboard's
 * ProviderTopology: 9Router in the center, providers on an ellipse, electric
 * animated edges for providers with in-flight requests.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BaseEdge,
  Controls,
  Handle,
  Position,
  ReactFlow,
  getBezierPath,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './topology.css';
import type { TopologyProvider } from '../../../src/usage/protocol';

const FE_ACTIVE_TIMEOUT_MS = 60_000;
const FE_ACTIVE_TICK_MS = 1000;
const KAME_PARTICLE_COUNT = 6;
const SPARK_COUNT = 5;

const hiddenHandle = { opacity: 0, width: 0, height: 0 } as const;

type ProviderData = { label: string; color: string; imageUrl?: string; textIcon: string; active: boolean };
type RouterData = { activeCount: number };

function ProviderNode({ data }: NodeProps<Node<ProviderData>>) {
  const { label, color, imageUrl, textIcon, active } = data;
  const [imgError, setImgError] = useState(false);
  return (
    <div
      className="topo-provider"
      style={{
        border: `2px solid ${active ? color : 'var(--vscode-tree-indentGuidesStroke, rgba(128,128,128,0.28))'}`,
        boxShadow: active ? `0 0 18px ${color}60` : '0 2px 8px rgba(0,0,0,0.35)',
      }}
    >
      {(['top', 'bottom', 'left', 'right'] as const).map((id) => (
        <Handle key={id} type="target" position={positionOf(id)} id={id} style={hiddenHandle} />
      ))}
      <div className="topo-provider-icon" style={{ backgroundColor: `${color}20` }}>
        {imageUrl && !imgError ? (
          <img src={imageUrl} alt={label} onError={() => setImgError(true)} />
        ) : (
          <span style={{ color }}>{textIcon}</span>
        )}
      </div>
      <span className="topo-provider-label" style={{ color: active ? color : undefined }}>
        {label}
      </span>
      {active && (
        <span className="topo-ping">
          <span className="topo-ping-wave" style={{ backgroundColor: color }} />
          <span className="topo-ping-dot" style={{ backgroundColor: color }} />
        </span>
      )}
    </div>
  );
}

function RouterNode({ data }: NodeProps<Node<RouterData>>) {
  const powering = data.activeCount > 0;
  return (
    <div className={`topo-router ${powering ? 'topology-router-core powering' : ''}`}>
      {(['top', 'bottom', 'left', 'right'] as const).map((id) => (
        <Handle key={id} type="source" position={positionOf(id)} id={id} style={hiddenHandle} />
      ))}
      <span className={`topo-router-icon ${powering ? 'topology-router-icon' : ''}`}>🦊</span>
      <span className={`topo-router-label ${powering ? 'topology-router-label' : ''}`}>9Router</span>
      {powering && <span className="topo-router-badge topology-router-badge">{data.activeCount}</span>}
    </div>
  );
}

function TopologyEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, data }: EdgeProps<Edge<{ active: boolean }>>) {
  const [edgePath] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  if (!data?.active) {
    return <BaseEdge id={id} path={edgePath} style={style} />;
  }
  const filterId = `topo-electric-${id}`;
  return (
    <g className="topology-edge-electric">
      <defs>
        <filter id={filterId} x="-40%" y="-40%" width="180%" height="180%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={2} result="noise">
            <animate attributeName="baseFrequency" values="0.8;1.4;0.8" dur="0.25s" repeatCount="indefinite" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale={3.5} xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
      <path d={edgePath} fill="none" stroke="#22d3ee" strokeWidth={10} strokeOpacity={0.35} strokeLinecap="round" filter={`url(#${filterId})`} className="topology-edge-halo" />
      <path d={edgePath} fill="none" stroke="#4ade80" strokeWidth={5} strokeOpacity={0.85} strokeLinecap="round" filter={`url(#${filterId})`} className="topology-edge-plasma" />
      <BaseEdge id={id} path={edgePath} style={{ stroke: '#f8fafc', strokeWidth: 2.2, opacity: 1 }} className="topology-edge-kame" />
      {Array.from({ length: KAME_PARTICLE_COUNT }, (_, i) => (
        <circle key={`p-${i}`} r={i % 2 === 0 ? 4 : 2.5} fill={i % 3 === 0 ? '#fde047' : i % 3 === 1 ? '#67e8f9' : '#fff'} opacity={0.95} style={{ filter: 'drop-shadow(0 0 4px #22d3ee)' }}>
          <animateMotion dur={`${0.4 + i * 0.08}s`} repeatCount="indefinite" path={edgePath} begin={`${i * 0.09}s`} />
        </circle>
      ))}
      {Array.from({ length: SPARK_COUNT }, (_, i) => (
        <circle key={`s-${i}`} r={1.8} fill="#e0f2fe" opacity={0}>
          <animate attributeName="opacity" values="0;1;0;0;1;0" dur={`${0.35 + (i % 3) * 0.1}s`} begin={`${i * 0.07}s`} repeatCount="indefinite" />
          <animateMotion dur={`${0.28 + i * 0.05}s`} repeatCount="indefinite" path={edgePath} begin={`${i * 0.11}s`} />
        </circle>
      ))}
    </g>
  );
}

function positionOf(id: 'top' | 'bottom' | 'left' | 'right'): Position {
  return id === 'top' ? Position.Top : id === 'bottom' ? Position.Bottom : id === 'left' ? Position.Left : Position.Right;
}

const nodeTypes = { provider: ProviderNode, router: RouterNode };
const edgeTypes = { topology: TopologyEdge };

function buildLayout(providers: TopologyProvider[], activeSet: Set<string>, lastSet: Set<string>, errorSet: Set<string>) {
  const nodeW = 160;
  const nodeH = 38;
  const routerW = 130;
  const routerH = 44;
  const count = providers.length;
  const rx = Math.max(260, ((nodeW + 20) * count) / (2 * Math.PI));
  const ry = Math.max(160, rx * 0.55);

  const nodes: Node[] = [
    { id: 'router', type: 'router', position: { x: -routerW / 2, y: -routerH / 2 }, data: { activeCount: activeSet.size }, draggable: false },
  ];
  const edges: Edge[] = [];

  const edgeStyle = (active: boolean, last: boolean, error: boolean) => {
    if (error) { return { stroke: '#ef4444', strokeWidth: 2.5, opacity: 0.9 }; }
    if (active) { return { stroke: '#22d3ee', strokeWidth: 3.5, opacity: 1 }; }
    if (last) { return { stroke: '#f59e0b', strokeWidth: 2, opacity: 0.7 }; }
    return { stroke: 'var(--vscode-tree-indentGuidesStroke, rgba(128,128,128,0.22))', strokeWidth: 1, opacity: 0.3 };
  };

  providers.forEach((p, i) => {
    const key = p.provider.toLowerCase();
    const active = activeSet.has(key);
    const last = !active && lastSet.has(key);
    const error = !active && errorSet.has(key);
    const nodeId = `provider-${p.provider}`;
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / count;
    const cx = rx * Math.cos(angle);
    const cy = ry * Math.sin(angle);

    let sourceHandle: string;
    let targetHandle: string;
    if (Math.abs(angle + Math.PI / 2) < Math.PI / 4 || Math.abs(angle - (3 * Math.PI) / 2) < Math.PI / 4) {
      sourceHandle = 'top'; targetHandle = 'bottom';
    } else if (Math.abs(angle - Math.PI / 2) < Math.PI / 4) {
      sourceHandle = 'bottom'; targetHandle = 'top';
    } else if (cx > 0) {
      sourceHandle = 'right'; targetHandle = 'left';
    } else {
      sourceHandle = 'left'; targetHandle = 'right';
    }

    nodes.push({
      id: nodeId,
      type: 'provider',
      position: { x: cx - nodeW / 2, y: cy - nodeH / 2 },
      data: { label: p.name, color: p.color, imageUrl: p.iconUri, textIcon: p.textIcon, active } satisfies ProviderData,
      draggable: false,
    });
    edges.push({
      id: `e-${nodeId}`,
      type: 'topology',
      source: 'router',
      sourceHandle,
      target: nodeId,
      targetHandle,
      data: { active },
      style: edgeStyle(active, last, error),
    });
  });

  return { nodes, edges };
}

export function TopologyGraph({
  providers,
  activeProviders,
  lastProvider,
  errorProvider,
}: {
  providers: TopologyProvider[];
  activeProviders: string[];
  lastProvider: string;
  errorProvider: string;
}) {
  const activeKey = useMemo(() => activeProviders.map((p) => p.toLowerCase()).filter(Boolean).sort().join(','), [activeProviders]);
  const rawActiveSet = useMemo(() => new Set(activeKey ? activeKey.split(',') : []), [activeKey]);
  const lastSet = useMemo(() => new Set(lastProvider ? [lastProvider.toLowerCase()] : []), [lastProvider]);
  const errorSet = useMemo(() => new Set(errorProvider ? [errorProvider.toLowerCase()] : []), [errorProvider]);

  // Drop providers that look "stuck" active for more than a minute (same as dashboard).
  const firstSeen = useRef<Record<string, number>>({});
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const now = Date.now();
    for (const p of rawActiveSet) {
      firstSeen.current[p] ??= now;
    }
    for (const p of Object.keys(firstSeen.current)) {
      if (!rawActiveSet.has(p)) {
        delete firstSeen.current[p];
      }
    }
  }, [rawActiveSet]);
  useEffect(() => {
    if (rawActiveSet.size === 0) { return; }
    const id = setInterval(() => setTick((t) => t + 1), FE_ACTIVE_TICK_MS);
    return () => clearInterval(id);
  }, [rawActiveSet]);
  const activeSet = useMemo(() => {
    const now = Date.now();
    return new Set([...rawActiveSet].filter((p) => {
      const ts = firstSeen.current[p];
      return !ts || now - ts < FE_ACTIVE_TIMEOUT_MS;
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawActiveSet, tick]);

  const { nodes, edges } = useMemo(() => buildLayout(providers, activeSet, lastSet, errorSet), [providers, activeSet, lastSet, errorSet]);
  const providersKey = useMemo(() => providers.map((p) => p.provider).sort().join(','), [providers]);

  const rf = useRef<ReactFlowInstance | null>(null);
  const container = useRef<HTMLDivElement | null>(null);
  const fitOpts = useMemo(() => ({ padding: 0.15, duration: 200 }), []);
  const onInit = useCallback((instance: ReactFlowInstance) => {
    rf.current = instance;
    setTimeout(() => void instance.fitView(fitOpts), 50);
  }, [fitOpts]);

  useEffect(() => {
    const el = container.current;
    if (!el) { return; }
    const ro = new ResizeObserver(() => void rf.current?.fitView(fitOpts));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitOpts]);

  useEffect(() => {
    const id = setTimeout(() => void rf.current?.fitView(fitOpts), 50);
    return () => clearTimeout(id);
  }, [nodes.length, fitOpts]);

  if (providers.length === 0) {
    return <div className="usage-empty">No providers connected</div>;
  }

  return (
    <div ref={container} className="topo-container">
      <ReactFlow
        key={providersKey}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={fitOpts}
        minZoom={0.1}
        maxZoom={2}
        onInit={onInit}
        proOptions={{ hideAttribution: true }}
        panOnDrag
        zoomOnScroll
        zoomOnPinch
        zoomOnDoubleClick
        preventScrolling={false}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        colorMode="system"
      >
        <Controls showInteractive={false} className="react-flow-controls-custom" style={{ transform: 'scale(0.85)', transformOrigin: 'bottom left' }} />
      </ReactFlow>
    </div>
  );
}
