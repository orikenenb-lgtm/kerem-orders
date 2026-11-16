import type { Metadata } from "next";
import SiteHeader from "../components/SiteHeader";
import SiteFooter from "../components/SiteFooter";
import s from "./accessibility.module.css";

export const metadata: Metadata = {
  // The root layout's title template appends "— כרם טויס".
  title: "הצהרת נגישות",
  description: "הצהרת הנגישות של אתר כרם טויס — התאמות, מגבלות ודרכי פנייה.",
};

export default function AccessibilityPage() {
  return (
    <div className={s.page}>
      <SiteHeader />

      <main id="main-content" tabIndex={-1} className={s.main}>
        <article className={s.article}>
          <h1 className={s.title}>
            הצהרת נגישות
          </h1>

          <p className={s.para}>
            אנו ב״כרם טויס״ רואים חשיבות רבה במתן שירות שוויוני, מכבד ונגיש לכלל
            הלקוחות, לרבות אנשים עם מוגבלות. אנו משקיעים משאבים ומאמצים כדי
            שהאתר יהיה נוח וזמין לכולם, ופועלים לשיפור מתמיד של חוויית השימוש.
          </p>

          {/* Careful, accurate wording: the site AIMS at TI-5568/WCAG 2.1 AA
              and implements the measures listed below, but no full
              professional accessibility audit has been performed — so we do
              not claim verified conformance. The floating widget was removed
              at the owner's request and must not be mentioned here. */}
          <h2 className={s.h2}>תקן ורמת הנגישות</h2>
          <p className={s.para}>
            האתר פותח מתוך שאיפה לעמוד בעקרונות התקן הישראלי (ת״י 5568)
            ״קווים מנחים לנגישות תכנים באינטרנט״ ברמה AA, המבוסס על הנחיות
            WCAG 2.1 הבין-לאומיות. נכון למועד עדכון הצהרה זו טרם בוצעה בדיקת
            נגישות מקצועית מלאה של האתר, ולכן איננו מצהירים על עמידה מלאה
            ומאומתת בתקן. הנגשת האתר היא מאמץ מתמשך, ואנו ממשיכים לבדוק
            ולשפר את הנגישות באופן שוטף.
          </p>

          <h2 className={s.h2}>התאמות הנגישות שיושמו באתר</h2>
          <ul className={s.list}>
            <li className={s.li}>ניווט באמצעות מקלדת, כולל קישור דילוג לתוכן הראשי.</li>
            <li className={s.li}>טקסטים חלופיים (alt) לתמונות מוצרים.</li>
            <li className={s.li}>ניגודיות צבעים בין טקסט לרקע בהתאם לתקן (4.5:1 לטקסט רגיל).</li>
            <li className={s.li}>סימון ברור של הפוקוס בעת ניווט במקלדת.</li>
            <li className={s.li}>תוויות ומאפייני ARIA לרכיבים אינטראקטיביים, לתמיכה בקוראי מסך.</li>
            <li className={s.li}>תמיכה מלאה בכיווניות עברית (RTL) ובתצוגה במסכים קטנים.</li>
          </ul>

          <h2 className={s.h2}>חלקים שטרם הונגשו</h2>
          <p className={s.para}>
            למרות מאמצינו, ייתכנו חלקים באתר שטרם הונגשו במלואם; נשמח לדיווח.
            אם נתקלתם בבעיה או בקושי בשימוש באתר — אנא פנו אלינו ונפעל לתקן את
            הליקוי בהקדם האפשרי.
          </p>

          <h2 className={s.h2}>רכז נגישות ודרכי פנייה</h2>
          <p className={s.para}>
            רכז הנגישות מטעם האתר: <strong>צוות כרם טויס</strong>.
          </p>
          {/* Contact channels: only details that actually exist. There is no
              dedicated accessibility email yet — so no email line at all
              rather than a placeholder or an invented address. */}
          <ul className={s.list}>
            <li className={s.li}>
              טלפון:{" "}
              <a
                href="tel:+972508524448"
                className={s.link}
              >
                050-852-4448
              </a>
            </li>
          </ul>
          <p className={s.para}>
            בפנייתכם אנא ציינו את מהות הבעיה, את הדף שבו נתקלתם בה ואת פרטי
            ההתקשרות שלכם. אנו נטפל בפנייה ונחזור אליכם בהקדם.
          </p>

          <h2 className={s.h2}>תאריך עדכון ההצהרה</h2>
          <p className={s.para}>ההצהרה עודכנה לאחרונה: אוגוסט 2026.</p>
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
