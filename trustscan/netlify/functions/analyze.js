// netlify/functions/analyze.js
// فحص تلقائي حقيقي لموقع إلكتروني أو صفحة متجر تطبيقات — يدعم العربية والإنجليزية (lang: 'ar' | 'en').
// Real automatic scan of a website or app-store page — supports Arabic and English (lang: 'ar' | 'en').
// Node 18+ (Netlify يوفر fetch العام أصلاً). نستخدم أيضاً وحدة tls للحصول على تفاصيل الشهادة.

import tls from 'node:tls';
import { URL } from 'node:url';

const TIMEOUT_MS = 9000;

// ---------- قاموس الترجمة ----------
const STR = {
  ar: {
    invalidJson: 'طلب غير صالح',
    invalidUrl: 'الرابط المُدخل غير صالح',
    unexpectedError: (msg) => `خطأ غير متوقع أثناء الفحص: ${msg}`,
    timeoutDuring: (label) => `انتهت المهلة أثناء: ${label}`,
    stepLoadPage: 'تحميل الصفحة',
    stepReadContent: 'قراءة محتوى الصفحة',
    stepLoadStorePage: 'تحميل صفحة المتجر',
    connectionTimeout: 'انتهت مهلة الاتصال',
    certUnreadable: 'تعذر قراءة بيانات الشهادة',
    unknownIssuer: 'غير معروف',

    protocolLabel: 'الاتصال المشفر (HTTPS)',
    protocolPass: 'الموقع يستخدم HTTPS — البيانات المتبادلة بين متصفحك والخادم مشفرة.',
    protocolFail: 'الموقع لا يستخدم HTTPS افتراضياً — أي بيانات تُدخلها قد تُرسل بدون تشفير.',

    reachabilityLabel: 'إمكانية الوصول للموقع',
    reachabilityFail: (msg) => `تعذر الوصول إلى الموقع: ${msg}`,

    hstsLabel: 'إجبار الاتصال المشفر (HSTS)',
    hstsPass: 'الموقع يفرض على المتصفح استخدام HTTPS دائماً لهذا النطاق.',
    hstsWarn: 'لا يوجد رأس HSTS — يبقى احتمال ضئيل لاتصال أول غير مشفر قبل التحويل.',

    cspLabel: 'سياسة أمان المحتوى (CSP)',
    cspPass: 'الموقع يحدد مصادر مسموحة للسكربتات والمحتوى، مما يقلل من هجمات الحقن.',
    cspWarn: 'لا توجد سياسة CSP — لا يعني بالضرورة خطراً مباشراً لكنها طبقة حماية إضافية غائبة.',

    xctoLabel: 'منع تخمين نوع الملف (X-Content-Type-Options)',
    xctoPass: 'المتصفح ملزم بالتعامل مع الملفات وفق نوعها المعلن فقط.',
    xctoWarn: 'غياب هذا الرأس يسمح نظرياً بتفسير الملفات بشكل غير متوقع.',

    clickjackingLabel: 'الحماية من التضمين الخبيث (Clickjacking)',
    clickjackingPass: 'الموقع يمنع تضمينه داخل إطار (iframe) من مواقع أخرى.',
    clickjackingWarn: 'لا يوجد X-Frame-Options ولا frame-ancestors — الموقع قد يكون قابلاً للتضمين داخل صفحة مزيفة.',

    referrerLabel: 'سياسة الإحالة (Referrer-Policy)',
    referrerPass: (val) => `الموقع يتحكم بالمعلومات المرسلة عند الانتقال لموقع آخر (${val}).`,
    referrerWarn: 'لا توجد سياسة إحالة صريحة — قد يُرسل رابط الصفحة كاملاً لمواقع خارجية.',

    permissionsLabel: 'سياسة الصلاحيات (كاميرا / موقع / ميكروفون)',
    permissionsPass: 'الموقع يحدد صراحة الصلاحيات المسموح للمتصفح منحها له.',
    permissionsInfo: 'لا توجد سياسة صلاحيات صريحة — غير حرج لكنه معيار حديث.',

    serverDisclosureLabel: 'كشف معلومات الخادم',
    serverDisclosureInfo: (val) => `الخادم يفصح عن نوعه/إصداره (${val}) — تفصيل بسيط قد يساعد مهاجماً في استهداف ثغرات معروفة.`,

    cookiesLabel: 'ملفات تعريف الارتباط (Cookies)',
    cookiesNoneInfo: 'لم يُرسل الموقع أي كوكيز في الطلب الأول للصفحة الرئيسية.',

    cookiesSecureLabel: 'حماية الكوكيز (Secure)',
    cookiesSecurePass: (total) => `جميع الكوكيز (${total}) مضبوطة بعلامة Secure ولا تُرسل إلا عبر HTTPS.`,
    cookiesSecureWarn: (insecure, total) => `${insecure} من أصل ${total} كوكيز بدون علامة Secure.`,

    cookiesSamesiteLabel: 'الحماية من التتبع بين المواقع (SameSite)',
    cookiesSamesitePass: 'جميع الكوكيز تحدد سياسة SameSite بشكل صريح.',
    cookiesSamesiteWarn: (n) => `${n} كوكيز بدون سياسة SameSite محددة صراحة.`,

    mixedContentLabel: 'المحتوى المختلط (Mixed Content)',
    mixedContentPass: 'لم يُعثر على موارد غير مشفرة (http://) داخل صفحة مشفرة.',
    mixedContentWarn: (n) => `عُثر على ${n} مورد يُحمَّل عبر http:// غير مشفر داخل صفحة https.`,

    privacyPolicyLabel: 'سياسة الخصوصية',
    privacyPolicyPass: (link) => `تم العثور على رابط لسياسة خصوصية معلنة: ${link}`,
    privacyPolicyWarn: 'لم يُعثر على رابط واضح لسياسة خصوصية في الصفحة الرئيسية — قد تكون موجودة في صفحة أخرى لم يتم فحصها.',

    tlsCertLabel: 'صلاحية شهادة الأمان (SSL/TLS)',
    tlsCertPass: (issuer, validTo, daysLeft, protocol) =>
      `الشهادة صادرة من "${issuer}" وسارية حتى ${validTo} (متبقٍ ${daysLeft} يوماً) عبر ${protocol}.`,
    tlsCertFail: (err) => `مشكلة في الشهادة: ${err || 'شهادة منتهية أو غير موثوقة'}.`,
    tlsCertWarnDetail: (reason) => `تعذر التحقق التفصيلي من الشهادة: ${reason}`,

    appDisclaimerLabel: 'طبيعة الفحص',
    appDisclaimerDetail:
      'لا يمكن فحص تطبيق الجوال نفسه (لا يوجد اتصال HTTP نفحصه مباشرة). الفحص التالي يقتصر على ما يُصرّح به المطوّر في صفحة المتجر.',

    appFetchLabel: 'إمكانية قراءة صفحة المتجر',
    appFetchFail: (msg) => `تعذر تحميل صفحة المتجر: ${msg}`,

    appPrivacyLabel: 'رابط سياسة الخصوصية المعلن',
    appPrivacyPass: (link) => `المطوّر ينشر رابط سياسة خصوصية: ${link}`,
    appPrivacyWarn: 'لم يُعثر على رابط سياسة خصوصية ظاهر في صفحة المتجر.',

    googleDataSafetyLabel: 'قسم "أمان البيانات" في Google Play',
    googleDataSafetyPass:
      'صفحة التطبيق تتضمن قسم "أمان البيانات" الذي يوضح البيانات المجمّعة ومشاركتها (بيانات ذاتية التصريح من المطوّر).',
    googleDataSafetyInfo:
      'تعذر رصد قسم أمان البيانات تلقائياً — راجعه يدوياً في صفحة التطبيق (هذا القسم مبني بجافاسكربت أحياناً).',

    applePrivacyLabel: 'ملصق "خصوصية التطبيق" في App Store',
    applePrivacyPass:
      'صفحة التطبيق تتضمن ملصق خصوصية يوضح أنواع البيانات المجمّعة (بيانات ذاتية التصريح من المطوّر).',
    applePrivacyInfo: 'تعذر رصد ملصق الخصوصية تلقائياً — راجعه يدوياً في صفحة التطبيق.',
  },
  en: {
    invalidJson: 'Invalid request',
    invalidUrl: 'The entered link is not valid',
    unexpectedError: (msg) => `Unexpected error during the scan: ${msg}`,
    timeoutDuring: (label) => `Timed out during: ${label}`,
    stepLoadPage: 'loading the page',
    stepReadContent: 'reading the page content',
    stepLoadStorePage: 'loading the store page',
    connectionTimeout: 'Connection timed out',
    certUnreadable: 'Could not read certificate data',
    unknownIssuer: 'Unknown',

    protocolLabel: 'Encrypted connection (HTTPS)',
    protocolPass: 'The site uses HTTPS — data exchanged between your browser and the server is encrypted.',
    protocolFail: 'The site does not use HTTPS by default — any data you enter may be sent unencrypted.',

    reachabilityLabel: 'Site reachability',
    reachabilityFail: (msg) => `Could not reach the site: ${msg}`,

    hstsLabel: 'Forced encrypted connection (HSTS)',
    hstsPass: 'The site forces the browser to always use HTTPS for this domain.',
    hstsWarn: 'No HSTS header — there is a small chance of an initial unencrypted connection before the redirect.',

    cspLabel: 'Content Security Policy (CSP)',
    cspPass: 'The site defines allowed sources for scripts and content, reducing injection attacks.',
    cspWarn: 'No CSP policy — not necessarily a direct risk, but an extra layer of protection is missing.',

    xctoLabel: 'MIME-sniffing protection (X-Content-Type-Options)',
    xctoPass: 'The browser is required to treat files strictly according to their declared type.',
    xctoWarn: 'The absence of this header theoretically allows files to be interpreted unexpectedly.',

    clickjackingLabel: 'Clickjacking protection',
    clickjackingPass: 'The site prevents itself from being embedded in an iframe on other sites.',
    clickjackingWarn: 'No X-Frame-Options or frame-ancestors — the site may be embeddable inside a fake page.',

    referrerLabel: 'Referrer policy',
    referrerPass: (val) => `The site controls the information sent when navigating to another site (${val}).`,
    referrerWarn: 'No explicit referrer policy — the full page URL may be sent to external sites.',

    permissionsLabel: 'Permissions policy (camera / location / microphone)',
    permissionsPass: 'The site explicitly defines which permissions the browser is allowed to grant it.',
    permissionsInfo: 'No explicit permissions policy — not critical, but a modern standard.',

    serverDisclosureLabel: 'Server information disclosure',
    serverDisclosureInfo: (val) =>
      `The server discloses its type/version (${val}) — a small detail that could help an attacker target known vulnerabilities.`,

    cookiesLabel: 'Cookies',
    cookiesNoneInfo: 'The site did not send any cookies on the first request to the homepage.',

    cookiesSecureLabel: 'Cookie protection (Secure)',
    cookiesSecurePass: (total) => `All cookies (${total}) are set with the Secure flag and are only sent over HTTPS.`,
    cookiesSecureWarn: (insecure, total) => `${insecure} out of ${total} cookies are missing the Secure flag.`,

    cookiesSamesiteLabel: 'Cross-site tracking protection (SameSite)',
    cookiesSamesitePass: 'All cookies explicitly define a SameSite policy.',
    cookiesSamesiteWarn: (n) => `${n} cookie(s) are missing an explicit SameSite policy.`,

    mixedContentLabel: 'Mixed content',
    mixedContentPass: 'No unencrypted (http://) resources were found inside an encrypted page.',
    mixedContentWarn: (n) => `Found ${n} resource(s) loaded over unencrypted http:// inside an https page.`,

    privacyPolicyLabel: 'Privacy policy',
    privacyPolicyPass: (link) => `A published privacy policy link was found: ${link}`,
    privacyPolicyWarn:
      'No clear privacy policy link was found on the homepage — it may exist on another page that was not scanned.',

    tlsCertLabel: 'SSL/TLS certificate validity',
    tlsCertPass: (issuer, validTo, daysLeft, protocol) =>
      `The certificate is issued by "${issuer}" and valid until ${validTo} (${daysLeft} days remaining) over ${protocol}.`,
    tlsCertFail: (err) => `Certificate issue: ${err || 'expired or untrusted certificate'}.`,
    tlsCertWarnDetail: (reason) => `Could not verify certificate details: ${reason}`,

    appDisclaimerLabel: 'Nature of this scan',
    appDisclaimerDetail:
      'The mobile app itself cannot be scanned (there is no direct HTTP connection to check). The following scan is limited to what the developer discloses on the store page.',

    appFetchLabel: 'Store page readability',
    appFetchFail: (msg) => `Could not load the store page: ${msg}`,

    appPrivacyLabel: 'Published privacy policy link',
    appPrivacyPass: (link) => `The developer publishes a privacy policy link: ${link}`,
    appPrivacyWarn: 'No visible privacy policy link was found on the store page.',

    googleDataSafetyLabel: '"Data safety" section on Google Play',
    googleDataSafetyPass:
      'The app page includes a "Data safety" section describing collected data and how it is shared (self-declared by the developer).',
    googleDataSafetyInfo:
      'Could not automatically detect a data safety section — check it manually on the app page (this section is sometimes built with JavaScript).',

    applePrivacyLabel: '"App Privacy" label on the App Store',
    applePrivacyPass:
      'The app page includes a privacy label describing the types of data collected (self-declared by the developer).',
    applePrivacyInfo: 'Could not automatically detect the privacy label — check it manually on the app page.',
  },
};

