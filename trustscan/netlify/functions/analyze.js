// netlify/functions/analyze.js
// فحص تلقائي حقيقي لموقع إلكتروني أو صفحة متجر تطبيقات.
// Node 18+ (Netlify يوفر fetch العام أصلاً). نستخدم أيضاً وحدة tls للحصول على تفاصيل الشهادة.

import tls from 'node:tls';
import { URL } from 'node:url';

const TIMEOUT_MS = 9000;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`انتهت المهلة أثناء: ${label}`)), ms)
    ),
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
function checkTlsCertificate(hostname) {
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
          resolve({ ok: false, reason: 'تعذر قراءة بيانات الشهادة' });
          return;
        }
        const now = Date.now();
        const validTo = new Date(cert.valid_to).getTime();
        const daysLeft = Math.round((validTo - now) / 86400000);

        resolve({
          ok: true,
          authorized,
          authError: authorized ? null : String(authError || ''),
          issuer: cert.issuer && (cert.issuer.O || cert.issuer.CN) || 'غير معروف',
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
      resolve({ ok: false, reason: 'انتهت مهلة الاتصال' });
    });
  });
}

// ---------- تحليل رؤوس الأمان ----------
function analyzeSecurityHeaders(headers) {
  const get = (name) => headers.get(name);
  const results = [];

  const hsts = get('strict-transport-security');
  results.push({
    id: 'hsts',
    label: 'إجبار الاتصال المشفر (HSTS)',
    status: hsts ? 'pass' : 'warn',
    detail: hsts
      ? 'الموقع يفرض على المتصفح استخدام HTTPS دائماً لهذا النطاق.'
      : 'لا يوجد رأس HSTS — يبقى احتمال ضئيل لاتصال أول غير مشفر قبل التحويل.',
  });

  const csp = get('content-security-policy');
  results.push({
    id: 'csp',
    label: 'سياسة أمان المحتوى (CSP)',
    status: csp ? 'pass' : 'warn',
    detail: csp
      ? 'الموقع يحدد مصادر مسموحة للسكربتات والمحتوى، مما يقلل من هجمات الحقن.'
      : 'لا توجد سياسة CSP — لا يعني بالضرورة خطراً مباشراً لكنها طبقة حماية إضافية غائبة.',
  });

  const xcto = get('x-content-type-options');
  results.push({
    id: 'xcto',
    label: 'منع تخمين نوع الملف (X-Content-Type-Options)',
    status: xcto && xcto.toLowerCase().includes('nosniff') ? 'pass' : 'warn',
    detail:
      xcto && xcto.toLowerCase().includes('nosniff')
        ? 'المتصفح ملزم بالتعامل مع الملفات وفق نوعها المعلن فقط.'
        : 'غياب هذا الرأس يسمح نظرياً بتفسير الملفات بشكل غير متوقع.',
  });

  const xfo = get('x-frame-options');
  const frameAncestors = csp && csp.toLowerCase().includes('frame-ancestors');
  results.push({
    id: 'clickjacking',
    label: 'الحماية من التضمين الخبيث (Clickjacking)',
    status: xfo || frameAncestors ? 'pass' : 'warn',
    detail:
      xfo || frameAncestors
        ? 'الموقع يمنع تضمينه داخل إطار (iframe) من مواقع أخرى.'
        : 'لا يوجد X-Frame-Options ولا frame-ancestors — الموقع قد يكون قابلاً للتضمين داخل صفحة مزيفة.',
  });

  const referrer = get('referrer-policy');
  results.push({
    id: 'referrer',
    label: 'سياسة الإحالة (Referrer-Policy)',
    status: referrer ? 'pass' : 'warn',
    detail: referrer
      ? `الموقع يتحكم بالمعلومات المرسلة عند الانتقال لموقع آخر (${referrer}).`
      : 'لا توجد سياسة إحالة صريحة — قد يُرسل رابط الصفحة كاملاً لمواقع خارجية.',
  });

  const permPolicy = get('permissions-policy');
  results.push({
    id: 'permissions',
    label: 'سياسة الصلاحيات (كاميرا / موقع / ميكروفون)',
    status: permPolicy ? 'pass' : 'info',
    detail: permPolicy
      ? 'الموقع يحدد صراحة الصلاحيات المسموح للمتصفح منحها له.'
      : 'لا توجد سياسة صلاحيات صريحة — غير حرج لكنه معيار حديث.',
  });

  const server = get('server');
  if (server) {
    results.push({
      id: 'server-disclosure',
      label: 'كشف معلومات الخادم',
      status: 'info',
      detail: `الخادم يفصح عن نوعه/إصداره (${server}) — تفصيل بسيط قد يساعد مهاجماً في استهداف ثغرات معروفة.`,
    });
  }

  return results;
}

