import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, Globe, Lock, Bookmark, ArrowRight, Trash2, Search, ChevronDown, Plus,
  RotateCw, X, Smartphone, BookOpen, Signal, Wifi, Bell, BatteryFull, SlidersHorizontal, PauseCircle,
} from 'lucide-react';
import { api } from '../../lib/api.js';

// Pixel-accurate device chassis specs for the multi-device simulator. Sizes are
// native CSS px (already accounting for each device's logical resolution).
const DEVICE_CATALOG = {
  'iphone-17-promax': {
    name: 'iPhone 17 Pro Max', tagline: '6.9" Super Retina XDR', category: 'mobile',
    width: 440, height: 956, dpr: 3, defaultScale: 0.65,
    outerRadiusClass: 'rounded-[54px]', screenRadiusClass: 'rounded-[46px]', bezelWidth: 10,
    notchType: 'dynamic-island', notchWidth: 125, notchHeight: 35, osType: 'ios', timeString: '9:41',
    sideButtons: { left: ['action', 'vol-up', 'vol-down'], right: ['power', 'camera-control'] },
  },
  'iphone-17-pro': {
    name: 'iPhone 17 Pro', tagline: '6.3" Super Retina XDR', category: 'mobile',
    width: 402, height: 874, dpr: 3, defaultScale: 0.70,
    outerRadiusClass: 'rounded-[54px]', screenRadiusClass: 'rounded-[46px]', bezelWidth: 10,
    notchType: 'dynamic-island', notchWidth: 120, notchHeight: 35, osType: 'ios', timeString: '9:41',
    sideButtons: { left: ['action', 'vol-up', 'vol-down'], right: ['power', 'camera-control'] },
  },
  'iphone-17': {
    name: 'iPhone 17', tagline: '6.3" OLED Display', category: 'mobile',
    width: 402, height: 874, dpr: 3, defaultScale: 0.70,
    outerRadiusClass: 'rounded-[54px]', screenRadiusClass: 'rounded-[46px]', bezelWidth: 11,
    notchType: 'dynamic-island', notchWidth: 120, notchHeight: 35, osType: 'ios', timeString: '9:41',
    sideButtons: { left: ['mute', 'vol-up', 'vol-down'], right: ['power'] },
  },
  'iphone-air': {
    name: 'iPhone Air', tagline: '6.5" Ultra-Slim Titanium', category: 'mobile',
    width: 414, height: 896, dpr: 3, defaultScale: 0.68,
    outerRadiusClass: 'rounded-[52px]', screenRadiusClass: 'rounded-[44px]', bezelWidth: 9,
    notchType: 'dynamic-island', notchWidth: 122, notchHeight: 34, osType: 'ios', timeString: '9:41',
    sideButtons: { left: ['action', 'vol-up', 'vol-down'], right: ['power'] },
  },
  'ipad-pro-13': {
    name: 'iPad Pro 13" M4', tagline: '13.0" Ultra Retina XDR OLED', category: 'tablet',
    width: 1032, height: 1376, dpr: 2, defaultScale: 0.45,
    outerRadiusClass: 'rounded-3xl', screenRadiusClass: 'rounded-2xl', bezelWidth: 12,
    notchType: 'camera-center', osType: 'ios', timeString: '9:41 AM',
    sideButtons: { left: [], right: ['vol-up', 'vol-down', 'power'] },
  },
  'galaxy-s26-ultra': {
    name: 'Galaxy S26 Ultra', tagline: 'Boxy Sharp Architectural Titanium Chassis', category: 'mobile',
    width: 412, height: 920, dpr: 3, defaultScale: 0.68,
    outerRadiusClass: 'rounded-[26px]', screenRadiusClass: 'rounded-[20px]', bezelWidth: 6,
    notchType: 'hole-punch-center', osType: 'android', timeString: '10:08',
    sideButtons: { left: [], right: ['vol-up', 'vol-down', 'power'] },
  },
  'galaxy-s26': {
    name: 'Galaxy S26', tagline: 'Contour Armor Aluminum Chassis', category: 'mobile',
    width: 360, height: 780, dpr: 3, defaultScale: 0.75,
    outerRadiusClass: 'rounded-[34px]', screenRadiusClass: 'rounded-[28px]', bezelWidth: 8,
    notchType: 'hole-punch-center', osType: 'android', timeString: '10:08',
    sideButtons: { left: [], right: ['vol-up', 'vol-down', 'power'] },
  },
  'galaxy-zfold8-ultra': {
    name: 'Galaxy Z Fold 8 Ultra', category: 'foldable',
    dpr: 3, outerRadiusClass: 'rounded-[18px]', screenRadiusClass: 'rounded-[14px]', bezelWidth: 9,
    unfolded: { width: 1052, height: 956, tagline: '8.0" 11:10 Main Display (Unfolded)', bezelWidth: 9, notchType: 'hole-punch-top-right', defaultScale: 0.65 },
    folded: { width: 410, height: 956, tagline: '6.5" 21:9 Cover Display (Folded)', bezelWidth: 7, notchType: 'hole-punch-center', defaultScale: 0.65 },
    osType: 'android', timeString: '10:08',
    sideButtons: { left: [], right: ['vol-up', 'vol-down', 'power'] },
  },
  'galaxy-zfold8': {
    name: 'Galaxy Z Fold 8', category: 'foldable',
    dpr: 3, outerRadiusClass: 'rounded-[18px]', screenRadiusClass: 'rounded-[14px]', bezelWidth: 9,
    unfolded: { width: 1080, height: 810, tagline: '7.6" 4:3 Main Display (Unfolded)', bezelWidth: 9, notchType: 'hole-punch-top-right', defaultScale: 0.65 },
    folded: { width: 506, height: 810, tagline: '5.5" 16:10 Cover Display (Folded)', bezelWidth: 8, notchType: 'hole-punch-center', defaultScale: 0.65 },
    osType: 'android', timeString: '10:08',
    sideButtons: { left: [], right: ['vol-up', 'vol-down', 'power'] },
  },
  'galaxy-s25-ultra': {
    name: 'Galaxy S25 Ultra', tagline: 'Boxy Sharp Architectural Chassis', category: 'mobile',
    width: 412, height: 912, dpr: 3, defaultScale: 0.68,
    outerRadiusClass: 'rounded-[26px]', screenRadiusClass: 'rounded-[20px]', bezelWidth: 6,
    notchType: 'hole-punch-center', osType: 'android', timeString: '10:08',
    sideButtons: { left: [], right: ['vol-up', 'vol-down', 'power'] },
  },
  'galaxy-s25': {
    name: 'Galaxy S25', tagline: 'Rounded Contour Armor Aluminum', category: 'mobile',
    width: 360, height: 780, dpr: 3, defaultScale: 0.75,
    outerRadiusClass: 'rounded-[34px]', screenRadiusClass: 'rounded-[28px]', bezelWidth: 8,
    notchType: 'hole-punch-center', osType: 'android', timeString: '10:08',
    sideButtons: { left: [], right: ['vol-up', 'vol-down', 'power'] },
  },
  'macbook-air-13': {
    name: 'MacBook Air 13" M4', tagline: 'Liquid Retina Display', category: 'desktop',
    width: 1280, height: 832, dpr: 2, defaultScale: 0.68,
    outerRadiusClass: 'rounded-t-2xl', screenRadiusClass: 'rounded-t-2xl', bezelWidth: 11,
    notchType: 'mac-notch', osType: 'macos', timeString: '9:41 AM', sideButtons: { left: [], right: [] },
  },
  'macbook-pro-14': {
    name: 'MacBook Pro 14" M4', tagline: 'Liquid Retina XDR Display', category: 'desktop',
    width: 1512, height: 982, dpr: 2, defaultScale: 0.72,
    outerRadiusClass: 'rounded-t-2xl', screenRadiusClass: 'rounded-t-2xl', bezelWidth: 12,
    notchType: 'mac-notch', osType: 'macos', timeString: '9:41 AM', sideButtons: { left: [], right: [] },
  },
  'macbook-air-15': {
    name: 'MacBook Air 15" M4', tagline: 'Ultra-Thin M4 Laptop', category: 'desktop',
    width: 1536, height: 960, dpr: 2, defaultScale: 0.72,
    outerRadiusClass: 'rounded-t-2xl', screenRadiusClass: 'rounded-t-2xl', bezelWidth: 11,
    notchType: 'mac-notch', osType: 'macos', timeString: '9:41 AM', sideButtons: { left: [], right: [] },
  },
  'macbook-pro-16': {
    name: 'MacBook Pro 16" M4', tagline: 'Pro Liquid Retina XDR', category: 'desktop',
    width: 1728, height: 1117, dpr: 2, defaultScale: 0.65,
    outerRadiusClass: 'rounded-t-2xl', screenRadiusClass: 'rounded-t-2xl', bezelWidth: 12,
    notchType: 'mac-notch', osType: 'macos', timeString: '9:41 AM', sideButtons: { left: [], right: [] },
  },
  'monitor-24-4k': {
    name: '24" 4K Monitor', tagline: '4K Ultra HD Desktop Display', category: 'desktop',
    width: 1920, height: 1080, dpr: 2, defaultScale: 0.55,
    outerRadiusClass: 'rounded-xl', screenRadiusClass: 'rounded-lg', bezelWidth: 14,
    notchType: 'none', osType: 'macos', timeString: '9:41 AM', sideButtons: { left: [], right: [] },
  },
  'monitor-34-ultrawide': {
    name: '34" Ultrawide Curved', tagline: '21:9 WQHD Panoramic Display', category: 'desktop',
    width: 2560, height: 1080, dpr: 1, defaultScale: 0.45,
    outerRadiusClass: 'rounded-xl', screenRadiusClass: 'rounded-lg', bezelWidth: 14,
    notchType: 'none', osType: 'macos', timeString: '9:41 AM', sideButtons: { left: [], right: [] },
  },
};