function t(lang) {
  return STR[lang] || STR.ar;
}

function withTimeout(promise, ms, label, lang) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(t(lang).timeoutDuring(label))), ms)),
  ]);
}

function normalizeInput(raw) {
  let input = (raw || '').trim();
  if (!input) return null;
  if (!/^https?:\/\//i.test(input)) input = 'https://' + input;
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

function detectAppStore(url) {
  const host = url.hostname.replace(/^www\./, '');
  if (host === 'apps.apple.com') return 'apple';
  if (host === 'play.google.com') return 'google';
  return null;
}

// ---------- فحص شهادة TLS مباشرة عبر مقبس آمن ----------
function checkTlsCertificate(hostname, lang) {
  const T = t(lang);
  return new Promise((resolve) => {
    const socket = tls.connect(
      { host: hostname, port: 443, servername: hostname, timeout: TIMEOUT_MS },
      () => {
        const cert = socket.getPeerCertificate();
        const protocol = socket.getProtocol();
        const authorized = socket.authorized;
        const authError = socket.authorizationError;
        socket.end();

        if (!cert || Object.keys(cert).length === 0) {
          resolve({ ok: false, reason: T.certUnreadable });
          return;
        }
        const now = Date.now();
        const validTo = new Date(cert.valid_to).getTime();
        const daysLeft = Math.round((validTo - now) / 86400000);

        resolve({
          ok: true,
          authorized,
          authError: authorized ? null : String(authError || ''),
          issuer: (cert.issuer && (cert.issuer.O || cert.issuer.CN)) || T.unknownIssuer,
          validFrom: cert.valid_from,
          validTo: cert.valid_to,
          daysLeft,
          protocol,
        });
      }
    );
    socket.on('error', (err) => resolve({ ok: false, reason: err.message }));
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ ok: false, reason: T.connectionTimeout });
    });
  });
}

