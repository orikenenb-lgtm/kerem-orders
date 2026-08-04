import type { Metadata } from "next";
import SiteHeader from "../components/SiteHeader";
import { tokens } from "../../lib/ui";

export const metadata: Metadata = {
  title: "הצהרת נגישות — כרם טויס",
  description: "הצהרת הנגישות של אתר כרם טויס — התאמות, מגבלות ודרכי פנייה.",
};

const sectionTitle = {
  fontFamily: tokens.rubik,
  fontWeight: 700,
  fontSize: "1.25rem",
  color: tokens.text,
  margin: "2rem 0 0.6rem",
} as const;

const para = {
  fontFamily: tokens.assistant,
  fontWeight: 400,
  fontSize: "1.05rem",
  lineHeight: 1.8,
  color: tokens.body,
  margin: "0 0 0.8rem",
} as const;

const listItem = {
  fontFamily: tokens.assistant,
  fontWeight: 400,
  fontSize: "1.05rem",
  lineHeight: 1.8,
  color: tokens.body,
  marginBottom: "0.35rem",
} as const;

export default function AccessibilityPage() {
  return (
    <div style={{ background: tokens.bg, minHeight: "100vh" }}>
      <SiteHeader />

      <main id="main-content"
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: "2.5rem clamp(1rem, 4vw, 2rem) 4rem",
        }}
      >
        <article>
          <h1
            style={{
              fontFamily: tokens.rubik,
              fontWeight: 900,
              fontSize: "clamp(1.8rem, 4vw, 2.4rem)",
              color: tokens.text,
              margin: "0 0 1rem",
            }}
          >
            הצהרת נגישות
          </h1>

          <p style={para}>
            אנו ב"כרם טויס" רואים חשיבות רבה במתן שירות שוויוני, מכבד ונגיש לכלל
            הלקוחות, לרבות אנשים עם מוגבלות. אנו משקיעים משאבים ומאמצים כדי
            שהאתר יהיה נוח וזמין לכולם, ופועלים לשיפור מתמיד של חוויית השימוש.
          </p>

          <h2 style={sectionTitle}>תקן ורמת הנגישות</h2>
          <p style={para}>
            האתר מונגש בהתאמה לתקן ישראלי (ת"י 5568) "קווים מנחים לנגישות תכנים
            באינטרנט" ברמה AA, המבוסס על הנחיות WCAG 2.1 הבין-לאומיות. הנגשת
            האתר היא מאמץ מתמשך, ואנו ממשיכים לבדוק ולשפר את הנגישות באופן
            שוטף.
          </p>

          <h2 style={sectionTitle}>מה הונגש באתר</h2>
          <ul style={{ paddingInlineStart: "1.4rem", margin: "0 0 0.8rem" }}>
            <li style={listItem}>ניווט מלא באמצעות מקלדת.</li>
            <li style={listItem}>טקסטים חלופיים (alt) לתמונות.</li>
            <li style={listItem}>ניגודיות צבעים תקינה בין טקסט לרקע.</li>
            <li style={listItem}>תמיכה בסיסית בקוראי מסך.</li>
            <li style={listItem}>
              ווידג'ט נגישות ייעודי הכולל הגדלת טקסט, ניגודיות גבוהה, הדגשת
              קישורים ועצירת אנימציות — נפתח מהכפתור העגול בתחתית המסך.
            </li>
          </ul>

          <h2 style={sectionTitle}>חלקים שטרם הונגשו</h2>
          <p style={para}>
            למרות מאמצינו, ייתכנו חלקים באתר שטרם הונגשו במלואם; נשמח לדיווח.
            אם נתקלתם בבעיה או בקושי בשימוש באתר — אנא פנו אלינו ונפעל לתקן את
            הליקוי בהקדם האפשרי.
          </p>

          <h2 style={sectionTitle}>רכז נגישות ודרכי פנייה</h2>
          <p style={para}>
            רכז הנגישות מטעם האתר: <strong>צוות כרם טויס</strong>.
          </p>
          {/* Contact channels: only details that actually exist. There is no
              dedicated accessibility email yet — so no email line at all
              rather than a placeholder or an invented address. */}
          <ul style={{ paddingInlineStart: "1.4rem", margin: "0 0 0.8rem" }}>
            <li style={listItem}>
              טלפון:{" "}
              <a
                href="tel:+972508524448"
                style={{ color: "#005A9C", fontWeight: 600 }}
              >
                050-852-4448
              </a>
            </li>
          </ul>
          <p style={para}>
            בפנייתכם אנא ציינו את מהות הבעיה, את הדף שבו נתקלתם בה ואת פרטי
            ההתקשרות שלכם. אנו נטפל בפנייה ונחזור אליכם בהקדם.
          </p>

          <h2 style={sectionTitle}>תאריך עדכון ההצהרה</h2>
          <p style={para}>ההצהרה עודכנה לאחרונה: יולי 2026.</p>
        </article>
      </main>
    </div>
  );
}