const DEVICE_GROUPS = {
  'Apple iPhone & iPad': ['iphone-17-promax', 'iphone-17-pro', 'iphone-17', 'iphone-air', 'ipad-pro-13'],
  'Samsung Galaxy Series': ['galaxy-s26-ultra', 'galaxy-s26', 'galaxy-zfold8-ultra', 'galaxy-zfold8', 'galaxy-s25-ultra', 'galaxy-s25'],
  'Mac & Desktop Monitors': ['macbook-air-13', 'macbook-pro-14', 'macbook-air-15', 'macbook-pro-16', 'monitor-24-4k', 'monitor-34-ultrawide'],
};

// Reads the px radius out of a device's own Tailwind rounding class (arbitrary
// values like "rounded-[46px]", or named scale steps) so each device keeps its
// authentic silhouette — sharp-cornered Galaxy vs. deeply-rounded iPhone —
// instead of every screen collapsing to one flattened generic radius.
function radiusPx(cls) {
  const arbitrary = /\[(\d+)px\]/.exec(cls || '');
  if (arbitrary) return parseInt(arbitrary[1], 10);
  if (/3xl/.test(cls)) return 24;
  if (/2xl/.test(cls)) return 16;
  if (/-xl\b/.test(cls)) return 12;
  if (/-lg\b/.test(cls)) return 8;
  if (/-md\b/.test(cls)) return 6;
  return 4; // plain "rounded"
}