// ---------- تحليل رؤوس الأمان ----------
function analyzeSecurityHeaders(headers, lang) {
  const T = t(lang);
  const get = (name) => headers.get(name);
  const results = [];

  const hsts = get('strict-transport-security');
  results.push({
    id: 'hsts',
    label: T.hstsLabel,
    status: hsts ? 'pass' : 'warn',
    detail: hsts ? T.hstsPass : T.hstsWarn,
  });

  const csp = get('content-security-policy');
  results.push({
    id: 'csp',
    label: T.cspLabel,
    status: csp ? 'pass' : 'warn',
    detail: csp ? T.cspPass : T.cspWarn,
  });

  const xcto = get('x-content-type-options');
  results.push({
    id: 'xcto',
    label: T.xctoLabel,
    status: xcto && xcto.toLowerCase().includes('nosniff') ? 'pass' : 'warn',
    detail: xcto && xcto.toLowerCase().includes('nosniff') ? T.xctoPass : T.xctoWarn,
  });

  const xfo = get('x-frame-options');
  const frameAncestors = csp && csp.toLowerCase().includes('frame-ancestors');
  results.push({
    id: 'clickjacking',
    label: T.clickjackingLabel,
    status: xfo || frameAncestors ? 'pass' : 'warn',
    detail: xfo || frameAncestors ? T.clickjackingPass : T.clickjackingWarn,
  });

  const referrer = get('referrer-policy');
  results.push({
    id: 'referrer',
    label: T.referrerLabel,
    status: referrer ? 'pass' : 'warn',
    detail: referrer ? T.referrerPass(referrer) : T.referrerWarn,
  });

  const permPolicy = get('permissions-policy');
  results.push({
    id: 'permissions',
    label: T.permissionsLabel,
    status: permPolicy ? 'pass' : 'info',
    detail: permPolicy ? T.permissionsPass : T.permissionsInfo,
  });

  const server = get('server');
  if (server) {
    results.push({
      id: 'server-disclosure',
      label: T.serverDisclosureLabel,
      status: 'info',
      detail: T.serverDisclosureInfo(server),
    });
  }

  return results;
}

