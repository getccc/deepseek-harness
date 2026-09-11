/** Server-rendered, locale-owned pages available before the local application is unlocked. */

/** Locales available before the client application loads. */
export const LOGIN_LOCALES = ['en-US', 'zh-CN'] as const
/** A locale available to the Runner-local login pages. */
export type LoginLocale = typeof LOGIN_LOCALES[number]

/** Every piece of product copy rendered by the local login routes. */
export interface PageCopy {
  readonly lang: string
  readonly productName: string
  readonly teamLabel: string
  readonly loginTitle: string
  readonly account: string
  readonly accountPlaceholder: string
  readonly password: string
  readonly passwordPlaceholder: string
  readonly signIn: string
  readonly privacyNote: string
  readonly cannotContinue: string
  readonly returnToSignIn: string
  readonly formOnly: string
  readonly differentOrigin: string
  readonly enterBoth: string
  readonly updateRequired: string
  readonly credentialsRefused: string
  readonly sessionFailed: string
  readonly navigationOnly: string
}

const COPY: Record<LoginLocale, PageCopy> = {
  'en-US': {
    lang: 'en',
    productName: 'WeWork',
    teamLabel: 'Personal and team workspace',
    loginTitle: 'Welcome back',
    account: 'Account',
    accountPlaceholder: 'Enter your account',
    password: 'Password',
    passwordPlaceholder: 'Enter your password',
    signIn: 'Sign in',
    privacyNote: 'Your password is handled by this computer and sent only to your configured Control Plane.',
    cannotContinue: 'Cannot continue',
    returnToSignIn: 'Return to sign in',
    formOnly: 'This address accepts a sign-in form.',
    differentOrigin: 'This sign-in form did not come from this computer.',
    enterBoth: 'Enter both the account and password.',
    updateRequired: 'This application must be updated before it can sign in.',
    credentialsRefused: 'The account or password was not accepted.',
    sessionFailed: 'The local browser session could not be created.',
    navigationOnly: 'This address is opened by navigating to it.',
  },
  'zh-CN': {
    lang: 'zh-CN',
    productName: 'WeWork',
    teamLabel: '个人与团队工作空间',
    loginTitle: '欢迎回来',
    account: '账户',
    accountPlaceholder: '请输入账户',
    password: '密码',
    passwordPlaceholder: '请输入密码',
    signIn: '登录',
    privacyNote: '密码由本机处理，并且只会发送到已配置的 Control Plane。',
    cannotContinue: '无法继续',
    returnToSignIn: '返回登录',
    formOnly: '此地址只接受登录表单。',
    differentOrigin: '此登录表单并非来自本机页面。',
    enterBoth: '请输入账户和密码。',
    updateRequired: '请先更新此应用，再重新登录。',
    credentialsRefused: '账户或密码未被接受。',
    sessionFailed: '无法创建本地浏览器会话。',
    navigationOnly: '请通过浏览器导航打开此地址。',
  },
}

/**
 * Return the complete copy dictionary for one configured locale.
 * @param locale - the locale this Runner serves its pre-application pages in.
 * @returns every string the login and problem pages render.
 */
export function pageCopy(locale: LoginLocale): PageCopy {
  return COPY[locale]
}

