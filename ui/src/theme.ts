import { useEffect, useState } from "react";

function savedTheme() {
  try {
    return localStorage.getItem("wiki-theme") || "dark";
  } catch {
    return "dark";
  }
}
/** Shared light/dark preference; storage is optional. */
export function useTheme(): [string, (value: string) => void] {
  const [theme, setTheme] = useState(savedTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("wiki-theme", theme);
    } catch {
      /* Storage is optional. */
    }
  }, [theme]);
  return [theme, setTheme];
}