// ---------- تحليل الكوكيز ----------
function analyzeCookies(setCookieHeaders, lang) {
  const T = t(lang);
  if (!setCookieHeaders || setCookieHeaders.length === 0) {
    return [
      {
        id: 'cookies',
        label: T.cookiesLabel,
        status: 'info',
        detail: T.cookiesNoneInfo,
      },
    ];
  }
  const results = [];
  let insecureCount = 0;
  let noSameSiteCount = 0;

  for (const c of setCookieHeaders) {
    const lower = c.toLowerCase();
    if (!lower.includes('secure')) insecureCount++;
    if (!lower.includes('samesite')) noSameSiteCount++;
  }

  results.push({
    id: 'cookies-secure',
    label: T.cookiesSecureLabel,
    status: insecureCount === 0 ? 'pass' : 'warn',
    detail:
      insecureCount === 0
        ? T.cookiesSecurePass(setCookieHeaders.length)
        : T.cookiesSecureWarn(insecureCount, setCookieHeaders.length),
  });

  results.push({
    id: 'cookies-samesite',
    label: T.cookiesSamesiteLabel,
    status: noSameSiteCount === 0 ? 'pass' : 'warn',
    detail: noSameSiteCount === 0 ? T.cookiesSamesitePass : T.cookiesSamesiteWarn(noSameSiteCount),
  });

  return results;
}

