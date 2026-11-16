"use client";

import { useState } from "react";
import s from "./PasswordInput.module.css";

// Password input with a show/hide toggle, shared by login / register / reset.
//
// The toggle is a real button (not an icon-div): keyboard reachable, named in
// Hebrew, aria-pressed reflects the state. type="button" so pressing it never
// submits the surrounding form. The input keeps whatever autocomplete the
// caller passes ("current-password" / "new-password") — browsers key their
// password managers off that attribute.
export default function PasswordInput({
  style,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  return (
    <span className={s.wrap}>
      <input
        {...props}
        type={show ? "text" : "password"}
        style={{
          ...style,
          width: "100%",
          boxSizing: "border-box",
          paddingInlineEnd: "3.2rem",
        }}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-pressed={show}
        aria-label={show ? "הסתרת הסיסמה" : "הצגת הסיסמה"}
        title={show ? "הסתרת הסיסמה" : "הצגת הסיסמה"}
        className={s.toggle}
      >
        {show ? "הסתרה" : "הצגה"}
      </button>
    </span>
  );
}
