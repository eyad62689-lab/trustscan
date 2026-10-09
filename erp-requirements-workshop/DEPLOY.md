# نشر تطبيق «ورشة المتطلبات» على Netlify

| البند | القيمة |
|---|---|
| مشروع Netlify | `erp-requirements-workshop` (الفريق `eyad62689`) — https://app.netlify.com/projects/erp-requirements-workshop |
| الرابط العام | https://erp-requirements-workshop.netlify.app |
| المستودع | `eyad62689-lab/trustscan` |
| مجلد الأساس (Base directory) | `erp-requirements-workshop/app` |
| أمر البناء | `npm ci && npm run build` (يُقرأ من `app/netlify.toml`) |
| مجلد النشر | `dist` |
| Node | 22 (يُقرأ من `app/netlify.toml`) |

التطبيق ثابت بلا خادم ولا متغيرات بيئة ولا أسرار؛ لا شيء يُضبط خارج ملف `netlify.toml`.

## ١. الربط المستمر مع GitHub (مرة واحدة)

1. افتح مشروع `erp-requirements-workshop` في لوحة Netlify.
2. **Project configuration → Build & deploy → Continuous deployment → Link repository**، واختر GitHub ثم المستودع `eyad62689-lab/trustscan`.
3. اضبط:
   - **Branch to deploy (فرع الإنتاج):** الفرع الذي يحوي مجلد `erp-requirements-workshop/` (حالياً `claude/pensive-wright-gurb0x`؛ وبعد دمجه في `main` غيّره إلى `main`).
   - **Base directory:** `erp-requirements-workshop/app`
   - **Build command:** `npm ci && npm run build`
   - **Publish directory:** `erp-requirements-workshop/app/dist`
4. احفظ. سيبدأ أول نشر تلقائياً، وكل دفعة لاحقة إلى فرع الإنتاج تُعيد البناء والنشر.

> المستودع يحوي مشروعاً آخر (`trustscan/`) له موقع Netlify مستقل؛ مجلد الأساس يفصل بينهما، فلا يتأثر أحدهما بالآخر.

## ٢. نشر يدوي بديل (دون ربط)

إن أردت نشراً فورياً دون انتظار الربط: شغّل محلياً داخل `erp-requirements-workshop/app`:

```bash
npm ci && npm run build
```

ثم اسحب مجلد `dist` وأفلته في https://app.netlify.com/drop أو في صفحة **Deploys** الخاصة بالمشروع. ملفا `_headers` و`_redirects` داخل `dist` يحملان الترويسات الأمنية وتحويل المسارات نفسها، فلا يحتاج النشر اليدوي إلى `netlify.toml`.

**تنبيه:** النشر اليدوي على مشروع مربوط بـGit يُستبدل تلقائياً عند أول دفعة لاحقة إلى فرع الإنتاج.

## ٣. فحص ما بعد النشر

1. الصفحة الرئيسية تفتح وتعرض اسم البنك (2.6) ولا تعرض وسم «بيانات تجريبية»؛ ظهوره يعني أن `bank-data/*.json` لم تُضمّن في البناء.
2. ترويسات الاستجابة تحوي `Content-Security-Policy` و`X-Frame-Options: DENY` و`Cache-Control: no-cache` على `/index.html`.
3. تحديث أي مسار فرعي (مثل `/#/...`) يعيد `index.html` لا خطأ 404.
4. بدء ورشة والإجابة على بضعة أسئلة ثم **تصدير Word** و**تصدير Markdown** يعملان، والمحتوى متطابق.
5. إغلاق المتصفح وفتحه مجدداً يعيد التقدم من `localStorage`؛ وقطع الاتصال لا يمنع فتح التطبيق (عامل الخدمة `sw.js`).

## ٤. استكشاف الأخطاء

| العرض | السبب المرجح | المعالجة |
|---|---|---|
| البناء يفشل بـ`tsc` أو `vitest` | تغيير في المصدر لم يُختبر | شغّل `npm test && npm run build` محلياً قبل الدفع |
| البناء يفشل في `check-dist-urls` | رابط خارجي جديد في الحزمة | أزل الرابط أو استثنه في `scripts/check-dist-urls.mjs` |
| «بيانات تجريبية» على الموقع | ملفات `bank-data/` غائبة وقت البناء | تأكد أن مجلد الأساس صحيح وأن الملفات مدفوعة |
| 404 عند التحديث | قاعدة التحويل لم تُطبّق | تأكد من وجود `_redirects` في `dist` أو من مجلد الأساس |
| نسخة قديمة بعد النشر | ذاكرة عامل الخدمة | أعد تحميل الصفحة مرتين؛ `sw.js` و`index.html` بلا تخزين، والأصول مُسمّاة بتجزئة |