// ---------- تحليل الكوكيز ----------
function analyzeCookies(setCookieHeaders) {
  if (!setCookieHeaders || setCookieHeaders.length === 0) {
    return [
      {
        id: 'cookies',
        label: 'ملفات تعريف الارتباط (Cookies)',
        status: 'info',
        detail: 'لم يُرسل الموقع أي كوكيز في الطلب الأول للصفحة الرئيسية.',
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
    label: 'حماية الكوكيز (Secure)',
    status: insecureCount === 0 ? 'pass' : 'warn',
    detail:
      insecureCount === 0
        ? `جميع الكوكيز (${setCookieHeaders.length}) مضبوطة بعلامة Secure ولا تُرسل إلا عبر HTTPS.`
        : `${insecureCount} من أصل ${setCookieHeaders.length} كوكيز بدون علامة Secure.`,
  });

  results.push({
    id: 'cookies-samesite',
    label: 'الحماية من التتبع بين المواقع (SameSite)',
    status: noSameSiteCount === 0 ? 'pass' : 'warn',
    detail:
      noSameSiteCount === 0
        ? 'جميع الكوكيز تحدد سياسة SameSite بشكل صريح.'
        : `${noSameSiteCount} كوكيز بدون سياسة SameSite محددة صراحة.`,
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
function checkMixedContent(html, isHttps) {
  if (!isHttps) return null;
  const matches = html.match(/(src|href)=["']http:\/\/[^"']+["']/gi) || [];
  return {
    id: 'mixed-content',
    label: 'المحتوى المختلط (Mixed Content)',
    status: matches.length === 0 ? 'pass' : 'warn',
    detail:
      matches.length === 0
        ? 'لم يُعثر على موارد غير مشفرة (http://) داخل صفحة مشفرة.'
        : `عُثر على ${matches.length} مورد يُحمَّل عبر http:// غير مشفر داخل صفحة https.`,
  };
}

function scoreFromChecks(checks) {
  const weights = { pass: 1, info: 0.7, warn: 0.3, fail: 0 };
  if (checks.length === 0) return 0;
  const total = checks.reduce((sum, c) => sum + (weights[c.status] ?? 0.5), 0);
  return Math.round((total / checks.length) * 100);
}

// ---------- فحص موقع إلكتروني ----------
async function analyzeWebsite(url) {
  const checks = [];
  const isHttps = url.protocol === 'https:';

  checks.push({
    id: 'protocol',
    label: 'الاتصال المشفر (HTTPS)',
    status: isHttps ? 'pass' : 'fail',
    detail: isHttps
      ? 'الموقع يستخدم HTTPS — البيانات المتبادلة بين متصفحك والخادم مشفرة.'
      : 'الموقع لا يستخدم HTTPS افتراضياً — أي بيانات تُدخلها قد تُرسل بدون تشفير.',
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
      'تحميل الصفحة'
    );
    finalUrl = response.url || finalUrl;
  } catch (err) {
    checks.push({
      id: 'reachability',
      label: 'إمكانية الوصول للموقع',
      status: 'fail',
      detail: `تعذر الوصول إلى الموقع: ${err.message}`,
    });
    return { checks, finalUrl, cert: null };
  }

  const headers = response.headers;
  checks.push(...analyzeSecurityHeaders(headers));

  const setCookie =
    typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : headers.get('set-cookie')
      ? [headers.get('set-cookie')]
      : [];
  checks.push(...analyzeCookies(setCookie));

  let html = '';
  try {
    html = await withTimeout(response.text(), TIMEOUT_MS, 'قراءة محتوى الصفحة');
  } catch {
    html = '';
  }

  const mixed = checkMixedContent(html, finalUrl.startsWith('https://'));
  if (mixed) checks.push(mixed);

  const privacyLink = findPrivacyPolicyLink(html, finalUrl);
  checks.push({
    id: 'privacy-policy',
    label: 'سياسة الخصوصية',
    status: privacyLink ? 'pass' : 'warn',
    detail: privacyLink
      ? `تم العثور على رابط لسياسة خصوصية معلنة: ${privacyLink}`
      : 'لم يُعثر على رابط واضح لسياسة خصوصية في الصفحة الرئيسية — قد تكون موجودة في صفحة أخرى لم يتم فحصها.',
  });

  let cert = null;
  if (isHttps) {
    cert = await checkTlsCertificate(url.hostname);
    if (cert.ok) {
      const certOk = cert.authorized && cert.daysLeft > 0;
      checks.push({
        id: 'tls-cert',
        label: 'صلاحية شهادة الأمان (SSL/TLS)',
        status: certOk ? (cert.daysLeft < 14 ? 'warn' : 'pass') : 'fail',
        detail: certOk
          ? `الشهادة صادرة من "${cert.issuer}" وسارية حتى ${cert.validTo} (متبقٍ ${cert.daysLeft} يوماً) عبر ${cert.protocol}.`
          : `مشكلة في الشهادة: ${cert.authError || 'شهادة منتهية أو غير موثوقة'}.`,
      });
    } else {
      checks.push({
        id: 'tls-cert',
        label: 'صلاحية شهادة الأمان (SSL/TLS)',
        status: 'warn',
        detail: `تعذر التحقق التفصيلي من الشهادة: ${cert.reason}`,
      });
    }
  }

  return { checks, finalUrl, cert };
}

// ---------- فحص صفحة متجر تطبيق ----------
async function analyzeAppStore(url, store) {
  const checks = [];
  checks.push({
    id: 'app-store-disclaimer',
    label: 'طبيعة الفحص',
    status: 'info',
    detail:
      'لا يمكن فحص تطبيق الجوال نفسه (لا يوجد اتصال HTTP نفحصه مباشرة). الفحص التالي يقتصر على ما يُصرّح به المطوّر في صفحة المتجر.',
  });

  let html = '';
  try {
    const res = await withTimeout(
      fetch(url.toString(), { headers: { 'User-Agent': 'TrustScan/1.0' } }),
      TIMEOUT_MS,
      'تحميل صفحة المتجر'
    );
    html = await res.text();
  } catch (err) {
    checks.push({
      id: 'app-store-fetch',
      label: 'إمكانية قراءة صفحة المتجر',
      status: 'fail',
      detail: `تعذر تحميل صفحة المتجر: ${err.message}`,
    });
    return { checks, finalUrl: url.toString() };
  }

  const privacyLink = findPrivacyPolicyLink(html, url.toString());
  checks.push({
    id: 'app-privacy-policy',
    label: 'رابط سياسة الخصوصية المعلن',
    status: privacyLink ? 'pass' : 'warn',
    detail: privacyLink
      ? `المطوّر ينشر رابط سياسة خصوصية: ${privacyLink}`
      : 'لم يُعثر على رابط سياسة خصوصية ظاهر في صفحة المتجر.',
  });

  if (store === 'google') {
    const hasDataSafety = /data safety|أمان البيانات/i.test(html);
    checks.push({
      id: 'google-data-safety',
      label: 'قسم "أمان البيانات" في Google Play',
      status: hasDataSafety ? 'pass' : 'info',
      detail: hasDataSafety
        ? 'صفحة التطبيق تتضمن قسم "أمان البيانات" الذي يوضح البيانات المجمّعة ومشاركتها (بيانات ذاتية التصريح من المطوّر).'
        : 'تعذر رصد قسم أمان البيانات تلقائياً — راجعه يدوياً في صفحة التطبيق (هذا القسم مبني بجافاسكربت أحياناً).',
    });
  }
  if (store === 'apple') {
    const hasPrivacyLabel = /app privacy|خصوصية التطبيق|data used to track you/i.test(html);
    checks.push({
      id: 'apple-privacy-label',
      label: 'ملصق "خصوصية التطبيق" في App Store',
      status: hasPrivacyLabel ? 'pass' : 'info',
      detail: hasPrivacyLabel
        ? 'صفحة التطبيق تتضمن ملصق خصوصية يوضح أنواع البيانات المجمّعة (بيانات ذاتية التصريح من المطوّر).'
        : 'تعذر رصد ملصق الخصوصية تلقائياً — راجعه يدوياً في صفحة التطبيق.',
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
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'طلب غير صالح' }) };
  }

  const url = normalizeInput(body.input);
  if (!url) {
    return {
      statusCode: 400,
      headers: cors,
      body: JSON.stringify({ error: 'الرابط المُدخل غير صالح' }),
    };
  }

  const store = detectAppStore(url);
  try {
    const result = store ? await analyzeAppStore(url, store) : await analyzeWebsite(url);
    const score = scoreFromChecks(result.checks);
    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: body.input,
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
      body: JSON.stringify({ error: `خطأ غير متوقع أثناء الفحص: ${err.message}` }),
    };
  }
};
