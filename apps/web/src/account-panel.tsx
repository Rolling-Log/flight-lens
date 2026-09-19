"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Plane, X } from "lucide-react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { accountFetch } from "./account-api";
import { authClient } from "./auth-client";
import { consumeAuthUrl } from "./auth-url";
import { LiquidGlassSurface } from "./liquid-glass-surface";

type AuthView = "login" | "register" | "forgot" | "reset";
type DeviceSession = { token: string; userAgent?: string | null; ipAddress?: string | null; createdAt: Date; expiresAt: Date };
type PersonalSearch = { id: string; intent: { origin?: { code?: string }; destination?: { code?: string }; departureDate?: string }; createdAt: string };
type SavedItinerary = { id: string; name: string; itinerary: { seller?: { name?: string }; totalPrice?: { amountMinor?: number; currency?: string } }; updatedAt: string };

const legacyOwnerKey = "flight-lens-owner-token";
const legacyDecisionKey = "flight-lens-owner-migration-decision";
const avatarStorageKey = "flight-lens-profile-avatar-v1";

const accountActionGlassConfig = {
  borderRadius: 24,
  borderWidth: 0.05,
  brightness: 92,
  opacity: 0.72,
  blur: 7,
  displace: 0.25,
  backgroundOpacity: 0.08,
  saturation: 1.28,
  distortionScale: -32,
  redOffset: 0,
  greenOffset: 3,
  blueOffset: 6,
  mixBlendMode: "screen",
} as const;

const authTitles: Record<AuthView, string> = {
  login: "登录航探",
  register: "创建航探账号",
  forgot: "找回密码",
  reset: "设置新密码",
};

async function ownerDecisionMarker(ownerToken: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ownerToken));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function errorText(error: { message?: string; code?: string; status?: number; statusCode?: number } | null | undefined, action = "操作"): string {
  if (!error) return "";
  const detail = `${error.code ?? ""} ${error.message ?? ""}`.toUpperCase();
  const status = error.status ?? error.statusCode;
  if (action.includes("邮件") && ((status !== undefined && status >= 500) || detail.includes("EMAIL") || detail.includes("DELIVERY") || detail.includes("INTERNAL_SERVER_ERROR") || detail.includes("INTERNAL SERVER"))) {
    return `${action}发送失败，请检查 staging 的发件域名配置后重试。`;
  }
  return `${action}未完成，请检查信息或稍后重试。`;
}

