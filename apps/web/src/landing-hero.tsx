"use client";

import dynamic from "next/dynamic";
import { ArrowDown, ArrowUpRight, Pause, Play, Plane, ShieldCheck, SlidersHorizontal, ScanLine } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { preload } from "react-dom";
import { LiquidGlassSurface } from "./liquid-glass-surface";
import { GlassButton } from "./glass-control";

const HeroAircraft = dynamic(() => import("./hero-aircraft"), { ssr: false });

export function LandingHero({ onSearch, onCoverage }: {
  onSearch(): void;
  onCoverage(trigger: HTMLButtonElement): void;
}) {
  preload("/hero/boeing-707.glb", { as: "fetch", crossOrigin: "anonymous" });
  preload("/hero/sky-environment.hdr", { as: "fetch", crossOrigin: "anonymous" });
  const [motionAllowed, setMotionAllowed] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [sceneVisible, setSceneVisible] = useState(true);
  const sectionRef = useRef<HTMLElement>(null);
  const aircraftReady = useCallback(() => setReady(true), []);
  const aircraftFailed = useCallback(() => setFailed(true), []);
  const playing = motionAllowed && !userPaused && ready && !failed && sceneVisible;

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => setMotionAllowed(!motion.matches);
    syncMotion();
    motion.addEventListener("change", syncMotion);
    return () => { motion.removeEventListener("change", syncMotion); };
  }, []);

  useEffect(() => {
    let inView = true;
    const syncVisibility = () => setSceneVisible(inView && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      syncVisibility();
    });
    observer.observe(sectionRef.current!);
    document.addEventListener("visibilitychange", syncVisibility);
    syncVisibility();
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", syncVisibility);
    };
  }, []);

  return <>
    <section ref={sectionRef} className="cinema-hero" id="top" aria-labelledby="hero-title">
      <div className="hero-media" data-ready={ready && !failed} data-playing={playing}>
        <div className="hero-clouds hero-clouds-far" aria-hidden="true"><i /></div>
        <div className="hero-clouds hero-clouds-near" aria-hidden="true"><i /><i /></div>
        {(!ready || failed) && <div className="hero-fallback" aria-hidden="true" />}
        {!failed && <HeroAircraft playing={playing} visible={sceneVisible} reducedMotion={!motionAllowed}
          onReady={aircraftReady} onError={aircraftFailed} />}
        <div className="hero-clouds hero-clouds-foreground" aria-hidden="true"><i /><i /></div>
      </div>
      <div className="hero-editorial">
        <h1 id="hero-title"><span>让远方，</span><strong>更近一点。</strong></h1>
        <div className="hero-actions">
          <LiquidGlassSurface control label="hero-discover" className="hero-action-glass">
            <a className="hero-discover" href="#approach">了解航探 <ArrowDown size={16} aria-hidden="true" /></a>
          </LiquidGlassSurface>
          <LiquidGlassSurface control label="hero-search" className="hero-action-glass hero-action-primary">
            <button className="hero-search" onClick={onSearch} aria-haspopup="dialog">开始探索<ArrowUpRight size={16} aria-hidden="true" /></button>
          </LiquidGlassSurface>
        </div>
      </div>
      <div className="hero-loading" role="status" aria-live="polite" aria-hidden={ready || failed}
        data-loading={!ready && !failed}>
        <span className="hero-loading-orbit" aria-hidden="true"><Plane size={18} strokeWidth={1.5} /></span>
        <span>{!ready && !failed ? "正在准备飞行画面" : ""}</span>
      </div>
      <div className="hero-baseline">
        <GlassButton className="video-toggle" disabled={failed || !ready || !motionAllowed} aria-label={playing ? "暂停飞机动画" : "播放飞机动画"}
          onClick={() => setUserPaused(paused => !paused)}>
          {playing ? <Pause size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}<span>{failed ? "静态背景" : !ready ? "画面载入中…" : !motionAllowed ? "静态画面" : playing ? "暂停画面" : "播放画面"}</span>
        </GlassButton>
      </div>
    </section>
    <section className="approach-section" id="approach" aria-labelledby="approach-title">
      <div className="approach-heading"><p className="section-kicker">THE ART OF A BETTER JOURNEY</p><h2 id="approach-title">好价格，也要看得明白。</h2><p>从出发的念头，到值得选择的那一班。</p></div>
      <div className="approach-grid">
        <div className="approach-card"><span className="approach-number">01 / EXPLORE</span><SlidersHorizontal size={23} strokeWidth={1.3} /><h3>按你的方式出发</h3><p>一句话说出旅行计划，或精确设置机场、日期、行李与起飞时间。</p><button onClick={onSearch}>规划我的行程 <ArrowUpRight size={16} /></button></div>
        <div className="approach-card"><span className="approach-number">02 / COMPARE</span><ScanLine size={23} strokeWidth={1.3} /><h3>比价格，也比条件</h3><p>区分展示价与已核验全价，把税费、行李和优惠资格放在一起看。</p><button onClick={(event) => onCoverage(event.currentTarget)}>了解报价口径 <ArrowUpRight size={16} /></button></div>
        <div className="approach-card"><span className="approach-number">03 / VERIFY</span><ShieldCheck size={23} strokeWidth={1.3} /><h3>让每个来源有迹可循</h3><p>成功、超时与失败分别呈现。购票前，回到来源平台确认最终价格。</p><button onClick={(event) => onCoverage(event.currentTarget)}>查看来源与边界 <ArrowUpRight size={16} /></button></div>
      </div>
    </section>
  </>;
}