/** Escape text for insertion into HTML. */
function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const PAGE_STYLE = `
:root {
  color-scheme: light;
  --ink: #182230;
  --muted: #697586;
  --line: #e4e9f0;
  --field: #f8fafc;
  --card: rgba(255, 255, 255, .92);
  --primary: #2563eb;
  --primary-hover: #1d4ed8;
  --focus: rgba(37, 99, 235, .18);
  --danger: #c93737;
  --danger-bg: #fff3f3;
}
* { box-sizing: border-box; }
html, body { min-height: 100%; }
body {
  margin: 0;
  min-height: 100vh;
  overflow-x: hidden;
  background:
    radial-gradient(circle at 12% 12%, rgba(97, 154, 255, .18), transparent 34rem),
    radial-gradient(circle at 88% 88%, rgba(95, 211, 190, .16), transparent 30rem),
    #f5f8fc;
  color: var(--ink);
  font: 15px/1.5 Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.ambient {
  position: fixed;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}
.ambient::before, .ambient::after {
  content: "";
  position: absolute;
  width: 24rem;
  height: 24rem;
  border-radius: 50%;
  filter: blur(2px);
  opacity: .7;
}
.ambient::before { left: -10rem; top: 36%; background: linear-gradient(135deg, rgba(67, 122, 246, .15), transparent 70%); }
.ambient::after { right: -10rem; top: 6%; background: linear-gradient(135deg, rgba(55, 199, 167, .14), transparent 72%); }
.page {
  position: relative;
  z-index: 1;
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 40px 20px;
}
.login-card, .problem-card {
  width: min(100%, 440px);
  padding: 36px;
  border: 1px solid rgba(215, 223, 234, .9);
  border-radius: 24px;
  background: var(--card);
  box-shadow: 0 28px 72px rgba(30, 50, 80, .14), 0 4px 14px rgba(30, 50, 80, .05);
  backdrop-filter: blur(18px);
}
.brand {
  display: flex;
  align-items: center;
  gap: 11px;
  margin-bottom: 32px;
}
.brand-mark {
  flex: none;
  display: grid;
  place-items: center;
}
.brand-mark img { display: block; width: 56px; height: auto; }
.brand-copy { display: flex; flex-direction: column; min-width: 0; }
.brand-name { font-size: 14px; font-weight: 700; letter-spacing: -.01em; }
.brand-team { color: var(--muted); font-size: 12px; }
h1 { margin: 0; font-size: 30px; line-height: 1.2; letter-spacing: -.035em; }
.login-card h1 { margin-bottom: 28px; }
.alert {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin: 0 0 20px;
  padding: 11px 12px;
  border: 1px solid #ffd7d7;
  border-radius: 12px;
  background: var(--danger-bg);
  color: var(--danger);
  font-size: 13px;
}
.alert svg { flex: none; margin-top: 1px; }
.form { display: grid; gap: 18px; }
.field { display: grid; gap: 7px; }
.field-label { font-size: 13px; font-weight: 600; }
.input-wrap { position: relative; }
.input-icon {
  position: absolute;
  left: 14px;
  top: 50%;
  width: 18px;
  height: 18px;
  transform: translateY(-50%);
  color: #8995a5;
  pointer-events: none;
}
input {
  display: block;
  width: 100%;
  height: 48px;
  padding: 0 14px 0 44px;
  border: 1px solid var(--line);
  border-radius: 13px;
  outline: none;
  background: var(--field);
  color: var(--ink);
  font: inherit;
  transition: border-color .16s ease, box-shadow .16s ease, background .16s ease;
}
input::placeholder { color: #9aa5b4; }
input:hover { border-color: #cbd4e1; background: #fff; }
input:focus { border-color: var(--primary); background: #fff; box-shadow: 0 0 0 4px var(--focus); }
.submit {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 48px;
  margin-top: 4px;
  border: 0;
  border-radius: 13px;
  background: linear-gradient(180deg, #3475ef, var(--primary));
  box-shadow: 0 8px 18px rgba(37, 99, 235, .22);
  color: #fff;
  font-family: inherit;
  font-size: 15px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  transition: transform .16s ease, background .16s ease, box-shadow .16s ease;
}
.submit:hover { background: linear-gradient(180deg, #2d6ee4, var(--primary-hover)); box-shadow: 0 10px 22px rgba(37, 99, 235, .28); }
.submit:active { transform: translateY(1px); }
.submit:focus-visible, .return-link:focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }
.privacy {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin: 22px 0 0;
  color: var(--muted);
  font-size: 12px;
}
.privacy svg { flex: none; margin-top: 1px; }
.problem-card h1 { margin-top: 24px; }
.problem-message { margin: 12px 0 24px; color: var(--muted); }
.return-link { color: var(--primary); font-weight: 600; text-decoration: none; }
.return-link:hover { text-decoration: underline; }
@media (max-width: 540px) {
  .page { align-items: start; padding: 18px 12px; }
  .login-card, .problem-card { margin-top: 4vh; padding: 28px 22px; border-radius: 20px; }
  .brand { margin-bottom: 26px; }
  h1 { font-size: 27px; }
}
@media (prefers-reduced-motion: reduce) {
  input, .submit { transition: none; }
}
`