// A leading "/" is same-origin (the workspace's own app path) rather than a
// bare domain that needs "https://" prefixed.
function resolveUrl(raw) {
  const trimmed = (raw || '').trim();
  if (trimmed === '') return '';
  if (trimmed.startsWith('/')) return trimmed;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  return 'https://' + trimmed;
}

// Status bar text/icons render dark-on-light by default — matching a normal
// browser tab, where the OS status bar sits over the page's own (usually
// light) background rather than a forced black bar. Real notch/hole-punch
// hardware stays solid black regardless of the page underneath.
function StatusBar({ spec }) {
  if (spec.osType === 'ios') {
    return (
      <div className="relative shrink-0 h-12 px-7 flex items-center justify-between text-slate-800 z-30 pointer-events-none select-none bg-white">
        <span className="text-[14px] font-semibold tracking-tight pl-1 pt-0.5">{spec.timeString}</span>
        {spec.notchType === 'dynamic-island' && (
          <div className="absolute left-1/2 -translate-x-1/2 top-[11px] bg-black rounded-full border border-slate-800/80 flex items-center justify-between px-3.5 z-40 shadow-sm" style={{ width: spec.notchWidth || 122, height: spec.notchHeight || 35 }}>
            <div className="w-[13px] h-[13px] rounded-full bg-slate-950 border border-slate-800 flex items-center justify-center"><div className="w-[5px] h-[5px] rounded-full bg-indigo-950/80 border border-indigo-700/50" /></div>
            <div className="w-[13px] h-[13px] rounded-full bg-slate-950 border border-slate-800 flex items-center justify-center"><div className="w-[4px] h-[4px] rounded-full bg-slate-900" /></div>
          </div>
        )}
        {spec.notchType === 'camera-center' && (
          <div className="absolute left-1/2 -translate-x-1/2 top-[7px] flex items-center gap-2 z-40">
            <div className="w-[8px] h-[8px] bg-black rounded-full border border-slate-800 flex items-center justify-center"><div className="w-[3px] h-[3px] bg-indigo-900 rounded-full" /></div>
            <div className="w-[5px] h-[5px] bg-slate-900/80 rounded-full" />
          </div>
        )}
        <div className="flex items-center gap-2 text-[12px] pr-1 pt-0.5">
          <Signal size={11} /><span className="text-[11px] font-bold tracking-tighter">5G</span><Wifi size={11} />
          <div className="w-[22px] h-[11px] rounded-[3px] border border-slate-800/80 p-[1.5px] relative flex items-center">
            <div className="h-full w-[85%] bg-slate-800 rounded-[1px]" />
            <div className="absolute -right-[3px] top-[2.5px] w-[2px] h-[4px] bg-slate-800/80 rounded-r-[1px]" />
          </div>
        </div>
      </div>
    );
  }
  if (spec.osType === 'android') {
    return (
      <div className="relative shrink-0 h-9 px-6 flex items-center justify-between text-slate-800 z-30 pointer-events-none select-none bg-white">
        <span className="text-[12px] font-mono font-semibold pt-0.5">{spec.timeString}</span>
        {spec.notchType === 'hole-punch-center' && (
          <div className="absolute left-1/2 -translate-x-1/2 top-[10px] w-[13px] h-[13px] bg-black rounded-full border border-slate-800 flex items-center justify-center z-40 shadow-inner">
            <div className="w-[5px] h-[5px] bg-indigo-950/90 rounded-full border border-slate-700/60" />
          </div>
        )}
        {spec.notchType === 'hole-punch-top-right' && (
          <div className="absolute right-[48px] top-[10px] w-[13px] h-[13px] bg-black rounded-full border border-slate-800 flex items-center justify-center z-40 shadow-inner">
            <div className="w-[5px] h-[5px] bg-indigo-950/90 rounded-full" />
          </div>
        )}
        <div className="flex items-center gap-2 text-[11px] pt-0.5">
          <Bell size={10} className="opacity-70" /><Wifi size={11} /><Signal size={11} />
          <span className="text-[11px] font-mono font-bold">98%</span><BatteryFull size={13} />
        </div>
      </div>
    );
  }
  if (spec.osType === 'macos') {
    return (
      <div className="relative shrink-0 h-[30px] px-5 bg-slate-950/90 text-slate-200 text-[12px] flex items-center justify-between z-30 border-b border-slate-800/60 font-medium select-none">
        <div className="flex items-center gap-3.5">
          <span className="font-bold text-white">Safari</span>
          <span className="hidden sm:inline">File</span><span className="hidden sm:inline">Edit</span>
          <span className="hidden sm:inline">View</span><span className="hidden sm:inline">History</span>
        </div>
        {spec.notchType === 'mac-notch' && (
          <div className="absolute left-1/2 -translate-x-1/2 top-0 w-[160px] h-[30px] bg-black rounded-b-xl flex items-center justify-center gap-2 z-40 shadow-md">
            <div className="w-[9px] h-[9px] bg-slate-950 rounded-full border border-slate-800 flex items-center justify-center"><div className="w-[3px] h-[3px] bg-indigo-950 rounded-full" /></div>
            <div className="w-[3px] h-[3px] bg-emerald-500/80 rounded-full opacity-60" />
          </div>
        )}
        <div className="flex items-center gap-3 text-[11px]"><Wifi size={11} /><SlidersHorizontal size={11} /><span>{spec.timeString}</span></div>
      </div>
    );
  }
  return null;
}