// ---------- البحث عن رابط سياسة الخصوصية ----------
function findPrivacyPolicyLink(html, baseUrl) {
  const linkRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis;
  const keywords = ['privacy', 'خصوصية', 'سياسة الاستخدام', 'policy'];
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    const text = match[2].replace(/<[^>]+>/g, '').trim().toLowerCase();
    const hrefLower = href.toLowerCase();
    if (keywords.some((k) => hrefLower.includes(k) || text.includes(k))) {
      try {
        return new URL(href, baseUrl).toString();
      } catch {
        return href;
      }
    }
  }
  return null;
}

// ---------- المحتوى المختلط (http داخل صفحة https) ----------
function checkMixedContent(html, isHttps, lang) {
  if (!isHttps) return null;
  const T = t(lang);
  const matches = html.match(/(src|href)=["']http:\/\/[^"']+["']/gi) || [];
  return {
    id: 'mixed-content',
    label: T.mixedContentLabel,
    status: matches.length === 0 ? 'pass' : 'warn',
    detail: matches.length === 0 ? T.mixedContentPass : T.mixedContentWarn(matches.length),
  };
}

function scoreFromChecks(checks) {
  const weights = { pass: 1, info: 0.7, warn: 0.3, fail: 0 };
  if (checks.length === 0) return 0;
  const total = checks.reduce((sum, c) => sum + (weights[c.status] ?? 0.5), 0);
  return Math.round((total / checks.length) * 100);
}

