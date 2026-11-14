"use client";

import { GlassButton } from "./glass-control";

import { X } from "lucide-react";
import { type ReactNode } from "react";
import { GlassDialog } from "./glass-dialog";

/** Native modal keeps focus inside the form and makes the page behind it inert. */
export function SearchWorkspace({ open, onClose, children }: { open: boolean; onClose(): void; children: ReactNode }) {
  return <GlassDialog open={open} onClose={onClose} className="search-dialog" labelledBy="search-workspace-title">
    <div className="search-dialog-heading"><div><p className="section-kicker">YOUR NEXT JOURNEY</p><h2 id="search-workspace-title">下一站，想去哪里？</h2><p>说出你的计划，让我们一起找到合适的航班。</p></div><GlassButton className="search-dialog-close" onClick={onClose} aria-label="关闭搜索面板"><X size={21} /></GlassButton></div>
    {children}
  </GlassDialog>;
}