function HardwareButtons({ spec, scale }) {
  const left = spec.sideButtons?.left || [];
  const right = spec.sideButtons?.right || [];
  if (!left.length && !right.length) return null;
  const s = Math.max(0.5, scale);
  const btnW = Math.max(2, 3 * s);
  const h = (type) => {
    if (type === 'action') return 24 * s;
    if (type === 'mute') return 20 * s;
    if (type === 'power') return 48 * s;
    if (type === 'camera-control') return 40 * s;
    return 32 * s;
  };
  return (
    <>
      {left.length > 0 && (
        <div className="absolute flex flex-col z-10 pointer-events-none" style={{ left: -btnW, top: 80 * s }}>
          {left.map((btn, i) => <div key={i} style={{ width: btnW, height: h(btn), marginBottom: 4 * s, background: '#444', borderTopLeftRadius: 3, borderBottomLeftRadius: 3 }} />)}
        </div>
      )}
      {right.length > 0 && (
        <div className="absolute flex flex-col z-10 pointer-events-none" style={{ right: -btnW, top: 100 * s }}>
          {right.map((btn, i) => <div key={i} style={{ width: btnW, height: h(btn), marginBottom: 6 * s, background: btn === 'camera-control' ? '#555' : '#444', borderTopRightRadius: 3, borderBottomRightRadius: 3 }} />)}
        </div>
      )}
    </>
  );
}

function DeviceSelect({ value, onChange }) {
  return (
    <div className="relative flex-1 min-w-0">
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full bg-slate-900 border border-slate-700/80 hover:border-slate-600 text-slate-200 text-xs rounded-xl px-2.5 py-1.5 pr-6 focus:outline-none focus:border-indigo-500 cursor-pointer appearance-none font-semibold shadow-md transition truncate">
        {Object.entries(DEVICE_GROUPS).map(([label, keys]) => (
          <optgroup key={label} label={label}>
            {keys.map((k) => <option key={k} value={k}>{DEVICE_CATALOG[k].name}</option>)}
          </optgroup>
        ))}
      </select>
      <ChevronDown size={9} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
    </div>
  );
}

