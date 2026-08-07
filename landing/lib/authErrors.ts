// Map Supabase Auth error messages (English, server-supplied) to Hebrew.
//
// The auth screens previously interpolated the raw `err.message` into a Hebrew
// sentence ("ההתחברות נכשלה: Invalid login credentials"), which reads as broken,
// unprofessional copy at the highest-friction moments (sign-in / recovery).
// This translates the handful of messages Supabase actually returns and falls
// back to a clean generic Hebrew line for anything unrecognized — never English.
export function authErrorHe(raw: string | undefined | null): string {
  const m = (raw || "").toLowerCase();
  if (/invalid login credentials|invalid credentials/.test(m)) {
    return "אימייל או סיסמה שגויים. נסו שוב.";
  }
  if (/email not confirmed|not confirmed|confirm your email/.test(m)) {
    return "החשבון עדיין לא אומת. בדקו את תיבת המייל שלכם.";
  }
  if (/for security purposes|rate limit|too many|after \d+ seconds|try again/.test(m)) {
    return "יותר מדי ניסיונות. המתינו רגע ונסו שוב.";
  }
  if (/expired|invalid|not found|token/.test(m)) {
    return "הקישור אינו תקף או שפג תוקפו. בקשו קישור חדש.";
  }
  if (/email logins are disabled|signups? not allowed|disabled/.test(m)) {
    return "התחברות עם אימייל אינה זמינה כרגע. פנו אלינו בטלפון.";
  }
  if (/network|failed to fetch|fetch/.test(m)) {
    return "שגיאת רשת. בדקו את החיבור ונסו שוב.";
  }
  return "אירעה שגיאה. נסו שוב מאוחר יותר.";
}
