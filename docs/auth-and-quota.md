# Auth & Quota — 桌面端实现要点

## 登录

桌面端通过 Supabase Auth REST 直接调(不引 supabase-js):

- `electron/auth.ts` 负责 sign-in / sign-up / refresh / sign-out,token 用 `safeStorage` 加密保存到 `userData/auth.json`(Linux secret-service / macOS Keychain / Windows DPAPI)。
- `langcatFetch`(`electron/main.ts`)在每次请求前调 `getValidAccessToken()`:已登录且 access_token 未过期就直接用,过期前 60s 内自动 refresh;refresh 失败清空登录态返回 null。
- 所有受保护端点(`/dictionary/lookup` `/dictionary/regenerate` `/dictionary/ask`)走相同的注入流程;公开端点(`/dictionary/morphemes`)未登录也能调。

## 配额

后端按 user 计当日配额,响应头里带:

```
X-RateLimit-Limit: 50
X-RateLimit-Remaining: 12
X-RateLimit-Reset: 1714857600   # unix seconds
```

`langcatFetch` 拿到这三个头就广播 `langcat:quota-changed`,Sidebar 据此实时更新"今日额度"进度条。

## 401 / 429 处理

主进程把 401 / 429 序列化进 `Error.message` 前缀 `__LANGCAT_ERR__:<json>`(IPC 不保留自定义字段,这是约定的最简跨边界传错方式):

- 渲染层 `lib/langcat-api.ts` 的 `parseLangCatError` 拆前缀,抛 `UnauthorizedError` / `QuotaExceededError`。
- 抛 typed error 的同时往 `subscribeLangCatErrors` 总线推一份;`MainView` 订阅:
  - 401 → 弹 `LoginView`(让用户重新登录)
  - 429 → 弹 `Toast`(显示当前端点配额上限 + reset 倒计时)

业务调用方仍可在 try/catch 里用 `err.message` 显示给用户,跟现有 UI 错误展示风格一致。
