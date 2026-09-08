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
    productName: 'Welinkin Work',
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
    productName: 'Welinkin Work',
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
.brand-mark img { display: block; width: 40px; height: auto; }
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
 * The Welinkin mark, inlined so this page needs no asset route of its own. The
 * same artwork also ships as the shell's `WelinkinLogo` primitive, as
 * apps/web/public/favicon.svg, and as apps/team-admin's own brand.ts and
 * index.html favicon; replacing the logo means replacing all of them.
 */
const BRAND_MARK = '<img src="data:image/png;base64,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" alt="" />'

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