function DeviceCard({ dev, isLast, currentUrl, globalScale, onSwap, onFold, onRotate, onRemove, onAdd }) {
  let spec = DEVICE_CATALOG[dev.key];
  if (spec.category === 'foldable') spec = { ...spec, ...(dev.isFolded ? spec.folded : spec.unfolded) };
  const nativeWidth = dev.landscape ? spec.height : spec.width;
  const nativeHeight = dev.landscape ? spec.width : spec.height;
  const scale = globalScale !== 'auto' ? parseFloat(globalScale) : (dev.scale || spec.defaultScale);
  // The catalog's width/height is the app's own viewport (what the page's
  // 100vh actually measures) — the OS status bar is chrome ON TOP of that,
  // not carved out of it. So the physical frame is taller than the app
  // viewport by the status bar's height, rather than the status bar eating
  // into the app's own vertical space (which was cutting off the last row
  // of on-screen content, e.g. bottom tab bar labels).
  const barHeightNative = spec.osType === 'ios' ? 48 : spec.osType === 'android' ? 36 : spec.osType === 'macos' ? 30 : 0;
  const frameNativeHeight = nativeHeight + barHeightNative;
  // screenWidth/screenHeight is the exact box the app content renders into.
  // The bezel is drawn as extra size AROUND that box (via padding on the
  // outer frame below) rather than eating into it — with border-box sizing,
  // padding shrinks the content box, so if the frame's width/height were set
  // to the screen size directly, the bezel padding would silently clip the
  // last ~2×bezel px of app content along the bottom/right edge. Adding the
  // bezel back on top of the screen size keeps the content box exact.
  const bezelPad = spec.bezelWidth * scale;
  const screenWidth = nativeWidth * scale;
  const screenHeight = frameNativeHeight * scale;
  const scaledWidth = screenWidth + bezelPad * 2;
  const scaledHeight = screenHeight + bezelPad * 2;
  const hasUrl = Boolean(currentUrl);
  const isLaptop = spec.category === 'desktop' && spec.notchType === 'mac-notch';
  const isMonitor = spec.category === 'desktop' && spec.notchType === 'none';
  const isMobile = spec.category === 'mobile' || spec.category === 'tablet' || spec.category === 'foldable';
  // The screen's radius rides close to the bezel's own outer radius (a real
  // phone's glass corner curve nearly matches its case curve — the bezel
  // margin is a thin ring, not a big step down in roundness). Subtracting
  // the full bezel width made the screen corner look almost square next to
  // a visibly rounder bezel; scaling it down only slightly keeps it nested
  // inside the bezel's clip (already guaranteed above) while staying round.
  const contentRadius = Math.round(radiusPx(spec.outerRadiusClass) * scale * 0.88);
  const kbHeight = isLaptop ? Math.max(20, scaledHeight * 0.055) : 0;
  const neckW = isMonitor ? Math.max(14, 18 * scale) : 0;
  const neckH = isMonitor ? Math.max(22, 35 * scale) : 0;
  const baseW = isMonitor ? scaledWidth * 0.28 : 0;
  const baseH = isMonitor ? Math.max(6, 10 * scale) : 0;
  const totalH = scaledHeight + (isLaptop ? kbHeight + 2 : 0) + (isMonitor ? neckH + baseH : 0);

  return (
    <div className="relative flex flex-col items-center shrink-0 transition-all duration-300" style={{ width: Math.max(scaledWidth, 260) }}>
      <div className="mb-3 flex items-center justify-between w-full min-w-[260px] gap-2 z-20">
        <DeviceSelect value={dev.key} onChange={(k) => onSwap(dev.id, k)} />
        <div className="flex items-center gap-1 shrink-0">
          {spec.category === 'foldable' && (
            <button onClick={() => onFold(dev.id)} title="Switch between Folded and Unfolded screen"
              className="px-2 py-1 text-[10px] font-bold rounded-lg bg-indigo-900/80 hover:bg-indigo-800 text-indigo-200 border border-indigo-700/60 transition flex items-center gap-1.5 shadow-sm">
              {dev.isFolded ? <Smartphone size={10} /> : <BookOpen size={10} />}<span>{dev.isFolded ? 'Folded' : 'Unfolded'}</span>
            </button>
          )}
          <button onClick={() => onRotate(dev.id)} title="Rotate orientation" className="p-1.5 text-slate-400 hover:text-indigo-400 hover:bg-slate-800 rounded-lg transition"><RotateCw size={13} /></button>
          <button onClick={() => onRemove(dev.id)} title="Remove device" className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition"><X size={13} /></button>
        </div>
        {isLast && (
          <button onClick={onAdd} title="Add another device to comparison"
            className="w-7 h-7 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full flex items-center justify-center shadow-lg shadow-indigo-600/30 transition transform active:scale-90 hover:rotate-90 shrink-0 ml-1">
            <Plus size={13} />
          </button>
        )}
      </div>

      {/* Outer wrapper has no clipping of its own, so hardware buttons (which
          intentionally sit at negative left/right, outside the bezel) still
          protrude normally. Everything that should stay bounded by the case
          — bezel background AND the screen inside it — lives in the clipped
          child below, so nothing (including the screen's own squarer inner
          corners) can ever render past the bezel's rounded silhouette. */}
      <div className="relative" style={{ width: scaledWidth, height: scaledHeight }}>
        <HardwareButtons spec={spec} scale={scale} />
        <div className={`relative w-full h-full ${spec.outerRadiusClass} border overflow-hidden`}
          style={{ padding: spec.bezelWidth * scale, background: isMobile ? '#111113' : '#28282a', borderColor: isMobile ? '#2a2a2c' : '#3a3a3c', boxShadow: isMobile ? '0 20px 60px -10px rgba(0,0,0,.9), inset 0 1px 0 rgba(255,255,255,.04)' : '0 25px 50px -12px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.06)' }}>
          <div className="relative w-full h-full overflow-hidden bg-white shadow-inner" style={{ borderRadius: contentRadius }}>
            {!hasUrl && (
              <div className="absolute inset-0 bg-slate-950 flex flex-col items-center justify-center p-6 text-center z-10">
                <div className="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-indigo-400 mb-3 shadow-inner"><Globe size={18} /></div>
                <h4 className="text-xs font-semibold text-slate-300 mb-1">Blank Screen</h4>
                <p className="text-[10px] text-slate-500 max-w-[180px] leading-relaxed">Enter a URL above to load it on this device.</p>
              </div>
            )}
            {hasUrl && (
              <div className="absolute left-0 top-0 origin-top-left z-10 overflow-hidden flex flex-col"
                style={{ width: nativeWidth, height: frameNativeHeight, transform: `scale(${scale})`, transition: 'transform .25s cubic-bezier(.16,1,.3,1)' }}>
                <StatusBar spec={spec} />
                <iframe title={dev.id} src={currentUrl} className="w-full flex-1 min-h-0 border-none bg-white"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-popups-to-escape-sandbox" />
              </div>
            )}
            {isMobile && hasUrl && (
              <div className="absolute bottom-[5px] left-1/2 -translate-x-1/2 z-30 pointer-events-none" style={{ width: '35%', maxWidth: 140 }}>
                <div className="w-full rounded-full bg-black/25" style={{ height: Math.max(3, 5 * scale) }} />
              </div>
            )}
          </div>
        </div>
      </div>

      {isLaptop && (
        <>
          <div style={{ width: scaledWidth, height: 2, background: '#1a1a1c' }} />
          <div className="relative overflow-hidden" style={{ width: scaledWidth, height: kbHeight, background: '#28282a', borderBottomLeftRadius: 10, borderBottomRightRadius: 10, borderLeft: '1px solid #3a3a3c', borderRight: '1px solid #3a3a3c', borderBottom: '1px solid #3a3a3c' }}>
            <div className="absolute left-1/2 -translate-x-1/2" style={{ top: '25%', width: '28%', height: '50%', background: '#232325', borderRadius: 4, border: '1px solid #333' }} />
          </div>
        </>
      )}
      {isMonitor && (
        <div className="flex flex-col items-center">
          <div style={{ width: neckW, height: neckH, background: '#303034', borderLeft: '1px solid #3a3a3c', borderRight: '1px solid #3a3a3c' }} />
          <div style={{ width: baseW, height: baseH, background: '#303034', borderRadius: 999, border: '1px solid #3a3a3c' }} />
        </div>
      )}

      <div className="mt-3 flex flex-col items-center text-center w-full px-2">
        <p className="text-[11px] text-slate-400 font-medium">{spec.tagline}</p>
        <span className="mt-1 text-[10px] font-mono text-slate-500 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
          {nativeWidth} × {nativeHeight} px ({spec.dpr}x DPR)
        </span>
        <div className="mt-2 text-xs">
          {hasUrl ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 max-w-[220px] truncate">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" /><span className="truncate">{currentUrl}</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] text-slate-500 bg-slate-900/60 border border-slate-800">
              <PauseCircle size={9} /><span>Blank Screen</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Simulate() {
  const { id } = useParams();
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState(null);
  const [workspaceName, setWorkspaceName] = useState(id);
  const [devices, setDevices] = useState(() => [{ id: 'dev-0', key: 'iphone-17-promax', landscape: false, isFolded: false, scale: null }]);
  const [currentUrl, setCurrentUrl] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [globalScale, setGlobalScale] = useState('auto');
  const [bookmarks, setBookmarks] = useState([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const formRef = useRef(null);

  // Set the view-as cookie for this workspace (same-origin, so the embedded
  // iframes below inherit the session), then point every device at it live.
  useEffect(() => {
    let cancelled = false;
    api.post(`/super/view-as/${id}`, {}).then(() => {
      if (cancelled) return;
      setCurrentUrl(`/${id}`);
      setUrlInput(`/${id}`);
      setReady(true);
    }).catch((e) => { if (!cancelled) setErr(e.message); });
    api.get(`/super/orgs/${id}`).then((o) => { if (!cancelled) setWorkspaceName(o.branding?.displayName || o.name); }).catch(() => {});
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    const onDocClick = (e) => { if (formRef.current && !formRef.current.contains(e.target)) setDropdownOpen(false); };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  const navigateTo = (raw) => { const resolved = resolveUrl(raw); setCurrentUrl(resolved); setUrlInput(resolved); };
  const submit = (e) => { e.preventDefault(); navigateTo(urlInput); setDropdownOpen(false); };

  const bookmarkTarget = resolveUrl(urlInput || currentUrl);
  const isBookmarked = bookmarks.includes(bookmarkTarget);
  const toggleBookmark = () => {
    if (!bookmarkTarget) return;
    setBookmarks((bm) => (bm.includes(bookmarkTarget) ? bm.filter((b) => b !== bookmarkTarget) : [bookmarkTarget, ...bm]));
  };

  const addDevice = (key = 'iphone-17-promax', opts = {}) =>
    setDevices((ds) => [...ds, { id: `dev-${ds.length}-${Math.random().toString(36).slice(2, 7)}`, key, landscape: false, isFolded: opts.isFolded ?? false, scale: null }]);
  const removeDevice = (devId) => setDevices((ds) => ds.filter((d) => d.id !== devId));
  const swapDevice = (devId, key) => setDevices((ds) => ds.map((d) => (d.id === devId ? { ...d, key, scale: null } : d)));
  const rotateDevice = (devId) => setDevices((ds) => ds.map((d) => (d.id === devId ? { ...d, landscape: !d.landscape } : d)));
  const foldDevice = (devId) => setDevices((ds) => ds.map((d) => (d.id === devId ? { ...d, isFolded: !d.isFolded } : d)));
  const applyPreset = (list) => setDevices(list.map((item, i) => ({ id: `dev-p-${i}-${Math.random().toString(36).slice(2, 7)}`, landscape: false, isFolded: false, scale: null, ...item })));

  if (err) {
    return (
      <div className="fixed inset-0 z-[1000] bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-red-400 mb-3 text-sm">{err}</p>
          <Link to="/" className="btn">Back to workspaces</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[1000] bg-slate-950 text-slate-100 flex flex-col overflow-hidden select-none">
      <header className="h-16 border-b border-slate-800/80 bg-slate-900/90 backdrop-blur-md px-4 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 shrink-0">
          <Link to="/" title="Back to Workspaces"
            className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-violet-500 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
            <ArrowLeft size={18} />
          </Link>
          <div className="hidden sm:flex flex-col leading-none">
            <h1 className="font-extrabold text-lg tracking-tight text-white uppercase leading-none">Nexus</h1>
            <span className="font-bold text-[10px] text-indigo-400 tracking-[0.14em] uppercase mt-0.5">{workspaceName}</span>
          </div>
        </div>

        <div className="flex-1 max-w-2xl mx-2 relative" ref={formRef}>
          <form onSubmit={submit} className="relative flex items-center group">
            <div className="absolute left-3.5 flex items-center gap-2 text-slate-500 text-xs pointer-events-none">
              {currentUrl ? <Lock size={11} className="text-emerald-400" /> : <Globe size={11} className="text-slate-500" />}
            </div>
            <input type="text" value={urlInput} onChange={(e) => setUrlInput(e.target.value)} onFocus={() => setDropdownOpen(true)}
              placeholder="Enter a URL, or leave as the workspace path…" autoComplete="off"
              className="w-full bg-slate-950 text-slate-200 text-xs font-mono pl-9 pr-32 py-2.5 rounded-full border border-slate-800 group-hover:border-slate-700 focus:border-indigo-500 focus:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-inner" />
            <div className="absolute right-16 flex items-center gap-1.5 pointer-events-none">
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${currentUrl ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-slate-500 bg-slate-900 border-slate-800'}`}>
                {currentUrl ? 'Site Connected' : 'Blank Screen'}
              </span>
            </div>
            <button type="button" title="Bookmark this URL" onClick={toggleBookmark}
              className="absolute right-9 w-7 h-7 hover:bg-slate-800 text-slate-400 hover:text-amber-400 rounded-full flex items-center justify-center transition active:scale-95">
              <Bookmark size={13} className={isBookmarked ? 'fill-amber-400 text-amber-400' : ''} />
            </button>
            <button type="submit" title="Navigate to URL"
              className="absolute right-1.5 w-7 h-7 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full flex items-center justify-center shadow-md transition transform active:scale-95">
              <ArrowRight size={13} />
            </button>
          </form>

          {dropdownOpen && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-slate-900/95 backdrop-blur-xl border border-slate-800 rounded-2xl shadow-2xl z-50 p-2 overflow-hidden">
              <div className="px-3 py-1.5 border-b border-slate-800/80 flex items-center justify-between text-[11px] font-semibold text-slate-400">
                <span className="flex items-center gap-1.5"><Bookmark size={12} className="text-amber-400" /> Saved Bookmarks</span>
                <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">{bookmarks.length} saved</span>
              </div>
              <div className="max-h-56 overflow-y-auto py-1">
                {bookmarks.length === 0 && (
                  <div className="px-4 py-5 text-center text-slate-500 text-xs">
                    <Bookmark size={16} className="mx-auto mb-1.5 opacity-60" />
                    <p className="font-medium text-slate-400">No bookmarks saved yet</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">Click the bookmark icon in the URL bar to save the current site.</p>
                  </div>
                )}
                {bookmarks.map((url) => (
                  <div key={url} className="group flex items-center justify-between px-3 py-2 hover:bg-slate-800/80 rounded-xl cursor-pointer transition text-xs">
                    <div onClick={() => { navigateTo(url); setDropdownOpen(false); }} className="flex items-center gap-2.5 flex-1 min-w-0 pr-2">
                      <Globe size={12} className="text-indigo-400 shrink-0" /><span className="font-mono text-slate-200 truncate">{url}</span>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); setBookmarks((bm) => bm.filter((b) => b !== url)); }} title="Remove bookmark"
                      className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-red-400 transition rounded-md">
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setDevices([])} title="Remove all devices"
            className="px-3 py-2 text-xs font-medium text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-xl border border-slate-800 transition flex items-center gap-2">
            <Trash2 size={13} /><span className="hidden sm:inline">Clear All</span>
          </button>
        </div>
      </header>

      <div className="bg-slate-900/40 border-b border-slate-800/80 px-6 py-2 flex items-center justify-between text-xs text-slate-400 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-slate-400 font-medium">Presets:</span>
          <button onClick={() => applyPreset([{ key: 'iphone-17-promax' }, { key: 'ipad-pro-13' }, { key: 'macbook-air-13' }])}
            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition text-[11px] border border-slate-700/50">Apple Lineup</button>
          <button onClick={() => applyPreset([{ key: 'galaxy-s26' }, { key: 'galaxy-s26-ultra' }, { key: 'galaxy-zfold8', isFolded: true }, { key: 'galaxy-zfold8-ultra', isFolded: false }])}
            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition text-[11px] border border-slate-700/50">Galaxy S26 & Fold Lineup</button>
        </div>
        <div className="flex items-center gap-2">
          <Search size={11} className="text-slate-500" /><span>Fit Scale:</span>
          <select value={globalScale} onChange={(e) => setGlobalScale(e.target.value)} className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded px-2 py-0.5 focus:outline-none">
            <option value="auto">Auto Fit (Smart)</option>
            <option value="1">100% (Native)</option>
            <option value="0.75">75%</option>
            <option value="0.5">50%</option>
          </select>
        </div>
      </div>

      <style>{`
        .sim-scroll::-webkit-scrollbar { height: 10px; width: 10px; }
        .sim-scroll::-webkit-scrollbar-track { background: #020617; }
        .sim-scroll::-webkit-scrollbar-thumb { background: #334155; border-radius: 999px; border: 2px solid #020617; }
        .sim-scroll::-webkit-scrollbar-thumb:hover { background: #475569; }
        .sim-scroll { scrollbar-color: #334155 #020617; scrollbar-width: thin; }
      `}</style>
      <main className="sim-scroll flex-1 relative overflow-x-auto overflow-y-auto bg-slate-950">
        {!ready ? (
          <div className="flex items-center justify-center h-full text-slate-500 text-sm">Connecting to workspace…</div>
        ) : (
          <div className="inline-flex items-end gap-12 min-h-full min-w-full justify-center px-12 pt-2 pb-6 transition-all duration-300 ease-out">
            {devices.length === 0 && (
              <div className="flex flex-col items-center justify-center p-12 text-center text-slate-500">
                <p className="text-sm font-medium mb-3">No active devices on stage</p>
                <button onClick={() => addDevice()} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs rounded-full shadow-lg transition flex items-center gap-2">
                  <Plus size={13} /><span>Add iPhone 17 Pro Max</span>
                </button>
              </div>
            )}
            {devices.map((dev, i) => (
              <DeviceCard key={dev.id} dev={dev} isLast={i === devices.length - 1} currentUrl={currentUrl} globalScale={globalScale}
                onSwap={swapDevice} onFold={foldDevice} onRotate={rotateDevice} onRemove={removeDevice} onAdd={() => addDevice()} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