/**
 * The WeWork logo, 小微's whole figure, inlined so this page needs no asset route
 * of its own. The same artwork also ships as the shell's `WeWorkLogo` primitive, as
 * apps/web/public/favicon.svg, and as apps/team-admin's own brand.ts and
 * index.html favicon; replacing the logo means replacing all of them.
 */
const BRAND_MARK = '<img src="data:image/webp;base64,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" alt="" />'

/** Shared brand lockup for pre-application pages. */
function brand(copy: PageCopy): string {
  return `<div class="brand">
<span class="brand-mark" aria-hidden="true">${BRAND_MARK}</span>
<span class="brand-copy"><span class="brand-name">${escape(copy.productName)}</span><span class="brand-team">${escape(copy.teamLabel)}</span></span>
</div>`
}

/** Account icon drawn inside the username field. */
const ACCOUNT_ICON = '<svg class="input-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="7" r="3.1" stroke="currentColor" stroke-width="1.5"/><path d="M4.5 16c.7-3 2.5-4.5 5.5-4.5s4.8 1.5 5.5 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'
/** Lock icon drawn inside the password field. */
const PASSWORD_ICON = '<svg class="input-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="4.5" y="8.2" width="11" height="8" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M7 8.2V6.5a3 3 0 0 1 6 0v1.7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'

/** Full HTML head shared by the login and request-failure pages. */
function head(title: string): string {
  return `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escape(title)}</title><style>${PAGE_STYLE}</style></head>`
}

/**
 * Render the local account-and-password page.
 * @param copy - locale-owned page copy.
 * @param problem - optional reasonless sign-in failure.
 * @returns the complete HTML document.
 */
export function loginPage(copy: PageCopy, problem?: string): string {
  return `<!doctype html>
<html lang="${copy.lang}">
${head(copy.loginTitle)}
<body><div class="ambient" aria-hidden="true"></div><main class="page">
<section class="login-card" aria-labelledby="login-title">
${brand(copy)}
<h1 id="login-title">${escape(copy.loginTitle)}</h1>
${problem === undefined ? '' : `<div class="alert" role="alert"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.5" stroke="currentColor"/><path d="M8 4.6v4.2M8 11.3v.1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg><span>${escape(problem)}</span></div>`}
<form class="form" method="post" action="/team/login">
<label class="field"><span class="field-label">${escape(copy.account)}</span><span class="input-wrap">${ACCOUNT_ICON}<input name="loginName" autocomplete="username" placeholder="${escape(copy.accountPlaceholder)}" spellcheck="false" autofocus required></span></label>
<label class="field"><span class="field-label">${escape(copy.password)}</span><span class="input-wrap">${PASSWORD_ICON}<input name="secret" type="password" autocomplete="current-password" placeholder="${escape(copy.passwordPlaceholder)}" required></span></label>
<button class="submit" type="submit">${escape(copy.signIn)}</button>
</form>
</section>
</main></body>
</html>
`
}

/**
 * Render a local request failure.
 * @param copy - locale-owned page copy.
 * @param message - the safe message shown to the member.
 * @returns the complete HTML document.
 */
export function problemPage(copy: PageCopy, message: string): string {
  return `<!doctype html>
<html lang="${copy.lang}">
${head(copy.cannotContinue)}
<body><div class="ambient" aria-hidden="true"></div><main class="page">
<section class="problem-card">
${brand(copy)}
<h1>${escape(copy.cannotContinue)}</h1>
<p class="problem-message">${escape(message)}</p>
<a class="return-link" href="/team/login">${escape(copy.returnToSignIn)}</a>
</section>
</main></body>
</html>
`
}
