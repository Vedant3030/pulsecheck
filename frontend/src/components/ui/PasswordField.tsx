"use client";

import { useState } from "react";

interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  minLength?: number;
  hint?: string;
}

export function PasswordField({ id, label, value, onChange, autoComplete, minLength, hint }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  return <div className="auth-field"><label htmlFor={id}>{label}</label><div className="password-control"><input id={id} type={visible ? "text" : "password"} autoComplete={autoComplete} required minLength={minLength} value={value} onChange={(event) => onChange(event.target.value)} placeholder="Enter your password" /><button type="button" onClick={() => setVisible((current) => !current)} aria-label={visible ? "Hide password" : "Show password"}>{visible ? "Hide" : "Show"}</button></div>{hint && <p className="auth-hint">{hint}</p>}</div>;
}