export function AccountPanel() {
  const { data: session, isPending, refetch } = authClient.useSession();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<AuthView>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [message, setMessage] = useState("");
  const [devices, setDevices] = useState<DeviceSession[]>([]);
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [searches, setSearches] = useState<PersonalSearch[]>([]);
  const [itineraries, setItineraries] = useState<SavedItinerary[]>([]);
  const [preferredAirlines, setPreferredAirlines] = useState("");
  const [preferredAirports, setPreferredAirports] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [hasPendingAnonymousData, setHasPendingAnonymousData] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  function closePanel() {
    setOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAvatarUrl(localStorage.getItem(avatarStorageKey) ?? "");
      const authUrl = consumeAuthUrl(new URL(window.location.href));
      if (authUrl.sanitizedPath) window.history.replaceState(window.history.state, "", authUrl.sanitizedPath);
      if (authUrl.resetToken) {
        setResetToken(authUrl.resetToken);
        setView("reset");
        setOpen(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function updateAvatar(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) {
      setMessage("请选择不超过 5MB 的图片文件。");
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const size = Math.min(bitmap.width, bitmap.height);
      const canvas = document.createElement("canvas");
      canvas.width = 192;
      canvas.height = 192;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      context.drawImage(
        bitmap,
        (bitmap.width - size) / 2,
        (bitmap.height - size) / 2,
        size,
        size,
        0,
        0,
        192,
        192,
      );
      bitmap.close();
      const nextAvatar = canvas.toDataURL("image/webp", 0.84);
      localStorage.setItem(avatarStorageKey, nextAvatar);
      setAvatarUrl(nextAvatar);
      setMessage("头像已保存在当前浏览器。");
    } catch {
      setMessage("头像处理失败，请换一张图片重试。");
    }
  }

  function removeAvatar() {
    localStorage.removeItem(avatarStorageKey);
    setAvatarUrl("");
    setMessage("已恢复默认飞机头像。");
  }

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? []).filter((element) => !element.hasAttribute("hidden"));
    window.setTimeout(() => focusable()[0]?.focus(), 0);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closePanel();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open || !session) return;
    void authClient.listSessions().then(({ data }) => setDevices((data ?? []) as DeviceSession[]));
    void accountFetch("/v3/me/notifications").then(async (response) => {
      if (!response.ok) return;
      const payload = await response.json() as { notifications: { emailEnabled: boolean; pushEnabled: boolean; ntfyTopic: string | null } };
      setEmailEnabled(payload.notifications.emailEnabled);
      setPushEnabled(payload.notifications.pushEnabled);
      setTopic(payload.notifications.ntfyTopic ?? "");
    });
    void accountFetch("/v3/me/searches").then(async (response) => {
      if (response.ok) setSearches((await response.json() as { searches: PersonalSearch[] }).searches);
    });
    void accountFetch("/v3/me/itineraries").then(async (response) => {
      if (response.ok) setItineraries((await response.json() as { itineraries: SavedItinerary[] }).itineraries);
    });
    void accountFetch("/v2/preferences").then(async (response) => {
      if (!response.ok) return;
      const preferences = (await response.json() as { preferences: { preferredAirlines?: string[]; preferredAirports?: string[] } | null }).preferences;
      setPreferredAirlines(preferences?.preferredAirlines?.join(", ") ?? "");
      setPreferredAirports(preferences?.preferredAirports?.join(", ") ?? "");
    });
    const refresh = () => {
      void accountFetch("/v3/me/itineraries").then(async (response) => {
        if (response.ok) setItineraries((await response.json() as { itineraries: SavedItinerary[] }).itineraries);
      });
    };
    window.addEventListener("flight-lens-personal-data", refresh);
    return () => window.removeEventListener("flight-lens-personal-data", refresh);
  }, [open, session]);

  async function refreshAnonymousDataState() {
    const ownerToken = localStorage.getItem(legacyOwnerKey);
    const decidedOwner = localStorage.getItem(legacyDecisionKey)?.split(":", 2)[1];
    setHasPendingAnonymousData(Boolean(
      ownerToken && decidedOwner !== await ownerDecisionMarker(ownerToken),
    ));
  }

  async function submitAuth() {
    setBusy(true);
    setMessage("");
    try {
      if (view === "register") {
        const { error } = await authClient.signUp.email({ name, email, password, callbackURL: window.location.origin });
        setMessage(error ? errorText(error, "验证邮件") : "请查收验证邮件。验证后即可登录。");
      } else if (view === "forgot") {
        const { error } = await authClient.requestPasswordReset({ email, redirectTo: `${window.location.origin}/?mode=reset-password` });
        setMessage(error ? errorText(error, "重置邮件") : "如果该邮箱已注册，我们会发送一次性重置链接。");
      } else if (view === "reset") {
        const { error } = await authClient.resetPassword({ newPassword, token: resetToken });
        setMessage(error ? errorText(error) : "密码已重置，所有旧设备会话已撤销。请重新登录。");
        if (!error) {
          setResetToken("");
          setView("login");
        }
      } else {
        const { data, error } = await authClient.signIn.email({ email, password, rememberMe: true });
        setMessage(error ? errorText(error) : "");
        if (!error) {
          setDisplayName(data?.user.name ?? "");
          void refreshAnonymousDataState();
          await refetch();
        }
      }
    } finally {
      setPassword("");
      setNewPassword("");
      setBusy(false);
    }
  }

  async function resendVerificationEmail() {
    if (!email.trim()) {
      setMessage("请先填写需要验证的邮箱。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const { error } = await authClient.sendVerificationEmail({
        email,
        callbackURL: window.location.origin,
      });
      setMessage(error ? errorText(error, "验证邮件") : "验证邮件已重新发送，请检查收件箱和垃圾邮件。");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await authClient.signOut();
    await refetch();
    setOpen(false);
  }

  async function revoke(token: string) {
    await authClient.revokeSession({ token });
    const { data } = await authClient.listSessions();
    setDevices((data ?? []) as DeviceSession[]);
  }

  async function signOutEverywhere() {
    await authClient.revokeSessions();
    await refetch();
    setOpen(false);
  }

  async function saveNotifications() {
    if (pushEnabled && !topic.trim()) {
      setMessage("开启推送前需要填写通知订阅标识。");
      return;
    }
    const response = await accountFetch("/v3/me/notifications", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ emailEnabled, pushEnabled, ntfyTopic: topic || null }),
    });
    setMessage(response.ok ? "通知设置已保存。" : "通知设置保存失败。");
  }

  async function savePreferences() {
    const normalizeCodes = (value: string, minimumLength: number, maximumLength = minimumLength) => value.split(/[,，\s]+/)
      .map((item) => item.trim().toUpperCase())
      .filter((item) => item.length >= minimumLength && item.length <= maximumLength)
      .slice(0, 20);
    const response = await accountFetch("/v2/preferences", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        preferredAirlines: normalizeCodes(preferredAirlines, 2, 3),
        preferredAirports: normalizeCodes(preferredAirports, 3),
        cabin: "economy",
        minimumCheckedBaggageKg: 0,
        redEyeWindow: { start: "00:00", end: "06:00" },
        budgetAmountCnyMinor: null,
        ntfyTopic: topic || null,
      }),
    });
    setMessage(response.ok ? "偏好已保存，可在其他设备恢复。" : "偏好保存失败。");
  }

  async function saveAccount() {
    const trimmedName = displayName.trim();
    if (!trimmedName) return setMessage("显示名称不能为空。");
    const { error } = await authClient.updateUser({ name: trimmedName });
    setMessage(error ? errorText(error) : "账号设置已保存。");
    if (!error) await refetch();
  }

  async function deleteItinerary(id: string) {
    const response = await accountFetch(`/v3/me/itineraries/${id}`, { method: "DELETE" });
    if (response.ok) setItineraries((current) => current.filter((item) => item.id !== id));
  }

  async function migrate(decision: "migrate" | "skip" | "delete") {
    const ownerToken = localStorage.getItem(legacyOwnerKey);
    if (!ownerToken) {
      setMessage("此浏览器没有可处理的匿名数据。");
      return;
    }
    const response = await accountFetch("/v3/me/anonymous-migration", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerToken, idempotencyKey: crypto.randomUUID(), decision }),
    });
    if (response.ok) {
      if (decision !== "skip") localStorage.removeItem(legacyOwnerKey);
      localStorage.setItem(legacyDecisionKey, `${decision}:${await ownerDecisionMarker(ownerToken)}`);
      setHasPendingAnonymousData(false);
    }
    setMessage(response.ok ? "匿名数据选择已记录。" : "匿名数据处理失败，可稍后重试。");
  }

  async function exportData() {
    const response = await accountFetch("/v3/me/export");
    if (!response.ok) return setMessage("数据导出失败。");
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = "flight-lens-export.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function deleteAccount() {
    if (!window.confirm("永久删除账号、提醒和全部个人数据？公共去身份化价格观测不受影响。")) return;
    const { error } = await authClient.deleteUser({ password, callbackURL: window.location.origin });
    setPassword("");
    if (error) return setMessage(errorText(error));
    await refetch();
    setOpen(false);
  }

  return (
    <>
      <div className="account-entry">
        <button ref={triggerRef} className="account-trigger" onClick={() => {
          setDisplayName(session?.user.name ?? "");
          void refreshAnonymousDataState();
          setOpen(true);
        }}>
          {isPending ? "账号" : session ? session.user.name : "登录"}
        </button>
        <button
          className="avatar-trigger"
          onClick={() => avatarInputRef.current?.click()}
          aria-label={avatarUrl ? "更换头像" : "上传头像"}
          title={avatarUrl ? "更换头像" : "上传头像"}
        >
          {avatarUrl ? <Image src={avatarUrl} alt="个人头像" width={38} height={38} unoptimized /> : <Plane size={17} />}
          <span className="avatar-edit-badge" aria-hidden="true"><Camera size={9} /></span>
        </button>
      </div>
      <input
        ref={avatarInputRef}
        className="avatar-file-input"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        aria-label="选择头像图片"
        onChange={(event) => {
          void updateAvatar(event.currentTarget.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
      {open && typeof document !== "undefined" && createPortal(
        <div className={`modal-backdrop account-modal-backdrop ${session ? "" : "account-auth-backdrop"}`} role="presentation" onMouseDown={closePanel}>
          <section ref={dialogRef} className={`modal account-modal ${session ? "account-modal-profile" : "account-modal-auth"}`} role="dialog" aria-modal="true" aria-labelledby="account-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={closePanel} aria-label="关闭"><X size={19} /></button>
            <div className="account-modal-header">
              <div className="eyebrow"><span /> 账号与个人数据</div>
              <h2 id="account-title">{session ? session.user.name : authTitles[view]}</h2>
              <div className="account-avatar-settings">
                <span className="account-avatar-preview">{avatarUrl ? <Image src={avatarUrl} alt="个人头像预览" width={96} height={96} unoptimized /> : <Plane size={38} />}</span>
                <div className="account-avatar-actions">
                  <button onClick={() => avatarInputRef.current?.click()}>{avatarUrl ? "更换头像" : "上传头像"}</button>
                  {avatarUrl && <button onClick={removeAvatar}>恢复默认</button>}
                </div>
              </div>
            </div>
            {!session ? (
              <>
                <div className="account-tabs" data-view={view} role="tablist" aria-label="账号操作">
                  <span className="account-tab-selection" aria-hidden="true" />
                  {(["login", "register", "forgot"] as const).map((item) => (
                    <button key={item} role="tab" aria-selected={view === item} className={view === item ? "selected" : ""} onClick={() => { setView(item); setMessage(""); }}>
                      {item === "login" ? "登录" : item === "register" ? "注册" : "找回密码"}
                    </button>
                  ))}
                </div>
                <div className="account-form-stage">
                  <div key={view} className="account-form" data-view={view}>
                    {view === "register" && <label>显示名称<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" /></label>}
                    {view !== "reset" && <label>邮箱<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label>}
                    {["login", "register"].includes(view) && <label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={view === "login" ? "current-password" : "new-password"} /></label>}
                    {view === "reset" && <label>新密码<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" /></label>}
                    <LiquidGlassSurface
                      label="account-primary-action"
                      className="account-primary-glass"
                      panelClassName="account-primary-glass-panel"
                      config={accountActionGlassConfig}
                      changeKey={view}
                    >
                      <button className="account-primary-button" disabled={busy} onClick={submitAuth}>{view === "register" ? "创建账号" : view === "forgot" ? "发送重置邮件" : view === "reset" ? "重置密码" : "登录"}</button>
                    </LiquidGlassSurface>
                    {view === "register" && <button className="account-secondary-button" disabled={busy} onClick={resendVerificationEmail}>重新发送验证邮件</button>}
                  </div>
                </div>
              </>
            ) : (
              <div className="account-sections">
                <section><b>账号</b><p>{session.user.email} · {session.user.emailVerified ? "邮箱已验证" : "邮箱待验证"}</p><label>显示名称<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" /></label><div className="account-actions"><button onClick={saveAccount}>保存账号设置</button><button onClick={signOut}>退出当前设备</button></div></section>
                {hasPendingAnonymousData && <section><b>匿名数据</b><p>处理此浏览器此前保存的偏好和提醒。选择只会记录一次。</p><div className="account-actions"><button onClick={() => migrate("migrate")}>迁移</button><button onClick={() => migrate("skip")}>跳过</button><button onClick={() => migrate("delete")}>删除匿名数据</button></div></section>}
                <section><b>偏好</b><label>常用航司<input value={preferredAirlines} onChange={(event) => setPreferredAirlines(event.target.value)} placeholder="MU, CA" /></label><label>常用机场<input value={preferredAirports} onChange={(event) => setPreferredAirports(event.target.value)} placeholder="PVG, SHA" /></label><button onClick={savePreferences}>保存偏好</button></section>
                <section><b>通知</b><label><input type="checkbox" checked={emailEnabled} onChange={(event) => setEmailEnabled(event.target.checked)} /> 邮件通知</label><label><input type="checkbox" checked={pushEnabled} onChange={(event) => setPushEnabled(event.target.checked)} /> 推送通知</label><label>通知订阅标识<input value={topic} onChange={(event) => setTopic(event.target.value)} /></label><button onClick={saveNotifications}>保存通知设置</button></section>
                <section><b>最近查询</b>{searches.length ? searches.slice(0, 8).map((item) => <div className="personal-row" key={item.id}><span>{item.intent.origin?.code} → {item.intent.destination?.code}<small>{item.intent.departureDate} · {new Date(item.createdAt).toLocaleString("zh-CN")}</small></span></div>) : <p>登录后的查询会在这里跨设备恢复。</p>}</section>
                <section><b>收藏方案</b>{itineraries.length ? itineraries.map((item) => <div className="personal-row" key={item.id}><span>{item.name}<small>{item.itinerary.seller?.name ?? "来源待核验"} · {new Date(item.updatedAt).toLocaleString("zh-CN")}</small></span><button onClick={() => deleteItinerary(item.id)}>删除</button></div>) : <p>在搜索结果中收藏方案后会显示在这里。</p>}</section>
                <section><b>设备会话</b>{devices.map((device) => <div className="device-row" key={device.token}><span>{device.userAgent || "未知设备"}<small>{new Date(device.createdAt).toLocaleString("zh-CN")}</small></span><button onClick={() => revoke(device.token)}>撤销</button></div>)}<button onClick={signOutEverywhere}>退出全部设备</button></section>
                <section><b>数据管理</b><div className="account-actions"><button onClick={exportData}>导出数据</button></div><label>删除账号前输入密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label><button className="danger-button" onClick={deleteAccount}>删除账号</button></section>
              </div>
            )}
            <div className="account-message-slot">{message && <p className="account-message" role="status">{message}</p>}</div>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
