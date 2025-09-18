"use client";

import { useEffect, useState } from "react";
import { Light as SyntaxHighlighter } from "react-syntax-highlighter";
import bash from "react-syntax-highlighter/dist/esm/languages/hljs/bash";
import javascript from "react-syntax-highlighter/dist/esm/languages/hljs/javascript";
import json from "react-syntax-highlighter/dist/esm/languages/hljs/json";
import typescript from "react-syntax-highlighter/dist/esm/languages/hljs/typescript";
import {
  atomOneDark,
  atomOneLight,
} from "react-syntax-highlighter/dist/esm/styles/hljs";

import { cn } from "@/lib/utils";

// Register languages
SyntaxHighlighter.registerLanguage("json", json);
SyntaxHighlighter.registerLanguage("javascript", javascript);
SyntaxHighlighter.registerLanguage("typescript", typescript);
SyntaxHighlighter.registerLanguage("bash", bash);

interface CodeBlockProps {
  children: string;
  language?: string;
  className?: string;
  showLineNumbers?: boolean;
  maxHeight?: string;
  wrapLines?: boolean;
}

export function CodeBlock({
  children,
  language = "json",
  className,
  showLineNumbers = false,
  maxHeight = "400px",
  wrapLines = true,
}: CodeBlockProps) {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    // Check if dark mode is enabled
    const checkDarkMode = () => {
      const isDarkMode = document.documentElement.classList.contains("dark");
      setIsDark(isDarkMode);
    };

    checkDarkMode();

    // Listen for changes to dark mode
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  return (
    <div
      className={cn("relative rounded-md overflow-hidden border", className)}
    >
      <SyntaxHighlighter
        language={language}
        style={isDark ? atomOneDark : atomOneLight}
        showLineNumbers={showLineNumbers}
        customStyle={{
          margin: 0,
          padding: "12px",
          fontSize: "12px",
          maxHeight,
          overflow: "auto",
          background: "var(--color-background)",
          color: "var(--color-foreground)",
        }}
        wrapLines={wrapLines}
        wrapLongLines={wrapLines}
      >
        {children}
      </SyntaxHighlighter>
    </div>
  );
}
