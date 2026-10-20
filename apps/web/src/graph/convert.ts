import type { NodeMouseEvent } from "@vue-flow/core";
import { MarkerType } from "@vue-flow/core";
import type { CanvasDocument, CanvasEdge, CanvasNode } from "@prism/contracts";
import { SOURCE_HANDLE, slotKeyFromHandle, type FlowEdge, type FlowNode } from "./types";

/**
 * The canvas document is the durable shape; Vue Flow's node and edge lists
 * are the editing view of it. These helpers convert between the two so the
 * document can be stored without leaking library-specific fields.
 */

export function documentToNodes(document: CanvasDocument): FlowNode[] {
  return document.nodes.map((node) => ({
    id: node.id,
    type: node.kind,
    position: { ...node.position },
    data: { ...node.data },
    ...(typeof node.width === "number" ? { width: node.width } : {}),
    ...(typeof node.height === "number" ? { height: node.height } : {}),
  }));
}

export function documentToEdges(document: CanvasDocument): FlowEdge[] {
  return document.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    sourceHandle: edge.sourceHandle,
    target: edge.target,
    targetHandle: edge.targetHandle,
    type: "smoothstep",
    markerEnd: MarkerType.ArrowClosed,
  }));
}

export function nodesToDocument(nodes: FlowNode[], edges: FlowEdge[]): CanvasDocument {
  const documentNodes: CanvasNode[] = nodes.map((node) => ({
    id: node.id,
    kind: (node.type ?? "prompt") as CanvasNode["kind"],
    position: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
    data: { ...((node.data ?? {}) as Record<string, unknown>) },
    ...(typeof node.width === "number" ? { width: node.width } : {}),
    ...(typeof node.height === "number" ? { height: node.height } : {}),
  }));

  const documentEdges: CanvasEdge[] = edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    sourceHandle: edge.sourceHandle ?? SOURCE_HANDLE,
    target: edge.target,
    targetHandle: edge.targetHandle ?? "",
  }));

  return {
    version: 1,
    nodes: documentNodes,
    edges: documentEdges,
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

/** A human readable label for a node, used in the inspector and in tooltips. */
export function describeNode(node: FlowNode): string {
  const data = (node.data ?? {}) as Record<string, unknown>;
  switch (node.type) {
    case "prompt":
      return String(data.text ?? "Prompt").slice(0, 40) || "Prompt";
    case "text":
      return String(data.text ?? "Text").slice(0, 40) || "Text";
    case "image":
      return String(data.label ?? "Image");
    case "result":
      return String(data.label ?? "Result");
    case "generator":
      return String(data.pluginId ?? "Generator");
    default:
      return node.type ?? "Node";
  }
}

/** The slot an edge feeds, derived from its target handle. */
export function edgeSlot(edge: FlowEdge): string {
  return slotKeyFromHandle(edge.targetHandle ?? "");
}

export function nodeFromEvent(event: NodeMouseEvent): FlowNode | null {
  return (event.node as FlowNode | undefined) ?? null;
}
