import type { Metadata } from "next";
import { Cairo } from "next/font/google";
import "./globals.css";

const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "رادار التزييف | FakeRadar",
  description: "أداة متطورة تعتمد على الذكاء الاصطناعي لكشف المحتوى المزيف (Deepfakes)",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" className={`${cairo.variable} h-full antialiased dark`}>
      <body className="min-h-full flex flex-col bg-background text-foreground bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-surface to-background">
        <header className="border-b border-border bg-surface/80 backdrop-blur-md sticky top-0 z-50">
          <div className="container mx-auto px-4 h-16 flex items-center justify-between">
            <div className="flex items-center gap-2 text-primary font-bold text-xl">
              <span className="text-2xl">📡</span> رادار التزييف
            </div>
            <nav className="flex gap-6">
              <a href="/" className="hover:text-primary transition-colors text-sm font-medium cursor-pointer">الرئيسية</a>
              <a href="/analyze" className="hover:text-primary transition-colors text-sm font-medium cursor-pointer">أداة التحليل</a>
            </nav>
          </div>
        </header>

        <main className="flex-1 flex flex-col relative">
          {children}
        </main>

        <footer className="border-t border-border py-8 text-center text-foreground/50 text-sm bg-surface/30">
          <div className="container mx-auto px-4">
            تطبيق مدعوم بـ Sightengine API • جميع الحقوق محفوظة {new Date().getFullYear()}
          </div>
        </footer>
      </body>
    </html>
  );
}
