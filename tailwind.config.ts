import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./src/pages/**/*.{js,ts,jsx,tsx,mdx}", "./src/components/**/*.{js,ts,jsx,tsx,mdx}", "./src/app/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["var(--font-tektur)", "ui-sans-serif", "system-ui"],
        mono: ["var(--font-fragment)", "ui-monospace", "monospace"],
        body: ["var(--font-hanken)", "ui-sans-serif", "system-ui"],
        sans: ["var(--font-hanken)", "ui-sans-serif", "system-ui"],
      },
      colors: {
        carbon: { DEFAULT: "#07090A", 2: "#0F1312", 3: "#151A18" },
        lime: { DEFAULT: "#C6FF3D", dim: "#8FB82C" },
        signal: { DEFAULT: "#FF3B30" },
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "var(--radius)",
        sm: "var(--radius)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
