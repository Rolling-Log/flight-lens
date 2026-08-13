"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { accountFetch } from "./account-api";
import { authClient } from "./auth-client";

type AuthView = "login" | "register" | "forgot" | "reset";
type DeviceSession = { token: string; userAgent?: string | null; ipAddress?: string | null; createdAt: Date; expiresAt: Date };
type PersonalSearch = { id: string; intent: { origin?: { code?: string }; destination?: { code?: string }; departureDate?: string }; createdAt: string };
type SavedItinerary = { id: string; name: string; itinerary: { seller?: { name?: string }; totalPrice?: { amountMinor?: number; currency?: string } }; updatedAt: string };

const legacyOwnerKey = "flight-lens-owner-token";

function errorText(error: { message?: string } | null | undefined): string {
  return error?.message ? "操作未完成，请检查信息或稍后重试。" : "";
}

export function AccountPanel() {
  const { data: session, isPending, refetch } = authClient.useSession();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<AuthView>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
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

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      if (params.get("token") && params.get("mode") === "reset-password") {
        setView("reset");
        setOpen(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

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

  async function submitAuth() {
    setBusy(true);
    setMessage("");
    try {
      if (view === "register") {
        const { error } = await authClient.signUp.email({ name, email, password, callbackURL: window.location.origin });
        setMessage(error ? errorText(error) : "请查收验证邮件。验证后即可登录。");
      } else if (view === "forgot") {
        await authClient.requestPasswordReset({ email, redirectTo: `${window.location.origin}/?mode=reset-password` });
        setMessage("如果该邮箱已注册，我们会发送一次性重置链接。");
      } else if (view === "reset") {
        const token = new URLSearchParams(window.location.search).get("token") ?? "";
        const { error } = await authClient.resetPassword({ newPassword, token });
        setMessage(error ? errorText(error) : "密码已重置，所有旧设备会话已撤销。请重新登录。");
        if (!error) setView("login");
      } else {
        const { data, error } = await authClient.signIn.email({ email, password, rememberMe: true });
        setMessage(error ? errorText(error) : "");
        if (!error) {
          setDisplayName(data?.user.name ?? "");
          await refetch();
        }
      }
    } finally {
      setPassword("");
      setNewPassword("");
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
    if (response.ok && decision !== "skip") localStorage.removeItem(legacyOwnerKey);
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
      <button className="account-trigger" onClick={() => {
        setDisplayName(session?.user.name ?? "");
        setOpen(true);
      }}>
        {isPending ? "账号" : session ? session.user.name : "登录"}
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
          <section className="modal account-modal" role="dialog" aria-modal="true" aria-labelledby="account-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setOpen(false)} aria-label="关闭">×</button>
            <div className="account-modal-header">
              <div className="eyebrow"><span /> 账号与个人数据</div>
              <h2 id="account-title">{session ? session.user.name : "登录航探"}</h2>
            </div>
            {!session ? (
              <>
                <div className="account-tabs">
                  {(["login", "register", "forgot"] as const).map((item) => (
                    <button key={item} className={view === item ? "selected" : ""} onClick={() => setView(item)}>
                      {item === "login" ? "登录" : item === "register" ? "注册" : "找回密码"}
                    </button>
                  ))}
                </div>
                <div className="account-form">
                  {view === "register" && <label>显示名称<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" /></label>}
                  {view !== "reset" && <label>邮箱<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label>}
                  {["login", "register"].includes(view) && <label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={view === "login" ? "current-password" : "new-password"} /></label>}
                  {view === "reset" && <label>新密码<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" /></label>}
                  <button className="primary-button" disabled={busy} onClick={submitAuth}>{view === "register" ? "创建账号" : view === "forgot" ? "发送重置邮件" : view === "reset" ? "重置密码" : "登录"}</button>
                </div>
              </>
            ) : (
              <div className="account-sections">
                <section><b>账号</b><p>{session.user.email} · {session.user.emailVerified ? "邮箱已验证" : "邮箱待验证"}</p><label>显示名称<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" /></label><div className="account-actions"><button onClick={saveAccount}>保存账号设置</button><button onClick={signOut}>退出当前设备</button></div></section>
                <section><b>匿名数据</b><p>处理此浏览器此前保存的偏好和提醒。</p><div className="account-actions"><button onClick={() => migrate("migrate")}>迁移</button><button onClick={() => migrate("skip")}>跳过</button><button onClick={() => migrate("delete")}>删除匿名数据</button></div></section>
                <section><b>偏好</b><label>常用航司<input value={preferredAirlines} onChange={(event) => setPreferredAirlines(event.target.value)} placeholder="MU, CA" /></label><label>常用机场<input value={preferredAirports} onChange={(event) => setPreferredAirports(event.target.value)} placeholder="PVG, SHA" /></label><button onClick={savePreferences}>保存偏好</button></section>
                <section><b>通知</b><label><input type="checkbox" checked={emailEnabled} onChange={(event) => setEmailEnabled(event.target.checked)} /> 邮件通知</label><label><input type="checkbox" checked={pushEnabled} onChange={(event) => setPushEnabled(event.target.checked)} /> 推送通知</label><label>通知订阅标识<input value={topic} onChange={(event) => setTopic(event.target.value)} /></label><button onClick={saveNotifications}>保存通知设置</button></section>
                <section><b>最近查询</b>{searches.length ? searches.slice(0, 8).map((item) => <div className="personal-row" key={item.id}><span>{item.intent.origin?.code} → {item.intent.destination?.code}<small>{item.intent.departureDate} · {new Date(item.createdAt).toLocaleString("zh-CN")}</small></span></div>) : <p>登录后的查询会在这里跨设备恢复。</p>}</section>
                <section><b>收藏方案</b>{itineraries.length ? itineraries.map((item) => <div className="personal-row" key={item.id}><span>{item.name}<small>{item.itinerary.seller?.name ?? "来源待核验"} · {new Date(item.updatedAt).toLocaleString("zh-CN")}</small></span><button onClick={() => deleteItinerary(item.id)}>删除</button></div>) : <p>在搜索结果中收藏方案后会显示在这里。</p>}</section>
                <section><b>设备会话</b>{devices.map((device) => <div className="device-row" key={device.token}><span>{device.userAgent || "未知设备"}<small>{new Date(device.createdAt).toLocaleString("zh-CN")}</small></span><button onClick={() => revoke(device.token)}>撤销</button></div>)}<button onClick={signOutEverywhere}>退出全部设备</button></section>
                <section><b>数据管理</b><div className="account-actions"><button onClick={exportData}>导出数据</button></div><label>删除账号前输入密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label><button className="danger-button" onClick={deleteAccount}>删除账号</button></section>
              </div>
            )}
            {message && <p className="account-message" role="status">{message}</p>}
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