// ---------- فحص موقع إلكتروني ----------
async function analyzeWebsite(url, lang) {
  const T = t(lang);
  const checks = [];
  const isHttps = url.protocol === 'https:';

  checks.push({
    id: 'protocol',
    label: T.protocolLabel,
    status: isHttps ? 'pass' : 'fail',
    detail: isHttps ? T.protocolPass : T.protocolFail,
  });

  let response;
  let finalUrl = url.toString();
  try {
    response = await withTimeout(
      fetch(url.toString(), {
        redirect: 'follow',
        headers: { 'User-Agent': 'TrustScan/1.0 (+privacy-and-security-checker)' },
      }),
      TIMEOUT_MS,
      T.stepLoadPage,
      lang
    );
    finalUrl = response.url || finalUrl;
  } catch (err) {
    checks.push({
      id: 'reachability',
      label: T.reachabilityLabel,
      status: 'fail',
      detail: T.reachabilityFail(err.message),
    });
    return { checks, finalUrl, cert: null };
  }

  const headers = response.headers;
  checks.push(...analyzeSecurityHeaders(headers, lang));

  const setCookie =
    typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : headers.get('set-cookie')
      ? [headers.get('set-cookie')]
      : [];
  checks.push(...analyzeCookies(setCookie, lang));

  let html = '';
  try {
    html = await withTimeout(response.text(), TIMEOUT_MS, T.stepReadContent, lang);
  } catch {
    html = '';
  }

  const mixed = checkMixedContent(html, finalUrl.startsWith('https://'), lang);
  if (mixed) checks.push(mixed);

  const privacyLink = findPrivacyPolicyLink(html, finalUrl);
  checks.push({
    id: 'privacy-policy',
    label: T.privacyPolicyLabel,
    status: privacyLink ? 'pass' : 'warn',
    detail: privacyLink ? T.privacyPolicyPass(privacyLink) : T.privacyPolicyWarn,
  });

  let cert = null;
  if (isHttps) {
    cert = await checkTlsCertificate(url.hostname, lang);
    if (cert.ok) {
      const certOk = cert.authorized && cert.daysLeft > 0;
      checks.push({
        id: 'tls-cert',
        label: T.tlsCertLabel,
        status: certOk ? (cert.daysLeft < 14 ? 'warn' : 'pass') : 'fail',
        detail: certOk
          ? T.tlsCertPass(cert.issuer, cert.validTo, cert.daysLeft, cert.protocol)
          : T.tlsCertFail(cert.authError),
      });
    } else {
      checks.push({
        id: 'tls-cert',
        label: T.tlsCertLabel,
        status: 'warn',
        detail: T.tlsCertWarnDetail(cert.reason),
      });
    }
  }

  return { checks, finalUrl, cert };
}

// ---------- فحص صفحة متجر تطبيق ----------
async function analyzeAppStore(url, store, lang) {
  const T = t(lang);
  const checks = [];
  checks.push({
    id: 'app-store-disclaimer',
    label: T.appDisclaimerLabel,
    status: 'info',
    detail: T.appDisclaimerDetail,
  });

  let html = '';
  try {
    const res = await withTimeout(
      fetch(url.toString(), { headers: { 'User-Agent': 'TrustScan/1.0' } }),
      TIMEOUT_MS,
      T.stepLoadStorePage,
      lang
    );
    html = await res.text();
  } catch (err) {
    checks.push({
      id: 'app-store-fetch',
      label: T.appFetchLabel,
      status: 'fail',
      detail: T.appFetchFail(err.message),
    });
    return { checks, finalUrl: url.toString() };
  }

  const privacyLink = findPrivacyPolicyLink(html, url.toString());
  checks.push({
    id: 'app-privacy-policy',
    label: T.appPrivacyLabel,
    status: privacyLink ? 'pass' : 'warn',
    detail: privacyLink ? T.appPrivacyPass(privacyLink) : T.appPrivacyWarn,
  });

  if (store === 'google') {
    const hasDataSafety = /data safety|أمان البيانات/i.test(html);
    checks.push({
      id: 'google-data-safety',
      label: T.googleDataSafetyLabel,
      status: hasDataSafety ? 'pass' : 'info',
      detail: hasDataSafety ? T.googleDataSafetyPass : T.googleDataSafetyInfo,
    });
  }
  if (store === 'apple') {
    const hasPrivacyLabel = /app privacy|خصوصية التطبيق|data used to track you/i.test(html);
    checks.push({
      id: 'apple-privacy-label',
      label: T.applePrivacyLabel,
      status: hasPrivacyLabel ? 'pass' : 'info',
      detail: hasPrivacyLabel ? T.applePrivacyPass : T.applePrivacyInfo,
    });
  }

  return { checks, finalUrl: url.toString() };
}

export const handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: STR.ar.invalidJson }) };
  }

  const lang = body.lang === 'en' ? 'en' : 'ar';
  const T = t(lang);

  const url = normalizeInput(body.input);
  if (!url) {
    return {
      statusCode: 400,
      headers: cors,
      body: JSON.stringify({ error: T.invalidUrl }),
    };
  }

  const store = detectAppStore(url);
  try {
    const result = store ? await analyzeAppStore(url, store, lang) : await analyzeWebsite(url, lang);
    const score = scoreFromChecks(result.checks);
    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: body.input,
        lang,
        type: store ? 'app' : 'website',
        store: store || null,
        finalUrl: result.finalUrl,
        score,
        checks: result.checks,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ error: T.unexpectedError(err.message) }),
    };
  }
};
